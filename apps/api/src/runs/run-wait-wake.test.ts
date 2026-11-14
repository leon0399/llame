import {
  type AwaitingJobs,
  type Chat,
  type ChatJob,
  type Message,
  type Run,
  type RunEvent,
} from '../db/schema';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { type Db, type TenantDbService } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { asDouble } from '../testing/support';
import { type RunDispatchService } from './run-dispatch.service';
import { RunEventsRepository } from './runs-repository';
import { RunWaitService } from './run-wait.service';

const awaiting = asDouble<AwaitingJobs>({
  toolCallId: 'call-1',
  toolInput: { jobs: ['job-1'], timeout: 3600 },
  jobIds: ['job-1'],
  deadline: '2026-11-14T01:00:00.000Z',
});

const waitingRun = asDouble<Run>({
  id: 'run-1',
  chatId: 'chat-1',
  messageId: 'message-1',
  userId: 'user-1',
  modelId: 'system:openai:gpt-5.4-mini',
  status: 'awaiting_jobs',
  activeAttemptId: null,
  cancelRequestedAt: null,
  finishedAt: null,
  wakeGeneration: 7,
  currentJobId: 'deadline-1',
  awaiting,
});

type WakeUpdate = { status?: 'queued'; currentJobId?: string };

function makeFixture(
  selectRows: Array<Array<unknown>>,
  options: {
    deadJobs?: Array<ChatJob>;
    updateSucceeds?: boolean;
  } = {},
) {
  let selectIndex = 0;
  const updates: Array<WakeUpdate> = [];

  const select = vi.fn(() => {
    const rows = selectRows[selectIndex++] ?? [];
    const query = Promise.resolve(rows);

    return Object.assign(query, {
      from: vi.fn(() => query),
      where: vi.fn(() => query),
      limit: vi.fn(() => query),
      for: vi.fn(() => query),
    });
  });

  const update = vi.fn(() => ({
    set: vi.fn((values: WakeUpdate) => {
      updates.push(values);

      return {
        where: vi.fn(() => ({
          returning: vi.fn(() =>
            Promise.resolve(
              options.updateSucceeds === false
                ? []
                : [{ ...waitingRun, ...values }],
            ),
          ),
        })),
      };
    }),
  }));

  const tx = asDouble<Db>({ select, update });
  const tenantDb = asDouble<TenantDbService>({});

  const enqueueInTransaction = vi
    .fn<RunDispatchService['enqueueInTransaction']>()
    .mockResolvedValue(undefined);

  const dispatch = asDouble<Pick<RunDispatchService, 'enqueueInTransaction'>>({
    enqueueInTransaction,
  });

  vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue(
    asDouble<Chat>({ id: 'chat-1' }),
  );

  const settleOnDeadWorkers = vi
    .spyOn(ChatJobsRepository.prototype, 'settleOnDeadWorkers')
    .mockResolvedValue(options.deadJobs ?? []);

  const append = vi
    .spyOn(RunEventsRepository.prototype, 'append')
    .mockResolvedValue(asDouble<RunEvent>({}));

  vi.spyOn(MessagesRepository.prototype, 'findById').mockResolvedValue(
    asDouble<Message>({
      id: 'message-1',
      seq: 1,
      parts: [{ type: 'text', text: 'wait for job-1' }],
    }),
  );

  return {
    service: new RunWaitService(tenantDb, dispatch, {
      config: BUILT_IN_DEFAULTS,
    } satisfies InstanceConfigReader),
    tx,
    updates,
    enqueueInTransaction,
    settleOnDeadWorkers,
    append,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('RunWaitService wake transactions', () => {
  it('rejects a deadline wake with a stale queue identity', async () => {
    const fixture = makeFixture([
      [waitingRun],
      [{ currentJobId: 'newer-deadline' }],
    ]);

    await expect(
      fixture.service.wakeInTransaction(fixture.tx, {
        runId: 'run-1',
        userId: 'user-1',
        generation: waitingRun.wakeGeneration,
        cause: 'timeout',
        deadlineJobId: 'deadline-1',
      }),
    ).resolves.toBe(false);

    expect(fixture.updates).toHaveLength(0);
    expect(fixture.enqueueInTransaction).not.toHaveBeenCalled();
    expect(fixture.settleOnDeadWorkers).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'not due according to the deadline query',
      dueRows: [],
      expected: false,
    },
    {
      label: 'due according to the deadline query',
      dueRows: [{ id: 'run-1' }],
      expected: true,
    },
  ])(
    'resumes a timeout only when the deadline query reports it is $label',
    async ({ dueRows, expected }) => {
      const fixture = makeFixture([
        [waitingRun],
        [{ currentJobId: 'deadline-1' }],
        [waitingRun],
        dueRows,
      ]);

      await expect(
        fixture.service.wakeInTransaction(fixture.tx, {
          runId: 'run-1',
          userId: 'user-1',
          generation: waitingRun.wakeGeneration,
          cause: 'timeout',
          deadlineJobId: 'deadline-1',
        }),
      ).resolves.toBe(expected);

      if (expected) {
        expect(fixture.updates).toEqual([
          { status: 'queued', currentJobId: 'deadline-1' },
        ]);
        expect(fixture.enqueueInTransaction).not.toHaveBeenCalled();
      } else {
        expect(fixture.updates).toHaveLength(0);
        expect(fixture.enqueueInTransaction).not.toHaveBeenCalled();
      }
    },
  );

  it('treats a timed-out wait containing a discovered dead job as settled', async () => {
    const fixture = makeFixture(
      [
        [waitingRun],
        [{ currentJobId: 'deadline-1' }],
        [waitingRun],
        [{ id: 'job-1', state: 'lost' }],
      ],
      { deadJobs: [asDouble<ChatJob>({ id: 'job-1' })] },
    );

    await expect(
      fixture.service.wakeInTransaction(fixture.tx, {
        runId: 'run-1',
        userId: 'user-1',
        generation: waitingRun.wakeGeneration,
        cause: 'timeout',
      }),
    ).resolves.toBe(true);

    expect(fixture.settleOnDeadWorkers).toHaveBeenCalledOnce();
    expect(fixture.updates[0]).toMatchObject({ status: 'queued' });
    expect(fixture.append).toHaveBeenCalledWith(waitingRun.id, 'run.resumed', {
      generation: waitingRun.wakeGeneration,
      cause: 'settled',
    });
    expect(fixture.enqueueInTransaction).toHaveBeenCalledOnce();
  });

  it('does not wake a settlement while its listed job remains running', async () => {
    const fixture = makeFixture([
      [waitingRun],
      [waitingRun],
      [{ id: 'job-1', state: 'running' }],
      [{ id: 'job-1', state: 'running' }],
    ]);

    await expect(
      fixture.service.wakeForChatInTransaction(fixture.tx, {
        chatId: 'chat-1',
        userId: 'user-1',
        jobId: 'job-1',
        kind: 'settlement',
      }),
    ).resolves.toBe(false);

    expect(fixture.updates).toHaveLength(0);
    expect(fixture.append).not.toHaveBeenCalled();
    expect(fixture.enqueueInTransaction).not.toHaveBeenCalled();
  });

  it('does not publish when the persisted wake update loses its race', async () => {
    const fixture = makeFixture(
      [[waitingRun], [{ currentJobId: 'deadline-1' }], [waitingRun]],
      { updateSucceeds: false },
    );

    await expect(
      fixture.service.wakeInTransaction(fixture.tx, {
        runId: 'run-1',
        userId: 'user-1',
        generation: waitingRun.wakeGeneration,
        cause: 'interrupted',
      }),
    ).resolves.toBe(false);

    expect(fixture.updates).toHaveLength(1);
    expect(fixture.updates[0]?.status).toBe('queued');
    expect(fixture.updates[0]?.currentJobId).toBeTruthy();
    expect(fixture.append).not.toHaveBeenCalled();
    expect(fixture.enqueueInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'settled',
      kind: 'settlement',
      cause: 'settled',
      states: [{ id: 'job-1', state: 'succeeded' }],
      jobId: 'job-1',
    },
    {
      label: 'interrupted by another job',
      kind: 'settlement',
      cause: 'interrupted',
      states: [{ id: 'job-1', state: 'running' }],
      jobId: 'other-job',
    },
    {
      label: 'steered',
      kind: 'steer',
      cause: 'interrupted',
      states: [],
      jobId: undefined,
    },
    {
      label: 'interrupted',
      kind: 'interrupt',
      cause: 'interrupted',
      states: [],
      jobId: undefined,
    },
    {
      label: 'cancelled',
      kind: 'cancel',
      cause: 'cancelled',
      states: [],
      jobId: undefined,
    },
  ] as const)(
    'records a $label wake and publishes the persisted queue identity',
    async ({ kind, cause, states, jobId }) => {
      const selected =
        kind === 'settlement'
          ? [[waitingRun], [waitingRun], [...states]]
          : [[waitingRun], [waitingRun]];

      const fixture = makeFixture(selected);

      await expect(
        fixture.service.wakeForChatInTransaction(fixture.tx, {
          chatId: 'chat-1',
          userId: 'user-1',
          kind,
          ...(jobId !== undefined && { jobId }),
        }),
      ).resolves.toBe(true);

      const persisted = fixture.updates[0];
      expect(persisted).toMatchObject({ status: 'queued' });
      expect(persisted?.currentJobId).not.toBe('deadline-1');
      expect(fixture.enqueueInTransaction).toHaveBeenCalledOnce();
      const call = fixture.enqueueInTransaction.mock.calls[0];

      if (!call) throw new Error('Wake did not enqueue a run');
      const [, enqueued, options] = call;
      expect(options?.id).toBe(persisted?.currentJobId);
      expect(enqueued.wake).toEqual({
        generation: waitingRun.wakeGeneration,
        jobId: persisted?.currentJobId,
      });
      expect(enqueued.runId).toBe(waitingRun.id);
      expect(call[0]).toBe(fixture.tx);
      expect(fixture.append).toHaveBeenCalledWith(
        waitingRun.id,
        'run.resumed',
        { generation: waitingRun.wakeGeneration, cause },
      );
    },
  );

  it('publishes an explicit interrupted wake with the exact persisted identity', async () => {
    const fixture = makeFixture([
      [waitingRun],
      [{ currentJobId: 'deadline-1' }],
      [waitingRun],
    ]);

    await expect(
      fixture.service.wakeInTransaction(fixture.tx, {
        runId: 'run-1',
        userId: 'user-1',
        generation: waitingRun.wakeGeneration,
        cause: 'interrupted',
      }),
    ).resolves.toBe(true);

    const persisted = fixture.updates[0];
    const call = fixture.enqueueInTransaction.mock.calls[0];

    if (!call) throw new Error('Wake did not enqueue a run');
    const [, enqueued, options] = call;
    expect(persisted).toMatchObject({ status: 'queued' });
    expect(persisted?.currentJobId).not.toBe('deadline-1');
    expect(options?.id).toBe(persisted?.currentJobId);
    expect(enqueued.wake).toEqual({
      generation: waitingRun.wakeGeneration,
      jobId: persisted?.currentJobId,
    });
  });
});
