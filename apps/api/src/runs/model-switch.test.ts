import { drizzle } from 'drizzle-orm/postgres-js';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import {
  type Chat,
  type ChatDelivery,
  type Message,
  type Run,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { RunRowFenceRepository } from './run-row-fence.repository';
import { runningReplyUsage } from './run-reply-finalizer';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { SystemPromptReceiptsRepository } from './system-prompt-receipts.repository';
import { deliverModelSwitch } from './model-switch';

const runId = '11111111-1111-4111-8111-111111111111';
const chatId = '22222222-2222-4222-8222-222222222222';
const userMessageId = '33333333-3333-4333-8333-333333333333';
const replyId = '44444444-4444-4444-8444-444444444444';
const hostMessageId = '55555555-5555-4555-8555-555555555555';
const userId = 'user-1';
const attemptId = 'attempt-old';
const now = new Date('2026-11-08T00:00:00.000Z');

const run: Run = {
  id: runId,
  kind: 'turn',
  chatId,
  messageId: userMessageId,
  userId,
  modelId: 'old-model',
  selector: 'old-model',
  selectedEffort: null,
  selectionRevision: null,
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
  wakeGeneration: 0,
  currentJobId: null,
  awaiting: null,
  effort: 'high',
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
  modelSelection: null,
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

const userMessage: Message = {
  id: userMessageId,
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
};

const reply: Message = {
  ...userMessage,
  id: replyId,
  seq: 2,
  role: 'assistant',
  senderUserId: null,
  inReplyTo: userMessageId,
  usage: runningReplyUsage({
    runId,
    attemptId,
    modelId: 'old-model',
    effort: 'high',
    permissionMode: 'default',
  }),
};

function pending(id: string, text: string): ChatDelivery {
  return {
    id,
    chatId,
    ownerUserId: userId,
    producer: 'owner',
    senderRef: null,
    mode: 'steer',
    parts: [{ type: 'text', text }],
    settings: { selector: 'old-model', permissionMode: 'default' },
    state: 'pending',
    position: 1,
    deliveredMessageId: null,
    runId: null,
    createdAt: now,
    updatedAt: now,
  };
}

const steer = pending('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'queued steer');

const secondSteer = pending(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'second steer',
);

const compact = pending('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '/compact');

const deliveredMessage: Message = {
  ...userMessage,
  id: hostMessageId,
  seq: 3,
};

const telemetry = {
  runId,
  attemptId,
  modelId: 'old-model',
  latencyMs: 10,
  finishReason: 'stop' as const,
  status: 'completed' as const,
  complete: true,
};

const tx: Db = drizzle.mock();

describe('deliverModelSwitch', () => {
  afterEach(() => vi.restoreAllMocks());

  function serve(
    options: {
      locked?: Run | undefined;
      withoutReply?: boolean;
      unlockedChat?: boolean;
      failModelUpdate?: boolean;
    } = {},
  ) {
    const lockOrder: Array<string> = [];
    const storedParts: Array<unknown> = [];

    let closedUsage: unknown;

    vi.spyOn(
      SystemPromptReceiptsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue([]);

    vi.spyOn(
      ChatJobsRepository.prototype,
      'settleOnDeadWorkers',
    ).mockResolvedValue([]);

    const lockRun = vi
      .spyOn(RunRowFenceRepository.prototype, 'lockForDelivery')
      .mockImplementation(() => {
        lockOrder.push('run');

        return Promise.resolve('locked' in options ? options.locked : run);
      });

    const lockChat = vi
      .spyOn(ChatsRepository.prototype, 'lock')
      .mockImplementation(() => {
        lockOrder.push('chat');

        return Promise.resolve(options.unlockedChat ? undefined : chat);
      });

    const lockPending = vi
      .spyOn(ChatDeliveriesRepository.prototype, 'lockPendingBoundary')
      .mockResolvedValue([steer, compact, secondSteer]);

    const markDelivered = vi
      .spyOn(ChatDeliveriesRepository.prototype, 'markDelivered')
      .mockImplementation((id) =>
        Promise.resolve([steer, secondSteer].find((item) => item.id === id)),
      );

    const findTurnState = vi
      .spyOn(MessagesRepository.prototype, 'findTurnState')
      .mockResolvedValue({
        userMessage,
        assistantMessage: options.withoutReply
          ? { ...reply, usage: { status: 'completed' } }
          : reply,
      });

    const updateReply = vi
      .spyOn(MessagesRepository.prototype, 'updateAssistantReply')
      .mockImplementation((write) => {
        closedUsage = write.usage;

        return Promise.resolve({
          ...reply,
          parts: write.parts,
          usage: write.usage,
        });
      });

    const createUser = vi
      .spyOn(MessagesRepository.prototype, 'createUserMessageIfAbsent')
      .mockImplementation((write) => {
        storedParts.push(...write.parts);

        return Promise.resolve({ ...deliveredMessage, parts: write.parts });
      });

    let updateCount = 0;

    const updateForAttempt = vi
      .spyOn(RunsRepository.prototype, 'updateForAttempt')
      .mockImplementation(() => {
        updateCount += 1;

        return Promise.resolve(
          options.failModelUpdate && updateCount === 2 ? undefined : run,
        );
      });

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

    return {
      lockOrder,
      lockRun,
      lockChat,
      lockPending,
      markDelivered,
      findTurnState,
      updateReply,
      createUser,
      updateForAttempt,
      append,
      storedParts,
      closedUsage: () => closedUsage,
    };
  }

  function input() {
    return {
      delivery: {
        run: { runId, userId },
        attemptId,
        models: [],
        live: {
          chatId,
          inReplyTo: userMessageId,
          parts: [{ type: 'text', text: 'partial output' }],
          telemetry,
        },
        modelCompleted: {
          usage: { inputTokens: 12 },
          finishReason: 'stop' as const,
          telemetry,
        },
        deadWorkerAfterSeconds: 60,
      },
      fromModel: {
        id: 'old-model',
        name: 'Old Model',
        providerModelId: 'old-provider-model',
      },
      toModel: {
        id: 'new-model',
        name: 'New Model',
        providerModelId: 'new-provider-model',
      },
      toEffort: 'low',
      failureClass: 'overloaded' as const,
      origin: 'policy' as const,
    };
  }

  it('locks Run before Chat and refuses a fenced or cancelled Run before writing', async () => {
    const fenced = serve({ locked: undefined });

    await expect(deliverModelSwitch(tx, input())).rejects.toThrow(
      'no longer owns its attempt',
    );
    expect(fenced.lockOrder).toEqual(['run']);
    expect(fenced.createUser).not.toHaveBeenCalled();

    vi.restoreAllMocks();

    const cancelled = serve({ locked: { ...run, cancelRequestedAt: now } });

    await expect(deliverModelSwitch(tx, input())).rejects.toThrow(
      'was cancelled',
    );
    expect(cancelled.lockOrder).toEqual(['run']);
    expect(cancelled.lockChat).not.toHaveBeenCalled();
  });

  it('rejects an unlocked Chat and a missing reply before storing a switch', async () => {
    const unlockedChat = serve({ unlockedChat: true });

    await expect(deliverModelSwitch(tx, input())).rejects.toThrow(
      'could not lock its Chat',
    );
    expect(unlockedChat.lockOrder).toEqual(['run', 'chat']);
    expect(unlockedChat.createUser).not.toHaveBeenCalled();

    vi.restoreAllMocks();

    const missingReply = serve({ withoutReply: true });

    await expect(deliverModelSwitch(tx, input())).rejects.toThrow(
      'no reply to close',
    );
    expect(missingReply.createUser).not.toHaveBeenCalled();
  });

  it('rejects when the new model cannot be recorded on the moved attempt', async () => {
    const failedModelUpdate = serve({ failModelUpdate: true });

    await expect(deliverModelSwitch(tx, input())).rejects.toThrow(
      'could not take its switched model',
    );
    expect(failedModelUpdate.updateForAttempt).toHaveBeenCalledTimes(2);
    expect(failedModelUpdate.append).toHaveBeenCalledWith(
      runId,
      'run.delivered',
      expect.objectContaining({
        cause: 'failover',
      }),
    );
    expect(failedModelUpdate.append).not.toHaveBeenCalledWith(
      runId,
      'model.switched',
      expect.anything(),
    );
  });

  it('closes the reply as failed and delivers the switch before steers, leaving compact pending', async () => {
    const spies = serve();
    const result = await deliverModelSwitch(tx, input());

    expect(spies.lockOrder).toEqual(['run', 'chat']);
    expect(spies.updateReply).toHaveBeenCalledWith(
      expect.objectContaining({ id: replyId }),
    );
    expect(spies.closedUsage()).toMatchObject({
      status: 'error',
      complete: false,
    });
    expect(spies.storedParts[0]).toMatchObject({
      data: { producer: 'effective-context-change' },
    });
    expect(spies.storedParts.slice(1)).toEqual([
      ...steer.parts,
      ...secondSteer.parts,
    ]);
    expect(spies.markDelivered).toHaveBeenCalledTimes(2);
    expect(spies.markDelivered).toHaveBeenCalledWith(steer.id, userId, {
      messageId: hostMessageId,
      runId,
    });
    expect(spies.markDelivered).toHaveBeenCalledWith(secondSteer.id, userId, {
      messageId: hostMessageId,
      runId,
    });
    expect(spies.markDelivered).not.toHaveBeenCalledWith(
      compact.id,
      expect.anything(),
      expect.anything(),
    );
    expect(spies.updateForAttempt).toHaveBeenNthCalledWith(
      1,
      runId,
      userId,
      attemptId,
      {
        messageId: hostMessageId,
        activeAttemptId: result.attemptId,
      },
    );
    expect(spies.updateForAttempt).toHaveBeenNthCalledWith(
      2,
      runId,
      userId,
      result.attemptId,
      {
        modelId: 'new-model',
        effort: 'low',
      },
    );
    expect(spies.append).toHaveBeenCalledWith(runId, 'model.switched', {
      fromModelId: 'old-model',
      fromEffort: 'high',
      toModelId: 'new-model',
      toEffort: 'low',
      failureClass: 'overloaded',
      messageId: hostMessageId,
      origin: 'policy',
    });
  });
});
