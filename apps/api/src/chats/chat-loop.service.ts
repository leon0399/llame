import {
  ConflictException,
  Logger,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isDeepStrictEqual } from 'node:util';

import { TenantDbService } from '../db/tenant-db.service';
import { type Message, type Run } from '../db/schema';
import { type ModelClient } from '../models/model-client';
import { ModelsService } from '../models/models.service';
import { ConfigResolverService } from '../config-resolver/config-resolver.service';
import {
  ChatsRepository,
  isCompletedAssistantTurn,
  MessagesRepository,
} from './chats-repository';
import { type MessagePart } from './context-builder';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { type RunUserMessage } from '../runs/run-execution.service';
import { RunStreamBridgeService } from '../runs/run-stream-bridge';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { heartbeatStaleSeconds } from '../runs/run-queues';
import { RunDispatchService } from '../runs/run-dispatch.service';

export type ChatMessageInput = {
  id: string;
  parts: MessagePart[];
};

/**
 * ChatLoopService — the API side of a message turn (SPEC §9.5): validate,
 * store the message, create the run, enqueue it, and answer with the
 * run-event stream bridge. Execution happens exclusively in the queue
 * consumer (RunsWorkerService → RunExecutionService); there is no inline
 * request-thread execution path.
 */
@Injectable()
export class ChatLoopService {
  private readonly logger = new Logger(ChatLoopService.name);

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly models: ModelsService,
    private readonly config: ConfigService,
    private readonly bridge: RunStreamBridgeService,
    private readonly aborts: RunAbortRegistry,
    private readonly dispatch: RunDispatchService,
    private readonly configResolver: ConfigResolverService,
  ) {}

  async createMessageStream(input: {
    chatId: string;
    userId: string;
    message: ChatMessageInput;
    abortSignal?: AbortSignal;
  }): Promise<ReturnType<ModelClient['streamText']>> {
    // Throws MissingModelCredentialError (a domain error) when absent; the controller
    // maps it to HTTP 402. Resolved BEFORE any persistence, so a no-key request
    // creates nothing (#86). In worker mode the worker re-resolves for itself —
    // this early check preserves the fail-fast 402 UX either way.
    // Fail-fast 402 (#86): resolved BEFORE any persistence so a no-key
    // request creates nothing. The worker re-resolves for itself at pickup.
    await this.models.resolveModelCredential(input.userId);

    const { runId, userMessage, supersededRunIds } =
      await this.persistUserMessageAndRun(input);

    // A retry superseded its prior attempt(s) — if one is executing in this
    // process, abort its model call now (after the tx committed, so the
    // superseded run is already terminally cancelled: first writer wins).
    for (const supersededRunId of supersededRunIds) {
      this.aborts.abort(supersededRunId);
    }

    // Durable execution (#50): dispatch the run (queue mechanics, deadman
    // scheduling, and enqueue-failure handling live in RunDispatchService)
    // and answer with the run-event bridge. The HTTP connection is a viewport
    // onto the durable run — closing it does not kill the turn.
    await this.dispatch.dispatch({
      runId,
      chatId: input.chatId,
      userId: input.userId,
      userMessage,
    });

    const response = this.bridge.createUiMessageStreamResponse({
      runId,
      userId: input.userId,
      abortSignal: input.abortSignal,
    });
    // Adapter: the controller only calls toUIMessageStreamResponse() on the
    // result — satisfy that surface with the bridge's Response.
    return {
      toUIMessageStreamResponse: () => response,
    } as unknown as ReturnType<ModelClient['streamText']>;
  }

  private async persistUserMessageAndRun(input: {
    chatId: string;
    userId: string;
    message: ChatMessageInput;
  }): Promise<{
    runId: string;
    userMessage: RunUserMessage;
    supersededRunIds: string[];
  }> {
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
      // KNOWN GAP: two CONCURRENT requests for the same message id both reach
      // this point (the idempotency insert dedupes the message, not the run) —
      // two runs and two model streams for one turn. The fix is per-chat
      // single-flight, deliberately deferred to the heartbeat slice of #48:
      // without heartbeat, a crashed in-flight run would deadlock its chat.
      const runsRepo = new RunsRepository(tx);
      const eventsRepo = new RunEventsRepository(tx);

      // Effective-config snapshot (#46/#91, SPEC §6.4): resolved once, in the
      // SAME transaction as the message + run, stored on the run row —
      // execution reads the snapshot, so a config change mid-flight cannot
      // re-configure an already-created run.
      const configSnapshot = await this.configResolver.resolveForChatWithin(
        tx,
        { userId: input.userId, chatId: input.chatId },
      );

      // Retry supersedes prior attempts (#48 single-flight): cancelling every
      // non-terminal run for THIS message frees the chat's single-flight slot,
      // so a turn whose previous attempt died silently is always retryable.
      // Content equality was already enforced above, so at most one generation
      // for this message survives (the newest).
      const superseded = await runsRepo.cancelActiveRunsForMessage(
        userMessage.id,
        input.userId,
      );
      for (const stale of superseded) {
        await eventsRepo.append(stale.id, 'run.cancelled', {
          reason: 'superseded by retry',
        });
      }

      let run: Run;
      try {
        // Savepoint (nested tx): a unique violation must not poison the outer
        // transaction — the unwedge path below still needs it.
        run = await tx.transaction((inner) =>
          new RunsRepository(inner).create({
            chatId: input.chatId,
            messageId: userMessage.id,
            userId: input.userId,
            configSnapshot,
          }),
        );
      } catch (error) {
        if (!isInflightUniqueViolation(error)) {
          throw error;
        }

        // Per-chat single-flight (#48). Before rejecting, check whether the
        // blocking run is DEAD (stale heartbeat — e.g. a process crash before
        // its deadman fires): expire it and retry once, so a zombie can never
        // wedge the chat permanently. A blocker that VANISHED between our
        // insert and this read (it just finished) also falls through to the
        // retry — the slot is free, a 409 would be spurious.
        const blocking = await runsRepo.findActiveByChatId(
          input.chatId,
          input.userId,
        );
        const lastSign = blocking
          ? (blocking.heartbeatAt ?? blocking.startedAt ?? blocking.createdAt)
          : undefined;
        const staleMs = heartbeatStaleSeconds(this.config) * 1000;
        if (blocking && lastSign && Date.now() - lastSign.getTime() < staleMs) {
          throw new ConflictException(
            'Another run is already in flight for this chat',
          );
        }

        if (blocking) {
          const expired = await runsRepo.markFinished(
            blocking.id,
            input.userId,
            'expired',
            { message: 'Expired by a new message: no execution heartbeat.' },
          );
          if (expired) {
            await eventsRepo.append(blocking.id, 'run.expired', {
              status: 'expired',
              message: 'Expired by a new message: no execution heartbeat.',
            });
          }
        }
        try {
          run = await tx.transaction((inner) =>
            new RunsRepository(inner).create({
              chatId: input.chatId,
              messageId: userMessage.id,
              userId: input.userId,
              configSnapshot,
            }),
          );
        } catch (retryError) {
          if (isInflightUniqueViolation(retryError)) {
            throw new ConflictException(
              'Another run is already in flight for this chat',
            );
          }
          throw retryError;
        }
      }
      await eventsRepo.append(run.id, 'run.created', {
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
        supersededRunIds: superseded.map((stale) => stale.id),
      };
    });
  }
}

/** Strip class prototypes / undefined so two structurally-equal shapes compare equal. */
function normalizeJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Postgres unique_violation on the per-chat single-flight partial index.
 * Walks the cause chain — drizzle wraps the postgres.js error.
 */
function isInflightUniqueViolation(error: unknown): boolean {
  for (
    let current = error;
    typeof current === 'object' && current !== null;
    current = (current as { cause?: unknown }).cause
  ) {
    const candidate = current as {
      code?: unknown;
      constraint_name?: unknown;
      message?: unknown;
    };
    const mentionsIndex =
      (typeof candidate.constraint_name === 'string' &&
        candidate.constraint_name.includes('runs_chat_inflight_unique')) ||
      (typeof candidate.message === 'string' &&
        candidate.message.includes('runs_chat_inflight_unique'));
    if (candidate.code === '23505' && mentionsIndex) {
      return true;
    }
  }
  return false;
}
