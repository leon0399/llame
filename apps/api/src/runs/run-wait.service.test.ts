import { ChatsRepository } from '../chats/chats-repository';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { MessagesRepository } from '../chats/messages-repository';
import { type Chat, type Message, type Run, type RunEvent } from '../db/schema';
import { type Db, type TenantDbService } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { asDouble } from '../testing/support';
import { type RunDispatchService } from './run-dispatch.service';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { RunWaitService, type SuspendRunWaitInput } from './run-wait.service';

const now = new Date('2026-11-14T00:00:00.000Z');

function makeRun(overrides: Partial<Run> = {}): Run {
  return asDouble<Run>({
    id: 'run-1',
    chatId: 'chat-1',
    messageId: 'message-1',
    userId: 'user-1',
    modelId: 'system:openai:gpt-5.4-mini',
    status: 'running_tool',
    activeAttemptId: 'attempt-1',
    cancelRequestedAt: null,
    finishedAt: null,
    wakeGeneration: 4,
    ...overrides,
  });
}

const input: SuspendRunWaitInput = {
  runId: 'run-1',
  chatId: 'chat-1',
  userId: 'user-1',
  attemptId: 'attempt-1',
  toolCallId: 'call-1',
  toolInput: { jobs: ['job-1'], timeout: 3600 },
  jobIds: ['job-1'],
  deadline: '2026-11-14T01:00:00.000Z',
  parts: [{ type: 'tool-call', id: 'call-1' }],
  steps: { 'call-1': 0 },
};

function makeFixture(
  options: {
    run?: Run;
    jobs?: Array<{ id: string }>;
    states?: Array<{ id: string; state: string }>;
    pendingSteering?: boolean;
    updateSucceeds?: boolean;
    chatLocked?: boolean;
  } = {},
) {
  const run = options.run ?? makeRun();

  const resultRows = [
    [run],
    options.jobs ?? [{ id: 'job-1' }],
    options.states ?? [{ id: 'job-1', state: 'running' }],
  ];

  let selectIndex = 0;

  const select = vi.fn(() => {
    const rows = resultRows[selectIndex] ?? [];
    const queryIndex = selectIndex++;

    return {
      from: vi.fn(() => ({
        where: vi.fn(() =>
          queryIndex === 0
            ? { for: vi.fn().mockResolvedValue(rows) }
            : Promise.resolve(rows),
        ),
      })),
    };
  });

  const tx = asDouble<Db>({ select });

  const runAs: TenantDbService['runAs'] = <T>(
    userId: string,
    callback: (scopedTx: Db) => Promise<T>,
  ) => {
    expect(userId).toBe(input.userId);

    return callback(tx);
  };

  const tenantDb = asDouble<TenantDbService>({ runAs });

  const enqueueInTransaction = vi
    .fn<RunDispatchService['enqueueInTransaction']>()
    .mockResolvedValue(undefined);

  const dispatch = asDouble<Pick<RunDispatchService, 'enqueueInTransaction'>>({
    enqueueInTransaction,
  });

  const service = new RunWaitService(tenantDb, dispatch, {
    config: BUILT_IN_DEFAULTS,
  } satisfies InstanceConfigReader);

  const chatLock = vi
    .spyOn(ChatsRepository.prototype, 'lock')
    .mockResolvedValue(
      options.chatLocked === false
        ? undefined
        : asDouble<Chat>({ id: input.chatId }),
    );

  const settleOnDeadWorkers = vi
    .spyOn(ChatJobsRepository.prototype, 'settleOnDeadWorkers')
    .mockResolvedValue([]);

  const hasPendingSteering = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'hasPendingSteering')
    .mockResolvedValue(options.pendingSteering ?? false);

  const updateForAttempt = vi
    .spyOn(RunsRepository.prototype, 'updateForAttempt')
    .mockResolvedValue(options.updateSucceeds === false ? undefined : run);

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
    service,
    tx,
    select,
    chatLock,
    settleOnDeadWorkers,
    hasPendingSteering,
    updateForAttempt,
    append,
    enqueueInTransaction,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('RunWaitService.suspend', () => {
  it('suspends a running job and persists its checkpoint and queue handoff', async () => {
    const fixture = makeFixture();

    await expect(fixture.service.suspend(input)).resolves.toEqual({
      kind: 'suspended',
    });

    expect(fixture.settleOnDeadWorkers).toHaveBeenCalledWith(
      input.chatId,
      input.userId,
      BUILT_IN_DEFAULTS.runs.heartbeatSeconds * 4,
    );

    expect(fixture.updateForAttempt).toHaveBeenCalledTimes(1);
    const update = fixture.updateForAttempt.mock.calls[0]?.[3];
    expect(update?.wakeGeneration).toBe(5);
    expect(update?.activeAttemptId).toBeNull();
    expect(update?.currentJobId).toBeTruthy();
    expect(update?.awaiting?.jobIds).toEqual(input.jobIds);

    expect(fixture.append).toHaveBeenCalledTimes(1);
    expect(fixture.append.mock.calls[0]?.[1]).toBe('run.suspended');
    expect(fixture.append.mock.calls[0]?.[2]).toMatchObject({
      generation: 5,
      toolCallId: input.toolCallId,
    });

    expect(fixture.enqueueInTransaction).toHaveBeenCalledTimes(1);
    const enqueueCall = fixture.enqueueInTransaction.mock.calls[0];
    expect(enqueueCall?.[0]).toBe(fixture.tx);
    expect(enqueueCall?.[1].runId).toBe(input.runId);
    expect(enqueueCall?.[1].wake?.generation).toBe(5);
    expect(enqueueCall?.[1].wake?.jobId).toBe(update?.currentJobId);
    expect(enqueueCall?.[1].userMessage.id).toBe('message-1');
    expect(enqueueCall?.[2]?.id).toBe(update?.currentJobId);
    expect(enqueueCall?.[2]?.startAfter).toEqual(new Date(input.deadline));
  });

  it('refuses suspension when the chat lock is unavailable', async () => {
    const fixture = makeFixture({ chatLocked: false });

    await expect(fixture.service.suspend(input)).resolves.toEqual({
      kind: 'ready',
      cause: 'cancelled',
    });

    expect(fixture.chatLock).toHaveBeenCalledWith(input.chatId, input.userId);
    expect(fixture.select).not.toHaveBeenCalled();
    expect(fixture.updateForAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ['a different active attempt', makeRun({ activeAttemptId: 'attempt-2' })],
    ['a terminal run', makeRun({ status: 'completed' })],
    ['a finished run', makeRun({ finishedAt: now })],
  ])('does not suspend %s', async (_case, run) => {
    const fixture = makeFixture({ run });

    await expect(fixture.service.suspend(input)).resolves.toEqual({
      kind: 'ready',
      cause: 'cancelled',
    });

    expect(fixture.updateForAttempt).not.toHaveBeenCalled();
    expect(fixture.enqueueInTransaction).not.toHaveBeenCalled();
  });

  it('returns interrupted when any requested job is missing', async () => {
    const fixture = makeFixture({ jobs: [{ id: 'job-1' }] });

    const twoJobInput: SuspendRunWaitInput = {
      ...input,
      jobIds: ['job-1', 'job-2'],
      toolInput: { ...input.toolInput, jobs: ['job-1', 'job-2'] },
    };

    await expect(fixture.service.suspend(twoJobInput)).resolves.toEqual({
      kind: 'ready',
      cause: 'interrupted',
    });

    expect(fixture.settleOnDeadWorkers).not.toHaveBeenCalled();
    expect(fixture.updateForAttempt).not.toHaveBeenCalled();
  });

  it('returns settled when any listed job has stopped running', async () => {
    const fixture = makeFixture({
      jobs: [{ id: 'job-1' }, { id: 'job-2' }],
      states: [
        { id: 'job-1', state: 'running' },
        { id: 'job-2', state: 'completed' },
      ],
    });

    const twoJobInput: SuspendRunWaitInput = {
      ...input,
      jobIds: ['job-1', 'job-2'],
      toolInput: { ...input.toolInput, jobs: ['job-1', 'job-2'] },
    };

    await expect(fixture.service.suspend(twoJobInput)).resolves.toEqual({
      kind: 'ready',
      cause: 'settled',
    });

    expect(fixture.updateForAttempt).not.toHaveBeenCalled();
  });

  it('returns interrupted when steering is pending and all jobs remain active', async () => {
    const fixture = makeFixture({ pendingSteering: true });

    await expect(fixture.service.suspend(input)).resolves.toEqual({
      kind: 'ready',
      cause: 'interrupted',
    });

    expect(fixture.hasPendingSteering).toHaveBeenCalledWith(
      input.chatId,
      input.userId,
    );
    expect(fixture.updateForAttempt).not.toHaveBeenCalled();
  });

  it('returns cancelled for a cancellation request without writing a checkpoint', async () => {
    const fixture = makeFixture({ run: makeRun({ cancelRequestedAt: now }) });

    await expect(fixture.service.suspend(input)).resolves.toEqual({
      kind: 'ready',
      cause: 'cancelled',
    });

    expect(fixture.updateForAttempt).not.toHaveBeenCalled();
    expect(fixture.enqueueInTransaction).not.toHaveBeenCalled();
  });

  it('returns ready when the attempt update loses its race', async () => {
    const fixture = makeFixture({ updateSucceeds: false });

    await expect(fixture.service.suspend(input)).resolves.toEqual({
      kind: 'ready',
      cause: 'cancelled',
    });

    expect(fixture.append).not.toHaveBeenCalled();
    expect(fixture.enqueueInTransaction).not.toHaveBeenCalled();
  });
});
