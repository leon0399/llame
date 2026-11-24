import { vi } from 'vitest';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import {
  type Chat,
  type ChatDelivery,
  type Message,
  type Run,
} from '../db/schema';
import { RunRowFenceRepository } from '../runs/run-row-fence.repository';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { SystemPromptReceiptsRepository } from '../runs/system-prompt-receipts.repository';

export type ModelSwitchFakeOptions = {
  locked?: Run | undefined;
  withoutReply?: boolean;
  unlockedChat?: boolean;
  failModelUpdate?: boolean;
  modelSelection?: Chat['modelSelection'];
};

export type ModelSwitchFakeObservations = {
  readonly storedParts?: Array<unknown>;
  readonly replyWrites?: Array<{
    readonly parts: ReadonlyArray<unknown>;
    readonly usage: unknown;
  }>;
  readonly runUpdates?: Array<{
    readonly id: string;
    readonly userId: string;
    readonly attemptId: string;
    readonly update: unknown;
  }>;
  readonly selectionWrites?: Array<{
    readonly chatId: string;
    readonly ownerUserId: string;
    readonly selection: unknown;
  }>;
};

type ClosedUsage = { usage: unknown };

type ModelSwitchFakeInput = {
  run: Run;
  chat: Chat;
  userMessage: Message;
  reply: Message;
  deliveredMessage: Message;
  pending: ReadonlyArray<ChatDelivery>;
  now: Date;
  options?: ModelSwitchFakeOptions;
  observations?: ModelSwitchFakeObservations;
};

function mockSwitchLocks(
  input: ModelSwitchFakeInput,
  lockOrder: Array<string>,
) {
  const options = input.options ?? {};

  const lockRun = vi
    .spyOn(RunRowFenceRepository.prototype, 'lockForDelivery')
    .mockImplementation(() => {
      lockOrder.push('run');

      return Promise.resolve('locked' in options ? options.locked : input.run);
    });

  const lockChat = vi
    .spyOn(ChatsRepository.prototype, 'lock')
    .mockImplementation(() => {
      lockOrder.push('chat');

      return Promise.resolve(
        options.unlockedChat
          ? undefined
          : {
              ...input.chat,
              modelSelection:
                options.modelSelection ?? input.chat.modelSelection,
            },
      );
    });

  return { lockRun, lockChat };
}

function mockBoundaryFakes(input: ModelSwitchFakeInput) {
  vi.spyOn(
    SystemPromptReceiptsRepository.prototype,
    'findByOwnedRun',
  ).mockResolvedValue([]);

  vi.spyOn(
    ChatJobsRepository.prototype,
    'settleOnDeadWorkers',
  ).mockResolvedValue([]);

  const lockPending = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'lockPendingBoundary')
    .mockResolvedValue([...input.pending]);

  const markDelivered = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'markDelivered')
    .mockImplementation((id) =>
      Promise.resolve(input.pending.find((item) => item.id === id)),
    );

  return { lockPending, markDelivered };
}

function mockChatStateFakes(input: ModelSwitchFakeInput) {
  const options = input.options ?? {};

  const setModelSelection = vi
    .spyOn(ChatsRepository.prototype, 'setModelSelection')
    .mockImplementation((chatId, ownerUserId, selection) => {
      input.observations?.selectionWrites?.push({
        chatId,
        ownerUserId,
        selection,
      });

      return Promise.resolve();
    });

  vi.spyOn(ChatsRepository.prototype, 'transactionNow').mockResolvedValue(
    input.now,
  );

  return { setModelSelection, options };
}

function mockTurnStateFake(
  input: ModelSwitchFakeInput,
  options: ModelSwitchFakeOptions,
) {
  return vi
    .spyOn(MessagesRepository.prototype, 'findTurnState')
    .mockResolvedValue({
      userMessage: input.userMessage,
      assistantMessage: options.withoutReply
        ? { ...input.reply, usage: { status: 'completed' } }
        : input.reply,
    });
}

function mockReplyFake(input: ModelSwitchFakeInput, closed: ClosedUsage) {
  return vi
    .spyOn(MessagesRepository.prototype, 'updateAssistantReply')
    .mockImplementation((write) => {
      closed.usage = write.usage;

      input.observations?.replyWrites?.push({
        parts: write.parts,
        usage: write.usage,
      });

      return Promise.resolve({
        ...input.reply,
        parts: write.parts,
        usage: write.usage,
      });
    });
}

function mockStoredMessageFakes(
  input: ModelSwitchFakeInput,
  storedParts: Array<unknown>,
) {
  const createStoredMessage = (parts: Array<unknown>) => {
    storedParts.push(...parts);

    input.observations?.storedParts?.push(...parts);

    return { ...input.deliveredMessage, parts };
  };

  const createUser = vi
    .spyOn(MessagesRepository.prototype, 'createUserMessageIfAbsent')
    .mockImplementation((write) =>
      Promise.resolve(createStoredMessage(write.parts)),
    );

  const createMessage = vi
    .spyOn(MessagesRepository.prototype, 'create')
    .mockImplementation((write) =>
      Promise.resolve(createStoredMessage(write.parts)),
    );

  return { createUser, createMessage };
}

function mockRunFakes(input: ModelSwitchFakeInput, closed: ClosedUsage) {
  const options = input.options ?? {};

  let updateCount = 0;

  const updateForAttempt = vi
    .spyOn(RunsRepository.prototype, 'updateForAttempt')
    .mockImplementation((id, userId, attemptId, update) => {
      updateCount += 1;

      input.observations?.runUpdates?.push({ id, userId, attemptId, update });

      return Promise.resolve(
        options.failModelUpdate && updateCount === 2 ? undefined : input.run,
      );
    });

  const append = vi
    .spyOn(RunEventsRepository.prototype, 'append')
    .mockImplementation((runId, eventType, payload) =>
      Promise.resolve({
        sequence: 1,
        runId,
        eventType,
        payload,
        createdAt: input.now,
      }),
    );

  vi.spyOn(RunEventsRepository.prototype, 'listByRunId').mockResolvedValue([]);

  return { updateForAttempt, append, closedUsage: () => closed.usage };
}

export function mockModelSwitchRepositories(input: ModelSwitchFakeInput) {
  const lockOrder: Array<string> = [];
  const storedParts: Array<unknown> = [];
  const closed: ClosedUsage = { usage: undefined };

  const locks = mockSwitchLocks(input, lockOrder);

  const boundary = mockBoundaryFakes(input);

  const chatState = mockChatStateFakes(input);

  const findTurnState = mockTurnStateFake(input, chatState.options);
  const updateReply = mockReplyFake(input, closed);
  const storedMessages = mockStoredMessageFakes(input, storedParts);
  const run = mockRunFakes(input, closed);

  return {
    ...locks,
    ...boundary,
    ...chatState,
    ...storedMessages,
    findTurnState,
    updateReply,
    ...run,
    lockOrder,
    storedParts,
  };
}
