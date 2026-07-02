import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { ModelMessage as AiModelMessage } from 'ai';

import { TenantDbService } from '../db/tenant-db.service';
import { type Message } from '../db/schema';
import { type ModelClient } from '../models/model-client';
import { ModelsService } from '../models/models.service';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from './chats-repository';
import { CompactionService } from './compaction.service';
import {
  buildContext,
  DEFAULT_MAX_MESSAGES,
  type MessagePart,
  type StoredMessage,
} from './context-builder';
import {
  buildTurnTelemetry,
  emitCompletedTurnTelemetryLog,
  turnTelemetryLogger,
  type TurnTelemetry,
} from './turn-telemetry';

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
    private readonly compaction: CompactionService,
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

    const { system, messages } = await this.persistUserAndBuildContext(input);
    const streamStartedAt = Date.now();

    return client.streamText({
      system,
      messages,
      abortSignal: input.abortSignal,
      onError: async ({ error }) => {
        // The stream has already sent HTTP headers, so this error can't reach the NestJS
        // exception filter — logging here is the only way to surface model/network failures.
        this.logger.error(
          `Stream error for chat ${input.chatId}`,
          error instanceof Error ? error.stack : String(error),
        );

        const telemetry = buildTurnTelemetry({
          usage: null,
          finishReason: null,
          status: input.abortSignal?.aborted ? 'aborted' : 'error',
          model: client.model,
          provider: client.provider,
          latencyMs: Date.now() - streamStartedAt,
        });

        await this.recordAssistantTurn({
          chatId: input.chatId,
          userId: input.userId,
          inReplyTo: input.message.id,
          parts: [],
          telemetry,
        });
      },
      onFinish: async ({ text, usage, finishReason }) => {
        const telemetry = buildTurnTelemetry({
          usage,
          finishReason,
          status: input.abortSignal?.aborted
            ? 'aborted'
            : finishReason === 'error'
              ? 'error'
              : 'completed',
          model: client.model,
          provider: client.provider,
          latencyMs: Date.now() - streamStartedAt,
        });

        await this.recordAssistantTurn({
          chatId: input.chatId,
          userId: input.userId,
          inReplyTo: input.message.id,
          parts: [{ type: 'text', text }],
          telemetry,
        });

        // Post-turn compaction check (#57): fire-and-forget — never delays or
        // fails the finished turn; the NEXT turn reads summary + recent turns.
        if (telemetry.status === 'completed') {
          void this.compaction.maybeCompact({
            chatId: input.chatId,
            userId: input.userId,
            client,
          });
        }
      },
    });
  }

  private async persistUserAndBuildContext(input: {
    chatId: string;
    userId: string;
    message: ChatMessageInput;
  }): Promise<{ system: string; messages: AiModelMessage[] }> {
    return this.tenantDb.runAs(input.userId, async (tx) => {
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);

      // First message creates the chat (#86): the client supplies the id (routing +
      // idempotency); the owner is always the session user. If the chat is absent, upsert
      // it; a conflict means the id is already taken — by us (a concurrent first send) or by
      // another tenant. Re-query to disambiguate: our own row becomes visible (relies on the
      // default READ COMMITTED seeing the concurrent commit), a cross-tenant id stays
      // invisible → 404 (no existence leak). Mirrors the user-message path below.
      let chat = await chatsRepo.findById(input.chatId, input.userId);
      let createdByUs = false;
      if (!chat) {
        chat = await chatsRepo.createIfAbsent({
          id: input.chatId,
          ownerUserId: input.userId,
        });
        if (chat) {
          createdByUs = true;
        } else {
          chat = await chatsRepo.findById(input.chatId, input.userId);
        }
        if (!chat) {
          throw new NotFoundException(`Chat ${input.chatId} not found`);
        }
      }

      const turn = await messagesRepo.findTurnState(
        input.chatId,
        input.userId,
        input.message.id,
      );
      if (
        turn.assistantMessage &&
        isCompletedAssistantTurn(turn.assistantMessage)
      ) {
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
        if (
          retryTurn.assistantMessage &&
          isCompletedAssistantTurn(retryTurn.assistantMessage)
        ) {
          throw new ConflictException('Message turn already completed');
        }

        userMessage = retryTurn.userMessage;
      }

      if (!userMessage) {
        throw new ConflictException('Message id already exists');
      }

      // Mark chat activity so it sorts to the top of the chat list (findByOwner). Skip only
      // when THIS turn inserted the chat — its updatedAt is already now(), so touching again
      // is a redundant write. A request that found the chat (pre-existing, or created by a
      // concurrent same-tenant race that this one lost) still touches it.
      if (!createdByUs) {
        await chatsRepo.touch(input.chatId, input.userId);
      }

      // Lineage-based compaction (#57): superseded turns (seq <= uptoSeq) are
      // represented by the summary; only the live window is read back.
      const compactionsRepo = new CompactionsRepository(tx);
      const compaction = await compactionsRepo.findLatestByChatId(
        input.chatId,
        input.userId,
      );

      const history = await messagesRepo.findByChatId(
        input.chatId,
        input.userId,
        {
          maxSeq: userMessage.seq,
          ...(compaction ? { sinceSeq: compaction.uptoSeq } : {}),
          limit: DEFAULT_MAX_MESSAGES,
        },
      );
      const { system, messages } = buildContext(history as StoredMessage[], {
        systemPrompt: CHAT_SYSTEM_PROMPT,
        maxMessages: DEFAULT_MAX_MESSAGES,
        ...(compaction
          ? {
              compaction: {
                summary: compaction.summary,
                uptoSeq: compaction.uptoSeq,
              },
            }
          : {}),
      });

      return { system, messages: messages as AiModelMessage[] };
    });
  }

  private async recordAssistantTurn(input: {
    chatId: string;
    userId: string;
    inReplyTo: string;
    parts: MessagePart[];
    telemetry: TurnTelemetry;
  }): Promise<void> {
    try {
      const assistantMessage = await this.persistAssistantMessage(input);

      if (assistantMessage) {
        emitCompletedTurnTelemetryLog(turnTelemetryLogger, {
          chatId: input.chatId,
          messageId: assistantMessage.id,
          inReplyTo: input.inReplyTo,
          telemetry: input.telemetry,
          onError: (error) => {
            this.logger.error(
              `Failed to emit assistant turn telemetry for chat ${input.chatId}`,
              error instanceof Error ? error.stack : String(error),
            );
          },
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to persist assistant turn for chat ${input.chatId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async persistAssistantMessage(input: {
    chatId: string;
    userId: string;
    inReplyTo: string;
    parts: MessagePart[];
    telemetry: TurnTelemetry;
  }): Promise<Message | undefined> {
    return this.tenantDb.runAs(input.userId, async (tx) => {
      const messagesRepo = new MessagesRepository(tx);
      const turn = await messagesRepo.findTurnState(
        input.chatId,
        input.userId,
        input.inReplyTo,
      );

      if (turn.assistantMessage) {
        if (isCompletedAssistantTurn(turn.assistantMessage)) {
          return undefined;
        }

        return messagesRepo.updateAssistantReply({
          id: turn.assistantMessage.id,
          chatId: input.chatId,
          inReplyTo: input.inReplyTo,
          parts: input.parts,
          usage: input.telemetry,
        });
      }

      // The user turn must still exist (it was persisted before streaming). If it's gone
      // — e.g. the chat was deleted mid-stream — skip rather than hit an in_reply_to FK error.
      if (!turn.userMessage) {
        return undefined;
      }

      return messagesRepo.createAssistantReplyIfAbsent({
        chatId: input.chatId,
        parts: input.parts,
        usage: input.telemetry,
        inReplyTo: input.inReplyTo,
      });
    });
  }
}

/** Strip class prototypes / undefined so two structurally-equal shapes compare equal. */
function normalizeJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function isCompletedAssistantTurn(message: Message): boolean {
  const usage = message.usage;
  if (typeof usage !== 'object' || usage === null || !('status' in usage)) {
    return true;
  }

  return (usage as { status?: unknown }).status === 'completed';
}
