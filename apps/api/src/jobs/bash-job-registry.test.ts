import {
  type BashExecutorContext,
  type BashResult,
} from '@workspace/bash-executor';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatsRepository } from '../chats/chats-repository';
import { RunsRepository } from '../runs/runs-repository';
import { type ChatJob, type Run, type RunEvent } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunRowFenceRepository } from '../runs/run-row-fence.repository';
import { NativeReceiptsRepository } from '../runs/native-receipts-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { BashJobLifecycle } from './bash-job-lifecycle';
import { BashJobRegistry, type BashJobFacts } from './bash-job-registry';
import { jobSequence, toolResultFromReceipt } from './bash-promotion-receipt';
import { ChatJobsRepository, type JobSettlement } from './chat-jobs.repository';
import { JobPromotionError } from './job-promotion-error';

/** The fakes implement only the members the registry and the store call. */
// SAFETY: see above.
// eslint-disable-next-line typescript/no-unsafe-type-assertion
const asDb = (fake: { insert: unknown }): Db => fake as never;

// SAFETY: a closed registry refuses before it reads the context.
// eslint-disable-next-line typescript/no-unsafe-type-assertion
const executorContext = {} as BashExecutorContext;

/** The row an insert echoes: the fields the registry reads. */
function jobRow(job: Parameters<ChatJobsRepository['insert']>[0]): ChatJob {
  // SAFETY: the registry reads only the echoed fields and the id.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return {
    ...job,
    id: 'job-1',
    artifactId: null,
    deadlineAt: job.deadlineAt ?? null,
  } as never;
}

const OWNER = 'owner';
const CHAT = 'chat-1';
const STARTED = new Date('2026-11-11T10:00:00.000Z');

type Output = { stdout: string; stderr: string };

/** A command handle the test settles by hand. */
function fakeHandle(initial: Output = { stdout: '', stderr: '' }) {
  let finish: (result: BashResult) => void = () => {};
  const settled = new Promise((resolve) => (finish = resolve));
  let current = initial;
  let cut = { stdout: false, stderr: false };
  const listeners: Array<(bytes: number) => void> = [];
  const everSubscribed: Array<(bytes: number) => void> = [];

  const stop = vi.fn((cause: string) => {
    finish({ status: 'error', type: 'cancelled', message: cause });

    return Promise.resolve({
      proved: true,
      ...current,
      truncated: cut.stdout || cut.stderr,
      truncatedStreams: cut,
    });
  });

  const handle = {
    pid: 42,
    settled,
    snapshot: vi.fn(() => ({
      ...current,
      truncated: cut.stdout || cut.stderr,
      truncatedStreams: cut,
    })),
    onOutput: (listener: (bytes: number) => void) => {
      listeners.push(listener);
      everSubscribed.push(listener);

      return () => void listeners.splice(listeners.indexOf(listener), 1);
    },
    stop,
  };

  return {
    // SAFETY: the registry uses only the members above.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    handle: handle as never,
    stop,
    snapshot: handle.snapshot,
    write: (next: Output) => (current = next),
    /** Output arrives: the registry hears it through its subscription. */
    emit: (next: Output) => {
      const bytes =
        Buffer.byteLength(next.stdout) +
        Buffer.byteLength(next.stderr) -
        Buffer.byteLength(current.stdout) -
        Buffer.byteLength(current.stderr);

      current = next;

      for (const listener of listeners.slice()) listener(bytes);
    },
    /** A notice already in flight when the registry unsubscribed. */
    emitLate: (next: Output) => {
      const bytes =
        Buffer.byteLength(next.stdout) - Buffer.byteLength(current.stdout);

      current = next;

      for (const listener of everSubscribed) listener(bytes);
    },
    subscribers: () => listeners.length,
    end: (result: BashResult) => finish(result),
    cut: (flags: { stdout: boolean; stderr: boolean }) => (cut = flags),
    exit: (exitCode: number, signal?: string) =>
      finish({
        status: 'success',
        exitCode,
        signal,
        ...current,
        truncated: cut.stdout || cut.stderr,
        truncatedStreams: cut,
      }),
  };
}

function setup(maxSeconds = 7200) {
  const chunks: Array<{ output: string; content: string; position: number }> =
    [];

  const updates: Array<Record<string, string | null>> = [];
  const deletes: Array<number> = [];
  const chain = { where: () => Promise.resolve() };

  const db = {
    transaction: <T>(fn: (tx: Db) => Promise<T>) => fn(asDb(db)),
    update: () => ({
      set: (values: Record<string, string | null>) => {
        updates.push(values);

        return chain;
      },
    }),
    delete: () => {
      deletes.push(1);

      return chain;
    },
    insert: () => ({
      values: (row: { output: string; content: Buffer; position: number }) => {
        chunks.push({
          output: row.output,
          content: row.content.toString(),
          position: row.position,
        });

        return Promise.resolve();
      },
    }),
  };

  const tenantDb = {
    runAs: <T>(_owner: string, fn: (tx: Db) => Promise<T>) => fn(asDb(db)),
  };

  const config = {
    config: {
      ...BUILT_IN_DEFAULTS,
      tools: {
        ...BUILT_IN_DEFAULTS.tools,
        jobs: { ...BUILT_IN_DEFAULTS.tools.jobs, maxSeconds },
      },
    },
  };

  const registry = new BashJobRegistry(
    tenantDb,
    { instanceId: crypto.randomUUID() },
    config,
    { startOnSettlement: vi.fn() },
  );

  vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(7);
  vi.spyOn(
    ChatDeliveriesRepository.prototype,
    'insertJobNotice',
  ).mockResolvedValue(undefined);
  vi.spyOn(RunsRepository.prototype, 'findActiveByChatId').mockResolvedValue(
    undefined,
  );

  const lock = vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue(
    // SAFETY: only presence is checked.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    {} as never,
  );

  const settlements: Array<JobSettlement> = [];

  const inserted = vi
    .spyOn(ChatJobsRepository.prototype, 'insert')
    .mockImplementation((job) => Promise.resolve(jobRow(job)));

  const settle = vi
    .spyOn(ChatJobsRepository.prototype, 'settle')
    .mockImplementation((_c, _o, _j, settlement) => {
      settlements.push(settlement);

      // SAFETY: the store checks only that a row came back.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      return Promise.resolve({} as ChatJob);
    });

  const artifact = vi
    .spyOn(ArtifactsRepository.prototype, 'insertArtifact')
    .mockResolvedValue({ id: 'art-1', createdAt: STARTED });

  const parts = vi
    .spyOn(ArtifactsRepository.prototype, 'insertParts')
    .mockResolvedValue();

  return {
    registry,
    chunks,
    inserted,
    settle,
    settlements,
    artifact,
    parts,
    lock,
    tenantDb,
    updates,
    deletes,
  };
}

const facts = (over: Partial<BashJobFacts> = {}): BashJobFacts => ({
  ownerUserId: OWNER,
  chatId: CHAT,
  runId: 'run-1',
  toolCallId: 'call-1',
  startedAt: STARTED,
  settings: { modelId: 'm', permissionMode: 'default' },
  maxBytes: 1_000_000,
  configuredCredentials: [],
  artifactReadable: true,
  hostFiles: false,
  ...over,
});

describe('BashJobRegistry', () => {
  beforeEach(() => vi.useFakeTimers({ now: STARTED }));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('promotes under the reserved number, with the lifetime deadline and the captured output', async () => {
    const { registry, chunks, inserted } = setup(120);
    const command = fakeHandle({ stdout: 'so far\n', stderr: 'warn\n' });

    await registry.promote(command.handle, facts());

    expect(inserted.mock.calls[0][0]).toMatchObject({
      seq: 7,
      pid: 42,
      executor: 'bash',
      deadlineAt: new Date(STARTED.getTime() + 120_000),
      outputs: ['stdout', 'stderr'],
    });
    expect(chunks).toEqual([
      { output: 'stdout', content: 'so far\n', position: 0 },
      { output: 'stderr', content: 'warn\n', position: 0 },
    ]);
  });

  it('reconciles a committed job receipt when the transaction acknowledgement is lost', async () => {
    const { registry, tenantDb } = setup();
    const command = fakeHandle({ stdout: 'captured output', stderr: '' });

    const receipt = {
      toolCallId: 'call-1',
      result: { status: 'success', job: 'job://bash-7' },
    };

    const runAs = tenantDb.runAs;
    let loseAcknowledgement = true;

    vi.spyOn(tenantDb, 'runAs').mockImplementation(async (owner, operation) => {
      const committed = await runAs(owner, operation);

      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        throw new Error('connection lost after commit');
      }

      return committed;
    });
    vi.spyOn(
      RunRowFenceRepository.prototype,
      'lockHostPromotion',
    ).mockResolvedValue({
      id: 'run-1',
      chatId: CHAT,
      messageId: 'message-1',
      userId: OWNER,
      modelId: 'model-1',
      activeAttemptId: 'attempt-1',
      completedAttemptId: null,
      turnToolAvailability: null,
      status: 'running_model',
      workerId: null,
      cancelRequestedAt: null,
      error: null,
      createdAt: STARTED,
      startedAt: STARTED,
      finishedAt: null,
      effort: null,
      permissionMode: 'default',
      followUpAction: null,
      sourceRunId: null,
    } satisfies Run);
    vi.spyOn(RunEventsRepository.prototype, 'append').mockResolvedValue({
      sequence: 1,
      runId: 'run-1',
      eventType: 'native.result',
      payload: null,
      createdAt: STARTED,
    } satisfies RunEvent);
    vi.spyOn(NativeReceiptsRepository.prototype, 'findNativeResult')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({
        sequence: 2,
        runId: 'run-1',
        eventType: 'native.result',
        payload: receipt,
        createdAt: STARTED,
      } satisfies RunEvent);

    const findJob = vi
      .spyOn(ChatJobsRepository.prototype, 'findByLocator')
      .mockResolvedValue(
        jobRow({
          chatId: CHAT,
          ownerUserId: OWNER,
          executor: 'bash',
          seq: 7,
          runId: 'run-1',
          toolCallId: 'call-1',
          workerInstanceId: 'worker',
          pid: 42,
          startedAt: STARTED,
          outputs: ['stdout', 'stderr'],
          artifactReadable: true,
          settings: facts().settings,
        }),
      );

    const promoted = await registry.promoteWithReceipt(
      command.handle,
      facts({ attemptId: 'attempt-1' }),
      (job) => ({ status: 'success', job: `job://bash-${job.seq}` }),
      () => ({ status: 'error', type: 'unavailable', message: 'stopped' }),
    );

    expect(promoted).toEqual({
      result: receipt.result,
      receiptCommitted: true,
      recoveryWon: false,
    });
    expect(findJob).toHaveBeenCalledWith(CHAT, OWNER, 'bash', 7);
    expect(command.stop).not.toHaveBeenCalled();

    await registry.shutdown();
    expect(command.stop).toHaveBeenCalledWith('worker');
  });

  it('returns an existing failure receipt after recovery loses its acknowledgement', async () => {
    const { registry, tenantDb } = setup();
    const command = fakeHandle();

    const prior = {
      status: 'error',
      type: 'cancelled',
      message: 'A stop receipt was already recorded.',
    } as const;

    const findReceipt = vi
      .spyOn(NativeReceiptsRepository.prototype, 'findNativeResult')
      .mockResolvedValue({
        sequence: 2,
        runId: 'run-1',
        eventType: 'native.result',
        payload: { toolCallId: 'call-1', result: prior },
        createdAt: STARTED,
      } satisfies RunEvent);

    const recover = vi
      .spyOn(NativeFilesRepository.prototype, 'recoverHostPromotion')
      .mockResolvedValue({ disposition: 'recovery_won', result: prior });

    const runAs = tenantDb.runAs;
    let calls = 0;

    vi.spyOn(tenantDb, 'runAs').mockImplementation(async (owner, operation) => {
      calls += 1;
      const result = await runAs(owner, operation);

      if (calls === 2)
        throw new Error('recovery committed; acknowledgement lost');

      return result;
    });
    vi.spyOn(
      RunRowFenceRepository.prototype,
      'lockHostPromotion',
    ).mockRejectedValue(new Error('database unavailable'));
    command.stop.mockRejectedValueOnce(new Error('could not prove stop'));

    const promoted = await registry.promoteWithReceipt(
      command.handle,
      facts({ attemptId: 'attempt-1' }),
      (job) => ({ status: 'success', job: `job://bash-${job.seq}` }),
      () => ({ status: 'error', type: 'cancelled', message: 'stopped' }),
    );

    expect(promoted).toEqual({
      result: prior,
      receiptCommitted: true,
      recoveryWon: true,
    });
    expect(recover.mock.calls[0]?.[0]).toMatchObject({
      runId: 'run-1',
      userId: OWNER,
      attemptId: 'attempt-1',
      toolCallId: 'call-1',
      result: { type: 'outcome_unknown' },
    });
    expect(findReceipt).toHaveBeenCalledWith('run-1', OWNER, 'call-1');
    expect(command.stop).toHaveBeenCalledWith('run');
  });

  it('does not attempt a Run fence after the Chat lock is missing', async () => {
    const { registry, lock, inserted } = setup();
    const command = fakeHandle();

    const runFence = vi.spyOn(
      RunRowFenceRepository.prototype,
      'lockHostPromotion',
    );

    lock.mockResolvedValue(undefined);

    const promoted = await registry.promoteWithReceipt(
      command.handle,
      facts({ attemptId: 'attempt-1' }),
      (job) => ({ status: 'success', job: `job://bash-${job.seq}` }),
      () => ({ status: 'error', type: 'cancelled', message: 'stopped' }),
    );

    expect(promoted).toMatchObject({
      result: { status: 'error', type: 'outcome_unknown' },
      receiptCommitted: false,
      recoveryWon: true,
    });
    expect(lock).toHaveBeenCalledWith(CHAT, OWNER);
    expect(runFence).not.toHaveBeenCalled();
    expect(inserted).not.toHaveBeenCalled();
    expect(command.stop).toHaveBeenCalledWith('run');
  });

  it('rejects receipt promotion without an owning Run attempt', async () => {
    const { registry, lock, inserted } = setup();
    const command = fakeHandle();

    await expect(
      registry.promoteWithReceipt(
        command.handle,
        facts(),
        () => ({ status: 'success' }),
        () => ({ status: 'error', type: 'cancelled', message: 'stopped' }),
      ),
    ).rejects.toThrow('Host promotion requires its Run attempt.');

    expect(lock).not.toHaveBeenCalled();
    expect(inserted).not.toHaveBeenCalled();
    expect(command.stop).not.toHaveBeenCalled();
  });

  it('accepts only a complete tool result from a promotion receipt', () => {
    expect(
      toolResultFromReceipt({
        result: { status: 'error', type: 'timed_out', message: 'deadline' },
      }),
    ).toEqual({ status: 'error', type: 'timed_out', message: 'deadline' });
    expect(
      toolResultFromReceipt({ result: { status: 'error', type: 'timed_out' } }),
    ).toBeUndefined();
    expect(
      toolResultFromReceipt({
        result: { status: 'pending', job: 'job://bash-7' },
      }),
    ).toBeUndefined();
  });

  it('accepts only complete bash job locators from a receipt', () => {
    expect(jobSequence({ status: 'success', job: 'job://bash-123' })).toBe(123);

    for (const job of [
      'job://bash-1x',
      'xjob://bash-1',
      'job://bash-a',
      'job://ssh-1',
    ]) {
      expect(jobSequence({ status: 'success', job })).toBeUndefined();
    }

    expect(jobSequence({ status: 'success' })).toBeUndefined();
  });

  it('returns the durable stop receipt when recovery wins the Run lock', async () => {
    const { registry } = setup();
    const command = fakeHandle({ stdout: 'before recovery', stderr: '' });

    const stopped = {
      status: 'error',
      type: 'unavailable',
      message: 'Run ended before promotion',
    } as const;

    vi.spyOn(
      RunRowFenceRepository.prototype,
      'lockHostPromotion',
    ).mockResolvedValue(undefined);

    const recover = vi.spyOn(
      NativeFilesRepository.prototype,
      'recoverHostPromotion',
    );

    recover.mockResolvedValue({ disposition: 'recovery_won', result: stopped });

    const promoted = await registry.promoteWithReceipt(
      command.handle,
      facts({ attemptId: 'attempt-1' }),
      (job) => ({ status: 'success', job: `job://bash-${job.seq}` }),
      () => stopped,
    );

    expect(promoted).toEqual({
      result: stopped,
      receiptCommitted: true,
      recoveryWon: true,
    });
    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        userId: OWNER,
        attemptId: 'attempt-1',
        toolCallId: 'call-1',
      }),
    );
    expect(command.stop).toHaveBeenCalledWith('run');
  });

  it('does not claim a durable receipt when recovery is fenced', async () => {
    const { registry } = setup();
    const command = fakeHandle({ stdout: 'before fencing', stderr: '' });

    const unavailable = {
      status: 'error',
      type: 'unavailable',
      message: 'Run no longer owns this attempt',
    } as const;

    vi.spyOn(
      RunRowFenceRepository.prototype,
      'lockHostPromotion',
    ).mockResolvedValue(undefined);

    const recover = vi
      .spyOn(NativeFilesRepository.prototype, 'recoverHostPromotion')
      .mockResolvedValue({ disposition: 'fenced', result: unavailable });

    const promoted = await registry.promoteWithReceipt(
      command.handle,
      facts({ attemptId: 'attempt-1' }),
      (job) => ({ status: 'success', job: `job://bash-${job.seq}` }),
      () => unavailable,
    );

    expect(promoted).toEqual({
      result: unavailable,
      receiptCommitted: false,
      recoveryWon: true,
    });
    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        attemptId: 'attempt-1',
        toolCallId: 'call-1',
      }),
    );
    expect(command.stop).toHaveBeenCalledWith('run');
  });

  it('stores no deadline for an unlimited job', async () => {
    const { registry, inserted } = setup(120);
    const command = fakeHandle();

    await registry.promote(command.handle, facts({ unlimited: true }));

    expect(inserted.mock.calls[0][0].deadlineAt).toBeUndefined();
  });

  it('preserves an executor timeout when an owner stop wins registry pickup', async () => {
    const { registry, settlements } = setup();
    const command = fakeHandle({ stdout: 'before deadline', stderr: '' });
    await registry.promote(command.handle, facts());
    command.end({
      status: 'error',
      type: 'timed_out',
      durationMs: 120_000,
      stdout: 'before deadline',
      stderr: '',
      truncated: false,
    });
    await registry.stop('job-1', 'owner');
    expect(settlements).toMatchObject([{ state: 'timed_out' }]);
  });

  it.each([
    [0, undefined, { state: 'succeeded', result: { exitCode: 0 } }],
    [2, undefined, { state: 'failed', result: { exitCode: 2 } }],
    [
      1,
      'SIGKILL',
      { state: 'failed', result: { exitCode: null, signal: 'SIGKILL' } },
    ],
  ])('settles an exit of %s with signal %s', async (code, signal, expected) => {
    const { registry, settlements } = setup();
    const command = fakeHandle();

    await registry.promote(command.handle, facts());
    command.exit(code, signal);
    await vi.advanceTimersByTimeAsync(0);

    expect(settlements).toMatchObject([expected]);
  });

  it('does not retain cumulative snapshots behind a stalled output write', async () => {
    const { registry, tenantDb, chunks } = setup();
    const command = fakeHandle();
    await registry.promote(command.handle, facts());
    command.snapshot.mockClear();
    const blocked = Promise.withResolvers<void>();
    const runAs = tenantDb.runAs;
    vi.spyOn(tenantDb, 'runAs').mockImplementation(async (owner, action) => {
      await blocked.promise;

      return runAs(owner, action);
    });
    const block = 'x'.repeat(16 * 1024);
    command.emit({ stdout: block, stderr: '' });
    await vi.advanceTimersByTimeAsync(0);

    for (let count = 2; count <= 6; count++) {
      command.emit({ stdout: block.repeat(count), stderr: '' });
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(command.snapshot).toHaveBeenCalledTimes(1);
    blocked.resolve();
    await vi.advanceTimersByTimeAsync(0);
    command.exit(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(chunks.map((chunk) => chunk.content).join('')).toBe(block.repeat(6));
  });

  it('retires a flush timer whose bytes the queued snapshot already includes', async () => {
    const { registry, tenantDb, chunks } = setup();
    const command = fakeHandle();
    await registry.promote(command.handle, facts());
    command.snapshot.mockClear();
    const blocked = Promise.withResolvers<void>();
    const runAs = tenantDb.runAs;
    vi.spyOn(tenantDb, 'runAs').mockImplementation(async (owner, action) => {
      await blocked.promise;

      return runAs(owner, action);
    });
    const block = 'x'.repeat(16 * 1024);
    command.emit({ stdout: block, stderr: '' });
    await vi.advanceTimersByTimeAsync(0);
    command.emit({ stdout: `${block}a`, stderr: '' });
    await vi.advanceTimersByTimeAsync(1000);
    command.emit({ stdout: `${block}ab`, stderr: '' });
    blocked.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(command.snapshot).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(command.snapshot).toHaveBeenCalledTimes(2);
    expect(chunks.map((chunk) => chunk.content).join('')).toBe(`${block}ab`);
    command.exit(0);
    await vi.advanceTimersByTimeAsync(0);
  });

  it('stores the output that arrived after the last flush when the job settles', async () => {
    const { registry, chunks } = setup();
    const command = fakeHandle();

    await registry.promote(command.handle, facts());
    command.write({ stdout: 'late\n', stderr: '' });
    command.exit(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(chunks).toEqual([
      { output: 'stdout', content: 'late\n', position: 0 },
    ]);
  });

  it('stops a job for the worker at shutdown and refuses a new command', async () => {
    const { registry, settlements } = setup();
    const command = fakeHandle();

    await registry.promote(command.handle, facts());
    await registry.shutdown();

    expect(command.stop).toHaveBeenCalledWith('worker');
    expect(settlements).toMatchObject([
      { state: 'cancelled', stoppedBy: 'worker' },
    ]);
    expect(
      registry.start(
        { command: 'true', args: [], cwd: '/' },
        executorContext,
        {},
      ),
    ).toMatchObject({ status: 'error', type: 'unavailable' });
  });

  it('refuses receipt promotion after shutdown without entering persistence', async () => {
    const { registry, inserted, lock } = setup();
    const command = fakeHandle();
    await registry.shutdown();

    expect(() =>
      registry.promoteWithReceipt(
        command.handle,
        facts({ attemptId: 'attempt-1' }),
        () => ({ status: 'success' }),
        () => ({ status: 'error', type: 'unavailable', message: 'stopped' }),
      ),
    ).toThrow('The worker is shutting down.');
    expect(inserted).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
    expect(command.stop).not.toHaveBeenCalled();
  });

  it('settles once when a stop races the natural end', async () => {
    const { registry, settle } = setup();
    const command = fakeHandle();

    await registry.promote(command.handle, facts());
    command.exit(0);
    await Promise.all([
      registry.stop('job-1', 'owner'),
      registry.stop('job-1', 'owner'),
    ]);
    await vi.advanceTimersByTimeAsync(0);

    expect(settle).toHaveBeenCalledTimes(1);
  });

  describe('a settlement that fails to commit', () => {
    it('keeps its facts and commits the same settlement on a later retry only', async () => {
      const { registry, settle, settlements } = setup();
      const command = fakeHandle();

      await registry.promote(command.handle, facts());
      settle.mockRejectedValueOnce(new Error('db down'));
      command.exit(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(settlements).toEqual([]);

      await registry.settlePending();
      expect(settlements).toMatchObject([
        { state: 'succeeded', result: { exitCode: 0 } },
      ]);

      await registry.settlePending();
      expect(settle).toHaveBeenCalledTimes(2);
    });

    it('stays pending while the database keeps failing, and never stops the command', async () => {
      const { registry, settle } = setup();
      const command = fakeHandle();

      await registry.promote(command.handle, facts());
      settle.mockRejectedValue(new Error('db down'));
      command.exit(0);
      await vi.advanceTimersByTimeAsync(0);

      await registry.settlePending();
      await registry.settlePending();

      expect(settle).toHaveBeenCalledTimes(3);
      expect(command.stop).not.toHaveBeenCalled();
    });

    it.each([true, false])(
      'shutdown retries the natural settlement once when persistence recovers=%s',
      async (recovers) => {
        const { registry, settle, settlements } = setup();
        const command = fakeHandle();

        await registry.promote(command.handle, facts());
        settle.mockRejectedValueOnce(new Error('db down'));
        command.exit(2);
        await vi.advanceTimersByTimeAsync(0);
        expect(settlements).toEqual([]);

        if (!recovers) settle.mockRejectedValue(new Error('still down'));

        await registry.shutdown();

        expect(settle).toHaveBeenCalledTimes(2);
        expect(command.stop).not.toHaveBeenCalled();
        expect(settlements).toEqual(
          recovers ? [expect.objectContaining({ state: 'failed' })] : [],
        );
      },
    );
  });

  describe('stored output while the job runs', () => {
    const KIB16 = 16 * 1024;

    it('stores nothing for a quiet job', async () => {
      const { registry, chunks } = setup();

      await registry.promote(fakeHandle().handle, facts());
      await vi.advanceTimersByTimeAsync(600_000);

      expect(chunks).toEqual([]);
    });

    it('flushes small output one second after the first unstored byte', async () => {
      const { registry, chunks } = setup();
      const command = fakeHandle();

      await registry.promote(command.handle, facts());
      command.emit({ stdout: 'hello\n', stderr: '' });
      await vi.advanceTimersByTimeAsync(999);
      expect(chunks).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      expect(chunks).toEqual([
        { output: 'stdout', content: 'hello\n', position: 0 },
      ]);
    });

    it('flushes at once when 16 KiB of new output exist, and not one byte earlier', async () => {
      const { registry, chunks } = setup();
      const command = fakeHandle();

      await registry.promote(command.handle, facts());
      command.emit({ stdout: 'x'.repeat(KIB16 - 1), stderr: '' });
      await vi.advanceTimersByTimeAsync(0);
      expect(chunks).toEqual([]);

      command.emit({ stdout: 'x'.repeat(KIB16), stderr: '' });
      await vi.advanceTimersByTimeAsync(0);
      expect(chunks).toEqual([
        { output: 'stdout', content: 'x'.repeat(KIB16), position: 0 },
      ]);
    });

    it('stores only the suffix of later flushes, at its offset', async () => {
      const { registry, chunks } = setup();
      const command = fakeHandle();

      await registry.promote(command.handle, facts());
      command.emit({ stdout: 'abc', stderr: '' });
      await vi.advanceTimersByTimeAsync(1000);
      command.emit({ stdout: 'abcdef', stderr: 'err' });
      await vi.advanceTimersByTimeAsync(1000);

      expect(chunks).toEqual([
        { output: 'stdout', content: 'abc', position: 0 },
        { output: 'stdout', content: 'def', position: 3 },
        { output: 'stderr', content: 'err', position: 0 },
      ]);
    });

    it('ignores a notice of zero bytes', async () => {
      const { registry, chunks } = setup();
      const command = fakeHandle();

      await registry.promote(command.handle, facts());
      command.emit({ stdout: '', stderr: '' });
      await vi.advanceTimersByTimeAsync(5000);

      expect(chunks).toEqual([]);
    });

    it('stores the bytes that arrived while the promotion transaction ran', async () => {
      const { registry, chunks, inserted } = setup();
      const command = fakeHandle({ stdout: 'a', stderr: '' });

      inserted.mockImplementationOnce((job) => {
        command.write({ stdout: 'abc', stderr: '' });

        return Promise.resolve(jobRow(job));
      });
      await registry.promote(command.handle, facts());
      await vi.advanceTimersByTimeAsync(1000);

      expect(chunks).toEqual([
        { output: 'stdout', content: 'a', position: 0 },
        { output: 'stdout', content: 'bc', position: 1 },
      ]);
    });

    it('stops listening and flushes nothing more once the job settled', async () => {
      const { registry, chunks } = setup();
      const command = fakeHandle();

      await registry.promote(command.handle, facts());
      command.emit({ stdout: 'a', stderr: '' });
      command.exit(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(command.subscribers()).toBe(0);

      const stored = chunks.length;

      await vi.advanceTimersByTimeAsync(10_000);
      expect(chunks).toHaveLength(stored);
    });
  });

  it.each([false, true])(
    'stores no late output after settlement (retry pending: %s)',
    async (retryPending) => {
      const { registry, chunks, settle } = setup();
      const command = fakeHandle();

      await registry.promote(command.handle, facts());

      if (retryPending) settle.mockRejectedValueOnce(new Error('db down'));
      command.exit(0);
      await vi.advanceTimersByTimeAsync(0);
      command.emitLate({ stdout: 'x'.repeat(20_000), stderr: '' });
      await vi.advanceTimersByTimeAsync(5000);

      expect(chunks).toEqual([]);
    },
  );

  it.each(['stdout', 'stderr'] as const)(
    'does not count committed %s bytes toward a promotion-window flush',
    async (stream) => {
      const { registry, chunks, inserted } = setup();
      const initial = 'x'.repeat(16 * 1024 - 1);
      const command = fakeHandle({ stdout: '', stderr: '', [stream]: initial });

      inserted.mockImplementationOnce((job) => {
        command.write({ stdout: '', stderr: '', [stream]: `${initial}y` });

        return Promise.resolve(jobRow(job));
      });
      await registry.promote(command.handle, facts());
      await vi.advanceTimersByTimeAsync(999);
      expect(chunks).toEqual([
        { output: stream, content: initial, position: 0 },
      ]);

      await vi.advanceTimersByTimeAsync(1);
      expect(chunks).toEqual([
        { output: stream, content: initial, position: 0 },
        { output: stream, content: 'y', position: initial.length },
      ]);
    },
  );

  it.each(['stdout', 'stderr'] as const)(
    'counts promotion-window %s bytes toward the 16 KiB flush',
    async (stream) => {
      const { registry, chunks, inserted } = setup();
      const command = fakeHandle({ stdout: '', stderr: '', [stream]: 'a' });
      const suffix = 'x'.repeat(16 * 1024);

      inserted.mockImplementationOnce((job) => {
        command.write({ stdout: '', stderr: '', [stream]: 'a' + suffix });

        return Promise.resolve(jobRow(job));
      });
      await registry.promote(command.handle, facts());
      await vi.advanceTimersByTimeAsync(0);
      expect(chunks).toEqual([
        { output: stream, content: 'a', position: 0 },
        { output: stream, content: suffix, position: 1 },
      ]);
    },
  );

  describe('what a settlement records', () => {
    it('settles a nonzero exit with its truncation flags', async () => {
      const { registry, settlements } = setup();
      const command = fakeHandle();

      await registry.promote(command.handle, facts());
      command.cut({ stdout: true, stderr: false });
      command.exit(3);
      await vi.advanceTimersByTimeAsync(0);

      expect(settlements).toEqual([
        {
          state: 'failed',
          result: {
            exitCode: 3,
            signal: undefined,
            truncated: { stdout: true, stderr: false },
          },
        },
      ]);
    });

    it('settles an exit 0 that a signal reports as failed, with no exit code', async () => {
      const { registry, settlements } = setup();
      const command = fakeHandle();

      await registry.promote(command.handle, facts());
      command.exit(0, 'SIGTERM');
      await vi.advanceTimersByTimeAsync(0);

      expect(settlements).toMatchObject([
        { state: 'failed', result: { exitCode: null, signal: 'SIGTERM' } },
      ]);
    });

    it('records the truncation of a stopped job', async () => {
      const { registry, settlements } = setup();
      const command = fakeHandle();

      await registry.promote(command.handle, facts());
      command.cut({ stdout: false, stderr: true });
      await registry.stop('job-1', 'owner');

      expect(settlements).toEqual([
        {
          state: 'cancelled',
          stoppedBy: 'owner',
          result: { truncated: { stdout: false, stderr: true } },
        },
      ]);
    });

    it('settles a result with no exit as lost with an unknown outcome', async () => {
      const { registry, settlements } = setup();
      const command = fakeHandle();

      await registry.promote(command.handle, facts());
      command.end({ status: 'error', type: 'unavailable', message: 'gone' });
      await vi.advanceTimersByTimeAsync(0);

      expect(settlements).toMatchObject([
        { state: 'lost', result: { outcomeUnknown: true } },
      ]);
    });
  });

  describe('the heartbeat retry', () => {
    it('retries nothing for a job that runs', async () => {
      const { registry, settle } = setup();

      await registry.promote(fakeHandle().handle, facts());
      await registry.settlePending();

      expect(settle).not.toHaveBeenCalled();
    });

    it('does not settle a job again while its first settlement is in flight', async () => {
      const { registry, settle } = setup();
      const command = fakeHandle();

      await registry.promote(command.handle, facts());
      let release: () => void = () => {};

      settle.mockImplementation(
        () =>
          new Promise((resolve) => {
            // SAFETY: the store checks only that a row came back.
            // eslint-disable-next-line typescript/no-unsafe-type-assertion
            release = () => resolve({} as never);
          }),
      );
      command.exit(0);
      await vi.advanceTimersByTimeAsync(0);
      await registry.settlePending();
      expect(settle).toHaveBeenCalledTimes(1);

      release();
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  describe('commands that are not jobs', () => {
    const real = (
      registry: BashJobRegistry,
      script: string,
      options: { readonly unlimited?: boolean } = {},
    ) => {
      const started = registry.start(
        { command: 'bash', args: ['-c', script], cwd: '/tmp', env: {} },
        {
          workingDirectory: '/tmp',
          secretBoundary: true,
          processIsolation: true,
          outputBoundBytes: 1_000_000,
          inputBound: 8000,
          durationMs: 300_000,
          maxProcesses: 4,
        },
        options,
      );

      if (!('pid' in started)) throw new Error('the command did not start');

      return started;
    };

    it('enforces lifetime from spawn through foreground and stalled promotion', async () => {
      vi.useRealTimers();
      const { registry, settlements } = setup(0.05);
      const foreground = real(registry, 'sleep 0.15');
      const foregroundResult = await foreground.settled;
      expect(foregroundResult).toMatchObject({
        status: 'error',
        type: 'timed_out',
      });

      const { promise: sequence, resolve: release } =
        Promise.withResolvers<number>();

      vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockReturnValue(
        sequence,
      );
      const promoting = real(registry, 'sleep 0.15');

      const promotion = registry.promote(
        promoting,
        facts({ startedAt: new Date() }),
      );

      expect(await promoting.settled).toMatchObject({
        status: 'error',
        type: 'timed_out',
      });
      release(7);
      await promotion;
      await registry.shutdown();
      expect(settlements).toMatchObject([{ state: 'timed_out' }]);
    });

    it('does not arm a lifetime for an unlimited command', async () => {
      vi.useRealTimers();
      const { registry } = setup(0.05);

      const command = real(registry, 'sleep 0.15; printf completed', {
        unlimited: true,
      });

      expect(await command.settled).toMatchObject({
        status: 'success',
        exitCode: 0,
        stdout: 'completed',
      });
    });

    it('stops a foreground command at shutdown, and not one that ended', async () => {
      vi.useRealTimers();
      const { registry } = setup();
      const running = real(registry, 'sleep 30');
      const ended = real(registry, 'true');

      await ended.settled;
      await registry.shutdown();

      const result = await running.settled;

      expect(result.status === 'success' && result.exitCode === 0).toBe(false);
    });

    it('persists a shutdown stop after pending promotion and awaits settlement', async () => {
      vi.useRealTimers();
      const { registry, inserted, settle, settlements, chunks } = setup();
      const insertion = Promise.withResolvers<void>();
      const releaseInsertion = Promise.withResolvers<void>();
      inserted.mockImplementation(async (values) => {
        insertion.resolve();
        await releaseInsertion.promise;

        return jobRow(values);
      });

      const command = real(registry, "printf 'before-stop'; sleep 30");
      await vi.waitFor(() =>
        expect(command.snapshot().stdout).toBe('before-stop'),
      );
      const promotion = registry.promote(command, facts());
      await insertion.promise;

      const unrelated = real(registry, 'sleep 30');
      let shutdownFinished = false;

      const shutdown = registry.shutdown().then(() => {
        shutdownFinished = true;
      });

      await Promise.all([command.settled, unrelated.settled]);
      expect(shutdownFinished).toBe(false);

      const settlement = Promise.withResolvers<ChatJob>();
      settle.mockImplementationOnce((_chat, _owner, _job, value) => {
        settlements.push(value);

        return settlement.promise;
      });
      releaseInsertion.resolve();
      await promotion;
      await vi.waitFor(() => expect(settle).toHaveBeenCalledTimes(1));

      expect(shutdownFinished).toBe(false);
      expect(settle.mock.calls[0]?.slice(0, 3)).toEqual([CHAT, OWNER, 'job-1']);
      expect(settlements).toMatchObject([
        { state: 'cancelled', stoppedBy: 'worker' },
      ]);
      expect(chunks).toEqual([
        { output: 'stdout', content: 'before-stop', position: 0 },
      ]);

      settlement.resolve(
        jobRow({
          chatId: CHAT,
          ownerUserId: OWNER,
          executor: 'bash',
          seq: 7,
          runId: 'run-1',
          toolCallId: 'call-1',
          workerInstanceId: 'worker',
          pid: command.pid,
          startedAt: STARTED,
          outputs: ['stdout', 'stderr'],
          artifactReadable: false,
          settings: facts().settings,
        }),
      );
      await shutdown;
      expect(shutdownFinished).toBe(true);
    });

    it('stops a promoted command once at shutdown, through its job', async () => {
      vi.useRealTimers();
      const { registry } = setup();
      const command = real(registry, 'sleep 30');
      const stop = vi.spyOn(command, 'stop');

      await registry.promote(command, facts());
      await registry.shutdown();

      expect(stop).toHaveBeenCalledTimes(1);
    });

    it('refuses a start after shutdown began', async () => {
      const { registry } = setup();

      await registry.shutdown();

      expect(
        registry.start(
          { command: 'bash', args: ['-c', 'true'], cwd: '/tmp' },
          executorContext,
        ),
      ).toMatchObject({ status: 'error', type: 'unavailable' });
    });

    it('stops a command whose promotion arrives after shutdown began', async () => {
      const { registry } = setup();
      const command = fakeHandle();

      await registry.shutdown();

      await expect(
        registry.promote(command.handle, facts()),
      ).rejects.toBeInstanceOf(JobPromotionError);
      expect(command.stop).toHaveBeenCalledWith('run');
    });
  });
});

describe('BashJobLifecycle.recheckJobs', () => {
  afterEach(() => vi.restoreAllMocks());

  it('checks the later jobs after one job check fails', async () => {
    const lifecycle = new BashJobLifecycle(
      { runAs: vi.fn() },
      { warn: vi.fn(), error: vi.fn() },
      { startOnSettlement: vi.fn() },
    );

    const command = fakeHandle();

    const job = jobRow({
      chatId: CHAT,
      ownerUserId: OWNER,
      executor: 'bash',
      seq: 1,
      runId: 'run-1',
      toolCallId: 'call-1',
      workerInstanceId: 'worker-1',
      pid: 42,
      startedAt: STARTED,
      outputs: ['stdout', 'stderr'],
      artifactReadable: true,
      settings: facts().settings,
    });

    for (const id of ['a', 'b', 'c'])
      lifecycle.trackJob(command.handle, { ...job, id }, facts(), {
        stdout: '',
        stderr: '',
        truncated: false,
        truncatedStreams: { stdout: false, stderr: false },
      });

    const check = vi
      .spyOn(lifecycle, 'recheckJob')
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(undefined);

    await expect(lifecycle.recheckJobs()).resolves.toBeUndefined();
    expect(check.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c']);
  });
});
