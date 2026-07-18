import { Injectable, Logger } from '@nestjs/common';
import {
  jsonSchema,
  tool,
  type ModelMessage as AiModelMessage,
  type ToolSet,
} from 'ai';

import { TenantDbService } from '../db/tenant-db.service';
import { type ModelClient } from '../models/model-client';
import { ModelsService } from '../models/models.service';
import {
  CompactionsRepository,
  MessagesRepository,
  findLiveWindow,
} from '../chats/chats-repository';
import {
  buildCompactionRequest,
  DEFAULT_KEEP_RECENT_MESSAGES,
  isPositiveFinite,
  normalizeCompactionSummary,
  planCompaction,
  planTransitionCompaction,
  requestFitsContextWindow,
  resolveCompactionThreshold,
} from './compaction';
import { type StoredMessage } from '../chats/context-builder';
import { buildTurnTelemetry } from '../chats/turn-telemetry';
import { type ModelToolDeclaration } from '../db/schema';
import { ModelContextSnapshotsRepository } from '../runs/model-context-snapshots.repository';
import { RunsRepository } from '../runs/runs-repository';

export class TransitionCompactionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TransitionCompactionError';
  }
}

function schemaOnlyTools(
  declarations: readonly ModelToolDeclaration[],
): ToolSet {
  return Object.fromEntries(
    declarations.map((declaration) => [
      declaration.id,
      tool({
        description: declaration.description,
        inputSchema: jsonSchema(declaration.inputSchema),
      }),
    ]),
  );
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
    private readonly models: ModelsService,
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
    toolDeclarations: readonly ModelToolDeclaration[];
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
    toolDeclarations: readonly ModelToolDeclaration[];
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

    // Read phase: latest compaction + the live window after it.
    const { compaction: previous, history } = await this.tenantDb.runAs(
      input.userId,
      (tx) => findLiveWindow(tx, input.chatId, input.userId),
    );

    const plan = planCompaction({
      history: history as StoredMessage[],
      previousSummary: previous?.summary,
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
        ? { summary: previous.summary, uptoSeq: previous.uptoSeq }
        : undefined,
      absorb: plan.absorb,
    });
    const startedAt = Date.now();
    const inference = await this.summarize({
      client: input.client,
      system: request.system,
      messages: request.messages as AiModelMessage[],
      toolDeclarations: input.toolDeclarations,
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
      latencyMs: Date.now() - startedAt,
      price: input.client.pricing,
    });

    // Write phase, with staleness guard: if another compaction landed while the
    // model ran, ours is based on a stale window — drop it, theirs stands.
    await this.tenantDb.runAs(input.userId, async (tx) => {
      const compactionsRepo = new CompactionsRepository(tx);

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

      await compactionsRepo.create({
        chatId: input.chatId,
        uptoSeq: plan.uptoSeq,
        parentId: previous?.id ?? null,
        summary,
        usage,
      });
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
    const state = await this.tenantDb.runAs(input.userId, async (tx) => {
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
          ...(previous ? { sinceSeq: previous.uptoSeq } : {}),
        },
      );
      const plan = planTransitionCompaction(
        history as StoredMessage[],
        input.triggeringUserSeq,
      );
      const sourceRun = await new RunsRepository(
        tx,
      ).findMostRecentBeforeMessageSequence(
        input.chatId,
        input.userId,
        input.triggeringUserSeq,
      );
      const sourceSnapshot = sourceRun
        ? await new ModelContextSnapshotsRepository(tx).findByOwnedRun(
            sourceRun.id,
            input.userId,
          )
        : undefined;

      return { previous, plan, sourceRun, sourceSnapshot };
    });
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

    let inference: Awaited<ReturnType<CompactionService['summarize']>>;
    try {
      inference = await this.summarize({
        client: sourceClient,
        system: request.system,
        messages: request.messages as AiModelMessage[],
        toolDeclarations: state.sourceSnapshot.toolDeclarations,
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
    input.abortSignal?.throwIfAborted();

    return this.tenantDb.runAs(input.userId, async (tx) => {
      const compactions = new CompactionsRepository(tx);
      const latest = await compactions.findLatestByChatId(
        input.chatId,
        input.userId,
      );
      input.abortSignal?.throwIfAborted();
      if (
        (latest?.id ?? null) !== (state.previous?.id ?? null) &&
        latest !== undefined &&
        latest.uptoSeq >= plan.uptoSeq
      ) {
        return 'superseded' as const;
      }
      const created = await compactions.createIfCutoffAbsent({
        chatId: input.chatId,
        uptoSeq: plan.uptoSeq,
        parentId: state.previous?.id ?? null,
        summary,
        usage: buildTurnTelemetry({
          usage: inference.usage,
          finishReason: inference.finishReason,
          status: 'completed',
          modelId: sourceClient.model,
          latencyMs: inference.latencyMs,
          price: sourceClient.pricing,
        }),
      });
      return created ? ('created' as const) : ('superseded' as const);
    });
  }

  private async summarize(input: {
    client: ModelClient;
    system: string;
    messages: AiModelMessage[];
    toolDeclarations: readonly ModelToolDeclaration[];
    abortSignal?: AbortSignal;
  }): Promise<{
    summary: string | null;
    usage: Awaited<ReturnType<ModelClient['streamText']>['usage']> | null;
    finishReason: Awaited<
      ReturnType<ModelClient['streamText']>['finishReason']
    > | null;
    latencyMs: number;
  }> {
    const tools = schemaOnlyTools(input.toolDeclarations);
    const startedAt = Date.now();
    const result = input.client.streamText({
      system: input.system,
      messages: input.messages,
      abortSignal: input.abortSignal,
      ...(input.toolDeclarations.length > 0 ? { tools } : {}),
      toolChoice: 'none',
    });
    const [text, toolCalls, usage, finishReason] = await Promise.all([
      Promise.resolve(result.text),
      Promise.resolve(
        (result as unknown as { toolCalls?: PromiseLike<unknown[]> }).toolCalls,
      ),
      Promise.resolve(result.usage).catch(() => null),
      Promise.resolve(result.finishReason).catch(() => null),
    ]);
    const providerReturnedToolCall =
      (Array.isArray(toolCalls) && toolCalls.length > 0) ||
      finishReason === 'tool-calls';
    return {
      summary: providerReturnedToolCall
        ? null
        : normalizeCompactionSummary(text),
      usage,
      finishReason,
      latencyMs: Date.now() - startedAt,
    };
  }
}
