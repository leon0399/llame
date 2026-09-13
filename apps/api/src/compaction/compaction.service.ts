import { Inject, Injectable, Logger } from '@nestjs/common';

import { TenantDbService } from '../db/tenant-db.service';
import { type ModelClient } from '../models/model-client';
import {
  ModelsService,
  type ModelClientFactory,
} from '../models/models.service';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
  findLiveWindow,
} from '../chats/chats-repository';
import {
  buildCompactionRequest,
  buildCompactionReplacementHistory,
  buildCompanion,
  DEFAULT_KEEP_RECENT_MESSAGES,
  isPositiveFinite,
  planCompaction,
  planTransitionCompaction,
  requestFitsContextWindow,
  resolveCompactionThreshold,
  summarize,
} from './compaction';
import { type StoredMessage } from '../chats/context-builder';
import { buildTurnTelemetry } from '../chats/turn-telemetry';
import { type Message, type ModelToolDeclaration } from '../db/schema';
import { isRecord } from '@workspace/runtime-safety';
import { ModelContextSnapshotsRepository } from '../runs/model-context-snapshots.repository';
import { RunsRepository } from '../runs/runs-repository';
import {
  MemoryService,
  type MemorySettingsBindingResolver,
} from '../memory/memory.service';
import {
  RecencyDigestService,
  type RecencyDigestResolution,
  type RecencyDigestResolver,
} from '../chats/recency-digest.service';

export class TransitionCompactionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TransitionCompactionError';
  }
}

/**
 * Narrows a read history's `unknown[]` JSONB `parts` to `MessagePart[]`: each
 * part must be an object (the union's `Record<string, unknown>` fallback
 * arm), matching every other JSON-record boundary in this codebase. Malformed
 * (non-object) parts fail closed rather than silently coercing.
 */
export function toStoredMessages(
  history: ReadonlyArray<Message>,
): Array<StoredMessage> {
  return history.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (!isRecord(part)) {
        throw new Error(
          `Malformed message part in message ${message.id}: expected an object`,
        );
      }
      return part;
    }),
  }));
}

/**
 * CompactionService (#57) — orchestrates lineage-based context compaction.
 *
 * Runs AFTER a completed turn (fire-and-forget from the chat loop): the freshly
 * finished turn is durable, the user's response latency is unaffected, and the
 * NEXT turn reads summary + recent turns. Compaction therefore triggers before
 * the context limit is ever hit, not as a reaction to a failure. Running right
 * after the turn also lands inside the provider's prompt-cache TTL, which the
 * cache-aligned request shape (buildCompactionRequest) exploits.
 *
 * The model call deliberately happens OUTSIDE runAs: holding a transaction open
 * across a network round-trip would pin a connection for the stream's lifetime.
 * Read tx → model call → write tx, with a staleness re-check before the insert
 * (a concurrent compaction of the same chat wins; this one is discarded).
 */
@Injectable()
export class CompactionService {
  private readonly logger = new Logger(CompactionService.name);

  constructor(
    private readonly tenantDb: TenantDbService,
    // No DI metadata of its own (#268 — the narrow capability type erases to
    // `Object` at runtime), so the token is explicit.
    @Inject(ModelsService)
    private readonly models: ModelClientFactory,
    @Inject(MemoryService)
    private readonly memory: MemorySettingsBindingResolver,
    @Inject(RecencyDigestService)
    private readonly recencyDigest: RecencyDigestResolver,
  ) {}

  /**
   * Trigger threshold for the run's model (providers-and-models-as-code,
   * #167): the model's own `compactionThresholdTokens` override (config
   * `models[].compactionThresholdTokens`, carried on the executing client)
   * when present, else `contextWindowTokens x COMPACTION_WINDOW_RATIO`. No
   * instance-level override exists — compaction is model-driven, never an
   * instance knob.
   */
  private thresholdTokens(client: ModelClient): number {
    return resolveCompactionThreshold({
      explicitThresholdTokens: client.compactionThresholdTokens,
      contextWindowTokens: client.contextWindowTokens,
    });
  }

  /**
   * Compact the chat if its live context exceeds the token threshold.
   * Never throws — a compaction failure must not surface into the chat turn.
   *
   * `system` is the exact system prompt the finished turn used and
   * `lastTurnTotalTokens` its real reported usage: the former keeps the
   * summarization request prefix-cache-aligned with that turn, the latter is
   * the trigger signal (see compaction.ts).
   */
  async maybeCompact(input: {
    chatId: string;
    userId: string;
    client: ModelClient;
    system: string;
    toolDeclarations: ReadonlyArray<ModelToolDeclaration>;
    /** The triggering run's effort — see `summarize`. */
    effort?: string;
    lastTurnTotalTokens?: number;
  }): Promise<void> {
    try {
      await this.compactIfNeeded(input);
    } catch (error) {
      this.logger.error(
        `Compaction failed for chat ${input.chatId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async compactIfNeeded(input: {
    chatId: string;
    userId: string;
    client: ModelClient;
    system: string;
    toolDeclarations: ReadonlyArray<ModelToolDeclaration>;
    /** The triggering run's effort — see `summarize`. */
    effort?: string;
    lastTurnTotalTokens?: number;
  }): Promise<void> {
    const thresholdTokens = this.thresholdTokens(input.client);

    // Cheap out before any DB work: the turn's real usage is the same signal
    // planCompaction would prefer anyway, and it's already in hand. Only when
    // it's absent (provider reported nothing) does the estimate need history.
    if (
      isPositiveFinite(input.lastTurnTotalTokens) &&
      input.lastTurnTotalTokens < thresholdTokens
    ) {
      return;
    }

    // Read phase: latest compaction + the live window after it, plus the
    // chat's current contextRevision for the continuation staleness guard.
    const {
      compaction: previous,
      history,
      chatContextRevision,
    } = await this.tenantDb.runAs(input.userId, async (tx) => {
      const window = await findLiveWindow(tx, input.chatId, input.userId);
      const chat = await new ChatsRepository(tx).findById(
        input.chatId,
        input.userId,
      );
      return { ...window, chatContextRevision: chat?.contextRevision ?? 0 };
    });
    const sourceMaxSeq = history.at(-1)?.seq ?? 0;

    const plan = planCompaction({
      history: toStoredMessages(history),
      previousSummary: previous?.summary,
      previousReplacementHistory: previous?.replacementHistory,
      thresholdTokens,
      keepRecentMessages: DEFAULT_KEEP_RECENT_MESSAGES,
      measuredContextTokens: input.lastTurnTotalTokens,
    });
    if (!plan) {
      return;
    }

    // Model phase — outside any transaction.
    const request = buildCompactionRequest({
      system: input.system,
      previous: previous
        ? {
            summary: previous.summary,
            uptoSeq: previous.uptoSeq,
            replacementHistory: previous.replacementHistory,
          }
        : undefined,
      absorb: plan.absorb,
    });
    const startedAt = Date.now();
    const inference = await summarize({
      client: input.client,
      system: request.system,
      messages: request.messages,
      toolDeclarations: input.toolDeclarations,
      ...(input.effort !== undefined && { effort: input.effort }),
    });
    const summary = inference.summary;
    if (summary === null) {
      this.logger.warn(
        `Compaction summary came back empty for chat ${input.chatId}; skipping`,
      );
      return;
    }
    // Promise.resolve: fake/test clients may not expose usage/finishReason promises.
    const usage = buildTurnTelemetry({
      usage: inference.usage,
      finishReason: inference.finishReason,
      status: 'completed',
      modelId: input.client.model,
      ...(input.effort !== undefined && { effort: input.effort }),
      latencyMs: Date.now() - startedAt,
      price: input.client.pricing,
    });
    const replacementHistory = buildCompactionReplacementHistory({
      summary,
      previous: previous?.replacementHistory,
      absorb: plan.absorb,
    });
    let digestCandidate: RecencyDigestResolution | null = null;
    try {
      digestCandidate = await this.recencyDigest.resolveCandidate(
        input.userId,
        input.chatId,
      );
    } catch {
      // The checkpoint is safe without a refresh; do not log owner chat content.
      this.logger.error('recency_digest_resolution_failed');
    }

    // Write phase, with staleness guard: if another compaction landed while the
    // model ran OR a new turn advanced the continuation revision, ours is based
    // on a stale window — drop it, theirs stands.
    await this.tenantDb.runAs(input.userId, async (tx) => {
      const compactionsRepo = new CompactionsRepository(tx);
      const chatsRepo = new ChatsRepository(tx);

      const latest = await compactionsRepo.findLatestByChatId(
        input.chatId,
        input.userId,
      );
      if ((latest?.id ?? null) !== (previous?.id ?? null)) {
        this.logger.warn(
          `Concurrent compaction detected for chat ${input.chatId}; discarding this one`,
        );
        return;
      }

      // Lock order is chats-then-memory, matching the chat loop.
      const chat = await chatsRepo.touch(input.chatId, input.userId);

      // Continuation-revision staleness (#154): a new turn accepted while
      // inference ran would make our captured digest obsolete.
      if (chat && chat.contextRevision !== chatContextRevision) {
        this.logger.warn(
          `Continuation revision stale for chat ${input.chatId}; discarding compaction`,
        );
        return;
      }

      const shareRecentChats = await this.memory.getForOwnerForBinding(
        tx,
        input.userId,
      );

      // Advance the chat's contextRevision for the companion state.
      const nextRevision = (chat?.contextRevision ?? 0) + 1;
      await chatsRepo.advanceContextRevision(
        input.chatId,
        input.userId,
        nextRevision,
      );

      // Determine whether this compaction triggers a digest re-bake.
      const rebakes =
        chat?.recencyDigestBaseline != null &&
        digestCandidate !== null &&
        shareRecentChats.shareRecentChats;

      const compaction = await compactionsRepo.create({
        chatId: input.chatId,
        uptoSeq: plan.uptoSeq,
        parentId: previous?.id ?? null,
        summary,
        replacementHistory,
        usage,
        companion: buildCompanion(
          nextRevision,
          sourceMaxSeq,
          chat,
          rebakes && digestCandidate
            ? { baseline: digestCandidate.baseline, told: digestCandidate.told }
            : undefined,
        ),
      });

      // Self-referencing companion: this compaction IS the new active
      // checkpoint. Update after insert to satisfy the self-FK.
      await compactionsRepo.setSelfReferenceCompanion(compaction.id, rebakes);

      if (rebakes && digestCandidate) {
        await chatsRepo.setRecencyDigest({
          chatId: input.chatId,
          ownerUserId: input.userId,
          baseline: digestCandidate.baseline,
          told: digestCandidate.told,
          rebakedFrom: compaction.id,
        });
      }
    });

    this.logger.log(
      `Compacted chat ${input.chatId} up to seq ${plan.uptoSeq} (${plan.absorb.length} turns absorbed)`,
    );
  }

  /**
   * One pre-turn source-model compaction for a target request that does not fit.
   * Every read is owner-scoped; absence/incompatibility is a hard failure. A
   * concurrently committed checkpoint wins without error only when it reaches
   * at least this transition's cutoff. An earlier sibling does not invalidate
   * the already-generated complete-prefix summary.
   */
  async compactForTransition(input: {
    chatId: string;
    userId: string;
    triggeringUserSeq: number;
    reservedOutputTokens: number | null;
    abortSignal?: AbortSignal;
  }): Promise<'created' | 'superseded'> {
    input.abortSignal?.throwIfAborted();
    const state = await this.loadTransitionState(input);
    input.abortSignal?.throwIfAborted();

    if (!state.plan) {
      throw new TransitionCompactionError(
        'No completed assistant prefix is available for transition compaction.',
      );
    }
    if (!state.sourceRun || !state.sourceSnapshot) {
      throw new TransitionCompactionError(
        'No owned source run context is available for transition compaction.',
      );
    }
    const plan = state.plan;
    // Captured here, where the guard above has narrowed `sourceRun`: this is
    // the effort of the run whose model and system prompt the request reuses,
    // NOT the incoming turn's, which is not part of that prefix and was
    // validated against a different model's declared levels.
    const sourceEffort = state.sourceRun.effort ?? undefined;

    let sourceClient: ModelClient;
    try {
      sourceClient = this.models.createClient(state.sourceRun.modelId);
    } catch (error) {
      throw new TransitionCompactionError(
        `Source model '${state.sourceRun.modelId}' is unavailable for transition compaction.`,
        { cause: error },
      );
    }

    const request = buildCompactionRequest({
      system: state.sourceSnapshot.systemPrompt,
      previous: state.previous
        ? {
            summary: state.previous.summary,
            uptoSeq: state.previous.uptoSeq,
            replacementHistory: state.previous.replacementHistory,
          }
        : undefined,
      absorb: plan.absorb,
      mode: 'transition_up_to',
    });
    if (
      !requestFitsContextWindow({
        system: request.system,
        messages: request.messages,
        toolDeclarations: state.sourceSnapshot.toolDeclarations,
        contextWindowTokens: sourceClient.contextWindowTokens,
        reservedOutputTokens: input.reservedOutputTokens,
      })
    ) {
      throw new TransitionCompactionError(
        'The source model cannot fit transition compaction in one request.',
      );
    }

    let inference: Awaited<ReturnType<typeof summarize>>;
    try {
      inference = await summarize({
        client: sourceClient,
        system: request.system,
        messages: request.messages,
        toolDeclarations: state.sourceSnapshot.toolDeclarations,
        // Read off the source run this method already loaded, so passing the
        // incoming turn's effort by mistake is not expressible here.
        ...(sourceEffort !== undefined && { effort: sourceEffort }),
        abortSignal: input.abortSignal,
      });
    } catch (error) {
      if (input.abortSignal?.aborted) {
        throw error;
      }
      throw new TransitionCompactionError(
        'Source-model transition compaction failed.',
        { cause: error },
      );
    }
    if (inference.summary === null) {
      throw new TransitionCompactionError(
        'Source-model transition compaction returned no valid text summary.',
      );
    }
    const summary = inference.summary;
    const replacementHistory = buildCompactionReplacementHistory({
      summary,
      previous: state.previous?.replacementHistory,
      absorb: plan.absorb,
    });
    input.abortSignal?.throwIfAborted();

    return this.commitTransitionCompaction({
      chatId: input.chatId,
      userId: input.userId,
      abortSignal: input.abortSignal,
      previousId: state.previous?.id ?? null,
      uptoSeq: plan.uptoSeq,
      sourceMaxSeq: input.triggeringUserSeq,
      chatContextRevision: state.chatContextRevision,
      summary,
      replacementHistory,
      usage: buildTurnTelemetry({
        usage: inference.usage,
        finishReason: inference.finishReason,
        status: 'completed',
        modelId: sourceClient.model,
        ...(sourceEffort !== undefined && { effort: sourceEffort }),
        latencyMs: inference.latencyMs,
        price: sourceClient.pricing,
      }),
    });
  }

  /** Read phase of `compactForTransition`: the plan plus the source run whose
   * prompt prefix and model it will reuse — gathered in one transaction so
   * the plan and its source snapshot describe the same instant. */
  private async loadTransitionState(input: {
    chatId: string;
    userId: string;
    triggeringUserSeq: number;
  }) {
    return this.tenantDb.runAs(input.userId, async (tx) => {
      const compactions = new CompactionsRepository(tx);
      const previous = await compactions.findLatestByChatId(
        input.chatId,
        input.userId,
        { beforeSeq: input.triggeringUserSeq },
      );
      const history = await new MessagesRepository(tx).findByChatId(
        input.chatId,
        input.userId,
        {
          maxSeq: input.triggeringUserSeq - 1,
          ...(previous && { sinceSeq: previous.uptoSeq }),
        },
      );
      const plan = planTransitionCompaction(
        toStoredMessages(history),
        input.triggeringUserSeq,
      );
      const sourceRun = await new RunsRepository(
        tx,
      ).findMostRecentByChatMessageSequence(input.chatId, input.userId, {
        beforeSeq: input.triggeringUserSeq,
      });
      const sourceSnapshot = sourceRun
        ? await new ModelContextSnapshotsRepository(tx).findByOwnedRun(
            sourceRun.id,
            input.userId,
          )
        : undefined;
      const chat = await new ChatsRepository(tx).findById(
        input.chatId,
        input.userId,
      );
      return {
        previous,
        plan,
        sourceRun,
        sourceSnapshot,
        chatContextRevision: chat?.contextRevision ?? 0,
      };
    });
  }

  /** Write phase of `compactForTransition`: the staleness-guarded insert
   * with continuation state companion recording. */
  private async commitTransitionCompaction(params: {
    chatId: string;
    userId: string;
    abortSignal?: AbortSignal;
    previousId: string | null;
    uptoSeq: number;
    sourceMaxSeq: number;
    chatContextRevision: number;
    summary: string;
    replacementHistory: ReturnType<typeof buildCompactionReplacementHistory>;
    usage: ReturnType<typeof buildTurnTelemetry>;
  }): Promise<'created' | 'superseded'> {
    return this.tenantDb.runAs(params.userId, async (tx) => {
      const compactionsRepo = new CompactionsRepository(tx);
      const chatsRepo = new ChatsRepository(tx);
      const latest = await compactionsRepo.findLatestByChatId(
        params.chatId,
        params.userId,
      );
      params.abortSignal?.throwIfAborted();
      if (
        (latest?.id ?? null) !== params.previousId &&
        latest !== undefined &&
        latest.uptoSeq >= params.uptoSeq
      ) {
        return 'superseded' as const;
      }
      // Continuation-revision staleness (#154).
      const chat = await chatsRepo.touch(params.chatId, params.userId);
      if (chat && chat.contextRevision !== params.chatContextRevision) {
        return 'superseded' as const;
      }
      const nextRevision = (chat?.contextRevision ?? 0) + 1;
      await chatsRepo.advanceContextRevision(
        params.chatId,
        params.userId,
        nextRevision,
      );
      const created = await compactionsRepo.createIfCutoffAbsent({
        chatId: params.chatId,
        uptoSeq: params.uptoSeq,
        parentId: params.previousId,
        summary: params.summary,
        replacementHistory: params.replacementHistory,
        usage: params.usage,
        companion: buildCompanion(nextRevision, params.sourceMaxSeq, chat),
      });
      if (created) {
        await compactionsRepo.setSelfReferenceCompanion(created.id, false);
      }
      return created ? ('created' as const) : ('superseded' as const);
    });
  }
}

/**
 * The narrow capability `RunExecutionService` needs (#268) — narrower than
 * the whole service. A test double implements exactly these two methods,
 * never a partial `CompactionService` cast.
 */
export type CompactionCapability = Pick<
  CompactionService,
  'maybeCompact' | 'compactForTransition'
>;
