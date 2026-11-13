import { type MockInstance } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import {
  BashProcessLimiter,
  type BashResult,
  type ManagedBashHandle,
  type ManagedOutput,
  type ManagedStopResult,
} from '@workspace/bash-executor';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type ChatJob } from '../db/schema';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { BashJobRegistry } from '../jobs/bash-job-registry';
import { formatJobLocator } from '../jobs/job-locator';
import { foregroundBoundMs } from './bash-limits';
import { JobPromotionError } from '../jobs/job-promotion-error';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { bashTool } from './bash';
import { runAsyncBash } from './bash-async';
import { runTool } from './runner';
import { type ToolContext } from './types';

const EMPTY: ManagedOutput = {
  stdout: '',
  stderr: '',
  truncated: false,
  truncatedStreams: { stdout: false, stderr: false },
};

class Command implements ManagedBashHandle {
  readonly pid = 4242;
  private readonly result = Promise.withResolvers<BashResult>();
  readonly settled = this.result.promise;
  proved = true;
  output: ManagedOutput = EMPTY;
  /** False keeps `settled` pending after a stop, as a slow process group does. */
  autoSettle = true;
  readonly stop = vi.fn((cause: string): Promise<ManagedStopResult> => {
    if (this.autoSettle)
      this.result.resolve({
        status: 'error',
        type: 'cancelled',
        message: cause,
      });

    return Promise.resolve({ ...this.output, proved: this.proved });
  });
  exit(exitCode: number): void {
    this.result.resolve({
      status: exitCode === 0 ? 'success' : 'error',
      exitCode,
      ...this.output,
    });
  }
  settle(): void {
    this.result.resolve({
      status: 'error',
      type: 'cancelled',
      message: 'settled',
    });
  }
  snapshot(): ManagedOutput {
    return this.output;
  }
  onOutput(): () => void {
    return () => undefined;
  }
}

function jobRow(seq: number): ChatJob {
  return {
    id: crypto.randomUUID(),
    chatId: crypto.randomUUID(),
    ownerUserId: 'owner',
    executor: 'bash',
    seq,
    state: 'running',
    stoppedBy: null,
    runId: crypto.randomUUID(),
    toolCallId: 'call-1',
    workerInstanceId: crypto.randomUUID(),
    pid: 4242,
    startedAt: new Date(),
    settledAt: null,
    deadlineAt: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    result: null,
    outputs: ['stdout', 'stderr'],
    artifactId: null,
    artifactReadable: false,
    settings: { modelId: 'm', permissionMode: 'default' },
  };
}

class StubRegistry extends BashJobRegistry {
  command = new Command();
  readonly promoteCalls: Array<{ handle: ManagedBashHandle; stdout: string }> =
    [];
  promotion: () => Promise<ChatJob> = () => Promise.resolve(jobRow(7));
  override start(): ManagedBashHandle {
    return this.command;
  }
  override promote(handle: ManagedBashHandle): Promise<ChatJob> {
    this.promoteCalls.push({ handle, stdout: handle.snapshot().stdout });

    return this.promotion();
  }
}

/** A promotion that failed: the registry stops the command, then rejects. */
function failingMove(command: Command, proved: boolean, stdout = '') {
  return async (): Promise<ChatJob> => {
    command.output = { ...EMPTY, stdout };
    command.proved = proved;
    const stopped = await command.stop('run');

    throw new JobPromotionError(stopped, {
      cause: new Error('database refused the job record'),
    });
  };
}

describe('foreground bound', () => {
  it('is the lesser of the operator bound and the call timeout', () => {
    expect(foregroundBoundMs(undefined, 600_000)).toBe(120_000);
    expect(foregroundBoundMs(120, 30_000)).toBe(30_000);
    expect(foregroundBoundMs(5, 600_000)).toBe(5000);
  });
});

describe('foreground host bash move', () => {
  let registry: StubRegistry;
  let moved: AbortController;
  let begin: MockInstance<NativeFilesRepository['begin']>;
  const append = vi.fn<RunEventsRepository['append']>();

  function contextFor(overrides: Partial<ToolContext> = {}): ToolContext {
    const db: Db = drizzle.mock({ schema });

    return {
      configuredCredentials: [],
      userId: 'owner',
      chatId: 'chat',
      runId: 'run',
      toolCallId: 'call-1',
      nativeExecutorId: 'host',
      nativeDeliverySequence: 1,
      bashProcessLimiter: new BashProcessLimiter(4),
      bashJobs: registry,
      jobSettings: { modelId: 'm', permissionMode: 'default' },
      moveSignal: moved.signal,
      permissionPolicy: compileTestPermissionPolicy(),
      tenantDb: {
        runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
          callback(db),
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    moved = new AbortController();
    const tenant = contextFor().tenantDb;

    registry = new StubRegistry(
      tenant,
      { instanceId: crypto.randomUUID() },
      { config: BUILT_IN_DEFAULTS },
    );
    begin = vi
      .spyOn(NativeFilesRepository.prototype, 'begin')
      .mockResolvedValue(undefined);
    append.mockReset();
    vi.spyOn(RunEventsRepository.prototype, 'append').mockImplementation(
      append,
    );
    append.mockResolvedValue({
      runId: 'run',
      sequence: 1,
      eventType: 'native.result',
      payload: null,
      createdAt: new Date(),
    });
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const results = () => append.mock.calls.map((call) => call[2]);

  it('does not spawn an async command when the Run signal already fired', async () => {
    const abort = new AbortController();
    const start = vi.spyOn(registry, 'start');
    const limiter = new BashProcessLimiter(1);
    const slot = limiter.tryAcquire();

    if (slot === null) throw new Error('Missing process slot');

    abort.abort();

    await expect(
      runAsyncBash(
        {
          ...contextFor({ abortSignal: abort.signal }),
          runId: 'run',
          nativeExecutorId: 'host',
          toolCallId: 'call-1',
        },
        { command: 'make test', async: true },
        process.cwd(),
        slot,
      ),
    ).resolves.toMatchObject({ type: 'cancelled' });
    expect(start).not.toHaveBeenCalled();
    expect(results()).toMatchObject([{ result: { type: 'cancelled' } }]);
  });

  it('releases a hung admission after its bound already exhausted the grace', async () => {
    const admission = Promise.withResolvers<undefined>();
    const limiter = new BashProcessLimiter(1);
    const start = vi.spyOn(registry, 'start');
    await vi.advanceTimersByTimeAsync(100);

    begin.mockReturnValue(admission.promise);
    moved.abort();

    const call = bashTool.execute(
      contextFor({
        bashProcessLimiter: limiter,
        moveDeadlineAt: performance.now() - 1,
      }),
      { command: 'make test', async: true },
    );

    await vi.advanceTimersByTimeAsync(0);
    const capacity = limiter.tryAcquire();

    expect(capacity).not.toBeNull();
    capacity?.release();
    admission.resolve(undefined);
    await expect(call).resolves.toMatchObject({ type: 'cancelled' });
    expect(start).not.toHaveBeenCalled();
  });

  it('does not spawn after the absolute grace expires while admission awaits', async () => {
    const admission = Promise.withResolvers<undefined>();
    const start = vi.spyOn(registry, 'start');

    begin.mockReturnValue(admission.promise);

    const call = bashTool.execute(
      contextFor({ moveDeadlineAt: performance.now() + 100 }),
      { command: 'make test', async: true },
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(101);
    admission.resolve(undefined);
    await expect(call).resolves.toMatchObject({ type: 'cancelled' });
    expect(start).not.toHaveBeenCalled();
  });
  it('closes a move fence synchronously at its zero-grace deadline', async () => {
    const admission = Promise.withResolvers<undefined>();
    const start = vi.spyOn(registry, 'start');
    const limiter = new BashProcessLimiter(1);
    begin.mockReturnValue(admission.promise);
    moved.abort();

    const call = bashTool.execute(
      contextFor({
        bashProcessLimiter: limiter,
        moveDeadlineAt: performance.now(),
      }),
      { command: 'make test', async: true },
    );

    const capacity = limiter.tryAcquire();

    expect(capacity).not.toBeNull();
    capacity?.release();
    admission.resolve(undefined);

    await expect(call).resolves.toMatchObject({ type: 'cancelled' });
    expect(start).not.toHaveBeenCalled();
  });

  it('does not close a live move fence when its signal has not fired', async () => {
    const admission = Promise.withResolvers<undefined>();
    registry.command.autoSettle = false;
    begin.mockReturnValue(admission.promise);

    const limiter = new BashProcessLimiter(1);

    const call = bashTool.execute(contextFor({ bashProcessLimiter: limiter }), {
      command: 'make test',
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(751);
    expect(limiter.tryAcquire()).toBeNull();

    moved.abort();
    admission.resolve(undefined);
    await expect(call).resolves.toMatchObject({ backgrounded: true });
    expect(limiter.tryAcquire()).toBeNull();
    registry.command.settle();
  });

  it('does not spawn when admission completes exactly at its move deadline', async () => {
    const admission = Promise.withResolvers<undefined>();
    const start = vi.spyOn(registry, 'start');
    begin.mockReturnValue(admission.promise);

    const call = bashTool.execute(
      contextFor({
        moveSignal: undefined,
        moveDeadlineAt: performance.now(),
      }),
      { command: 'make test', async: true },
    );

    await vi.advanceTimersByTimeAsync(0);
    admission.resolve(undefined);

    await expect(call).resolves.toMatchObject({ type: 'cancelled' });
    expect(start).not.toHaveBeenCalled();
  });

  it('keeps the process slot after the move fence listener is removed', async () => {
    registry.command.autoSettle = false;
    const limiter = new BashProcessLimiter(1);

    const call = bashTool.execute(contextFor({ bashProcessLimiter: limiter }), {
      command: 'make test',
    });

    await vi.advanceTimersByTimeAsync(0);
    moved.abort();
    await expect(call).resolves.toMatchObject({ backgrounded: true });
    await vi.advanceTimersByTimeAsync(751);
    expect(limiter.tryAcquire()).toBeNull();
    registry.command.settle();
  });

  it.each(['bashJobs', 'jobSettings'] as const)(
    'refuses a host command without %s before recording a native attempt',
    async (missing) => {
      await expect(
        bashTool.execute(contextFor({ [missing]: undefined }), {
          command: 'make test',
        }),
      ).resolves.toMatchObject({ type: 'executor_unavailable' });
      expect(begin).not.toHaveBeenCalled();
    },
  );

  it('returns a natural foreground exit without stopping the command', async () => {
    const call = bashTool.execute(contextFor(), { command: 'make test' });

    await vi.advanceTimersByTimeAsync(0);
    registry.command.exit(0);
    await expect(call).resolves.toMatchObject({
      status: 'success',
      stdout: '',
      stderr: '',
    });
    expect(registry.command.stop).not.toHaveBeenCalled();
    expect(results()).toMatchObject([{ result: { status: 'success' } }]);
  });

  it('A long test suite passes the bound and is not stopped', async () => {
    const call = bashTool.execute(contextFor(), { command: 'make test' });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(registry.promoteCalls).toHaveLength(0);
    moved.abort();

    await expect(call).resolves.toMatchObject({
      status: 'success',
      backgrounded: true,
      cause: 'time',
      job: formatJobLocator('bash', 7),
    });
    expect(registry.command.stop).not.toHaveBeenCalled();
    expect(results()).toHaveLength(1);
  });

  it('A bound that fired before the spawn moves at once', async () => {
    moved.abort();

    await expect(
      bashTool.execute(contextFor(), { command: 'make test' }),
    ).resolves.toMatchObject({ backgrounded: true });
  });

  it('The job record cannot be written: a proved stop is a timed_out result with the output', async () => {
    registry.promotion = failingMove(registry.command, true, 'partial');
    moved.abort();
    const result = await bashTool.execute(contextFor(), { command: 'x' });

    expect(result).toMatchObject({ status: 'error', type: 'timed_out' });
    expect(result.status === 'error' ? result.message : '').toContain(
      'partial',
    );
    expect(result.status === 'error' ? result.message : '').toContain(
      'move to a background job failed',
    );
    expect(results()).toHaveLength(1);
  });

  it('A failed move with an unproved stop is unknown', async () => {
    registry.promotion = failingMove(registry.command, false);
    moved.abort();

    await expect(
      bashTool.execute(contextFor(), { command: 'x' }),
    ).resolves.toMatchObject({ type: 'outcome_unknown' });
    expect(results()).toHaveLength(1);
  });

  it('A move recorded late returns one unknown result and keeps the command running', async () => {
    const commit = Promise.withResolvers<ChatJob>();
    registry.promotion = () => commit.promise;
    moved.abort();
    const call = bashTool.execute(contextFor(), { command: 'x' });
    await vi.advanceTimersByTimeAsync(0);
    // The commit completes after the deadline but before its continuations run.
    vi.advanceTimersByTime(750);
    commit.resolve(jobRow(7));
    const result = await call;
    expect(result).toMatchObject({
      status: 'error',
      type: 'outcome_unknown',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({
      toolCallId: 'call-1',
      result: { status: 'error', type: 'outcome_unknown' },
    });
    expect(registry.command.stop).not.toHaveBeenCalled();
  });

  it('A late failure stops the command and keeps the recorded unknown result', async () => {
    const lateFailure = Promise.withResolvers<void>();
    const fail = failingMove(registry.command, true, 'late');

    registry.promotion = async () => {
      await lateFailure.promise;

      return fail();
    };

    moved.abort();
    const call = bashTool.execute(contextFor(), { command: 'x' });
    await vi.advanceTimersByTimeAsync(750);
    await expect(call).resolves.toMatchObject({ type: 'outcome_unknown' });
    lateFailure.resolve();
    await vi.advanceTimersByTimeAsync(10);
    expect(registry.command.stop).toHaveBeenCalledWith('run');
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({ result: { type: 'outcome_unknown' } });
  });

  it('A hung append after a timely promotion is bounded and appends once', async () => {
    append.mockImplementation(() => new Promise(() => undefined));
    moved.abort();
    const call = bashTool.execute(contextFor(), { command: 'x' });
    await vi.advanceTimersByTimeAsync(750);

    await expect(call).resolves.toMatchObject({ type: 'outcome_unknown' });
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('returns the job when the command exits during a timely promotion', async () => {
    const commit = Promise.withResolvers<ChatJob>();
    registry.promotion = () => commit.promise;
    moved.abort();

    const call = bashTool.execute(contextFor(), { command: 'make test' });

    await vi.advanceTimersByTimeAsync(1);
    registry.command.exit(0);
    commit.resolve(jobRow(7));
    await expect(call).resolves.toMatchObject({
      status: 'success',
      backgrounded: true,
      job: 'job://bash-7',
    });
    expect(registry.command.stop).not.toHaveBeenCalled();
  });

  it('A Run abort during a pending promotion leaves the job and the command alone', async () => {
    const abort = new AbortController();
    const commit = Promise.withResolvers<ChatJob>();
    registry.promotion = () => commit.promise;
    moved.abort();

    const call = bashTool.execute(contextFor({ abortSignal: abort.signal }), {
      command: 'x',
    });

    await vi.advanceTimersByTimeAsync(1);
    abort.abort();
    await vi.advanceTimersByTimeAsync(750);
    await expect(call).resolves.toMatchObject({ type: 'outcome_unknown' });
    commit.resolve(jobRow(7));
    await vi.advanceTimersByTimeAsync(10);
    expect(registry.command.stop).not.toHaveBeenCalled();
    expect(results()).toHaveLength(1);
  });

  it('Stop during a foreground command keeps the slot until the command settles', async () => {
    const abort = new AbortController();
    registry.command.autoSettle = false;
    const limiter = new BashProcessLimiter(1);

    const call = bashTool.execute(
      contextFor({ abortSignal: abort.signal, bashProcessLimiter: limiter }),
      { command: 'sleep 100' },
    );

    await vi.advanceTimersByTimeAsync(20_000);
    abort.abort();
    await vi.advanceTimersByTimeAsync(1);
    expect(registry.command.stop).toHaveBeenCalledWith('run');
    expect(limiter.tryAcquire()).toBeNull();
    registry.command.settle();
    await expect(call).resolves.toMatchObject({ type: 'cancelled' });
    expect(registry.promoteCalls).toHaveLength(0);
    expect(limiter.tryAcquire()).not.toBeNull();
  });

  it('Stop after the move: a later Run cancellation leaves the command alone', async () => {
    const abort = new AbortController();
    moved.abort();

    await bashTool.execute(contextFor({ abortSignal: abort.signal }), {
      command: 'make test',
    });
    abort.abort();
    await vi.advanceTimersByTimeAsync(10);
    expect(registry.command.stop).not.toHaveBeenCalled();
  });

  it('A hung begin falls back to unknown without a process and frees the slot', async () => {
    begin.mockImplementation(() => new Promise(() => undefined));

    const limiter = new BashProcessLimiter(1);

    const call = bashTool.execute(contextFor({ bashProcessLimiter: limiter }), {
      command: 'x',
    });

    await vi.advanceTimersByTimeAsync(1);
    moved.abort();
    expect(limiter.tryAcquire()).toBeNull();
    await vi.advanceTimersByTimeAsync(750);
    expect(limiter.tryAcquire()).not.toBeNull();
    // The runner's backstop resolves the call; the tool itself stays pending.
    void call;
  });

  it('never spawns after the backstop when the wall clock moves backward', async () => {
    vi.useRealTimers();
    const admission = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<void>();
    const start = vi.spyOn(registry, 'start');
    const originalNow = Date.now;

    begin.mockImplementation(() => {
      entered.resolve();

      return admission.promise;
    });

    const call = runTool(
      bashTool,
      { command: 'make test', async: true },
      contextFor({ moveSignal: undefined }),
      0.05,
    );

    await entered.promise;
    vi.spyOn(Date, 'now').mockImplementation(() => originalNow() - 60_000);
    await expect(call).resolves.toMatchObject({ type: 'outcome_unknown' });
    admission.resolve(undefined);
    await vi.waitFor(() => expect(append).toHaveBeenCalled());
    expect(start).not.toHaveBeenCalled();
  });

  it('a per-call timeout never rejects a host call as outcome_unknown', async () => {
    vi.useRealTimers();

    const result = await runTool(
      bashTool,
      { command: 'make test' },
      contextFor({ moveSignal: undefined }),
      0.05,
    );

    expect(result).toMatchObject({ status: 'success', backgrounded: true });
    expect(registry.command.stop).not.toHaveBeenCalled();
  });

  it('a hung result append and a hung begin resolve through the runner backstop', async () => {
    vi.useRealTimers();
    append.mockImplementation(() => new Promise(() => undefined));
    const startedAt = Date.now();

    const hungAppend = await runTool(
      bashTool,
      { command: 'make test' },
      contextFor({ moveSignal: undefined }),
      0.05,
    );

    expect(hungAppend).toMatchObject({
      status: 'error',
      type: 'outcome_unknown',
    });

    begin.mockImplementation(() => new Promise(() => undefined));

    const hungBegin = await runTool(
      bashTool,
      { command: 'make test' },
      contextFor({ moveSignal: undefined, toolCallId: 'call-2' }),
      0.05,
    );

    expect(hungBegin).toMatchObject({
      status: 'error',
      type: 'outcome_unknown',
    });
    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(registry.command.stop).not.toHaveBeenCalled();
  });
});
