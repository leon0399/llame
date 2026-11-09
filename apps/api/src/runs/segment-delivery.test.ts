import { drizzle } from 'drizzle-orm/postgres-js';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import * as schema from '../db/schema';
import {
  type Chat,
  type ChatDelivery,
  type Message,
  type Run,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { runningReplyUsage } from './run-reply-finalizer';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { deliverPendingSteering } from './segment-delivery';

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
  const tx: Db = drizzle.mock({ schema });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The repositories as a Run with two pending items finds them. */
  function serve(
    overrides: {
      locked?: Run | undefined;
      chat?: Chat | undefined;
      items?: Array<ChatDelivery>;
      marked?: boolean;
      stored?: Message | undefined;
      moved?: Run | undefined;
    } = {},
  ) {
    const has = <K extends keyof typeof overrides>(key: K) => key in overrides;
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
      .mockResolvedValue(overrides.marked ?? true);
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
    const spies = serve({ marked: false });

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
