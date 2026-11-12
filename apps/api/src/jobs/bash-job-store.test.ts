import { ChatsRepository } from '../chats/chats-repository';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { RunsRepository } from '../runs/runs-repository';
import { type ChatJob } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { retryRunTransaction } from '../runs/run-transaction';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { appendJobOutput, settleBashJob } from './bash-job-store';
import { ChatJobsRepository, type JobSettlement } from './chat-jobs.repository';

const OWNER = 'owner';
const NO_CUT = { stdout: false, stderr: false };

const POLICY = {
  maxBytes: 1_000_000,
  hostFiles: false,
  noticeRuns: { startOnSettlement: vi.fn() },
};

const BIG = { stdout: 'o'.repeat(3000), stderr: 'e'.repeat(10) };

function row(over: Partial<ChatJob> = {}): ChatJob {
  // SAFETY: the store reads only the identity and policy fields set here.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return {
    id: 'job-1',
    chatId: 'chat-1',
    ownerUserId: OWNER,
    runId: 'run-1',
    toolCallId: 'call-1',
    seq: 7,
    artifactReadable: true,
    ...over,
  } as never;
}

const output = (text: { stdout: string; stderr: string }, cut = NO_CUT) => ({
  ...text,
  truncated: cut.stdout || cut.stderr,
  truncatedStreams: cut,
});

const code = (value: string) =>
  Object.assign(new Error(value), { code: value });

/** A plain transaction fake that records what the store writes through it. */
function setup() {
  const chunks: Array<{ output: string; content: string; position: number }> =
    [];

  const updates: Array<Record<string, string | null>> = [];
  let deletes = 0;
  const chain = { where: () => Promise.resolve() };

  const db = {
    transaction: <T>(fn: (tx: Db) => Promise<T>) => fn(asDb()),
    update: () => ({
      set: (values: Record<string, string | null>) => {
        updates.push(values);

        return chain;
      },
    }),
    delete: () => {
      deletes += 1;

      return chain;
    },
    insert: () => ({
      values: (value: {
        output: string;
        content: Buffer;
        position: number;
      }) => {
        chunks.push({
          output: value.output,
          content: value.content.toString(),
          position: value.position,
        });

        return Promise.resolve();
      },
    }),
  };

  // SAFETY: the fake implements only the chains the store calls.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const asDb = (): Db => db as never;

  const tenantDb = {
    runAs: <T>(_o: string, fn: (tx: Db) => Promise<T>) => fn(asDb()),
  };

  const settlements: Array<JobSettlement> = [];

  // SAFETY: only the presence of the locked Chat is checked.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const locked = {} as never;

  const lock = vi
    .spyOn(ChatsRepository.prototype, 'lock')
    .mockResolvedValue(locked);

  vi.spyOn(
    ChatDeliveriesRepository.prototype,
    'insertJobNotice',
  ).mockResolvedValue(undefined);
  vi.spyOn(RunsRepository.prototype, 'findActiveByChatId').mockResolvedValue(
    undefined,
  );

  const settle = vi
    .spyOn(ChatJobsRepository.prototype, 'settle')
    .mockImplementation((_c, _o, _j, settlement) => {
      settlements.push(settlement);

      return Promise.resolve(row({ state: settlement.state }));
    });

  const artifact = vi
    .spyOn(ArtifactsRepository.prototype, 'insertArtifact')
    .mockResolvedValue({ id: 'art-1', createdAt: new Date() });

  const parts = vi
    .spyOn(ArtifactsRepository.prototype, 'insertParts')
    .mockResolvedValue();

  const run = (
    text: { stdout: string; stderr: string },
    settlement: JobSettlement = { state: 'succeeded' },
    over: {
      job?: ChatJob;
      cut?: typeof NO_CUT;
      offsets?: typeof NO_OFFSETS;
      maxBytes?: number;
    } = {},
  ) =>
    settleBashJob(
      tenantDb,
      over.job ?? row(),
      {
        output: output(text, over.cut),
        settlement,
        offsets: over.offsets ?? NO_OFFSETS,
      },
      {
        ...POLICY,
        maxBytes: over.maxBytes ?? POLICY.maxBytes,
      },
    );

  return {
    run,
    chunks,
    updates,
    deletes: () => deletes,
    settlements,
    lock,
    settle,
    artifact,
    parts,
    tenantDb,
  };
}

const NO_OFFSETS = { stdout: 0, stderr: 0 };

describe('bash-job-store', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('appendJobOutput', () => {
    it('appends only the suffix after each offset, at that position', async () => {
      const { tenantDb, chunks } = setup();

      await tenantDb.runAs(OWNER, (db) =>
        appendJobOutput(db, row(), output({ stdout: 'abcdef', stderr: 'xy' }), {
          stdout: 3,
          stderr: 1,
        }),
      );

      expect(chunks).toEqual([
        { output: 'stdout', content: 'def', position: 3 },
        { output: 'stderr', content: 'y', position: 1 },
      ]);
    });

    it('writes nothing for a stream with no new output', async () => {
      const { tenantDb, chunks } = setup();

      await tenantDb.runAs(OWNER, (db) =>
        appendJobOutput(db, row(), output({ stdout: 'abc', stderr: '' }), {
          stdout: 3,
          stderr: 0,
        }),
      );

      expect(chunks).toEqual([]);
    });
  });

  describe('settleBashJob', () => {
    it('settles under the Chat lock and stores the output after the committed offsets', async () => {
      const { run, chunks, settlements, lock } = setup();

      await run(
        { stdout: 'abcdef', stderr: '' },
        { state: 'failed', result: { exitCode: 2 } },
        { offsets: { stdout: 3, stderr: 0 } },
      );

      expect(lock).toHaveBeenCalledWith('chat-1', OWNER);
      expect(settlements).toEqual([
        { state: 'failed', result: { exitCode: 2 } },
      ]);
      expect(chunks).toEqual([
        { output: 'stdout', content: 'def', position: 3 },
      ]);
    });

    it.each([
      ['a Chat that was deleted', 'lock'],
      ['a job that another writer settled first', 'settle'],
    ] as const)(
      'stores no output, artifact, or link for %s',
      async (_label, gate) => {
        const { run, chunks, updates, artifact, settle, lock } = setup();

        if (gate === 'lock') lock.mockResolvedValue(undefined);
        else settle.mockResolvedValue(undefined);
        await run(BIG);

        expect(chunks).toEqual([]);
        expect(artifact).not.toHaveBeenCalled();
        expect(updates).toEqual([]);
      },
    );

    it.each([
      [
        'exactly 2000 characters fit inline',
        { stdout: 'x'.repeat(2000), stderr: '' },
        true,
        0,
      ],
      [
        '2001 characters of stdout make an artifact',
        { stdout: 'x'.repeat(2001), stderr: '' },
        true,
        1,
      ],
      [
        '2001 characters of stderr make an artifact',
        { stdout: '', stderr: 'x'.repeat(2001) },
        true,
        1,
      ],
      ['an unreadable artifact is not stored', BIG, false, 0],
    ])('%s', async (_label, text, readable, written) => {
      const { run, artifact } = setup();

      await run(text, undefined, { job: row({ artifactReadable: readable }) });

      expect(artifact).toHaveBeenCalledTimes(written);
    });

    it('stores both streams whole, links the artifact, and drops the chunks', async () => {
      const { run, parts, artifact, updates, deletes } = setup();

      await run(BIG);

      expect(
        parts.mock.calls[0][1].map((part) => [
          part.name,
          part.content.toString(),
        ]),
      ).toEqual([
        ['stdout', BIG.stdout],
        ['stderr', BIG.stderr],
      ]);
      expect(artifact.mock.calls[0][0]).toMatchObject({
        chatId: 'chat-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'bash',
        seq: 7,
      });
      expect(updates).toContainEqual({ artifactId: 'art-1' });
      expect(deletes()).toBe(1);
    });

    it.each([
      ['a complete job', { state: 'succeeded' }, NO_CUT, true],
      [
        'a truncated job',
        { state: 'succeeded' },
        { stdout: true, stderr: false },
        false,
      ],
      ['a lost job', { state: 'lost' }, NO_CUT, false],
    ] as const)(
      'marks the artifact of %s complete=%s',
      async (_label, settlement, cut, complete) => {
        const { run, artifact } = setup();

        await run(BIG, settlement, { cut });

        expect(artifact.mock.calls[0][0]).toMatchObject({ complete });
      },
    );

    it('settles without a link when the artifact does not fit its bound', async () => {
      const { run, settlements, updates, deletes } = setup();

      await run(BIG, undefined, { maxBytes: 100 });

      expect(settlements).toHaveLength(1);
      expect(updates).toEqual([]);
      expect(deletes()).toBe(0);
    });

    it('settles without a link when the artifact write fails for another reason', async () => {
      const { run, artifact, settle, updates } = setup();

      artifact.mockRejectedValue(new Error('too large'));
      await run(BIG);

      expect(settle).toHaveBeenCalledTimes(1);
      expect(updates).toEqual([]);
    });

    it.each(['40P01', '40001'])(
      'retries the whole transaction when the artifact write fails with %s',
      async (state) => {
        const { run, artifact, settle } = setup();

        artifact.mockRejectedValueOnce(code(state));
        await run(BIG);

        expect(settle).toHaveBeenCalledTimes(2);
        expect(artifact).toHaveBeenCalledTimes(2);
      },
    );
  });

  describe('retryRunTransaction', () => {
    it.each(['40P01', '40001'])(
      'retries a %s and returns the later result',
      async (state) => {
        const work = vi
          .fn()
          .mockRejectedValueOnce(code(state))
          .mockResolvedValue('done');

        await expect(retryRunTransaction(work)).resolves.toBe('done');
        expect(work).toHaveBeenCalledTimes(2);
      },
    );

    it('does not retry an unrelated error', async () => {
      const work = vi.fn().mockRejectedValue(code('23505'));

      await expect(retryRunTransaction(work)).rejects.toThrow('23505');
      expect(work).toHaveBeenCalledTimes(1);
    });

    it('gives up with the last error after five attempts', async () => {
      const work = vi.fn().mockRejectedValue(code('40P01'));

      await expect(retryRunTransaction(work)).rejects.toThrow('40P01');
      expect(work).toHaveBeenCalledTimes(5);
    });
  });
});
