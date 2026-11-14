import {
  type BashExecutorContext,
  type BashResult,
} from '@workspace/bash-executor';

import { ChatsRepository } from '../chats/chats-repository';
import { type ChatJob } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import {
  BashJobRegistry,
  JobPromotionError,
  type BashJobFacts,
} from './bash-job-registry';
import { ChatJobsRepository, type JobSettlement } from './chat-jobs.repository';

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

  const stop = vi.fn((_cause: string) =>
    Promise.resolve({
      proved: true,
      ...current,
      truncated: cut.stdout || cut.stderr,
      truncatedStreams: cut,
    }),
  );

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
      tools: { ...BUILT_IN_DEFAULTS.tools, jobs: { maxSeconds } },
    },
  };

  const registry = new BashJobRegistry(
    tenantDb,
    { instanceId: crypto.randomUUID() },
    config,
  );

  vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(7);

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

  it('stores no deadline and arms no lifetime for an unlimited job', async () => {
    const { registry, inserted, settle } = setup(120);
    const command = fakeHandle();

    await registry.promote(command.handle, facts({ unlimited: true }));
    await vi.advanceTimersByTimeAsync(10_000_000);

    expect(inserted.mock.calls[0][0].deadlineAt).toBeUndefined();
    expect(command.stop).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it('stops a job at its lifetime and settles it timed_out; an unproved stop is lost', async () => {
    const { registry, settlements } = setup(120);
    const command = fakeHandle();

    await registry.promote(command.handle, facts());
    await vi.advanceTimersByTimeAsync(119_000);
    expect(command.stop).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(command.stop).toHaveBeenCalledWith('lifetime');
    expect(settlements).toMatchObject([{ state: 'timed_out' }]);

    const second = setup(120);
    const unproved = fakeHandle();

    unproved.stop.mockResolvedValue({
      proved: false,
      stdout: '',
      stderr: '',
      truncated: false,
      truncatedStreams: { stdout: false, stderr: false },
    });
    await second.registry.promote(unproved.handle, facts());
    await vi.advanceTimersByTimeAsync(120_000);

    expect(second.settlements).toMatchObject([
      { state: 'lost', result: { outcomeUnknown: true } },
    ]);
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

  describe('lifetime beyond one timer', () => {
    it('re-arms a lifetime longer than a timer can hold and stops at the deadline', async () => {
      const { registry } = setup(3_000_000);
      const command = fakeHandle();
      const limit = 2_147_483_647;

      await registry.promote(command.handle, facts());
      await vi.advanceTimersByTimeAsync(limit);
      expect(command.stop).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(3_000_000_000 - limit - 1);
      expect(command.stop).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(command.stop).toHaveBeenCalledWith('lifetime');
    });
  });

  describe('commands that are not jobs', () => {
    const real = (registry: BashJobRegistry, script: string) => {
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
      );

      if (!('pid' in started)) throw new Error('the command did not start');

      return started;
    };

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
