import { isRecord } from '@workspace/runtime-safety';

import { ChatsRepository } from '../chats/chats-repository';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { MessagesRepository } from '../chats/messages-repository';
import {
  type AwaitingQuota,
  type Chat,
  type Message,
  type Run,
  type RunEvent,
} from '../db/schema';
import { type Db, type TenantDbService } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { asDouble } from '../testing/support';
import {
  quotaRequestFromEvents,
  quotaWakeStateFromEvents,
} from './quota-wake-projection';
import { type RunDispatchService } from './run-dispatch.service';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import {
  RunWaitService,
  type SuspendRunQuotaInput,
  type SuspendRunWaitInput,
} from './run-wait.service';
import { type FirstEpochBaselines } from './segment-delivery';

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

const quotaAwaiting: AwaitingQuota = {
  kind: 'quota',
  failureClass: 'rate_limited',
  resetsAt: '2026-11-14T02:00:00.000Z',
  wakeAt: '2026-11-14T02:01:00.000Z',
  resumeAt: 'request',
  waitCount: 1,
};

const quotaInput: SuspendRunQuotaInput = {
  runId: 'run-1',
  chatId: 'chat-1',
  userId: 'user-1',
  attemptId: 'attempt-1',
  awaiting: quotaAwaiting,
  parts: [{ type: 'text', text: 'kept checkpoint' }],
  steps: { request: 2 },
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

  const findMessage = vi
    .spyOn(MessagesRepository.prototype, 'findById')
    .mockResolvedValue(
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
    findMessage,
    enqueueInTransaction,
  };
}

afterEach(() => vi.restoreAllMocks());

/**
 * Decodes the suspension checkpoint the service durably appended, the way the
 * `run_events.payload` jsonb column would give it back, and replays it through
 * the quota wake projection as a claimed resume boundary.
 */
function replayedSuspension(append: {
  mock: { calls: ReadonlyArray<[string, string, unknown?]> };
}) {
  const appended = append.mock.calls.find(
    ([, eventType]) => eventType === 'run.suspended',
  );

  if (appended === undefined)
    throw new Error('The Run appended no suspension checkpoint.');

  const parsed: unknown = JSON.parse(JSON.stringify(appended[2]));

  if (!isRecord(parsed))
    throw new Error('The suspension checkpoint is not an object.');

  const attemptId = 'wake-attempt';
  const generation = 5;

  const events: Array<RunEvent> = [
    {
      sequence: 1,
      runId: quotaInput.runId,
      eventType: 'run.suspended',
      payload: parsed,
      createdAt: now,
    },
    {
      sequence: 2,
      runId: quotaInput.runId,
      eventType: 'run.resumed',
      payload: { kind: 'quota', attemptId, generation },
      createdAt: now,
    },
    {
      sequence: 3,
      runId: quotaInput.runId,
      eventType: 'run.started',
      payload: { attemptId },
      createdAt: now,
    },
  ];

  return { attemptId, events };
}

describe('RunWaitService.suspendForQuota', () => {
  it('fences and queues a quota checkpoint for its persisted wake time', async () => {
    const fixture = makeFixture();

    await expect(fixture.service.suspendForQuota(quotaInput)).resolves.toEqual({
      kind: 'suspended',
    });

    expect(fixture.updateForAttempt.mock.lastCall).toMatchObject([
      quotaInput.runId,
      quotaInput.userId,
      quotaInput.attemptId,
      {
        status: 'awaiting_quota',
        awaiting: quotaAwaiting,
        wakeGeneration: 5,
        currentJobId: fixture.enqueueInTransaction.mock.lastCall?.[2]?.id,
        activeAttemptId: null,
      },
    ]);
    expect(fixture.append).toHaveBeenCalledWith(
      quotaInput.runId,
      'run.suspended',
      {
        kind: 'quota',
        attemptId: quotaInput.attemptId,
        generation: 5,
        failureClass: quotaAwaiting.failureClass,
        resetsAt: quotaAwaiting.resetsAt,
        wakeAt: quotaAwaiting.wakeAt,
        resumeAt: quotaAwaiting.resumeAt,
        waitCount: quotaAwaiting.waitCount,
        parts: quotaInput.parts,
        steps: quotaInput.steps,
      },
    );
    // A checkpoint without a cut appends no supersession marker.
    expect(fixture.append.mock.calls.map(([, eventType]) => eventType)).toEqual(
      ['run.suspended'],
    );

    const [, dispatchInput, options] =
      fixture.enqueueInTransaction.mock.calls[0] ?? [];

    expect(dispatchInput?.wake?.generation).toBe(5);
    expect(options?.startAfter).toEqual(new Date(quotaAwaiting.wakeAt));
    expect(fixture.settleOnDeadWorkers).not.toHaveBeenCalled();
    expect(fixture.hasPendingSteering).not.toHaveBeenCalled();
  });

  it('names the cut before the checkpoint when a failed send left one', async () => {
    const fixture = makeFixture();
    const superseded = { fromSequence: 3, step: 1 };

    await expect(
      fixture.service.suspendForQuota({ ...quotaInput, superseded }),
    ).resolves.toEqual({ kind: 'suspended' });

    // The live bridge prunes from `model.superseded` while the Run is still
    // streaming, so the cut is written before the suspension checkpoint
    // (continue-after-broken-send D6).
    expect(fixture.append.mock.calls.map(([, eventType]) => eventType)).toEqual(
      ['model.superseded', 'run.suspended'],
    );
    expect(fixture.append).toHaveBeenCalledWith(
      quotaInput.runId,
      'model.superseded',
      superseded,
    );
  });

  it('stores the failed send cut with the quota suspension', async () => {
    const fixture = makeFixture();
    const superseded = { fromSequence: 3, step: 0 };

    await expect(
      fixture.service.suspendForQuota({ ...quotaInput, superseded }),
    ).resolves.toEqual({ kind: 'suspended' });

    expect(fixture.append).toHaveBeenCalledWith(
      quotaInput.runId,
      'run.suspended',
      expect.objectContaining({ superseded }),
    );
  });

  it('rejects an ordinary wake without a triggering message', async () => {
    const fixture = makeFixture();
    fixture.findMessage.mockResolvedValue(undefined);

    await expect(fixture.service.suspendForQuota(quotaInput)).rejects.toThrow(
      Error,
    );

    expect(fixture.enqueueInTransaction).not.toHaveBeenCalled();
  });

  it('rejects an ordinary Run whose triggering message id is missing', async () => {
    const fixture = makeFixture({
      run: makeRun({ kind: 'turn', messageId: null }),
    });

    await expect(fixture.service.suspendForQuota(quotaInput)).rejects.toThrow(
      quotaInput.runId,
    );

    expect(fixture.findMessage).not.toHaveBeenCalled();
    expect(fixture.enqueueInTransaction).not.toHaveBeenCalled();
  });

  it('queues a message-less compaction without a triggering message', async () => {
    const fixture = makeFixture({
      run: makeRun({ kind: 'compaction', messageId: null }),
    });

    await expect(fixture.service.suspendForQuota(quotaInput)).resolves.toEqual({
      kind: 'suspended',
    });

    expect(fixture.findMessage).not.toHaveBeenCalled();

    const [, dispatchInput, options] =
      fixture.enqueueInTransaction.mock.calls[0] ?? [];

    expect(dispatchInput).toMatchObject({
      runId: quotaInput.runId,
      wake: { generation: 5 },
    });
    expect(dispatchInput).not.toHaveProperty('userMessage');
    expect(options?.id).toBe(
      fixture.updateForAttempt.mock.lastCall?.[3]?.currentJobId,
    );
  });

  it('rehydrates every frozen boundary field from its persisted checkpoint', async () => {
    const fixture = makeFixture();

    const baselines: FirstEpochBaselines = {
      recencyDigestInitialization: {
        baseline: {
          pinned: [{ title: 'pinned', date: '2026-11-01', messageCount: 2 }],
          recent: [
            {
              title: 'recent',
              date: '2026-11-02',
              messageCount: 3,
              excerpt: 'excerpt',
            },
          ],
          pinnedShown: 1,
          pinnedTotal: 1,
          recentShown: 1,
          recentTotal: 1,
          compiledOn: '2026-11-14T00:00:00.000Z',
        },
        told: [{ chatId: quotaInput.chatId, pinned: true }],
      },
      skillCatalogFreeze: {
        baseline: {
          entries: [{ name: 'skill-a', description: 'does a' }],
          omitted: 0,
        },
        rebakedFrom: null,
        told: ['skill-a'],
      },
    };

    const preparedContext = {
      ...baselines,
      historyRows: [{ parts: [{ type: 'text', text: 'private history' }] }],
      system: 'private prepared prompt',
    };

    const boundaryInput: SuspendRunQuotaInput = {
      ...quotaInput,
      awaiting: { ...quotaAwaiting, resumeAt: 'boundary' },
      parts: [
        { type: 'tool-read', toolCallId: 'call-a' },
        { type: 'text', text: 'after the call' },
      ],
      steps: { 'call-a': 0 },
      stoppedCalls: [{ toolName: 'bash', toolCallId: 'bash-1' }],
      stepBudgetUsed: 0,
      boundaryMode: 'owner',
      compactionSet: { ids: ['original-command'], focus: 'original focus' },
      summaryAttemptId: 'summary-attempt',
      summaryPrefixFingerprint: 'a'.repeat(64),
      baselines: preparedContext,
    };

    await expect(
      fixture.service.suspendForQuota(boundaryInput),
    ).resolves.toEqual({ kind: 'suspended' });

    const { attemptId, events } = replayedSuspension(fixture.append);

    expect(events[0]?.payload).toHaveProperty('baselines', baselines);

    expect(quotaRequestFromEvents(events)).toEqual({
      resumeAt: 'boundary',
      waitCount: 1,
      generation: 5,
      boundaryMode: 'owner',
      compactionSet: { ids: ['original-command'], focus: 'original focus' },
      stepBudgetUsed: 0,
      summaryAttemptId: 'summary-attempt',
      summaryPrefixFingerprint: 'a'.repeat(64),
      baselines,
      stoppedCalls: [{ toolName: 'bash', toolCallId: 'bash-1' }],
    });

    expect(quotaWakeStateFromEvents(events, attemptId)?.parts).toEqual([
      { type: 'tool-read', toolCallId: 'call-a', step: 0 },
      { type: 'text', text: 'after the call', step: 0 },
    ]);
  });

  it('does not suspend when cancellation was already requested', async () => {
    const fixture = makeFixture({
      run: makeRun({ cancelRequestedAt: now }),
    });

    await expect(fixture.service.suspendForQuota(quotaInput)).resolves.toEqual({
      kind: 'ready',
      cause: 'cancelled',
    });
    expect(fixture.updateForAttempt).not.toHaveBeenCalled();
    expect(fixture.append).not.toHaveBeenCalled();
    expect(fixture.enqueueInTransaction).not.toHaveBeenCalled();
  });
});

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
    expect(update?.awaiting).toMatchObject({
      kind: 'jobs',
      jobIds: input.jobIds,
    });

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
    expect(enqueueCall?.[1].userMessage).toMatchObject({ id: 'message-1' });
    expect(enqueueCall?.[2]?.id).toBe(update?.currentJobId);
    expect(enqueueCall?.[2]?.startAfter).toEqual(new Date(input.deadline));
  });

  it('persists measured usage before its suspension checkpoint', async () => {
    const fixture = makeFixture();

    const telemetry = asDouble<NonNullable<SuspendRunWaitInput['telemetry']>>({
      runId: input.runId,
      attemptId: input.attemptId,
      modelId: 'system:openai:gpt-5.4-mini',
      status: 'completed',
      complete: true,
    });

    await expect(
      fixture.service.suspend({ ...input, telemetry }),
    ).resolves.toEqual({ kind: 'suspended' });

    expect(fixture.append.mock.calls).toEqual([
      [
        input.runId,
        'model.completed',
        {
          finishReason: telemetry.finishReason,
          telemetry,
        },
      ],
      [
        input.runId,
        'run.suspended',
        expect.objectContaining({ attemptId: input.attemptId }),
      ],
    ]);
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
