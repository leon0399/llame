import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { LanguageModelUsage, ModelMessage as AiModelMessage } from 'ai';

import { TenantDbService } from '../db/tenant-db.service';
import { type Message } from '../db/schema';
import { type ModelClient } from '../models/model-client';
import { ModelsService } from '../models/models.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import {
  buildContext,
  DEFAULT_MAX_MESSAGES,
  type MessagePart,
  type StoredMessage,
} from './context-builder';

export const CHAT_SYSTEM_PROMPT =
  'You are llame, an answer-only assistant. Answer the latest user message directly. Do not claim to use tools or take external actions.';

export type ChatMessageInput = {
  id: string;
  parts: MessagePart[];
};

@Injectable()
export class ChatLoopService {
  private readonly logger = new Logger(ChatLoopService.name);

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly models: ModelsService,
  ) {}

  async createMessageStream(input: {
    chatId: string;
    userId: string;
    message: ChatMessageInput;
    abortSignal?: AbortSignal;
  }): Promise<ReturnType<ModelClient['streamText']>> {
    // Throws MissingModelCredentialError (a domain error) when absent; the controller
    // maps it to HTTP 402. The service stays HTTP-agnostic (it will move to a worker, §9.5).
    const credential = await this.models.resolveModelCredential(input.userId);
    const client = this.models.createOpenAIClient(credential);

    const context = await this.persistUserAndBuildContext(input);

    return client.streamText({
      messages: context,
      abortSignal: input.abortSignal,
      onFinish: async ({ text, usage, finishReason }) => {
        try {
          await this.persistAssistantMessage({
            chatId: input.chatId,
            userId: input.userId,
            inReplyTo: input.message.id,
            text,
            usage,
            finishReason,
          });
        } catch (error) {
          this.logger.error(
            `Failed to persist assistant message for chat ${input.chatId}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      },
    });
  }

  private async persistUserAndBuildContext(input: {
    chatId: string;
    userId: string;
    message: ChatMessageInput;
  }): Promise<AiModelMessage[]> {
    return this.tenantDb.runAs(input.userId, async (tx) => {
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);

      const chat = await chatsRepo.findById(input.chatId, input.userId);
      if (!chat) {
        throw new NotFoundException(`Chat ${input.chatId} not found`);
      }

      const turn = await messagesRepo.findTurnState(
        input.chatId,
        input.userId,
        input.message.id,
      );
      if (turn.assistantMessage) {
        throw new ConflictException('Message turn already completed');
      }

      // Idempotency key reuse with different content is a client error, not a retry.
      // Normalize both sides to plain JSON first: the stored parts are plain (from jsonb)
      // while input parts are class-transformer instances, so a raw deep-equal would
      // always differ on the prototype.
      if (
        turn.userMessage &&
        !isDeepStrictEqual(
          normalizeJson(turn.userMessage.parts),
          normalizeJson(input.message.parts),
        )
      ) {
        throw new ConflictException(
          'Message id already used with different content',
        );
      }

      let userMessage: Message | undefined = turn.userMessage;

      if (!userMessage) {
        userMessage = await messagesRepo.createUserMessageIfAbsent({
          id: input.message.id,
          chatId: input.chatId,
          senderUserId: input.userId,
          parts: input.message.parts,
        });
      }

      if (!userMessage) {
        const retryTurn = await messagesRepo.findTurnState(
          input.chatId,
          input.userId,
          input.message.id,
        );
        if (retryTurn.assistantMessage) {
          throw new ConflictException('Message turn already completed');
        }

        userMessage = retryTurn.userMessage;
      }

      if (!userMessage) {
        throw new ConflictException('Message id already exists');
      }

      // Mark chat activity so it sorts to the top of the chat list (findByOwner).
      await chatsRepo.touch(input.chatId, input.userId);

      const history = await messagesRepo.findByChatId(
        input.chatId,
        input.userId,
        { maxSeq: userMessage.seq, limit: DEFAULT_MAX_MESSAGES },
      );
      const context = buildContext(history as StoredMessage[], {
        systemPrompt: CHAT_SYSTEM_PROMPT,
        maxMessages: DEFAULT_MAX_MESSAGES,
      }) as AiModelMessage[];

      return context;
    });
  }

  private async persistAssistantMessage(input: {
    chatId: string;
    userId: string;
    inReplyTo: string;
    text: string;
    usage: LanguageModelUsage;
    finishReason: string;
  }): Promise<void> {
    await this.tenantDb.runAs(input.userId, async (tx) => {
      const messagesRepo = new MessagesRepository(tx);
      const turn = await messagesRepo.findTurnState(
        input.chatId,
        input.userId,
        input.inReplyTo,
      );

      if (turn.assistantMessage) {
        return;
      }

      // The user turn must still exist (it was persisted before streaming). If it's gone
      // — e.g. the chat was deleted mid-stream — skip rather than hit an in_reply_to FK error.
      if (!turn.userMessage) {
        return;
      }

      await messagesRepo.createAssistantReplyIfAbsent({
        chatId: input.chatId,
        parts: [{ type: 'text', text: input.text }],
        usage: { ...input.usage, finishReason: input.finishReason },
        inReplyTo: input.inReplyTo,
      });
    });
  }
}

/** Strip class prototypes / undefined so two structurally-equal shapes compare equal. */
function normalizeJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
