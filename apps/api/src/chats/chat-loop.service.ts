import {
  BadRequestException,
  ConflictException,
  Logger,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isDeepStrictEqual } from 'node:util';

import { TenantDbService, type Db } from '../db/tenant-db.service';
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
    /** Selected model id (#76); undefined = caller default. */
    model?: string;
    abortSignal?: AbortSignal;
  }): Promise<ReturnType<ModelClient['streamText']>> {
    // Throws MissingModelCredentialError → 402 (absent) or ModelNotAvailableError
    // → 422 (unknown/unauthorized model). Resolved BEFORE any persistence, so a
    // no-key or bad-model request creates nothing (#86, #76). In worker mode the
    // worker re-resolves — this early check preserves the fail-fast UX either
    // way. Also fail-fasts UnsupportedProviderTypeError (#82) for an
    // adapter-less BYOK account, rather than enqueueing a run that can only
    // fail at pickup.
    const credential = await this.models.resolveForModel(
      input.userId,
      input.model,
    );
    const client = this.models.createModelClient(credential);

    const { runId, userMessage, supersededRunIds } =
      await this.persistUserMessageAndRun(input);

    return this.launchRun({
      runId,
      chatId: input.chatId,
      userId: input.userId,
      userMessage,
      supersededRunIds,
      client,
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
  }

  /**
   * Regenerate the chat's LAST assistant turn (SPEC — a distinct op from the
   * idempotent-retry `POST /messages`): drop the completed reply and re-run the
   * same user message. Supersede-in-place, no branching. Credential/model
   * resolution first (402/402 fail-fast), then a fresh run, then stream.
   */
  async regenerateLastTurn(input: {
    chatId: string;
    userId: string;
    model?: string;
    /** Edit & resubmit: overwrite the last user message before rewinding. */
    editUserMessage?: string;
    /** Pins the edit to the message the client saw (else 409). */
    editMessageId?: string;
    abortSignal?: AbortSignal;
  }): Promise<ReturnType<ModelClient['streamText']>> {
    const credential = await this.models.resolveForModel(
      input.userId,
      input.model,
    );
    const client = this.models.createModelClient(credential);

    const { runId, userMessage, supersededRunIds } =
      await this.prepareRegenerateRun(input);

    return this.launchRun({
      runId,
      chatId: input.chatId,
      userId: input.userId,
      userMessage,
      supersededRunIds,
      client,
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
  }

  /**
   * Establish a fresh run for the chat's last user turn by DELETING its
   * completed assistant reply (freeing the UNIQUE `in_reply_to` slot so the new
   * run's reply can persist — `recordAssistantTurn` is `onConflictDoNothing`).
   * Guards: no user turn → 404; no COMPLETED reply (turn in flight or none) →
   * 409 (the opposite of the submit retry guard). RLS scopes every read/write.
   */
  private async prepareRegenerateRun(input: {
    chatId: string;
    userId: string;
    editUserMessage?: string;
    editMessageId?: string;
  }): Promise<{
    runId: string;
    userMessage: RunUserMessage;
    supersededRunIds: string[];
  }> {
    const edited = input.editUserMessage?.trim();
    if (input.editUserMessage !== undefined && !edited) {
      // Whitespace-only edit: MinLength(1) passes it but an empty turn is
      // meaningless — reject rather than persist a blank user message.
      throw new BadRequestException('Edited message must not be empty');
    }

    return this.tenantDb.runAs(input.userId, async (tx) => {
      const messagesRepo = new MessagesRepository(tx);
      let userMessage = await messagesRepo.findLastUserMessage(
        input.chatId,
        input.userId,
      );
      if (!userMessage) {
        // Unknown/cross-tenant chat or a chat with no user turn — no existence
        // leak (RLS makes a cross-tenant chat indistinguishable from empty).
        throw new NotFoundException('No turn to regenerate');
      }

      const { assistantMessage } = await messagesRepo.findTurnState(
        input.chatId,
        input.userId,
        userMessage.id,
      );

      if (edited) {
        // Pin the edit to the message the client rendered it on: if a race made
        // a DIFFERENT message the last user turn (e.g. another tab sent one),
        // refuse rather than silently rewrite + delete the wrong message.
        if (input.editMessageId && input.editMessageId !== userMessage.id) {
          throw new ConflictException(
            'The last user message changed — reload and retry',
          );
        }
        // EDIT & resubmit: overwrite the user turn's text (owner- + role-scoped),
        // then drop its reply IF one exists. Unlike a plain regenerate, an edit
        // does NOT require a completed reply — you may fix + retry a turn that
        // errored or never replied. `updateUserMessageContent` returns undefined
        // only on an RLS/role miss, which can't happen for a row we just read
        // under the same tx, but we re-bind defensively.
        const updated = await messagesRepo.updateUserMessageContent(
          userMessage.id,
          input.chatId,
          edited,
        );
        if (updated) userMessage = updated;
        if (assistantMessage) {
          await messagesRepo.deleteById(assistantMessage.id, input.chatId);
        }
      } else {
        if (!assistantMessage || !isCompletedAssistantTurn(assistantMessage)) {
          // Nothing finished to replace: the turn is still generating (use stop),
          // or never produced a reply (send a new message instead).
          throw new ConflictException(
            'The last turn has no completed response to regenerate',
          );
        }
        // Drop the stale reply so the fresh run's reply is not swallowed by the
        // unique in_reply_to `onConflictDoNothing`. Then delegate to
        // startRunForUserMessage, whose OWN supersede is the single source of
        // truth for cancelling any racing in-flight run — its returned
        // supersededRunIds flow to launchRun's abort loop (which actually stops
        // the live model stream). A separate cancel call here would strand those
        // ids and leave a zombie generating (review finding).
        await messagesRepo.deleteById(assistantMessage.id, input.chatId);
      }

      return this.startRunForUserMessage(
        tx,
        input.chatId,
        input.userId,
        userMessage,
      );
    });
  }

  /**
   * Launch an already-created run: abort any superseded in-process attempts,
   * then either enqueue for the worker (default) and answer from the run-event
   * bridge, or execute inline (deprecated). Shared by the submit and
   * regenerate paths — identical once a run exists for the user message.
   */
  private async launchRun(input: {
    runId: string;
    chatId: string;
    userId: string;
    userMessage: RunUserMessage;
    supersededRunIds: string[];
    client: ModelClient;
    model?: string;
    abortSignal?: AbortSignal;
  }): Promise<ReturnType<ModelClient['streamText']>> {
    const {
      runId,
      chatId,
      userId,
      userMessage,
      supersededRunIds,
      client,
      model,
      abortSignal,
    } = input;
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
      ...(input.model !== undefined ? { model: input.model } : {}),
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

      return this.startRunForUserMessage(
        tx,
        input.chatId,
        input.userId,
        userMessage,
      );
    });
  }

  /**
   * Create + persist a fresh run for an already-established user message in
   * the caller's tx: the effective-config snapshot, single-flight supersede +
   * savepoint create (with the dead-run unwedge), and the run.created event.
   * Shared by the submit path (persistUserMessageAndRun) and regenerate — one
   * source of truth for the delicate per-chat single-flight concurrency.
   */
  private async startRunForUserMessage(
    tx: Db,
    chatId: string,
    userId: string,
    userMessage: Message,
  ): Promise<{
    runId: string;
    userMessage: RunUserMessage;
    supersededRunIds: string[];
  }> {
    // Durable run (#48): every user message becomes a run (SPEC §9.3). The
    // run row + run.created land in the SAME transaction as the user message,
    // so a message can never exist without its execution record. A retried
    // turn (aborted/error) creates a fresh run — one message, many attempts.
    const runsRepo = new RunsRepository(tx);
    const eventsRepo = new RunEventsRepository(tx);

    // Effective-config snapshot (#46/#91, SPEC §6.4): resolved once, in the
    // SAME transaction as the message + run, stored on the run row —
    // execution reads the snapshot, so a config change mid-flight cannot
    // re-configure an already-created run.
    const configSnapshot = await this.configResolver.resolveForChatWithin(tx, {
      userId: userId,
      chatId: chatId,
    });

    // Retry supersedes prior attempts (#48 single-flight): cancelling every
    // non-terminal run for THIS message frees the chat's single-flight slot,
    // so a turn whose previous attempt died silently is always retryable.
    // Content equality was already enforced above, so at most one generation
    // for this message survives (the newest).
    const superseded = await runsRepo.cancelActiveRunsForMessage(
      userMessage.id,
      userId,
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
          chatId: chatId,
          messageId: userMessage.id,
          userId: userId,
          configSnapshot,
        }),
      );
    } catch (error) {
      if (!isInflightUniqueViolation(error)) {
        throw error;
      }

      // Per-chat single-flight (#48). Before rejecting, check whether the
      // blocking run is DEAD (stale heartbeat — e.g. an inline-mode process
      // crash, which has no deadman): expire it and retry once, so a zombie
      // can never wedge the chat permanently (review finding).
      const blocking = await runsRepo.findActiveByChatId(chatId, userId);
      const lastSign = blocking
        ? (blocking.heartbeatAt ?? blocking.startedAt ?? blocking.createdAt)
        : undefined;
      const staleMs = heartbeatStaleSeconds(this.config) * 1000;
      if (!blocking || !lastSign || Date.now() - lastSign.getTime() < staleMs) {
        throw new ConflictException(
          'Another run is already in flight for this chat',
        );
      }

      await eventsRepo.append(blocking.id, 'run.failed', {
        status: 'expired',
        message: 'Expired by a new message: no execution heartbeat.',
      });
      await runsRepo.markFinished(blocking.id, userId, 'expired', {
        message: 'Expired by a new message: no execution heartbeat.',
      });
      try {
        run = await tx.transaction((inner) =>
          new RunsRepository(inner).create({
            chatId: chatId,
            messageId: userMessage.id,
            userId: userId,
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
      chatId: chatId,
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
