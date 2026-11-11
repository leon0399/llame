import {
  type BashExecutorContext,
  type BashResult,
} from '@workspace/bash-executor';

import { ChatsRepository } from '../chats/chats-repository';
import { type ChatJob } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { BashJobRegistry, type BashJobFacts } from './bash-job-registry';
import { ChatJobsRepository, type JobSettlement } from './chat-jobs.repository';

/** The fakes implement only the members the registry and the store call. */
// SAFETY: see above.
// eslint-disable-next-line typescript/no-unsafe-type-assertion
const asDb = (fake: { insert: unknown }): Db => fake as never;

// SAFETY: a closed registry refuses before it reads the context.
// eslint-disable-next-line typescript/no-unsafe-type-assertion
const executorContext = {} as BashExecutorContext;

const OWNER = 'owner';
const CHAT = 'chat-1';
const STARTED = new Date('2026-11-11T10:00:00.000Z');

type Output = { stdout: string; stderr: string };

/** A command handle the test settles by hand. */
function fakeHandle(initial: Output = { stdout: '', stderr: '' }) {
  let finish: (result: BashResult) => void = () => {};
  const settled = new Promise((resolve) => (finish = resolve));
  let current = initial;

  const stop = vi.fn((_cause: string) =>
    Promise.resolve({
      proved: true,
      ...current,
      truncated: false,
      truncatedStreams: { stdout: false, stderr: false },
    }),
  );

  const handle = {
    pid: 42,
    settled,
    snapshot: () => ({
      ...current,
      truncated: false,
      truncatedStreams: { stdout: false, stderr: false },
    }),
    onOutput: () => () => undefined,
    stop,
  };

  return {
    // SAFETY: the registry uses only the members above.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    handle: handle as never,
    stop,
    write: (next: Output) => (current = next),
    exit: (exitCode: number, signal?: string) =>
      finish({
        status: 'success',
        exitCode,
        signal,
        ...current,
        truncated: false,
      }),
  };
}

function setup(maxSeconds = 7200) {
  const chunks: Array<{ output: string; content: string }> = [];

  const chain = { where: () => Promise.resolve() };

  const db = {
    transaction: <T>(fn: (tx: Db) => Promise<T>) => fn(asDb(db)),
    update: () => ({ set: () => chain }),
    delete: () => chain,
    insert: () => ({
      values: (row: { output: string; content: Buffer }) => {
        chunks.push({ output: row.output, content: row.content.toString() });

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
  vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue(
    // SAFETY: only presence is checked.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    {} as never,
  );

  const settlements: Array<JobSettlement> = [];

  const inserted = vi
    .spyOn(ChatJobsRepository.prototype, 'insert')
    .mockImplementation((job) =>
      // SAFETY: the row echoes the inserted fields the registry reads.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      Promise.resolve({
        ...job,
        id: 'job-1',
        artifactId: null,
        deadlineAt: job.deadlineAt ?? null,
      } as never),
    );

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

  vi.spyOn(ArtifactsRepository.prototype, 'insertParts').mockResolvedValue();

  return { registry, chunks, inserted, settle, settlements, artifact };
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
      { output: 'stdout', content: 'so far\n' },
      { output: 'stderr', content: 'warn\n' },
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

  it('stores the output that arrived after the last flush when the job settles', async () => {
    const { registry, chunks } = setup();
    const command = fakeHandle();

    await registry.promote(command.handle, facts());
    command.write({ stdout: 'late\n', stderr: '' });
    command.exit(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(chunks).toEqual([{ output: 'stdout', content: 'late\n' }]);
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

    it('retries a deadlock inside one settlement attempt', async () => {
      const { registry, settle, settlements } = setup();
      const command = fakeHandle();

      await registry.promote(command.handle, facts());
      settle.mockRejectedValueOnce(
        Object.assign(new Error('x'), { code: '40P01' }),
      );
      command.exit(0);
      await vi.advanceTimersByTimeAsync(0);

      expect(settle).toHaveBeenCalledTimes(2);
      expect(settlements).toHaveLength(1);
    });
  });

  describe('the artifact boundary', () => {
    it.each([
      ['2000 characters fit inline', 2000, true, 0],
      ['2001 characters make an artifact', 2001, true, 1],
      ['an unreadable artifact is not stored', 5000, false, 0],
    ])('%s', async (_label, size, readable, written) => {
      const { registry, artifact } = setup();
      const command = fakeHandle();

      await registry.promote(
        command.handle,
        facts({ artifactReadable: readable }),
      );
      command.write({ stdout: 'x'.repeat(size), stderr: '' });
      command.exit(0);
      await vi.advanceTimersByTimeAsync(0);

      expect(artifact).toHaveBeenCalledTimes(written);
    });

    it('settles the job even when the artifact write fails', async () => {
      const { registry, artifact, settlements } = setup();
      const command = fakeHandle();

      artifact.mockRejectedValue(new Error('too large'));
      await registry.promote(command.handle, facts());
      command.write({ stdout: 'x'.repeat(3000), stderr: '' });
      command.exit(0);
      await vi.advanceTimersByTimeAsync(0);

      expect(settlements).toMatchObject([{ state: 'succeeded' }]);
    });
  });
});
