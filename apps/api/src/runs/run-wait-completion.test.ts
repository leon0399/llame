import { isRecord, isString } from '@workspace/runtime-safety';
import { type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';

import { type ChatJob, type Run, type RunEvent } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import {
  clearQuotaAwaitingInTransaction,
  completeWaitInTransaction,
  pendingWakeInTransaction,
} from './run-wait-completion';

type WakeEvent = {
  eventType: string;
  payload: RunEvent['payload'];
  sequence: number;
};

function job(id: string, state: ChatJob['state']): ChatJob {
  const startedAt = new Date('2026-01-01T00:00:00.000Z');

  const settledAt =
    state === 'running' ? null : new Date('2026-01-01T00:00:02.000Z');

  return {
    id,
    chatId: 'chat-id',
    ownerUserId: 'owner-id',
    kind: 'bash',
    seq: id === 'settled-id' ? 1 : 2,
    state,
    stoppedBy: null,
    runId: 'run-id',
    toolCallId: 'call-id',
    intent: null,
    command: null,
    machineName: 'test-machine',
    daemonInstanceId: 'daemon-instance',
    daemonJobId: `daemon-${id}`,
    delivery: 'background',
    startedAt,
    settledAt,
    deadlineAt: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    result: state === 'succeeded' ? { exitCode: 0 } : null,
    outputs: state === 'running' ? [] : ['stdout'],
    artifactId: null,
    artifactReadable: false,
    settings: { selector: 'gpt-5.5', permissionMode: 'default' },
  };
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-id',
    kind: 'turn',
    origin: 'owner',
    chatId: 'chat-id',
    messageId: null,
    userId: 'owner-id',
    modelId: 'gpt-5.5',
    selector: 'gpt-5.5',
    status: 'running_tool',
    wakeGeneration: 2,
    awaiting: {
      kind: 'jobs',
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
    selectedEffort: null,
    selectionRevision: null,
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

  const tx = drizzle.mock();

  Object.defineProperty(tx, 'select', {
    value: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (condition: SQL) => {
            const parameters: Array<unknown> = [];

            const collectParameters = (chunk: unknown): void => {
              if (Array.isArray(chunk)) {
                for (const item of chunk) collectParameters(item);
              } else if (isRecord(chunk)) {
                if ('value' in chunk) parameters.push(chunk.value);

                if (Array.isArray(chunk['queryChunks']))
                  collectParameters(chunk['queryChunks']);
              }
            };

            collectParameters(condition.queryChunks);

            const eventTypes = parameters
              .filter(isString)
              .filter((value) => value.startsWith('run.'));

            const matchingWakeRows = wakeRows.filter((row) =>
              eventTypes.includes(row.eventType),
            );

            return Object.assign([...matchingWakeRows], {
              orderBy: () => ({
                limit: () => Promise.resolve(matchingWakeRows.slice(0, 1)),
              }),
            });
          },
        }),
        where: () => rows,
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

  it('returns requested-order settled and running job details', async () => {
    const settled = job('settled-id', 'succeeded');
    const running = job('running-id', 'running');
    const currentRun = run();
    const consumed: Array<string> = [];

    const update = vi
      .spyOn(RunsRepository.prototype, 'updateForAttempt')
      .mockResolvedValue(currentRun);

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
      {
        toolCallId: 'call-id',
        jobIds: ['settled-id', 'running-id'],
      },
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
        },
        { locator: 'job://bash-2', state: 'running' },
      ],
    });
    expect(consumed).toEqual(['settled-id']);
    expect(update).toHaveBeenCalledWith(
      currentRun.id,
      currentRun.userId,
      currentRun.activeAttemptId,
      { awaiting: null },
    );
  });
  it('clears quota awaiting under the active-attempt fence without completing a tool', async () => {
    const currentRun = run({
      awaiting: {
        kind: 'quota',
        failureClass: 'quota_exhausted',
        resetsAt: '2026-10-12T00:00:00.000Z',
        wakeAt: '2026-10-12T00:01:00.000Z',
        resumeAt: 'request',
        waitCount: 1,
      },
    });

    const update = vi
      .spyOn(RunsRepository.prototype, 'updateForAttempt')
      .mockResolvedValue(currentRun);

    const append = vi.spyOn(RunEventsRepository.prototype, 'append');

    await expect(
      clearQuotaAwaitingInTransaction(db([]), currentRun, 'timeout'),
    ).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledWith(
      currentRun.id,
      currentRun.userId,
      currentRun.activeAttemptId,
      { awaiting: null },
    );
    expect(append).not.toHaveBeenCalled();
  });
  it('clears quota awaiting only after the cancellation fence is set', async () => {
    const currentRun = run({
      awaiting: {
        kind: 'quota',
        failureClass: 'rate_limited',
        resetsAt: '2026-10-12T00:00:00.000Z',
        wakeAt: '2026-10-12T00:01:00.000Z',
        resumeAt: 'request',
        waitCount: 1,
      },
    });

    const fenced = { ...currentRun, cancelRequestedAt: new Date() };

    const update = vi
      .spyOn(RunsRepository.prototype, 'updateForAttempt')
      .mockResolvedValue(fenced);

    await expect(
      clearQuotaAwaitingInTransaction(db([]), currentRun, 'settled'),
    ).rejects.toThrow('A quota wait cannot resume for this cause.');
    expect(update).not.toHaveBeenCalled();

    await expect(
      clearQuotaAwaitingInTransaction(db([]), currentRun, 'cancelled'),
    ).resolves.toBeUndefined();
  });
  it('rejects quota awaiting when the attempt fence is lost', async () => {
    const currentRun = run({
      awaiting: {
        kind: 'quota',
        failureClass: 'quota_exhausted',
        resetsAt: '2026-10-12T00:00:00.000Z',
        wakeAt: '2026-10-12T00:01:00.000Z',
        resumeAt: 'request',
        waitCount: 1,
      },
    });

    vi.spyOn(RunsRepository.prototype, 'updateForAttempt').mockResolvedValue(
      undefined,
    );

    await expect(
      clearQuotaAwaitingInTransaction(db([]), currentRun, 'timeout'),
    ).rejects.toThrow('The resumed quota wait lost its active attempt.');
  });

  it('refuses a listed job that is no longer visible before consuming notices', async () => {
    const currentRun = run();
    const update = vi.spyOn(RunsRepository.prototype, 'updateForAttempt');

    const consumeNotices = vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'consumeJobNotices',
    );

    await expect(
      completeWaitInTransaction(
        db([]),
        currentRun,
        { toolCallId: 'call-id', jobIds: ['missing-id'] },
        'settled',
      ),
    ).rejects.toThrow('A resumed wait no longer owns its listed job.');

    expect(update).not.toHaveBeenCalled();
    expect(consumeNotices).not.toHaveBeenCalled();
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
  it('accepts quota timeout and cancellation wake causes only for quota awaiting', async () => {
    const quotaRun = run({
      awaiting: {
        kind: 'quota',
        failureClass: 'rate_limited',
        resetsAt: '2026-10-12T00:00:00.000Z',
        wakeAt: '2026-10-12T00:01:00.000Z',
        resumeAt: 'request',
        waitCount: 1,
      },
    });

    for (const cause of ['timeout', 'cancelled'] as const) {
      await expect(
        pendingWakeInTransaction(
          db([
            {
              eventType: 'run.resumed',
              payload: {
                kind: 'quota',
                generation: 2,
                cause,
              },
              sequence: 2,
            },
          ]),
          quotaRun,
        ),
      ).resolves.toBe(cause);
    }
  });

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
    {
      label: 'quota awaiting data with a jobs receipt',
      awaiting: {
        kind: 'quota',
        failureClass: 'rate_limited',
        resetsAt: '2026-10-12T00:00:00.000Z',
        wakeAt: '2026-10-12T00:01:00.000Z',
        resumeAt: 'request',
        waitCount: 1,
      },
      status: 'awaiting_quota',
      receiptKind: 'jobs',
    },
    {
      label: 'jobs awaiting data with a quota receipt',
      awaiting: {
        kind: 'jobs',
        toolCallId: 'call-id',
        jobIds: Array.of('settled-id'),
        toolInput: { jobs: Array.of('settled-id') },
        deadline: new Date(0).toISOString(),
      },
      status: 'awaiting_jobs',
      receiptKind: 'quota',
    },
  ] as const)(
    'rejects a wake receipt when $label',
    async ({ awaiting, status, receiptKind }) => {
      const awaitingRun = run({ status, awaiting });

      await expect(
        pendingWakeInTransaction(
          db([
            {
              eventType: 'run.resumed',
              payload: {
                kind: receiptKind,
                generation: awaitingRun.wakeGeneration,
                cause: 'timeout',
              },
              sequence: 2,
            },
          ]),
          awaitingRun,
        ),
      ).rejects.toThrow('The current Run wake kind is invalid.');
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

  it('does not treat a missing wake receipt as a resumed Run', async () => {
    await expect(
      pendingWakeInTransaction(db([]), run()),
    ).resolves.toBeUndefined();
  });

  it('does not inspect wake events when the Run is not awaiting jobs', async () => {
    await expect(
      pendingWakeInTransaction(
        db([
          {
            eventType: 'run.resumed',
            payload: { generation: 1, cause: 'settled' },
            sequence: 2,
          },
        ]),
        run({ awaiting: null }),
      ),
    ).resolves.toBeUndefined();
  });
});
