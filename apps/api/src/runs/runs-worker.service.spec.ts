/**
 * RunsWorkerService unit tests — the `runs.dead` retry-exhaustion consumer
 * (durable-run-workers D7 mechanism 3). Full end-to-end liveness coverage
 * (worker-death → redelivery → healthy re-execute; a real pg-boss queue)
 * is DB-backed integration work deferred to the later test slice (tasks
 * 7.0/7.7) — this pins the handler's own logic with mocked dependencies:
 * it settles the dead-lettered run to a terminal run.expired IN THE OWNER'S
 * TENANT SCOPE (via TenantDbService.runAs(job.userId, ...)), and it respects
 * markFinished's first-writer-wins guard (a no-op when the run is already
 * terminal).
 */
import { type Queue, deadLetterQueue } from '../queue/queue';
import { type InstanceConfigService } from '../instance-config/instance-config.service';
import { type WorkerProfileService } from '../instance-config/worker-profile.service';
import { type ModelsService } from '../models/models.service';
import { type Db, type TenantDbService } from '../db/tenant-db.service';
import { type RunAbortRegistry } from './run-abort-registry';
import { type RunExecutionService } from './run-execution.service';
import { RunsWorkerService } from './runs-worker.service';
import { RUNS_QUEUE, type RunJob } from './run-queues';

/** Minimal fake Drizzle tx: every update/insert resolves `returning()` to `returningRow`. */
function makeFakeTx(returningRow: Record<string, unknown> | undefined) {
  const setSpy = jest.fn();
  const whereSpy = jest.fn();
  const valuesSpy = jest.fn();
  const returning = jest
    .fn()
    .mockResolvedValue(returningRow ? [returningRow] : []);

  const update = jest.fn(() => ({
    set: jest.fn((arg: unknown) => {
      setSpy(arg);
      return {
        where: jest.fn((arg2: unknown) => {
          whereSpy(arg2);
          return { returning };
        }),
      };
    }),
  }));
  const insert = jest.fn(() => ({
    values: jest.fn((arg: unknown) => {
      valuesSpy(arg);
      return { returning: jest.fn().mockResolvedValue([{}]) };
    }),
  }));

  return {
    tx: { update, insert } as unknown as Db,
    setSpy,
    whereSpy,
    valuesSpy,
  };
}

function makeService(tx: Db) {
  // Named consts (not accessed later as `queue.consume`/`tenantDb.runAs`) so
  // assertions reference a plain jest.fn variable, not an interface method —
  // oxlint's typescript-aware unbound-method rule flags the latter.
  const ensureQueueSpy = jest.fn().mockResolvedValue(undefined);
  const consumeSpy = jest.fn().mockResolvedValue('consumer-id');
  const queue = {
    ensureQueue: ensureQueueSpy,
    consume: consumeSpy,
    enqueue: jest.fn(),
    stopConsumer: jest.fn(),
    schedule: jest.fn(),
    unschedule: jest.fn(),
    cancel: jest.fn(),
  } as unknown as jest.Mocked<Queue>;

  const instanceConfig = {
    config: { runs: { heartbeatSeconds: 15, timeoutSeconds: 300 } },
  } as unknown as InstanceConfigService;

  // 'runs' is active in this fake profile (concurrency 1) — the test's
  // bootstrap-time assertions (dead-letter consumer registration) exercise
  // the not-gated-off path; profile-gating itself is covered in
  // worker-profile.service.spec.ts (design D2/D3, task 7.5).
  const workerProfile = {
    concurrencyFor: jest.fn().mockReturnValue(1),
  } as unknown as WorkerProfileService;

  const runAsSpy = jest.fn((_userId: string, cb: (tx: Db) => unknown) =>
    cb(tx),
  );
  const tenantDb = {
    runAs: runAsSpy,
  } as unknown as jest.Mocked<TenantDbService>;

  const service = new RunsWorkerService(
    queue,
    instanceConfig,
    workerProfile,
    {} as unknown as ModelsService,
    {} as unknown as RunExecutionService,
    tenantDb,
    {} as unknown as RunAbortRegistry,
  );

  return { service, consumeSpy, runAsSpy };
}

type ConsumeCall = [{ name: string }, (job: RunJob) => Promise<void>];

/** Capture the handler RunsWorkerService registered on the runs.dead queue. */
async function captureDeadLetterHandler(
  service: RunsWorkerService,
  consumeSpy: jest.Mock,
): Promise<(job: RunJob) => Promise<void>> {
  await service.onApplicationBootstrap();
  const deadQueueName = deadLetterQueue(RUNS_QUEUE).name;
  const calls = consumeSpy.mock.calls as ConsumeCall[];
  const call = calls.find(([definition]) => definition.name === deadQueueName);
  if (!call) {
    throw new Error('runs.dead consumer was never registered');
  }
  return call[1];
}

describe('RunsWorkerService — runs.dead retry-exhaustion consumer (design D7)', () => {
  const job: RunJob = {
    runId: 'run-1',
    chatId: 'chat-1',
    userId: 'owner-xyz',
    modelId: 'system:openai:gpt-5.4-mini',
    userMessage: { id: 'msg-1', seq: 1, parts: [] },
  };

  it('registers a consumer on the runs.dead dead-letter queue at bootstrap', async () => {
    const { tx } = makeFakeTx({ id: job.runId, status: 'expired' });
    const { service, consumeSpy } = makeService(tx);
    await service.onApplicationBootstrap();
    expect(consumeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'runs.dead' }),
      expect.any(Function),
    );
  });

  it('settles a dead-lettered run to a terminal run.expired IN THE OWNER TENANT SCOPE', async () => {
    const { tx, setSpy, whereSpy, valuesSpy } = makeFakeTx({
      id: job.runId,
      status: 'expired',
    });
    const { service, consumeSpy, runAsSpy } = makeService(tx);
    const handler = await captureDeadLetterHandler(service, consumeSpy);

    await handler(job);

    // runAs is scoped by the JOB'S owner userId — never a cross-tenant scan.
    expect(runAsSpy).toHaveBeenCalledWith(job.userId, expect.any(Function));
    // markFinished: status set to 'expired'.
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'expired' }),
    );
    expect(whereSpy).toHaveBeenCalled();
    // The run.expired event is appended alongside it.
    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ runId: job.runId, eventType: 'run.expired' }),
    );
  });

  it('is a no-op when the run already reached a terminal state (first-writer-wins)', async () => {
    // markFinished's WHERE excludes already-terminal runs — the mock
    // simulates that by resolving `returning()` to an empty array (no row
    // updated), exactly like a real "already terminal" outcome.
    const { tx, valuesSpy } = makeFakeTx(undefined);
    const { service, consumeSpy } = makeService(tx);
    const handler = await captureDeadLetterHandler(service, consumeSpy);

    await handler(job);

    // No event is appended when markFinished didn't win the write.
    expect(valuesSpy).not.toHaveBeenCalled();
  });
});
