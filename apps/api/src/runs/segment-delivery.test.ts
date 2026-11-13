import { drizzle } from 'drizzle-orm/postgres-js';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';

import {
  type Chat,
  type ChatDelivery,
  type Message,
  type Run,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { runningReplyUsage } from './run-reply-finalizer';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import {
  abortedByInterrupt,
  closedTelemetry,
  deliverPendingSteering,
  type DeliveredBoundary,
  type DeliveryCause,
} from './segment-delivery';
import { SystemPromptReceiptsRepository } from './system-prompt-receipts.repository';

const runId = '11111111-1111-4111-8111-111111111111';
const chatId = '22222222-2222-4222-8222-222222222222';
const messageId = '33333333-3333-4333-8333-333333333333';
const userId = 'user-1';
const attemptId = 'attempt-1';
const now = new Date('2026-11-08T00:00:00.000Z');

const run: Run = {
  id: runId,
  chatId,
  messageId,
  userId,
  modelId: 'fake-model',
  activeAttemptId: attemptId,
  completedAttemptId: null,
  turnToolAvailability: null,
  status: 'running_model',
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  createdAt: now,
  startedAt: now,
  finishedAt: null,
  effort: null,
  permissionMode: 'default',
  followUpAction: null,
  sourceRunId: null,
};

const chat: Chat = {
  id: chatId,
  ownerUserId: userId,
  title: null,
  visibility: 'private',
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  projectId: null,
  recencyDigestBaseline: null,
  recencyDigestTold: null,
  recencyDigestRebakedFrom: null,
  skillCatalogBaseline: null,
  skillCatalogRebakedFrom: null,
  skillCatalogTold: null,
  workspaceRoot: null,
  workspaceExecutorId: null,
  workspaceGeneration: 0,
  artifactSeq: 0,
  workspaceTold: null,
  workspaceToldFrom: null,
  workspaceToldAvailable: null,
  workspaceDetachReason: null,
};

function storedMessage(overrides: Partial<Message>): Message {
  return {
    id: messageId,
    chatId,
    seq: 1,
    role: 'user',
    senderUserId: userId,
    parts: [],
    attachments: [],
    usage: null,
    absorbedThroughSeq: null,
    inReplyTo: null,
    createdAt: now,
    revisedAt: null,
    ...overrides,
  };
}

const deliveredMessage = storedMessage({
  id: '55555555-5555-4555-8555-555555555555',
  seq: 3,
});

function pending(id: string, text: string): ChatDelivery {
  return {
    id,
    chatId,
    ownerUserId: userId,
    producer: 'owner',
    senderRef: null,
    mode: 'steer',
    parts: [{ type: 'text', text }],
    settings: { modelId: 'fake-model', permissionMode: 'default' },
    state: 'pending',
    position: 1,
    deliveredMessageId: null,
    runId: null,
    createdAt: now,
    updatedAt: now,
  };
}

const first = pending('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'first');
const second = pending('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'second');
const models = [{ id: 'fake-model', billing: 'subscription' as const }];

const closingTelemetry = {
  runId,
  attemptId,
  modelId: 'fake-model',
  latencyMs: 10,
  finishReason: 'tool-calls' as const,
  status: 'completed' as const,
  complete: true,
};

describe('deliverPendingSteering', () => {
  const tx: Db = drizzle.mock();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The repositories as a Run with two pending items finds them. */
  function serve(
    overrides: {
      locked?: Run | undefined;
      chat?: Chat | undefined;
      items?: Array<ChatDelivery>;
      marked?: ChatDelivery | undefined;
      stored?: Message | undefined;
      moved?: Run | undefined;
    } = {},
  ) {
    const has = <K extends keyof typeof overrides>(key: K) => key in overrides;
    // No other attempt's receipt, so the closing usage stays complete.
    vi.spyOn(
      SystemPromptReceiptsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue([]);

    const lockForDelivery = vi
      .spyOn(RunsRepository.prototype, 'lockForDelivery')
      .mockResolvedValue(has('locked') ? overrides.locked : run);

    const lockChat = vi
      .spyOn(ChatsRepository.prototype, 'lock')
      .mockResolvedValue(has('chat') ? overrides.chat : chat);

    const lockPending = vi
      .spyOn(ChatDeliveriesRepository.prototype, 'lockPendingSteering')
      .mockResolvedValue(overrides.items ?? [first, second]);

    const markDelivered = vi
      .spyOn(ChatDeliveriesRepository.prototype, 'markDelivered')
      .mockResolvedValue(has('marked') ? overrides.marked : first);

    const createUser = vi
      .spyOn(MessagesRepository.prototype, 'createUserMessageIfAbsent')
      .mockResolvedValue(has('stored') ? overrides.stored : deliveredMessage);

    const updateForAttempt = vi
      .spyOn(RunsRepository.prototype, 'updateForAttempt')
      .mockResolvedValue(has('moved') ? overrides.moved : run);

    const append = vi
      .spyOn(RunEventsRepository.prototype, 'append')
      .mockImplementation((appendedRunId, eventType, payload) =>
        Promise.resolve({
          sequence: 1,
          runId: appendedRunId,
          eventType,
          payload,
          createdAt: now,
        }),
      );

    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue(
      [],
    );
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue({
      userMessage: storedMessage({}),
      assistantMessage: storedMessage({
        id: '44444444-4444-4444-8444-444444444444',
        seq: 2,
        role: 'assistant',
        senderUserId: null,
        inReplyTo: messageId,
        usage: runningReplyUsage({
          runId,
          attemptId,
          modelId: 'fake-model',
          effort: undefined,
          permissionMode: 'default',
        }),
      }),
    });

    const updateReply = vi
      .spyOn(MessagesRepository.prototype, 'updateAssistantReply')
      .mockImplementation((write) =>
        Promise.resolve(
          storedMessage({
            id: write.id,
            role: 'assistant',
            seq: 2,
            parts: write.parts,
            usage: write.usage,
            inReplyTo: write.inReplyTo,
          }),
        ),
      );

    return {
      lockForDelivery,
      lockChat,
      lockPending,
      markDelivered,
      createUser,
      updateForAttempt,
      append,
      updateReply,
    };
  }

  const live = {
    chatId,
    inReplyTo: messageId,
    parts: [{ type: 'text' as const, text: 'so far' }],
    telemetry: closingTelemetry,
  };

  function deliver(
    extra: Partial<Parameters<typeof deliverPendingSteering>[1]> = {},
  ) {
    return deliverPendingSteering(tx, {
      run: { runId, userId },
      attemptId,
      models,
      live,
      ...extra,
    });
  }

  it('is fenced when the attempt no longer owns the Run', async () => {
    const spies = serve({ locked: undefined });

    await expect(deliver()).resolves.toEqual({ kind: 'fenced' });

    expect(spies.lockForDelivery).toHaveBeenCalledWith(
      runId,
      userId,
      attemptId,
    );
    expect(spies.lockChat).not.toHaveBeenCalled();
    expect(spies.append).not.toHaveBeenCalled();
  });

  it('leaves every item pending when a cancellation is recorded', async () => {
    const spies = serve({ locked: { ...run, cancelRequestedAt: now } });

    await expect(deliver()).resolves.toEqual({ kind: 'cancelled' });

    expect(spies.lockChat).not.toHaveBeenCalled();
    expect(spies.lockPending).not.toHaveBeenCalled();
    expect(spies.createUser).not.toHaveBeenCalled();
  });

  it('is fenced when the chat row is gone', async () => {
    const spies = serve({ chat: undefined });

    await expect(deliver()).resolves.toEqual({ kind: 'fenced' });

    expect(spies.lockChat).toHaveBeenCalledWith(chatId, userId);
    expect(spies.lockPending).not.toHaveBeenCalled();
  });

  it('writes nothing when no item is pending', async () => {
    const spies = serve({ items: [] });

    await expect(deliver()).resolves.toEqual({ kind: 'nothing-pending' });

    expect(spies.lockPending).toHaveBeenCalledWith(chatId, userId);
    expect(spies.updateReply).not.toHaveBeenCalled();
    expect(spies.createUser).not.toHaveBeenCalled();
    expect(spies.append).not.toHaveBeenCalled();
    expect(spies.updateForAttempt).not.toHaveBeenCalled();
  });

  it('stores one message of every item in order and moves the Run onto it', async () => {
    const spies = serve();

    const outcome = await deliver({
      modelCompleted: {
        usage: { inputTokens: 3 },
        finishReason: 'tool-calls',
        telemetry: closingTelemetry,
      },
    });

    expect(outcome.kind).toBe('delivered');

    if (outcome.kind !== 'delivered') return;
    expect(outcome.message).toBe(deliveredMessage);
    expect(outcome.closedReply?.parts).toEqual(live.parts);
    expect(outcome.closedReply?.usage).toBe(closingTelemetry);

    expect(spies.createUser).toHaveBeenCalledTimes(1);
    const stored = spies.createUser.mock.calls[0]?.[0];
    expect(stored).toMatchObject({
      chatId,
      senderUserId: userId,
      parts: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ],
    });
    expect(stored?.id).toMatch(/^[0-9a-f-]{36}$/);

    expect(spies.markDelivered).toHaveBeenCalledTimes(2);

    for (const item of [first, second]) {
      expect(spies.markDelivered).toHaveBeenCalledWith(item.id, userId, {
        messageId: deliveredMessage.id,
        runId,
      });
    }

    expect(spies.updateForAttempt).toHaveBeenCalledWith(
      runId,
      userId,
      attemptId,
      { messageId: deliveredMessage.id, activeAttemptId: outcome.attemptId },
    );
    expect(outcome.attemptId).not.toBe(attemptId);

    expect(spies.append.mock.calls.map(([, type]) => type)).toEqual([
      'model.completed',
      'run.delivered',
    ]);
    expect(spies.append).toHaveBeenCalledWith(runId, 'model.completed', {
      usage: { inputTokens: 3 },
      finishReason: 'tool-calls',
      telemetry: closingTelemetry,
    });
    expect(spies.append).toHaveBeenCalledWith(runId, 'run.delivered', {
      messageId: deliveredMessage.id,
      deliveryIds: [first.id, second.id],
      cause: 'steer',
      stoppedCalls: [],
      attemptId: outcome.attemptId,
    });
  });

  const interruptItem: ChatDelivery = { ...first, mode: 'interrupt' };

  const interrupted = {
    ...closingTelemetry,
    status: 'aborted',
    complete: false,
    interrupted: true,
  };

  it('closes the reply aborted, and records the cause, when an interrupt item is delivered', async () => {
    const spies = serve({ items: [interruptItem] });

    const outcome = await deliver({
      modelCompleted: {
        usage: { inputTokens: 3 },
        finishReason: 'tool-calls',
        telemetry: { ...closingTelemetry },
      },
    });

    expect(outcome.kind).toBe('delivered');

    if (outcome.kind !== 'delivered') return;
    expect(outcome.cause).toBe('interrupt');
    expect(outcome.closedReply?.usage).toEqual(interrupted);
    expect(spies.append).toHaveBeenCalledWith(runId, 'model.completed', {
      usage: { inputTokens: 3 },
      finishReason: 'tool-calls',
      telemetry: interrupted,
    });
    expect(spies.append).toHaveBeenCalledWith(
      runId,
      'run.delivered',
      expect.objectContaining({ cause: 'interrupt', stoppedCalls: [] }),
    );
  });

  it('closes a reply with no collector as aborted from the usage the interrupt synthesized', async () => {
    const spies = serve({ items: [interruptItem] });

    await deliver({
      live: undefined,
      telemetry: { ...closingTelemetry },
    });

    expect(spies.updateReply.mock.calls[0]?.[0].usage).toMatchObject({
      status: 'aborted',
      interrupted: true,
    });
  });

  it('makes a delivery an interrupt when the stop names calls, even for a steer item', async () => {
    const spies = serve({ items: [first] });
    const stoppedCalls = [{ toolName: 'bash', toolCallId: 'call-1' }];

    const outcome = await deliver({ stoppedCalls });

    expect(outcome.kind === 'delivered' && outcome.cause).toBe('interrupt');
    expect(spies.append).toHaveBeenCalledWith(
      runId,
      'run.delivered',
      expect.objectContaining({ cause: 'interrupt', stoppedCalls }),
    );
  });

  it('settles a call still open when an interrupt closes the reply, and refuses to complete one for a steer', async () => {
    const spies = serve({ items: [interruptItem] });
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue([
      {
        runId,
        sequence: 1,
        eventType: 'tool.requested',
        payload: {
          toolCallId: 'open-call',
          toolName: 'read',
          input: { path: '/a' },
        },
        createdAt: now,
      },
    ]);

    await expect(deliver({ live: undefined })).resolves.toMatchObject({
      kind: 'delivered',
    });
    expect(spies.append).toHaveBeenCalledWith(
      runId,
      'tool.completed',
      expect.objectContaining({ toolCallId: 'open-call', status: 'error' }),
    );

    serve({ items: [first] });
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue([
      {
        runId,
        sequence: 1,
        eventType: 'tool.requested',
        payload: {
          toolCallId: 'open-call',
          toolName: 'read',
          input: { path: '/a' },
        },
        createdAt: now,
      },
    ]);
    await expect(deliver({ live: undefined })).rejects.toThrow(
      'cannot complete with durable tool calls still open',
    );
  });

  it('publishes no model.completed event when the segment closed without usage', async () => {
    const spies = serve();

    await deliver();

    expect(spies.append.mock.calls.map(([, type]) => type)).toEqual([
      'run.delivered',
    ]);
  });

  it('reports no closed reply when the finalizer wrote none', async () => {
    serve();
    vi.spyOn(MessagesRepository.prototype, 'findTurnState').mockResolvedValue(
      {},
    );

    const outcome = await deliver();

    expect(outcome.kind).toBe('delivered');
    expect(outcome).toMatchObject({ message: deliveredMessage });
    expect(outcome).not.toHaveProperty('closedReply');
  });

  it('rolls back when the delivered message cannot be stored', async () => {
    serve({ stored: undefined });

    await expect(deliver()).rejects.toThrow(
      `Run ${runId} could not store its delivery.`,
    );
  });

  it('rolls back when an item was not pending', async () => {
    const spies = serve({ marked: undefined });

    await expect(deliver()).rejects.toThrow(
      `Steer item ${first.id} was not pending.`,
    );
    expect(spies.updateForAttempt).not.toHaveBeenCalled();
  });

  it('rolls back when the Run cannot move onto its delivery', async () => {
    const spies = serve({ moved: undefined });

    await expect(deliver()).rejects.toThrow(
      `Run ${runId} could not move to its delivery.`,
    );
    expect(spies.append).not.toHaveBeenCalledWith(
      runId,
      'run.delivered',
      expect.anything(),
    );
  });
});

describe('deliverPendingSteering closing usage and baselines', () => {
  const tx: Db = drizzle.mock();

  const baseline = {
    pinned: [],
    recent: [],
    pinnedShown: 0,
    pinnedTotal: 0,
    recentShown: 0,
    recentTotal: 0,
    compiledOn: '2026-11-08',
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Every repository a delivery of `items` reads or writes, served. */
  function serve(items: Array<ChatDelivery>) {
    vi.spyOn(RunsRepository.prototype, 'lockForDelivery').mockResolvedValue(
      run,
    );
    vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue(chat);
    vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'lockPendingSteering',
    ).mockResolvedValue(items);
    vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'markDelivered',
    ).mockImplementation((id) =>
      Promise.resolve(items.find((item) => item.id === id)),
    );
    vi.spyOn(
      MessagesRepository.prototype,
      'createUserMessageIfAbsent',
    ).mockResolvedValue(deliveredMessage);
    vi.spyOn(RunsRepository.prototype, 'updateForAttempt').mockResolvedValue(
      run,
    );
    vi.spyOn(RunEventsRepository.prototype, 'append').mockImplementation(
      (appendedRunId, eventType, payload) =>
        Promise.resolve({
          sequence: 1,
          runId: appendedRunId,
          eventType,
          payload,
          createdAt: now,
        }),
    );
    vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue(
      [],
    );
    vi.spyOn(
      RunEventsRepository.prototype,
      'findFirstByType',
    ).mockResolvedValue(undefined);

    return {
      findByOwnedRun: vi
        .spyOn(SystemPromptReceiptsRepository.prototype, 'findByOwnedRun')
        .mockResolvedValue([]),
      findTurnState: vi
        .spyOn(MessagesRepository.prototype, 'findTurnState')
        .mockResolvedValue({}),
      setDigest: vi
        .spyOn(ChatsRepository.prototype, 'setRecencyDigestIfAbsent')
        .mockResolvedValue(undefined),
    };
  }

  /** Delivers with a closing reply that answers `inReplyTo`. */
  async function deliver(inReplyTo = messageId) {
    const telemetry = { ...closingTelemetry };
    await deliverPendingSteering(tx, {
      run: { runId, userId },
      attemptId,
      models,
      live: {
        chatId,
        inReplyTo,
        parts: [{ type: 'text' as const, text: 'so far' }],
        telemetry,
      },
      modelCompleted: {
        usage: { inputTokens: 3 },
        finishReason: 'tool-calls',
        telemetry,
      },
      baselines: { recencyDigestInitialization: { baseline, told: [] } },
    });

    return telemetry;
  }

  it('closes a steer reply as complete usage while the Run is still live', async () => {
    serve([first]);

    const telemetry = await deliver();

    expect(telemetry.complete).toBe(true);
  });

  it('marks the closing usage incomplete when another attempt prepared the Run', async () => {
    const spies = serve([first]);
    spies.findByOwnedRun.mockResolvedValue([
      {
        id: '77777777-7777-4777-8777-777777777777',
        ownerUserId: userId,
        runId,
        attemptId: 'earlier-attempt',
        source: 'project_default',
        systemPrompt: 'prompt',
        promptHash: 'hash',
        createdAt: now,
      },
    ]);

    const telemetry = await deliver();

    expect(telemetry.complete).toBe(false);
  });

  it('reads the replaced reply through the message the live segment answers', async () => {
    const spies = serve([first]);
    const liveReply = '66666666-6666-4666-8666-666666666666';

    await deliver(liveReply);

    expect(spies.findTurnState.mock.calls[0]).toEqual([
      chatId,
      userId,
      liveReply,
    ]);
  });

  it('writes the first-epoch baselines when every delivered item is a steer', async () => {
    const spies = serve([first, second]);

    await deliver();

    expect(spies.setDigest).toHaveBeenCalledWith(chatId, userId, baseline, []);
  });

  it('writes no first-epoch baseline when an interrupt is among the delivered items', async () => {
    const spies = serve([first, { ...second, mode: 'interrupt' }]);

    await deliver();

    expect(spies.setDigest).not.toHaveBeenCalled();
  });
});

describe('the usage an interrupt closes a reply with', () => {
  const telemetry = {
    runId,
    attemptId,
    modelId: 'fake-model',
    latencyMs: 10,
    finishReason: 'tool-calls' as const,
    status: 'completed' as const,
    complete: true,
  };

  it('is aborted, incomplete, and marked interrupted', () => {
    expect(abortedByInterrupt(telemetry)).toEqual({
      ...telemetry,
      status: 'aborted',
      complete: false,
      interrupted: true,
    });
  });

  it('is left as the segment measured it for a steer', () => {
    const delivered = (cause: DeliveryCause): DeliveredBoundary => ({
      kind: 'delivered',
      message: deliveredMessage,
      attemptId: 'attempt-2',
      cause,
    });

    const steer = delivered('steer');
    const interrupt = delivered('interrupt');

    expect(closedTelemetry(steer, telemetry)).toBe(telemetry);
    expect(closedTelemetry(interrupt, telemetry)).toEqual(
      abortedByInterrupt(telemetry),
    );
  });
});
