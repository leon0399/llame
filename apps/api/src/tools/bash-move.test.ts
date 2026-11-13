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
import { type BashJobFacts, BashJobRegistry } from '../jobs/bash-job-registry';
import { formatJobLocator } from '../jobs/job-locator';
import { JobPromotionError } from '../jobs/job-promotion-error';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { foregroundBoundMs, messageMoveWindow } from './bash-limits';
import { runAsyncBash } from './bash-async';
import { bashTool } from './bash';
import { runTool } from './runner';
import { type ToolContext, type ToolResult } from './types';

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
  readonly receipts: Array<{ toolCallId: string; result: ToolResult }> = [];
  jobAdmission: () => Promise<ChatJob> = () => Promise.resolve(jobRow(7));
  override start(): ManagedBashHandle {
    return this.command;
  }
  override promoteWithReceipt(
    handle: ManagedBashHandle,
    facts: BashJobFacts,
    resultForJob: (job: ChatJob) => ToolResult,
    resultForStop: (stopped: ManagedStopResult) => ToolResult,
  ): Promise<{
    result: ToolResult;
    receiptCommitted: boolean;
    recoveryWon: boolean;
  }> {
    this.promoteCalls.push({ handle, stdout: handle.snapshot().stdout });

    return this.jobAdmission()
      .then((job) => {
        const result = resultForJob(job);
        this.receipts.push({ toolCallId: facts.toolCallId, result });

        return { result, receiptCommitted: true, recoveryWon: false };
      })
      .catch((error: unknown) => {
        if (!(error instanceof JobPromotionError)) throw error;
        const result = resultForStop(error.stopped);
        this.receipts.push({ toolCallId: facts.toolCallId, result });

        return { result, receiptCommitted: true, recoveryWon: true };
      });
  }
}

/** A failed promotion stops the command and supplies a receipt fallback. */
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

describe('message move window', () => {
  it('accepts only a finite window tagged as a message yield', () => {
    const controller = new AbortController();
    const reason = { cause: 'message', deadlineAt: 123 };
    controller.abort(reason);

    expect(messageMoveWindow(controller.signal)).toEqual(reason);

    const unrelated = new AbortController();
    unrelated.abort({ cause: 'cancel', deadlineAt: 123 });
    expect(messageMoveWindow(unrelated.signal)).toBeUndefined();
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
      attemptId: 'attempt-1',
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
    vi.spyOn(
      NativeFilesRepository.prototype,
      'recoverHostPromotion',
    ).mockImplementation(async (input) => {
      await append(input.runId, 'native.result', {
        toolCallId: input.toolCallId,
        result: input.result,
      });

      return { disposition: 'recovery_won', result: input.result };
    });
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

  const results = () => [
    ...append.mock.calls.map((call) => call[2]),
    ...registry.receipts.map((receipt) => ({
      toolCallId: receipt.toolCallId,
      result: receipt.result,
    })),
  ];

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
          attemptId: 'attempt',
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

  it('holds capacity when the Run aborts between spawn and promotion', async () => {
    const abort = new AbortController();
    const limiter = new BashProcessLimiter(1);
    vi.spyOn(registry, 'start').mockImplementation(() => {
      queueMicrotask(() => abort.abort());

      return registry.command;
    });

    const result = await bashTool.execute(
      contextFor({ abortSignal: abort.signal, bashProcessLimiter: limiter }),
      { command: 'make test', async: true },
    );

    expect(result).toMatchObject({ backgrounded: true });
    expect(limiter.tryAcquire()).toBeNull();
    registry.command.settle();
    await registry.command.settled;
    expect(limiter.tryAcquire()).not.toBeNull();
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

  it('retries receipt recovery before returning the foreground result', async () => {
    const recovery = vi
      .spyOn(NativeFilesRepository.prototype, 'recoverHostPromotion')
      .mockRejectedValueOnce(new Error('first unavailable'))
      .mockRejectedValueOnce(new Error('second unavailable'));

    const call = bashTool.execute(contextFor(), { command: 'make test' });

    await vi.advanceTimersByTimeAsync(0);
    registry.command.exit(0);
    await vi.advanceTimersByTimeAsync(500);

    await expect(call).resolves.toMatchObject({ status: 'success' });
    expect(recovery).toHaveBeenCalledTimes(3);
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

  it.each([false, true])(
    'a segment yield moves a host call with message cause (already pending=%s)',
    async (pending) => {
      const yielded = new AbortController();

      if (pending) yielded.abort();

      const call = runTool(
        bashTool,
        { command: 'make test' },
        contextFor({ moveSignal: undefined, yieldSignal: yielded.signal }),
        120,
      );

      await vi.advanceTimersByTimeAsync(0);
      yielded.abort();
      await expect(call).resolves.toMatchObject({
        status: 'success',
        backgrounded: true,
        cause: 'message',
        job: 'job://bash-7',
      });
      expect(registry.command.stop).not.toHaveBeenCalled();
      expect(results()).toMatchObject([
        { result: { backgrounded: true, cause: 'message' } },
      ]);
    },
  );

  it('a message yield closes a hung admission at its own 750 ms deadline', async () => {
    const admission = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<void>();
    const yielded = new AbortController();
    const limiter = new BashProcessLimiter(1);
    const start = vi.spyOn(registry, 'start');
    begin.mockImplementation(() => {
      entered.resolve();

      return admission.promise;
    });

    const call = runTool(
      bashTool,
      { command: 'make test' },
      contextFor({
        moveSignal: undefined,
        yieldSignal: yielded.signal,
        bashProcessLimiter: limiter,
      }),
      120,
    );

    await entered.promise;
    await vi.advanceTimersByTimeAsync(10_000);
    yielded.abort();
    await vi.advanceTimersByTimeAsync(749);
    expect(limiter.tryAcquire()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await expect(call).resolves.toMatchObject({ type: 'cancelled' });
    const released = limiter.tryAcquire();
    expect(released).not.toBeNull();
    released?.release();
    admission.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(start).not.toHaveBeenCalled();
    expect(results()).toMatchObject([{ result: { type: 'cancelled' } }]);
  });

  it('waits past the message deadline for the fenced promotion receipt', async () => {
    const committed = Promise.withResolvers<ChatJob>();
    registry.jobAdmission = () => committed.promise;

    const call = bashTool.execute(
      contextFor({ moveDeadlineAt: performance.now() + 120_000 }),
      { command: 'make test' },
    );

    await vi.advanceTimersByTimeAsync(0);
    moved.abort({ cause: 'message', deadlineAt: performance.now() + 300 });
    vi.advanceTimersByTime(750);
    expect(await Promise.race([call, Promise.resolve('pending')])).toBe(
      'pending',
    );
    expect(results()).toEqual([]);
    expect(registry.command.stop).not.toHaveBeenCalled();

    committed.resolve(jobRow(7));
    await expect(call).resolves.toMatchObject({
      status: 'success',
      backgrounded: true,
      cause: 'message',
      job: 'job://bash-7',
    });
    expect(results()).toMatchObject([
      {
        result: { status: 'success', backgrounded: true, job: 'job://bash-7' },
      },
    ]);
  });
  it('waits for a promotion even when the message window was already expired', async () => {
    const committed = Promise.withResolvers<ChatJob>();
    registry.jobAdmission = () => committed.promise;
    const call = bashTool.execute(contextFor(), { command: 'make test' });

    await vi.advanceTimersByTimeAsync(0);
    moved.abort({ cause: 'message', deadlineAt: performance.now() });
    expect(await Promise.race([call, Promise.resolve('pending')])).toBe(
      'pending',
    );

    committed.resolve(jobRow(7));
    await expect(call).resolves.toMatchObject({
      status: 'success',
      backgrounded: true,
      job: 'job://bash-7',
    });
    expect(results()).toHaveLength(1);
  });

  it('records the atomic receipt when an already-expired promotion finishes immediately', async () => {
    const call = bashTool.execute(contextFor(), { command: 'make test' });

    await vi.advanceTimersByTimeAsync(0);
    moved.abort({ cause: 'message', deadlineAt: performance.now() });

    await expect(call).resolves.toMatchObject({
      status: 'success',
      backgrounded: true,
    });
    expect(results()).toMatchObject([
      { result: { status: 'success', backgrounded: true } },
    ]);
    expect(results()).toHaveLength(1);
  });

  it('a late message promotion commits its one exact native receipt', async () => {
    const committed = Promise.withResolvers<ChatJob>();
    const yielded = new AbortController();
    registry.jobAdmission = () => committed.promise;

    const call = runTool(
      bashTool,
      { command: 'make test' },
      contextFor({ moveSignal: undefined, yieldSignal: yielded.signal }),
      120,
    );

    await vi.advanceTimersByTimeAsync(0);
    yielded.abort();
    vi.advanceTimersByTime(750);
    expect(await Promise.race([call, Promise.resolve('pending')])).toBe(
      'pending',
    );
    expect(results()).toEqual([]);
    committed.resolve(jobRow(7));
    await expect(call).resolves.toMatchObject({
      status: 'success',
      backgrounded: true,
      job: 'job://bash-7',
    });
    expect(results()).toMatchObject([
      {
        result: { status: 'success', backgrounded: true, job: 'job://bash-7' },
      },
    ]);
    expect(results()).toHaveLength(1);
    expect(registry.command.stop).not.toHaveBeenCalled();
  });

  it('The job record cannot be written: a proved stop is a timed_out result with the output', async () => {
    registry.jobAdmission = failingMove(registry.command, true, 'partial');
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
    registry.jobAdmission = failingMove(registry.command, false);
    moved.abort();

    await expect(
      bashTool.execute(contextFor(), { command: 'x' }),
    ).resolves.toMatchObject({ type: 'outcome_unknown' });
    expect(results()).toHaveLength(1);
  });

  it('a promotion still pending after its timer returns the eventual receipt', async () => {
    const commit = Promise.withResolvers<ChatJob>();
    registry.jobAdmission = () => commit.promise;
    moved.abort();
    const call = bashTool.execute(contextFor(), { command: 'x' });
    let settled = false;
    void Promise.resolve(call).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(750);
    expect(settled).toBe(false);
    expect(results()).toEqual([]);
    commit.resolve(jobRow(7));
    await expect(call).resolves.toMatchObject({
      status: 'success',
      backgrounded: true,
      job: 'job://bash-7',
    });
    expect(results()).toMatchObject([
      {
        result: { status: 'success', backgrounded: true, job: 'job://bash-7' },
      },
    ]);
    expect(results()).toHaveLength(1);
    expect(registry.command.stop).not.toHaveBeenCalled();
  });

  it('returns the durable receipt winner without recording a competing result', async () => {
    const durableWinner: ToolResult = {
      status: 'error',
      type: 'timed_out',
      message: 'The durable receipt already won.',
    };

    vi.spyOn(registry, 'promoteWithReceipt').mockResolvedValue({
      result: durableWinner,
      receiptCommitted: false,
      recoveryWon: true,
    });
    moved.abort();

    await expect(
      bashTool.execute(contextFor(), { command: 'x' }),
    ).resolves.toEqual(durableWinner);
    expect(append).not.toHaveBeenCalled();
    expect(registry.receipts).toHaveLength(0);
  });

  it('a late known promotion failure returns its proved stop result', async () => {
    const lateFailure = Promise.withResolvers<void>();
    const fail = failingMove(registry.command, true, 'late');

    registry.jobAdmission = async () => {
      await lateFailure.promise;

      return fail();
    };

    const call = bashTool.execute(contextFor(), { command: 'x' });
    await vi.advanceTimersByTimeAsync(0);
    moved.abort();
    vi.advanceTimersByTime(750);
    expect(await Promise.race([call, Promise.resolve('pending')])).toBe(
      'pending',
    );
    lateFailure.resolve();
    await expect(call).resolves.toMatchObject({ type: 'timed_out' });
    expect(registry.command.stop).toHaveBeenCalledWith('run');
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({ result: { type: 'timed_out' } });
  });

  it('does not append a separate native result after promotion commits', async () => {
    moved.abort();
    await expect(
      bashTool.execute(contextFor(), { command: 'x' }),
    ).resolves.toMatchObject({ status: 'success', backgrounded: true });
    expect(append).not.toHaveBeenCalled();
    expect(registry.receipts).toHaveLength(1);
  });

  it('returns the job when the command exits during a timely promotion', async () => {
    const commit = Promise.withResolvers<ChatJob>();
    registry.jobAdmission = () => commit.promise;
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
    registry.jobAdmission = () => commit.promise;
    moved.abort();

    const call = bashTool.execute(contextFor({ abortSignal: abort.signal }), {
      command: 'x',
    });

    await vi.advanceTimersByTimeAsync(1);
    abort.abort();
    vi.advanceTimersByTime(750);
    expect(await Promise.race([call, Promise.resolve('pending')])).toBe(
      'pending',
    );
    commit.resolve(jobRow(7));
    await expect(call).resolves.toMatchObject({
      status: 'success',
      backgrounded: true,
    });
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

  it('a pending atomic promotion stays open while a hung begin uses the backstop', async () => {
    // Native AbortSignal timers do not use Vitest's clock.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), milliseconds);

      return controller.signal;
    });
    const committed = Promise.withResolvers<ChatJob>();
    registry.jobAdmission = () => committed.promise;
    moved.abort();

    const pendingPromotion = runTool(
      bashTool,
      { command: 'make test' },
      contextFor({ moveSignal: undefined }),
      0.05,
    );

    await vi.advanceTimersByTimeAsync(800);
    expect(
      await Promise.race([pendingPromotion, Promise.resolve('pending')]),
    ).toBe('pending');
    expect(append).not.toHaveBeenCalled();

    committed.resolve(jobRow(7));
    await expect(pendingPromotion).resolves.toMatchObject({
      status: 'success',
      backgrounded: true,
    });

    begin.mockImplementation(() => new Promise(() => undefined));

    const hungBegin = runTool(
      bashTool,
      { command: 'make test' },
      contextFor({ moveSignal: undefined, toolCallId: 'call-2' }),
      0.05,
    );

    await vi.advanceTimersByTimeAsync(800);

    await expect(hungBegin).resolves.toMatchObject({
      status: 'error',
      type: 'outcome_unknown',
    });
    expect(registry.command.stop).not.toHaveBeenCalled();
  });
});
