import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import { assertNotArchived } from '../db/assert-not-archived';
import { type Message, type Run } from '../db/schema';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { McpRuntimeService } from '../mcp/mcp-runtime.service';
import { type ModelClient } from '../models/model-client';
import {
  ModelsService,
  type ModelSelectionValidator,
} from '../models/models.service';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from './chats-repository';
import { type MessagePart } from './context-builder';
import { RunAbortRegistry, type RunAborter } from '../runs/run-abort-registry';
import { type RunUserMessage } from '../runs/run-execution.service';
import {
  RunStreamBridgeService,
  type RunStreamResponder,
} from '../runs/run-stream-bridge';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { stuckRunThresholdMs } from '../runs/run-queues';
import {
  PersonalizationService,
  type PromptUserResolver,
} from '../personalization/personalization.service';
import {
  RunDispatchService,
  type RunDispatcher,
} from '../runs/run-dispatch.service';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import {
  resolveEffectiveContext,
  type EffectiveContextSnapshotInput,
} from '../runs/effective-context-resolver';
import { ModelContextSnapshotsRepository } from '../runs/model-context-snapshots.repository';
import { type TurnToolCandidate } from '../tools/turn-tool-catalog';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import {
  createModelSwitchPart,
  sanitizeClientMessageParts,
} from './model-context-part';
import { createToolAvailabilityPart } from './tool-availability-part';
import {
  MemoryService,
  type MemorySettingsBindingResolver,
  type MemorySettingsResolver,
} from '../memory/memory.service';
import {
  createRecencyDigestDeltaPart,
  createRecencyDigestSupersessionPart,
} from './recency-digest-part';
import {
  deriveRecencyDigestDelta,
  RecencyDigestService,
  type RecencyDigestResolution,
  type RecencyDigestResolver,
} from './recency-digest.service';

type RuntimeCatalogSnapshotter = Pick<McpRuntimeService, 'snapshotCandidates'>;

export type ChatMessageInput = {
  id: string;
  parts: MessagePart[];
};

type ChatMessageStream = Pick<
  ReturnType<ModelClient['streamText']>,
  'toUIMessageStreamResponse'
>;

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
    // Each annotation below carries no DI metadata of its own (#268 — the
    // narrow capability type erases to `Object` at runtime), so the token is
    // explicit.
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(ModelsService)
    private readonly models: ModelSelectionValidator,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    @Inject(RunStreamBridgeService)
    private readonly bridge: RunStreamResponder,
    @Inject(RunAbortRegistry)
    private readonly aborts: RunAborter,
    @Inject(RunDispatchService)
    private readonly dispatch: RunDispatcher,
    @Inject(PersonalizationService)
    private readonly personalization: PromptUserResolver,
    private readonly systemPrompts: SystemPromptsService,
    @Inject(McpRuntimeService)
    private readonly mcpRuntime: RuntimeCatalogSnapshotter,
    @Inject(MemoryService)
    private readonly memory: MemorySettingsResolver &
      MemorySettingsBindingResolver,
    @Inject(RecencyDigestService)
    private readonly recencyDigest: RecencyDigestResolver,
  ) {}

  async createMessageStream(input: {
    chatId: string;
    userId: string;
    modelId: string;
    message: ChatMessageInput;
    abortSignal?: AbortSignal;
  }): Promise<ChatMessageStream> {
    const model = this.models.validateModelSelection(input.modelId);
    // Validate the message BEFORE any database work. A rejected message must
    // not cost a personalization transaction, and a personalization read that
    // fails must not turn a 400 into a 500 for input that was invalid anyway.
    const message = {
      ...input.message,
      parts: sanitizeClientMessageParts(input.message.parts),
    };
    if (message.parts.length === 0) {
      throw new BadRequestException('Message must contain a text part');
    }

    // Read the owner's per-user context in its own short transaction, out here
    // rather than inside the binding transaction below: that one holds the chat
    // row for its whole duration (see the lock-order note in
    // run-execution.service.ts#finishRun), and widening it to cover this read
    // would extend the hold for nothing. The cost is that an edit committed
    // between this read and the bind applies only to the next run — specified
    // and accepted.
    const user = await this.personalization.resolvePromptUser(input.userId);
    let digestCandidate: RecencyDigestResolution | undefined;
    try {
      if (
        (await this.memory.getForOwner(input.userId)).shareRecentChats === true
      ) {
        digestCandidate = await this.recencyDigest.resolveCandidate(
          input.userId,
          input.chatId,
        );
      }
    } catch {
      // Do not expose corpus text through diagnostics; only the failure class is useful.
      this.logger.error('recency_digest_resolution_failed');
    }
    const allowedToolRules = this.instanceConfig.config.tools.allowed;
    // This is a pure process-local projection of the last atomically published
    // runtime catalog. It neither waits for nor initiates remote I/O, and it is
    // intentionally resolved before the tenant binding transaction opens.
    const dynamicCandidates: readonly TurnToolCandidate[] =
      this.mcpRuntime.snapshotCandidates();
    const targetRunId = randomUUID();

    const { runId, userMessage, supersededRunIds } =
      await this.persistUserMessageAndRun({
        ...input,
        message,
        targetRunId,
        model,
        user,
        allowedToolRules,
        dynamicCandidates,
        digestCandidate,
      });

    // A retry superseded its prior attempt(s) — if one is executing in this
    // process, abort its model call now (after the tx committed, so the
    // superseded run is already terminally cancelled: first writer wins).
    for (const supersededRunId of supersededRunIds) {
      this.aborts.abort(supersededRunId);
    }

    // Durable execution (#50): dispatch the run (queue mechanics and
    // enqueue-failure handling live in RunDispatchService) and answer with
    // the run-event bridge. The HTTP connection is a viewport onto the
    // durable run — closing it does not kill the turn.
    await this.dispatch.dispatch({
      runId,
      chatId: input.chatId,
      userId: input.userId,
      modelId: input.modelId,
      userMessage,
    });

    // No inline index here: the assistant finalize re-indexes the whole chat
    // (incl. this message); an orphaned user-only turn (failed run) is caught
    // by the discovery sweep.

    const response = this.bridge.createUiMessageStreamResponse({
      runId,
      userId: input.userId,
      abortSignal: input.abortSignal,
    });
    // The controller consumes only this one-method stream surface; the
    // bridge's Response satisfies it without claiming a full streamText result.
    return {
      toUIMessageStreamResponse: () => response,
    };
  }

  private async persistUserMessageAndRun(input: {
    chatId: string;
    userId: string;
    modelId: string;
    message: ChatMessageInput;
    targetRunId: string;
    model: SystemModelCatalogEntry;
    user: Parameters<SystemPromptsService['render']>[1];
    allowedToolRules: readonly string[];
    dynamicCandidates: readonly TurnToolCandidate[];
    digestCandidate?: RecencyDigestResolution;
  }): Promise<{
    runId: string;
    userMessage: RunUserMessage;
    supersededRunIds: string[];
  }> {
    // Accepted-turn binding transaction. The prior accepted Run, active
    // compaction boundary, durable availability delta, frozen digest baseline,
    // rendered effective context, user message, immutable snapshot, Run, and
    // run.created event are bound here atomically. A rollback establishes no
    // digest or availability baseline. Compaction resets only this model-facing
    // comparison epoch; it never mutates the process-resident tool catalog.
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

      // Archive guard (chat-project-archive): refuse to send into an archived
      // chat. A freshly created chat (createdByUs) is never archived, so this
      // only fires for a pre-existing archived chat — sending does NOT unarchive.
      assertNotArchived(chat);

      const turn = await messagesRepo.findTurnState(
        input.chatId,
        input.userId,
        input.message.id,
      );
      if (turn.userMessage || turn.assistantMessage) {
        throw new ConflictException('Message id already exists');
      }

      // Serialize predecessor reads for accepted turns. The availability and
      // model-switch reminders compare against the immediately preceding Run,
      // so two transactions must not both read the same baseline and then
      // commit in sequence. A freshly inserted chat already carries this
      // transaction's row lock; an existing chat is locked by the activity
      // update before any predecessor state is read.
      if (!createdByUs) {
        // Take the post-lock row from the locking statement itself. `chat`
        // above is a pre-lock snapshot, and this transaction may have waited
        // here behind a compaction or a preceding turn that changed the very
        // digest columns read below: rendering from the stale copy binds an
        // outdated baseline, and deriving a delta from a stale told-set
        // re-announces chats another turn already announced. The comment above
        // is about ordering the READ of successor state after the lock — these
        // columns are that state.
        chat = (await chatsRepo.touch(input.chatId, input.userId)) ?? chat;
      }

      const hadDigestBaseline = chat.recencyDigestBaseline !== null;
      const shareRecentChats = input.digestCandidate
        ? await this.memory.getForOwnerForBinding(tx, input.userId)
        : undefined;
      if (chat.recencyDigestBaseline == null && input.digestCandidate) {
        // FOR SHARE serializes a consent withdrawal with this accepted binding.
        // The candidate was intentionally read outside this transaction, so a
        // stale true must be discarded instead of entering an immutable prompt.
        if (shareRecentChats?.shareRecentChats === true) {
          const bound = await chatsRepo.setRecencyDigestIfAbsent(
            input.chatId,
            input.userId,
            input.digestCandidate.baseline,
            input.digestCandidate.told,
          );
          chat =
            bound ?? (await chatsRepo.findById(input.chatId, input.userId))!;
        }
      }

      const digestDelta =
        hadDigestBaseline &&
        input.digestCandidate &&
        chat.recencyDigestTold !== null &&
        shareRecentChats?.shareRecentChats === true
          ? deriveRecencyDigestDelta({
              candidate: input.digestCandidate,
              told: chat.recencyDigestTold,
              pinnedChatIds: await chatsRepo.findPinnedChatIds(
                input.userId,
                chat.recencyDigestTold.map(({ chatId }) => chatId),
              ),
            })
          : null;

      let systemPrompt: string;
      try {
        systemPrompt = this.systemPrompts.render(
          input.model,
          input.user,
          chat.recencyDigestBaseline ?? undefined,
        );
      } catch (error) {
        if (chat.recencyDigestBaseline === null) throw error;
        this.logger.error('recency_digest_render_failed');
        throw new Error('Failed to render system prompt');
      }
      const effectiveContext: EffectiveContextSnapshotInput =
        await resolveEffectiveContext({
          model: input.model,
          systemPrompt,
          allowedToolRules: input.allowedToolRules,
          callTimeoutSeconds:
            this.instanceConfig.config.tools.callTimeoutSeconds,
          dynamicCandidates: input.dynamicCandidates,
        });

      let userMessage: Message | undefined = turn.userMessage;
      const runsRepo = new RunsRepository(tx);
      const previousRun = await runsRepo.findMostRecentByChatMessageSequence(
        input.chatId,
        input.userId,
      );
      const snapshotsRepo = new ModelContextSnapshotsRepository(tx);
      const previousSnapshot = previousRun
        ? await snapshotsRepo.findByOwnedRun(previousRun.id, input.userId)
        : undefined;
      const activeCompaction = previousRun
        ? await new CompactionsRepository(tx).findLatestByChatId(
            input.chatId,
            input.userId,
          )
        : undefined;
      const startsDisclosureEpoch =
        !previousSnapshot ||
        (activeCompaction !== undefined &&
          previousRun !== undefined &&
          activeCompaction.createdAt > previousRun.createdAt);
      const digestRebaked =
        activeCompaction !== undefined &&
        previousRun !== undefined &&
        chat.recencyDigestRebakedFrom === activeCompaction.id &&
        activeCompaction.createdAt > previousRun.createdAt;
      const availabilityPart = createToolAvailabilityPart({
        runId: input.targetRunId,
        current: effectiveContext.toolAvailabilityManifest,
        ...(!startsDisclosureEpoch
          ? { previous: previousSnapshot.toolAvailabilityManifest }
          : {}),
      });
      const modelSwitchPart =
        previousRun && previousRun.modelId !== input.modelId
          ? createModelSwitchPart({
              fromModelId: previousRun.modelId,
              toModelId: input.modelId,
              runId: input.targetRunId,
            })
          : undefined;
      const digestDeltaPart = digestDelta
        ? createRecencyDigestDeltaPart({
            runId: input.targetRunId,
            entries: digestDelta.entries,
            pinChanges: digestDelta.pinChanges,
          })
        : undefined;
      // Compaction is the one context boundary that re-bakes the digest. A
      // model switch changes only the provider reading unchanged history, so
      // refreshing there would silently change what the assistant knows.
      const digestSupersessionPart =
        digestRebaked &&
        chat.recencyDigestBaseline !== null &&
        shareRecentChats?.shareRecentChats === true
          ? createRecencyDigestSupersessionPart({ runId: input.targetRunId })
          : undefined;
      const messageParts = [
        ...(modelSwitchPart ? [modelSwitchPart] : []),
        ...(availabilityPart ? [availabilityPart] : []),
        ...(digestSupersessionPart ? [digestSupersessionPart] : []),
        ...(digestDeltaPart ? [digestDeltaPart] : []),
        ...input.message.parts,
      ];

      if (!userMessage) {
        userMessage = await messagesRepo.createUserMessageIfAbsent({
          id: input.message.id,
          chatId: input.chatId,
          senderUserId: input.userId,
          parts: messageParts,
        });
      }

      if (!userMessage) {
        throw new ConflictException('Message id already exists');
      }
      if (digestDelta) {
        await chatsRepo.updateRecencyDigestTold(
          input.chatId,
          input.userId,
          digestDelta.told,
        );
      }

      // Durable run (#48): every accepted user message becomes exactly one run
      // (SPEC §9.3). The run row + run.created land in the SAME transaction as
      // the user message, so a message can never exist without its execution
      // record. Reusing a message id is rejected above; retries are a separate
      // feature, not implicit idempotency.
      const eventsRepo = new RunEventsRepository(tx);
      const snapshot = await snapshotsRepo.createOrReuse(
        input.userId,
        effectiveContext,
      );

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
            id: input.targetRunId,
            chatId: input.chatId,
            messageId: userMessage.id,
            userId: input.userId,
            modelId: input.modelId,
            modelContextSnapshotId: snapshot.id,
          }),
        );
      } catch (error) {
        if (!isInflightUniqueViolation(error)) {
          throw error;
        }

        // Per-chat single-flight (#48; durable-run-workers D7). A blocker that
        // VANISHED between our insert and this read (it just finished) falls
        // through to the retry below — the slot is free, a 409 would be
        // spurious. A live blocker 409s. But a blocker that is STUCK — its last
        // sign of life older than the longest a real run could take (the
        // in-process wall-clock budget + one heartbeat window) — is expired
        // here and the create retried, because the job-queue can only recover
        // an ACTIVE job: a run whose pg-boss job was never created (a crash
        // between the run-row commit and enqueue) or never picked up (a worker
        // outage) has no job to time out / retry / dead-letter, so without this
        // it would wedge the chat forever. `markStarted` stamps a fresh
        // `startedAt` on every (re)claim, so a run pg-boss is actively
        // re-executing keeps a recent sign of life and is NOT expired here.
        const blocking = await runsRepo.findActiveByChatId(
          input.chatId,
          input.userId,
        );
        if (blocking) {
          const lastSign = blocking.startedAt ?? blocking.createdAt;
          const stuckAfterMs = stuckRunThresholdMs(this.instanceConfig.config);
          if (Date.now() - lastSign.getTime() < stuckAfterMs) {
            throw new ConflictException(
              'Another run is already in flight for this chat',
            );
          }
          const message =
            'Expired by a new message: run stuck with no execution progress.';
          const expired = await runsRepo.markFinished(
            blocking.id,
            input.userId,
            'expired',
            { message },
          );
          if (expired) {
            await eventsRepo.append(blocking.id, 'run.expired', {
              status: 'expired',
              message,
            });
          }
        }
        try {
          run = await tx.transaction((inner) =>
            new RunsRepository(inner).create({
              id: input.targetRunId,
              chatId: input.chatId,
              messageId: userMessage.id,
              userId: input.userId,
              modelId: input.modelId,
              modelContextSnapshotId: snapshot.id,
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
export function isInflightUniqueViolation(error: unknown): boolean {
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
