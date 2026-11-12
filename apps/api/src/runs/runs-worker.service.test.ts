/** Worker pickup, execution limits, queue registration and artifact sweeping. */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path, { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type ConsumeOptions, type QueueConsumer } from '../queue/queue';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type WorkerConcurrencyResolver } from '../instance-config/worker-profile.service';
import {
  ModelNotAvailableError,
  type ModelClientFactory,
} from '../models/models.service';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { type RunAbortRegistrar } from './run-abort-registry';
import { type RunWaitService } from './run-wait.service';
import { ModelContextExecutionError } from './model-context-errors';
import {
  RUN_CEILING_ABORT_REASON,
  RUN_TIMEOUT_ABORT_REASON,
  type RunExecutor,
  type RunUserMessage,
} from './run-execution.service';
import { RUN_EXECUTION_CEILING_SECONDS } from './run-queues';
import {
  artifactDirectory,
  SWEEP_AFTER_MS,
} from '../tools/artifacts/host-files';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { RunsWorkerService } from './runs-worker.service';
import { RUNS_QUEUE, type RunJob } from './run-queues';
import { type CanonicalSearchCoverageGate } from '../search/canonical-search-activation.service';

import type { Mock } from 'vitest';

beforeEach(() => {
  vi.spyOn(RunEventsRepository.prototype, 'findFirstByType').mockResolvedValue(
    undefined,
  );
});

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
    timeoutSeconds?: number | null;
    models?: ModelClientFactory;
    runExecution?: RunExecutor;
    aborts?: RunAbortRegistrar;
    runWait?: Pick<RunWaitService, 'wakeInTransaction'>;
    canonicalSearchCoverage?: CanonicalSearchCoverageGate;
    allowedTools?: Array<string>;
    nativeExecutorId?: string;
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
        // `null` is a real value here (no budget), not "unset".
        timeoutSeconds:
          overrides.timeoutSeconds !== undefined
            ? overrides.timeoutSeconds
            : 300,
      },
      tools: {
        ...BUILT_IN_DEFAULTS.tools,
        allowed: overrides.allowedTools ?? [],
        nativeExecutorId: overrides.nativeExecutorId,
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
    overrides.runWait ?? {
      wakeInTransaction: vi.fn().mockResolvedValue(false),
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

describe('RunsWorkerService — runs.dead retry-exhaustion consumer (design D7)', () => {
  const hostRoots: Array<string> = [];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();

    for (const root of hostRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** A private `$TMPDIR` for this test's artifact root. */
  function hostTmpdir(): string {
    const root = mkdtempSync(path.join(tmpdir(), 'artifact-worker-sweep-'));
    hostRoots.push(root);
    vi.stubEnv('TMPDIR', root);

    return root;
  }

  it('registers a consumer on the runs.dead dead-letter queue at bootstrap', async () => {
    const tx = makeFakeTx();
    const { service, consumeSpy } = makeService(tx);
    await service.onApplicationBootstrap();
    expect(consumeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'runs.dead' }),
      expect.any(Function),
    );
  });

  it('removes a Chat artifact directory no attempt reconciled for seven days', async () => {
    hostTmpdir();

    const stale = path.join(
      artifactDirectory('0b0b2a2e-7a7f-4a53-9d0e-2f2f6a3c3b11'),
      'bash-1',
    );

    const live = path.join(
      artifactDirectory('5d0e9d9e-9a5f-4cbb-8a0f-6c4a1f6a2e77'),
      'bash-2',
    );

    mkdirSync(stale, { recursive: true, mode: 0o700 });
    mkdirSync(live, { recursive: true, mode: 0o700 });
    const staleSeen = new Date(Date.now() - SWEEP_AFTER_MS - 1);
    utimesSync(dirname(dirname(stale)), staleSeen, staleSeen);
    const tx = makeFakeTx();

    const { service } = makeService(tx, {
      allowedTools: ['bash'],
      nativeExecutorId: 'host-a',
    });

    await service.onApplicationBootstrap();

    // The startup sweep runs in the background.
    await vi.waitFor(() =>
      expect(existsSync(dirname(dirname(stale)))).toBe(false),
    );
    expect(existsSync(dirname(dirname(live)))).toBe(true);
  });

  it('sweeps nothing when the worker keeps no host files', async () => {
    hostTmpdir();

    const stale = path.join(
      artifactDirectory('0b0b2a2e-7a7f-4a53-9d0e-2f2f6a3c3b11'),
      'bash-1',
    );

    mkdirSync(stale, { recursive: true, mode: 0o700 });
    const staleSeen = new Date(Date.now() - SWEEP_AFTER_MS - 1);
    utimesSync(dirname(dirname(stale)), staleSeen, staleSeen);
    const tx = makeFakeTx();
    const { service } = makeService(tx, { allowedTools: ['read'] });

    await service.onApplicationBootstrap();

    expect(existsSync(dirname(dirname(stale)))).toBe(true);
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
    activeAttemptId: null,
    completedAttemptId: null,
    turnToolAvailability: null,
    effort: null,
    permissionMode: 'default' as const,
    status: 'queued' as const,
    cancelRequestedAt: null,
    startedAt: null,
    finishedAt: null,
    error: null,
    workerId: null,
    createdAt: new Date(),
    followUpAction: null,
    sourceRunId: null,
    wakeGeneration: 0,
    currentJobId: null,
    awaiting: null,
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
      `Run ${job.runId} stream drained without a durable terminal or suspension state.`,
    );

    expect(consumeStream).toHaveBeenCalledTimes(1);
    expect(runAsSpy).toHaveBeenLastCalledWith(job.userId, expect.any(Function));
    expect(unregister).toHaveBeenCalledWith(job.runId, abort);
  });
  it('ignores a wake job whose generation is no longer current', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue({
      ...queuedRun,
      currentJobId: 'current-job',
      wakeGeneration: 4,
    });
    const createClient = vi.fn();
    const settleTerminalRun = vi.fn();

    const { service, consumeSpy } = makeService(makeFakeTx(), {
      models: { createClient },
      runExecution: {
        executeRun: unstubbed('executeRun'),
        settleTerminalRun,
      },
    });

    const handler = await captureRunsHandler(service, consumeSpy);

    await handler({
      ...job,
      wake: { generation: 3, jobId: 'stale-job' },
    });

    expect(createClient).not.toHaveBeenCalled();
    expect(settleTerminalRun).not.toHaveBeenCalled();
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

    expect(unregister).toHaveBeenCalledWith(job.runId, abort);
    expect(settleTerminalRun).toHaveBeenCalledWith({
      runId: job.runId,
      userId: job.userId,
      status: 'cancelled',
      runPayload: { status: 'cancelled', message: cancellationMessage },
      error: { message: cancellationMessage },
    });
  });

  it('routes a pickup failure through central terminal settlement, which refreshes search', async () => {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(queuedRun);

    const settleTerminalRun = vi.fn().mockResolvedValue({
      outcome: 'won' as const,
    });

    const unavailable = new ModelNotAvailableError(job.modelId);

    const { service, consumeSpy } = makeService(makeFakeTx(), {
      models: {
        createClient: () => {
          throw unavailable;
        },
      },
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
      status: 'failed',
      runPayload: { status: 'failed', message: unavailable.message },
      error: { message: unavailable.message },
    });
  });
});

const ONE_SECOND_MS = 1000;

describe('RunsWorkerService — the per-attempt execution limit (opt-in-run-limits D2)', () => {
  const job: RunJob = {
    runId: 'run-execution-limit',
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
    activeAttemptId: null,
    completedAttemptId: null,
    turnToolAvailability: null,
    effort: null,
    permissionMode: 'default' as const,
    status: 'running_model' as const,
    cancelRequestedAt: null,
    startedAt: new Date(),
    finishedAt: null,
    error: null,
    workerId: null,
    createdAt: new Date(),
    followUpAction: null,
    sourceRunId: null,
    wakeGeneration: 0,
    currentJobId: null,
    awaiting: null,
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Runs one job to its in-flight point and returns the live abort spy. */
  async function armFor(timeoutSeconds: number | null): Promise<Mock> {
    vi.spyOn(RunsRepository.prototype, 'findById').mockResolvedValue(queuedRun);
    const controller = new AbortController();
    const abort = vi.spyOn(controller, 'abort');

    const { service, consumeSpy } = makeService(makeFakeTx(), {
      timeoutSeconds,
      models: { createClient: vi.fn().mockReturnValue({}) },
      runExecution: {
        // Never settles: the run stays in flight while the timer runs.
        executeRun: vi.fn(() => new Promise<never>(() => {})),
        settleTerminalRun: vi
          .fn()
          .mockResolvedValue({ outcome: 'won' as const }),
      },
      aborts: {
        register: vi.fn().mockReturnValue(controller),
        unregister: vi.fn(),
      },
    });

    const handler = await captureRunsHandler(service, consumeSpy);
    void handler(job);
    await vi.waitFor(() => expect(abort).not.toHaveBeenCalled());

    return abort;
  }

  it('aborts with the budget reason at the configured budget', async () => {
    vi.useFakeTimers();
    const abort = await armFor(300);

    await vi.advanceTimersByTimeAsync(299_000);
    expect(abort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ONE_SECOND_MS);
    expect(abort).toHaveBeenCalledWith(RUN_TIMEOUT_ABORT_REASON);
  });

  it('aborts with the ceiling reason, not a budget, when no budget is configured', async () => {
    vi.useFakeTimers();
    const abort = await armFor(null);

    // A no-budget run is still ended — by the substrate's ceiling, well past
    // any budget an operator would have configured.
    await vi.advanceTimersByTimeAsync(RUN_EXECUTION_CEILING_SECONDS * 1000 - 1);
    expect(abort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ONE_SECOND_MS);
    expect(abort).toHaveBeenCalledWith(RUN_CEILING_ABORT_REASON);
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
      activeAttemptId: null,
      completedAttemptId: null,
      turnToolAvailability: null,
      effort: null,
      permissionMode: 'default' as const,
      status: 'queued',
      cancelRequestedAt: null,
      startedAt: null,
      finishedAt: null,
      error: null,
      workerId: null,
      createdAt: new Date(),
      followUpAction: null,
      sourceRunId: null,
      wakeGeneration: 0,
      currentJobId: null,
      awaiting: null,
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
    expect(unregister).toHaveBeenCalledWith(job.runId, abort);
  });

  it('rejects the queue job when model-context failure did not reach a durable terminal state', async () => {
    const run = {
      id: job.runId,
      chatId: job.chatId,
      messageId: job.userMessage.id,
      userId: job.userId,
      modelId: job.modelId,
      activeAttemptId: null,
      completedAttemptId: null,
      turnToolAvailability: null,
      effort: null,
      permissionMode: 'default' as const,
      status: 'queued' as const,
      cancelRequestedAt: null,
      startedAt: null,
      finishedAt: null,
      error: null,
      workerId: null,
      createdAt: new Date(),
      followUpAction: null,
      wakeGeneration: 0,
      currentJobId: null,
      awaiting: null,
      sourceRunId: null,
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
