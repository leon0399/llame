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
import { JobPromotionError } from '../jobs/job-promotion-error';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { bashTool } from './bash';
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
  readonly stop = vi.fn((cause: string): Promise<ManagedStopResult> => {
    this.result.resolve({ status: 'error', type: 'cancelled', message: cause });

    return Promise.resolve({ ...this.output, proved: this.proved });
  });
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
  readonly promoteCalls: Array<ManagedBashHandle> = [];
  promotion: () => Promise<ChatJob> = () => Promise.resolve(jobRow(7));
  override start(): ManagedBashHandle {
    return this.command;
  }
  override promote(handle: ManagedBashHandle): Promise<ChatJob> {
    this.promoteCalls.push(handle);

    return this.promotion();
  }
}

function failedMove(proved: boolean, stdout = ''): JobPromotionError {
  return new JobPromotionError(
    { ...EMPTY, stdout, proved },
    { cause: new Error('database refused the job record') },
  );
}

describe('foreground host bash move', () => {
  let registry: StubRegistry;

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
      permissionPolicy: compileTestPermissionPolicy(),
      tenantDb: {
        runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
          callback(db),
      },
      ...overrides,
    };
  }

  const append = vi.fn<RunEventsRepository['append']>();

  beforeEach(() => {
    const worker = { instanceId: crypto.randomUUID() };
    const tenant = contextFor().tenantDb;
    registry = new StubRegistry(tenant, worker, { config: BUILT_IN_DEFAULTS });
    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
      undefined,
    );

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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const results = () => append.mock.calls.map((call) => call[2]);

  it('A long test suite passes the bound; A host command is not stopped at the foreground bound', async () => {
    const call = bashTool.execute(contextFor(), { command: 'make test' });

    await vi.advanceTimersByTimeAsync(119_999);
    expect(registry.promoteCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    await expect(call).resolves.toMatchObject({
      status: 'success',
      backgrounded: true,
      cause: 'time',
      job: formatJobLocator('bash', 7),
    });
    expect(registry.promoteCalls).toEqual([registry.command]);
    expect(registry.command.stop).not.toHaveBeenCalled();
    expect(results()).toHaveLength(1);
  });

  it('Output from before the move is handed to the job record', async () => {
    registry.command.output = { ...EMPTY, stdout: 'line\n'.repeat(10) };
    const call = bashTool.execute(contextFor(), { command: 'make test' });
    await vi.advanceTimersByTimeAsync(120_000);
    await call;
    expect(registry.promoteCalls[0]?.snapshot().stdout).toBe(
      'line\n'.repeat(10),
    );
  });

  it.each([
    { timeoutMs: 600_000, after: 120, at: 120_000 },
    { timeoutMs: 30_000, after: 120, at: 30_000 },
    { timeoutMs: undefined, after: 5, at: 5000 },
  ])(
    'moves at $at ms with a call timeout of $timeoutMs',
    async ({ timeoutMs, after, at }) => {
      const call = bashTool.execute(
        contextFor({ timeoutMs, bashBackgroundAfterSeconds: after }),
        { command: 'make test' },
      );

      await vi.advanceTimersByTimeAsync(at - 1);
      expect(registry.promoteCalls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      await expect(call).resolves.toMatchObject({ backgrounded: true });
      expect(registry.command.stop).not.toHaveBeenCalled();
    },
  );

  it('The job record cannot be written: a proved stop is a timed_out result with the output', async () => {
    registry.promotion = () => Promise.reject(failedMove(true, 'partial'));
    const call = bashTool.execute(contextFor(), { command: 'make test' });
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await call;

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
    registry.promotion = () => Promise.reject(failedMove(false));
    const call = bashTool.execute(contextFor(), { command: 'make test' });
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(call).resolves.toMatchObject({ type: 'outcome_unknown' });
    expect(results()).toHaveLength(1);
  });

  it('A move recorded late returns one unknown result and keeps the command running', async () => {
    const commit = Promise.withResolvers<ChatJob>();
    registry.promotion = () => commit.promise;
    const call = bashTool.execute(contextFor(), { command: 'make test' });
    await vi.advanceTimersByTimeAsync(120_000);
    await vi.advanceTimersByTimeAsync(750);

    await expect(call).resolves.toMatchObject({ type: 'outcome_unknown' });
    commit.resolve(jobRow(7));
    await vi.advanceTimersByTimeAsync(10);
    expect(results()).toHaveLength(1);
    expect(registry.command.stop).not.toHaveBeenCalled();
  });

  it('A late failure does not replace the recorded unknown result', async () => {
    const commit = Promise.withResolvers<ChatJob>();
    registry.promotion = () => commit.promise;
    const call = bashTool.execute(contextFor(), { command: 'make test' });
    await vi.advanceTimersByTimeAsync(120_750);
    await expect(call).resolves.toMatchObject({ type: 'outcome_unknown' });
    commit.reject(failedMove(true, 'late'));
    await vi.advanceTimersByTimeAsync(10);
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({
      result: { type: 'outcome_unknown' },
    });
  });

  it('Stop during a foreground command: a Run cancellation stops it', async () => {
    const abort = new AbortController();

    const call = bashTool.execute(contextFor({ abortSignal: abort.signal }), {
      command: 'sleep 100',
    });

    await vi.advanceTimersByTimeAsync(20_000);
    abort.abort();
    await expect(call).resolves.toMatchObject({ type: 'cancelled' });
    expect(registry.command.stop).toHaveBeenCalledWith('run');
    expect(registry.promoteCalls).toHaveLength(0);
  });

  it('Stop after the move: a later Run cancellation leaves the command alone', async () => {
    const abort = new AbortController();

    const call = bashTool.execute(contextFor({ abortSignal: abort.signal }), {
      command: 'make test',
    });

    await vi.advanceTimersByTimeAsync(120_000);
    await call;
    abort.abort();
    await vi.advanceTimersByTimeAsync(10);
    expect(registry.command.stop).not.toHaveBeenCalled();
  });

  it('a per-call timeout never rejects a host call as outcome_unknown', async () => {
    vi.useRealTimers();

    const result = await runTool(
      bashTool,
      { command: 'make test' },
      contextFor(),
      0.05,
    );

    expect(result).toMatchObject({ status: 'success', backgrounded: true });
    expect(registry.command.stop).not.toHaveBeenCalled();
  });
});
