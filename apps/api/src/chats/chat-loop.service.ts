import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LanguageModelUsage, ModelMessage as AiModelMessage } from 'ai';

import { TenantDbService } from '../db/tenant-db.service';
import { type Message } from '../db/schema';
import {
  MissingModelCredentialError,
  type ModelClient,
} from '../models/model-client';
import { ModelsService } from '../models/models.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import {
  buildContext,
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
    const credential = await this.resolveCredential(input.userId);
    const client = this.models.createOpenAIClient(credential);

    await this.assertPreconditions(
      input.chatId,
      input.userId,
      input.message.id,
    );

    const { context } = await this.persistUserAndBuildContext(input);

    return client.streamText({
      messages: context,
      abortSignal: input.abortSignal,
      onFinish: async ({ text, usage, finishReason }) => {
        if (input.abortSignal?.aborted) {
          return;
        }

        await this.persistAssistantMessage({
          chatId: input.chatId,
          userId: input.userId,
          inReplyTo: input.message.id,
          text,
          usage,
          finishReason,
        });
      },
    });
  }

  private async resolveCredential(userId: string): Promise<string> {
    try {
      return await this.models.resolveModelCredential(userId);
    } catch (error) {
      if (isMissingCredential(error)) {
        throw new HttpException(
          {
            statusCode: HttpStatus.PAYMENT_REQUIRED,
            error: 'Payment Required',
            message: 'No model credential configured.',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }

      throw error;
    }
  }

  private async assertPreconditions(
    chatId: string,
    userId: string,
    userMessageId: string,
  ): Promise<void> {
    await this.tenantDb.runAs(userId, async (tx) => {
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);

      const chat = await chatsRepo.findById(chatId, userId);
      if (!chat) {
        throw new NotFoundException(`Chat ${chatId} not found`);
      }

      const turn = await messagesRepo.findTurnState(
        chatId,
        userId,
        userMessageId,
      );
      if (turn.assistantMessage) {
        throw new ConflictException('Message turn already completed');
      }
    });
  }

  private async persistUserAndBuildContext(input: {
    chatId: string;
    userId: string;
    message: ChatMessageInput;
  }): Promise<{ userMessage: Message; context: AiModelMessage[] }> {
    try {
      return await this.persistUserAndBuildContextOnce(input);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      return this.persistUserAndBuildContextOnce(input);
    }
  }

  private async persistUserAndBuildContextOnce(input: {
    chatId: string;
    userId: string;
    message: ChatMessageInput;
  }): Promise<{ userMessage: Message; context: AiModelMessage[] }> {
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

      const userMessage =
        turn.userMessage ??
        (await messagesRepo.create({
          id: input.message.id,
          chatId: input.chatId,
          role: 'user',
          senderUserId: input.userId,
          parts: input.message.parts,
        }));

      const history = await messagesRepo.findByChatId(
        input.chatId,
        input.userId,
        { maxSeq: userMessage.seq },
      );
      const context = buildContext(history as StoredMessage[], {
        systemPrompt: CHAT_SYSTEM_PROMPT,
      }) as AiModelMessage[];

      return { userMessage, context };
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

      await messagesRepo.create({
        chatId: input.chatId,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: input.text }],
        usage: { ...input.usage, finishReason: input.finishReason },
        inReplyTo: input.inReplyTo,
      });
    });
  }
}

function isMissingCredential(
  error: unknown,
): error is MissingModelCredentialError {
  return (
    error instanceof MissingModelCredentialError ||
    (isRecord(error) && error.code === 'missing_model_credential')
  );
}

function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === '23505';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
