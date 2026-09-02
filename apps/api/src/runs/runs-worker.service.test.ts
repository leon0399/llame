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
import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import {
  type ConsumeOptions,
  type QueueConsumer,
  deadLetterQueue,
} from '../queue/queue';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type WorkerConcurrencyResolver } from '../instance-config/worker-profile.service';
import { type ModelClientFactory } from '../models/models.service';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { type RunAbortRegistrar } from './run-abort-registry';
import { ModelContextExecutionError } from './snapshot-tool-execution';
import { type RunExecutor, type RunUserMessage } from './run-execution.service';
import { RunsRepository } from './runs-repository';
import { RunsWorkerService } from './runs-worker.service';
import { RUNS_QUEUE, type RunJob } from './run-queues';
import { type CanonicalSearchCoverageGate } from '../search/canonical-search-activation.service';

import type { Mock } from 'vitest';

/** Native Drizzle mock; repository behavior is mocked at its public seam. */
function makeFakeTx(): Db {
  return drizzle.mock({ schema });
}

/** A capability the test never exercises still needs a real (throwing) member — an empty object satisfies no narrowed interface either. */
function unstubbed(method: string) {
  return (): never => {
    throw new Error(`${method} was not stubbed for this test`);
  };
}

/**
 * The concrete instantiation of `QueueConsumer['consume']` this suite mocks —
 * both the runs queue and its dead-letter queue share this handler shape.
 * `vi.fn()`'s own generic can't express `consume`'s `<Q extends
 * QueueDefinition<any>>` signature directly, so the mock is typed at this
 * fixed instantiation instead of the generic method.
 */
type ConsumeMockFn = (
  queue: { name: string },
  handler: (job: RunJob) => Promise<void>,
  options?: ConsumeOptions,
) => Promise<string>;

function makeService(
  tx: Db,
  overrides: {
    models?: ModelClientFactory;
    runExecution?: RunExecutor;
    aborts?: RunAbortRegistrar;
    canonicalSearchCoverage?: CanonicalSearchCoverageGate;
    allowedTools?: Array<string>;
    runsConcurrency?: number | null;
  } = {},
) {
  // Named consts (not accessed later as `queue.consume`/`tenantDb.runAs`) so
  // assertions reference a plain vi.fn variable, not an interface method —
  // oxlint's typescript-aware unbound-method rule flags the latter.
  const ensureQueueSpy = vi.fn().mockResolvedValue(undefined);
  const consumeSpy = vi.fn<ConsumeMockFn>().mockResolvedValue('consumer-id');
  const queue: QueueConsumer = {
    ensureQueue: ensureQueueSpy,
    consume: consumeSpy,
  };

  const instanceConfig: InstanceConfigReader = {
    config: {
      ...BUILT_IN_DEFAULTS,
      runs: {
        ...BUILT_IN_DEFAULTS.runs,
        heartbeatSeconds: 15,
        timeoutSeconds: 300,
      },
      tools: {
        ...BUILT_IN_DEFAULTS.tools,
        allowed: overrides.allowedTools ?? [],
      },
    },
  };

  // 'runs' is active in this fake profile (concurrency 1) — the test's
  // bootstrap-time assertions (dead-letter consumer registration) exercise
  // the not-gated-off path; profile-gating itself is covered in
  // worker-profile.service.test.ts (design D2/D3, task 7.5).
  const workerProfile: WorkerConcurrencyResolver = {
    concurrencyFor: vi
      .fn()
      .mockReturnValue(
        overrides.runsConcurrency === undefined ? 1 : overrides.runsConcurrency,
      ),
  };

  // Records calls for assertions only — `runAs` below performs the actual
  // invocation, so this must not also call `cb` or the callback would run
  // twice.
  const runAsSpy = vi.fn(
    <T>(_userId: string, _cb: (tx: Db) => T | Promise<T>) => {},
  );
  // A mocked generic method infers a concrete T that can't structurally
  // satisfy `runAs`'s own `<T>`. A plain (non-mocked) arrow function assigned
  // to the generic-typed slot lets TS infer the real generic signature; it
  // delegates to the spy for tracking without ever widening then asserting.
  const runAs: TenantRunner['runAs'] = (userId, fn) => {
    runAsSpy(userId, fn);
    return fn(tx);
  };
  const tenantDb: TenantRunner = { runAs };

  const service = new RunsWorkerService(
    queue,
    instanceConfig,
    workerProfile,
    overrides.canonicalSearchCoverage ?? {
      assertReady: () => Promise.resolve(),
    },
    overrides.models ?? { createClient: unstubbed('createClient') },
    overrides.runExecution ?? {
      executeRun: unstubbed('executeRun'),
      settleTerminalRun: unstubbed('settleTerminalRun'),
    },
    tenantDb,
    overrides.aborts ?? {
      register: unstubbed('register'),
      unregister: unstubbed('unregister'),
    },
  );

  return { service, consumeSpy, ensureQueueSpy, runAsSpy };
}

/** Capture the handler RunsWorkerService registered on the main runs queue. */
async function captureRunsHandler(
  service: RunsWorkerService,
  consumeSpy: Mock<ConsumeMockFn>,
): Promise<(job: RunJob) => Promise<void>> {
  await service.onApplicationBootstrap();
  const call = consumeSpy.mock.calls.find(
    ([definition]) => definition.name === RUNS_QUEUE.name,
  );
  if (!call) {
    throw new Error('runs consumer was never registered');
  }
  return call[1];
}

/** Capture the handler RunsWorkerService registered on the runs.dead queue. */
async function captureDeadLetterHandler(
  service: RunsWorkerService,
  consumeSpy: Mock<ConsumeMockFn>,
): Promise<(job: RunJob) => Promise<void>> {
  await service.onApplicationBootstrap();
  const deadQueueName = deadLetterQueue(RUNS_QUEUE).name;
  const call = consumeSpy.mock.calls.find(
    ([definition]) => definition.name === deadQueueName,
  );
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a consumer on the runs.dead dead-letter queue at bootstrap', async () => {
    const tx = makeFakeTx();
    const { service, consumeSpy } = makeService(tx);
    await service.onApplicationBootstrap();
    expect(consumeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'runs.dead' }),
      expect.any(Function),
    );
  });

  it('settles a dead-lettered run to a terminal run.expired IN THE OWNER TENANT SCOPE', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');
    const tx = makeFakeTx();
    const settleTerminalRun = vi
      .fn()
      .mockResolvedValue({ outcome: 'won' as const });
    const { service, consumeSpy } = makeService(tx, {
      runExecution: {
        executeRun: unstubbed('executeRun'),
        settleTerminalRun,
      },
    });
    const handler = await captureDeadLetterHandler(service, consumeSpy);

    await handler(job);

    expect(settleTerminalRun).toHaveBeenCalledWith({
      runId: job.runId,
      userId: job.userId,
      status: 'expired',
      runPayload: {
        status: 'expired',
        message:
          'Run retries exhausted: the worker repeatedly failed to complete it.',
      },
      error: {
        message:
          'Run retries exhausted: the worker repeatedly failed to complete it.',
      },
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      `Expired run ${job.runId} (retries exhausted)`,
    );
    // The central finalizer receives the job owner's identity; its integration
    // test pins owner-scoped reads/writes and settlement-before-terminal order.
  });

  it('is a no-op when the run already reached a terminal state (first-writer-wins)', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');
    // The central finalizer reports a guarded markFinished loss when another
    // terminal writer already won; the dead-letter consumer accepts that no-op.
    const tx = makeFakeTx();
    const settleTerminalRun = vi.fn().mockResolvedValue({
      outcome: 'lost' as const,
      finalStatus: 'completed',
    });
    const { service, consumeSpy } = makeService(tx, {
      runExecution: {
        executeRun: unstubbed('executeRun'),
        settleTerminalRun,
      },
    });
    const handler = await captureDeadLetterHandler(service, consumeSpy);

    await handler(job);

    expect(settleTerminalRun).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('RunsWorkerService — canonical search coverage admission', () => {
  const localToolCases: Array<[string, Array<string>]> = [
    ['without a local search tool', []],
    ['with a local search tool', ['search_conversations']],
  ];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(localToolCases)(
    'gates a runs-consuming worker before queue registration %s',
    async (_name, allowedTools) => {
      const assertReady = vi.fn().mockResolvedValue(undefined);
      const { service, consumeSpy } = makeService(makeFakeTx(), {
        allowedTools,
        canonicalSearchCoverage: { assertReady },
      });

      await service.onApplicationBootstrap();

      expect(assertReady).toHaveBeenCalledTimes(1);
      expect(assertReady.mock.invocationCallOrder[0]).toBeLessThan(
        consumeSpy.mock.invocationCallOrder[0],
      );
    },
  );

  it('fails before registering a runs consumer when coverage is incomplete', async () => {
    const assertReady = vi
      .fn()
      .mockRejectedValue(new Error('aggregate coverage incomplete'));
    const { service, consumeSpy, ensureQueueSpy } = makeService(makeFakeTx(), {
      canonicalSearchCoverage: { assertReady },
    });

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      'aggregate coverage incomplete',
    );
    expect(ensureQueueSpy).not.toHaveBeenCalled();
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it('skips coverage and queue registration for a non-Run worker profile', async () => {
    const assertReady = vi.fn().mockResolvedValue(undefined);
    const { service, consumeSpy } = makeService(makeFakeTx(), {
      allowedTools: ['search_conversations'],
      runsConcurrency: null,
      canonicalSearchCoverage: { assertReady },
    });

    await service.onApplicationBootstrap();

    expect(assertReady).not.toHaveBeenCalled();
    expect(consumeSpy).not.toHaveBeenCalled();
  });
});

describe('RunsWorkerService — pickup cancellation and post-drain liveness', () => {
  const job: RunJob = {
    runId: 'run-worker-liveness',
    chatId: 'chat-1',
    userId: 'owner-xyz',
    modelId: 'system:openai:gpt-5.4-mini',
    userMessage: {
      id: 'msg-1',
      seq: 1,
      parts: [{ type: 'text', text: 'Continue.' }],
    } satisfies RunUserMessage,
  };
  const queuedRun = {
    id: job.runId,
    chatId: job.chatId,
    messageId: job.userMessage.id,
    userId: job.userId,
    modelId: job.modelId,
    modelContextSnapshotId: 'snapshot-1',
    effort: null,
    status: 'queued' as const,
    cancelRequestedAt: null,
    startedAt: null,
    finishedAt: null,
    error: null,
    contextItems: null,
    workerId: null,
    createdAt: new Date(),
  };
  const cancellationMessage =
    'Run was cancelled before this worker attempt started.';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a resolved stream drain when the owner-scoped run is still nonterminal so the queue retries', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById')
      .mockResolvedValueOnce(queuedRun)
      .mockResolvedValueOnce(queuedRun)
      .mockResolvedValueOnce({
        ...queuedRun,
        status: 'running_model',
        startedAt: new Date(),
      });
    const consumeStream = vi.fn().mockResolvedValue(undefined);
    const executeRun = vi.fn().mockResolvedValue({ consumeStream });
    const abort = new AbortController();
    const unregister = vi.fn();
    const tx = makeFakeTx();
    const { service, consumeSpy, runAsSpy } = makeService(tx, {
      models: { createClient: vi.fn().mockReturnValue({}) },
      runExecution: {
        executeRun,
        settleTerminalRun: unstubbed('settleTerminalRun'),
      },
      aborts: {
        register: vi.fn().mockReturnValue(abort),
        unregister,
      },
    });
    const handler = await captureRunsHandler(service, consumeSpy);

    await expect(handler(job)).rejects.toThrow(
      `Run ${job.runId} stream drained without a durable terminal state.`,
    );

    expect(consumeStream).toHaveBeenCalledTimes(1);
    expect(runAsSpy).toHaveBeenLastCalledWith(job.userId, expect.any(Function));
    expect(unregister).toHaveBeenCalledWith(job.runId);
  });

  it('routes a cancellation already visible at initial pickup through central terminal settlement', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue({
      ...queuedRun,
      cancelRequestedAt: new Date(),
    });
    const settleTerminalRun = vi.fn().mockResolvedValue({
      outcome: 'won' as const,
    });
    const tx = makeFakeTx();
    const { service, consumeSpy } = makeService(tx, {
      runExecution: {
        executeRun: unstubbed('executeRun'),
        settleTerminalRun,
      },
    });
    const handler = await captureRunsHandler(service, consumeSpy);

    await handler(job);

    expect(settleTerminalRun).toHaveBeenCalledWith({
      runId: job.runId,
      userId: job.userId,
      status: 'cancelled',
      runPayload: { status: 'cancelled', message: cancellationMessage },
      error: { message: cancellationMessage },
    });
  });

  it('routes a cancellation that wins the register recheck through central terminal settlement', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById')
      .mockResolvedValueOnce(queuedRun)
      .mockResolvedValueOnce({
        ...queuedRun,
        cancelRequestedAt: new Date(),
      });
    const settleTerminalRun = vi.fn().mockResolvedValue({
      outcome: 'won' as const,
    });
    const abort = new AbortController();
    const unregister = vi.fn();
    const tx = makeFakeTx();
    const { service, consumeSpy } = makeService(tx, {
      models: { createClient: vi.fn().mockReturnValue({}) },
      runExecution: {
        executeRun: unstubbed('executeRun'),
        settleTerminalRun,
      },
      aborts: {
        register: vi.fn().mockReturnValue(abort),
        unregister,
      },
    });
    const handler = await captureRunsHandler(service, consumeSpy);

    await handler(job);

    expect(unregister).toHaveBeenCalledWith(job.runId);
    expect(settleTerminalRun).toHaveBeenCalledWith({
      runId: job.runId,
      userId: job.userId,
      status: 'cancelled',
      runPayload: { status: 'cancelled', message: cancellationMessage },
      error: { message: cancellationMessage },
    });
  });
});

describe('RunsWorkerService — durable run-level failures', () => {
  const job: RunJob = {
    runId: 'run-context-incompatible',
    chatId: 'chat-1',
    userId: 'owner-xyz',
    modelId: 'system:openai:gpt-5.4-mini',
    userMessage: {
      id: 'msg-1',
      seq: 1,
      parts: [{ type: 'text', text: 'Continue.' }],
    } satisfies RunUserMessage,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('settles a durably recorded model-context incompatibility without asking the queue to retry', async () => {
    const run = {
      id: job.runId,
      chatId: job.chatId,
      messageId: job.userMessage.id,
      userId: job.userId,
      modelId: job.modelId,
      modelContextSnapshotId: 'snapshot-1',
      effort: null,
      status: 'queued',
      cancelRequestedAt: null,
      startedAt: null,
      finishedAt: null,
      error: null,
      contextItems: null,
      workerId: null,
      createdAt: new Date(),
    } as const;
    vi.spyOn(RunsRepository.prototype, 'findById')
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({ ...run, status: 'failed' });
    const createClient = vi.fn().mockReturnValue({});
    const executeRun = vi
      .fn()
      .mockRejectedValue(
        new ModelContextExecutionError('snapshot tool declaration drifted'),
      );
    const abort = new AbortController();
    const unregister = vi.fn();
    const tx = makeFakeTx();
    const { service, consumeSpy } = makeService(tx, {
      models: { createClient },
      runExecution: {
        executeRun,
        settleTerminalRun: unstubbed('settleTerminalRun'),
      },
      aborts: {
        register: vi.fn().mockReturnValue(abort),
        unregister,
      },
    });
    const handler = await captureRunsHandler(service, consumeSpy);

    await expect(handler(job)).resolves.toBeUndefined();

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(executeRun).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledWith(job.runId);
  });

  it('rejects the queue job when model-context failure did not reach a durable terminal state', async () => {
    const run = {
      id: job.runId,
      chatId: job.chatId,
      messageId: job.userMessage.id,
      userId: job.userId,
      modelId: job.modelId,
      modelContextSnapshotId: 'snapshot-1',
      effort: null,
      status: 'queued' as const,
      cancelRequestedAt: null,
      startedAt: null,
      finishedAt: null,
      error: null,
      contextItems: null,
      workerId: null,
      createdAt: new Date(),
    };
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(run);
    const contextError = new ModelContextExecutionError(
      'snapshot tool declaration drifted',
    );
    const abort = new AbortController();
    const tx = makeFakeTx();
    const { service, consumeSpy } = makeService(tx, {
      models: {
        createClient: vi.fn().mockReturnValue({}),
      },
      runExecution: {
        executeRun: vi.fn().mockRejectedValue(contextError),
        settleTerminalRun: unstubbed('settleTerminalRun'),
      },
      aborts: {
        register: vi.fn().mockReturnValue(abort),
        unregister: vi.fn(),
      },
    });
    const handler = await captureRunsHandler(service, consumeSpy);

    await expect(handler(job)).rejects.toBe(contextError);
  });
});
