import {
  ConflictException,
  Logger,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { TenantDbService } from '../db/tenant-db.service';
import { type Message, type Run } from '../db/schema';
import { SearchReindexDispatchService } from '../search/search-reindex-dispatch.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { type ModelClient } from '../models/model-client';
import { ModelsService } from '../models/models.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
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
    private readonly instanceConfig: InstanceConfigService,
    private readonly bridge: RunStreamBridgeService,
    private readonly aborts: RunAbortRegistry,
    private readonly dispatch: RunDispatchService,
    private readonly reindexDispatch: SearchReindexDispatchService,
  ) {}

  async createMessageStream(input: {
    chatId: string;
    userId: string;
    modelId: string;
    message: ChatMessageInput;
    abortSignal?: AbortSignal;
  }): Promise<ReturnType<ModelClient['streamText']>> {
    this.models.validateModelSelection(input.modelId);

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
      modelId: input.modelId,
      userMessage,
    });

    // Keep search fresh for the user's own just-sent message (#195). Best-effort
    // and post-commit — a failed enqueue never fails the turn; the sweep repairs.
    await this.reindexDispatch.enqueueChatReindex(input.chatId, input.userId);

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
    modelId: string;
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
      if (turn.userMessage || turn.assistantMessage) {
        throw new ConflictException('Message id already exists');
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
        throw new ConflictException('Message id already exists');
      }

      // Mark chat activity so it sorts to the top of the chat list (findByOwner). Skip only
      // when THIS turn inserted the chat — its updatedAt is already now(), so touching again
      // is a redundant write. A request that found the chat (pre-existing, or created by a
      // concurrent same-tenant race that this one lost) still touches it.
      if (!createdByUs) {
        await chatsRepo.touch(input.chatId, input.userId);
      }

      // Durable run (#48): every accepted user message becomes exactly one run
      // (SPEC §9.3). The run row + run.created land in the SAME transaction as
      // the user message, so a message can never exist without its execution
      // record. Reusing a message id is rejected above; retries are a separate
      // feature, not implicit idempotency.
      const runsRepo = new RunsRepository(tx);
      const eventsRepo = new RunEventsRepository(tx);

      // Defensive cleanup for impossible legacy state: a freshly inserted
      // message should have no older active runs, but if dev data violates that
      // invariant, canceling them preserves the per-chat single-flight slot.
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
            modelId: input.modelId,
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
        const staleMs =
          heartbeatStaleSeconds(this.instanceConfig.config) * 1000;
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
              modelId: input.modelId,
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
