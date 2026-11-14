import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { type ChatJob, type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { RunsRepository } from './runs-repository';
import {
  completeWaitInTransaction,
  pendingWakeInTransaction,
} from './run-wait-completion';

type WakeEvent = { eventType: string; payload: unknown; sequence: number };

function job(id: string, state: ChatJob['state']): ChatJob {
  const startedAt = new Date('2026-01-01T00:00:00.000Z');

  const settledAt =
    state === 'running' ? null : new Date('2026-01-01T00:00:02.000Z');

  return {
    id,
    chatId: 'chat-id',
    ownerUserId: 'owner-id',
    executor: 'bash',
    seq: id === 'settled-id' ? 1 : 2,
    state,
    stoppedBy: null,
    runId: 'run-id',
    toolCallId: 'call-id',
    workerInstanceId: 'worker-id',
    pid: null,
    startedAt,
    settledAt,
    deadlineAt: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    result: state === 'succeeded' ? { exitCode: 0 } : null,
    outputs: state === 'running' ? [] : ['stdout'],
    artifactId: null,
    artifactReadable: false,
    settings: { modelId: 'gpt-5.5', permissionMode: 'default' },
  };
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-id',
    chatId: 'chat-id',
    messageId: null,
    userId: 'owner-id',
    modelId: 'gpt-5.5',
    status: 'running_tool',
    wakeGeneration: 2,
    awaiting: {
      toolCallId: 'call-id',
      jobIds: ['settled-id', 'running-id'],
      toolInput: { jobs: [] },
      deadline: new Date(0).toISOString(),
    },
    currentJobId: null,
    workerId: null,
    cancelRequestedAt: null,
    error: null,
    createdAt: new Date(0),
    startedAt: new Date(0),
    finishedAt: null,
    effort: null,
    permissionMode: 'default',
    activeAttemptId: 'attempt-id',
    completedAttemptId: null,
    turnToolAvailability: null,
    followUpAction: null,
    sourceRunId: null,
    ...overrides,
  };
}

function db(rows: ReadonlyArray<ChatJob | WakeEvent>): Db {
  const wakeRows = rows
    .filter((row): row is WakeEvent => 'eventType' in row)
    .sort((left, right) => right.sequence - left.sequence);

  const selectedRows = Object.assign([...rows], {
    orderBy: () => ({ limit: () => Promise.resolve(wakeRows.slice(0, 1)) }),
  });

  const tx = drizzle.mock({ schema });

  Object.defineProperty(tx, 'select', {
    value: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => selectedRows }),
        where: () => selectedRows,
      }),
    }),
  });
  Object.defineProperty(tx, 'insert', {
    value: () => ({
      values: () => ({ returning: () => Promise.resolve([{}]) }),
    }),
  });

  return tx;
}

describe('completeWaitInTransaction', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns requested-order settled and running results with settled output details', async () => {
    const settled = job('settled-id', 'succeeded');
    const running = job('running-id', 'running');
    const currentRun = run();
    const consumed: Array<string> = [];

    vi.spyOn(ChatJobsRepository.prototype, 'readOutputTail').mockResolvedValue(
      Buffer.from('completed'),
    );
    vi.spyOn(RunsRepository.prototype, 'updateForAttempt').mockResolvedValue(
      currentRun,
    );
    vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'consumeJobNotices',
    ).mockImplementation(({ jobIds }) => {
      consumed.push(...jobIds);

      return Promise.resolve([]);
    });

    const result = await completeWaitInTransaction(
      db([running, settled]),
      currentRun,
      { toolCallId: 'call-id', jobIds: ['settled-id', 'running-id'] },
      'settled',
    );

    expect(result).toMatchObject({
      status: 'success',
      ended: 'settled',
      jobs: [
        {
          locator: 'job://bash-1',
          state: 'succeeded',
          elapsedMs: 2000,
          exitDetail: { exitCode: 0 },
          outputs: [{ name: 'stdout', text: 'completed' }],
        },
        { locator: 'job://bash-2', state: 'running' },
      ],
    });
    expect(consumed).toEqual(['settled-id']);
  });

  it.each([
    [
      'attempt fence loss',
      undefined,
      'The resumed wait lost its active attempt.',
    ],
    [
      'cancellation request',
      { ...run(), cancelRequestedAt: new Date(0) },
      'The resumed wait lost its active attempt.',
    ],
  ])('rejects completion after %s', async (_case, fenced, message) => {
    vi.spyOn(ChatJobsRepository.prototype, 'readOutputTail').mockResolvedValue(
      Buffer.alloc(0),
    );
    vi.spyOn(RunsRepository.prototype, 'updateForAttempt').mockResolvedValue(
      fenced,
    );

    const consumeNotices = vi
      .spyOn(ChatDeliveriesRepository.prototype, 'consumeJobNotices')
      .mockResolvedValue([]);

    await expect(
      completeWaitInTransaction(
        db([job('settled-id', 'succeeded')]),
        run(),
        { toolCallId: 'call-id', jobIds: ['settled-id'] },
        'settled',
      ),
    ).rejects.toThrow(message);
    expect(consumeNotices).not.toHaveBeenCalled();
  });

  it.each([
    ['terminal', { status: 'completed' as const }],
    ['finished', { finishedAt: new Date(0) }],
    ['without an active attempt', { activeAttemptId: null }],
  ])('rejects a %s Run before reading jobs', async (_case, overrides) => {
    await expect(
      completeWaitInTransaction(
        db([]),
        run(overrides),
        { toolCallId: 'call-id', jobIds: ['settled-id'] },
        'settled',
      ),
    ).rejects.toThrow('A wait result requires its active Run attempt.');
  });
});

describe('pendingWakeInTransaction', () => {
  it.each(['settled', 'interrupted', 'timeout'] as const)(
    'returns the current generation %s cause from a resumed wake',
    async (cause) => {
      await expect(
        pendingWakeInTransaction(
          db([
            {
              eventType: 'run.resumed',
              payload: { generation: 2, cause },
              sequence: 2,
            },
          ]),
          run(),
        ),
      ).resolves.toBe(cause);
    },
  );

  it.each(['run.started', 'run.delivered'])(
    'does not treat a latest %s event as a wait wake',
    async (eventType) => {
      await expect(
        pendingWakeInTransaction(
          db([
            {
              eventType: 'run.resumed',
              payload: { generation: 2, cause: 'settled' },
              sequence: 1,
            },
            {
              eventType,
              payload: { generation: 2, cause: 'settled' },
              sequence: 2,
            },
          ]),
          run(),
        ),
      ).resolves.toBeUndefined();
    },
  );

  it.each([
    ['stale generation', { generation: 1, cause: 'settled' }],
    ['malformed receipt', null],
    ['invalid cause', { generation: 2, cause: 'unknown' }],
  ])('rejects a resumed wake with a %s', async (caseName, payload) => {
    const expected =
      caseName === 'invalid cause'
        ? 'The current Run wake cause is invalid.'
        : 'The current Run wake receipt is invalid.';

    await expect(
      pendingWakeInTransaction(
        db([{ eventType: 'run.resumed', payload, sequence: 2 }]),
        run(),
      ),
    ).rejects.toThrow(expected);
  });

  it('does not inspect wake events when the Run is not awaiting jobs', async () => {
    await expect(
      pendingWakeInTransaction(db([]), run({ awaiting: null })),
    ).resolves.toBeUndefined();
  });
});
