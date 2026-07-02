import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isDeepStrictEqual } from 'node:util';

import { TenantDbService } from '../db/tenant-db.service';
import { type Message, type Run } from '../db/schema';
import { type ModelClient } from '../models/model-client';
import { ModelsService } from '../models/models.service';
import { QUEUE, type Queue } from '../queue/queue';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { type MessagePart } from './context-builder';
import { RunAbortRegistry } from './run-abort-registry';
import {
  isCompletedAssistantTurn,
  RunExecutionService,
  type RunUserMessage,
} from './run-execution.service';
import { RunStreamBridgeService } from './run-stream-bridge';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import {
  runExecutionMode,
  runTimeoutSeconds,
  RUN_TIMEOUTS_QUEUE,
  RUNS_QUEUE,
  type RunJob,
  type RunTimeoutJob,
} from './runs-worker.service';

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
  private queueReady: Promise<void> | undefined;

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly models: ModelsService,
    private readonly runExecution: RunExecutionService,
    private readonly config: ConfigService,
    private readonly bridge: RunStreamBridgeService,
    private readonly aborts: RunAbortRegistry,
    @Inject(QUEUE) private readonly queue: Queue,
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
    const credential = await this.models.resolveModelCredential(input.userId);
    const client = this.models.createOpenAIClient(credential);

    const { runId, userMessage, supersededRunIds } =
      await this.persistUserMessageAndRun(input);

    // A retry superseded its prior attempt(s) — if one is executing in this
    // process, abort its model call now (after the tx committed, so the
    // superseded run is already terminally cancelled: first writer wins).
    for (const supersededRunId of supersededRunIds) {
      this.aborts.abort(supersededRunId);
    }

    // Worker execution mode (#50, flag-gated): enqueue the run and answer with
    // the run-event bridge. The HTTP connection becomes a viewport onto the
    // durable run — closing it no longer kills the turn.
    if (runExecutionMode(this.config) === 'worker') {
      await this.ensureRunsQueue();
      await this.queue.enqueue<RunJob>(RUNS_QUEUE, {
        runId,
        chatId: input.chatId,
        userId: input.userId,
        userMessage,
      });
      // Per-run deadman (#48): a delayed job checks the run in after the
      // timeout — enqueued HERE so it exists even if no worker ever picks the
      // run up. Runs tenant-scoped at fire time; no cross-tenant reaper scan.
      await this.queue.enqueue<RunTimeoutJob>(
        RUN_TIMEOUTS_QUEUE,
        { runId, userId: input.userId },
        { startAfter: runTimeoutSeconds(this.config) },
      );

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

    return this.runExecution.executeRun({
      runId,
      chatId: input.chatId,
      userId: input.userId,
      userMessage,
      client,
      abortSignal: input.abortSignal,
    });
  }

  /** Publisher-side queue declarations, once per process (idempotent upsert). */
  private ensureRunsQueue(): Promise<void> {
    this.queueReady ??= Promise.all([
      this.queue.ensureQueue(RUNS_QUEUE),
      this.queue.ensureQueue(RUN_TIMEOUTS_QUEUE),
    ]).then(() => undefined);
    return this.queueReady;
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
      const runsRepo = new RunsRepository(tx);
      const eventsRepo = new RunEventsRepository(tx);

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
        run = await runsRepo.create({
          chatId: input.chatId,
          messageId: userMessage.id,
          userId: input.userId,
        });
      } catch (error) {
        // Per-chat single-flight (#48): another message's run is in flight for
        // this chat. The tx rolls back (nothing persisted); the client retries
        // once the active run finishes.
        if (isInflightUniqueViolation(error)) {
          throw new ConflictException(
            'Another run is already in flight for this chat',
          );
        }
        throw error;
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
