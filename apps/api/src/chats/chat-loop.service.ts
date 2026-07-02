import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';

import { TenantDbService } from '../db/tenant-db.service';
import { type Message } from '../db/schema';
import { type ModelClient } from '../models/model-client';
import { ModelsService } from '../models/models.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { type MessagePart } from './context-builder';
import {
  isCompletedAssistantTurn,
  RunExecutionService,
  type RunUserMessage,
} from './run-execution.service';
import { RunEventsRepository, RunsRepository } from './runs-repository';

export type ChatMessageInput = {
  id: string;
  parts: MessagePart[];
};

/**
 * ChatLoopService — the API side of a message turn (SPEC §9.5): validate,
 * store the message, create the run, then hand execution to
 * RunExecutionService. Today execution still happens on the request thread
 * (the returned stream feeds the HTTP response); the worker move (#50) swaps
 * that hand-off for an enqueue without touching the steps here.
 */
@Injectable()
export class ChatLoopService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly models: ModelsService,
    private readonly runExecution: RunExecutionService,
  ) {}

  async createMessageStream(input: {
    chatId: string;
    userId: string;
    message: ChatMessageInput;
    abortSignal?: AbortSignal;
  }): Promise<ReturnType<ModelClient['streamText']>> {
    // Throws MissingModelCredentialError (a domain error) when absent; the controller
    // maps it to HTTP 402. Resolved BEFORE any persistence, so a no-key request
    // creates nothing (#86).
    const credential = await this.models.resolveModelCredential(input.userId);
    const client = this.models.createOpenAIClient(credential);

    const { runId, userMessage } = await this.persistUserMessageAndRun(input);

    return this.runExecution.executeRun({
      runId,
      chatId: input.chatId,
      userId: input.userId,
      userMessage,
      client,
      abortSignal: input.abortSignal,
    });
  }

  private async persistUserMessageAndRun(input: {
    chatId: string;
    userId: string;
    message: ChatMessageInput;
  }): Promise<{ runId: string; userMessage: RunUserMessage }> {
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

      // Durable run (#48): every user message becomes a run (SPEC §9.3). The
      // run row + run.created land in the SAME transaction as the user message,
      // so a message can never exist without its execution record. A retried
      // turn (aborted/error) creates a fresh run — one message, many attempts.
      const runsRepo = new RunsRepository(tx);
      const run = await runsRepo.create({
        chatId: input.chatId,
        messageId: userMessage.id,
        userId: input.userId,
      });
      await new RunEventsRepository(tx).append(run.id, 'run.created', {
        chatId: input.chatId,
        messageId: userMessage.id,
      });

      return {
        runId: run.id,
        userMessage: {
          id: userMessage.id,
          seq: userMessage.seq,
          parts: userMessage.parts as MessagePart[],
        },
      };
    });
  }
}

/** Strip class prototypes / undefined so two structurally-equal shapes compare equal. */
function normalizeJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
