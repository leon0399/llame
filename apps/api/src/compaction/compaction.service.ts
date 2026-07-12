import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ModelMessage as AiModelMessage } from 'ai';

import { TenantDbService } from '../db/tenant-db.service';
import { type ModelClient } from '../models/model-client';
import {
  CompactionsRepository,
  findLiveWindow,
} from '../chats/chats-repository';
import {
  buildCompactionRequest,
  DEFAULT_KEEP_RECENT_MESSAGES,
  isPositiveFinite,
  planCompaction,
  resolveCompactionThreshold,
} from './compaction';
import { type StoredMessage } from '../chats/context-builder';
import { buildTurnTelemetry } from '../chats/turn-telemetry';

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
    private readonly config: ConfigService,
  ) {}

  /**
   * Trigger threshold for the run's model. Precedence: explicit override env
   * (COMPACTION_TOKEN_THRESHOLD) > operator-declared window env
   * (MODEL_CONTEXT_WINDOW_TOKENS) > the model's own context window (carried on
   * the client), each × the compaction ratio. Any unset or invalid env value
   * (empty, NaN, zero, negative) falls through to the model's window — there is
   * no unknown-window default, since every model declares its window.
   */
  private thresholdTokens(contextWindowTokens: number): number {
    return resolveCompactionThreshold({
      explicitThresholdTokens: positiveEnvNumber(
        this.config.get<string>('COMPACTION_TOKEN_THRESHOLD'),
      ),
      contextWindowTokens:
        positiveEnvNumber(
          this.config.get<string>('MODEL_CONTEXT_WINDOW_TOKENS'),
        ) ?? contextWindowTokens,
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
    lastTurnTotalTokens?: number;
  }): Promise<void> {
    const thresholdTokens = this.thresholdTokens(
      input.client.contextWindowTokens,
    );

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
    const result = input.client.streamText({
      system: request.system,
      // v0.1 flattened ModelMessage shape — same cast the chat loop applies.
      messages: request.messages as AiModelMessage[],
    });
    const summary = (await result.text).trim();
    if (summary.length === 0) {
      this.logger.warn(
        `Compaction summary came back empty for chat ${input.chatId}; skipping`,
      );
      return;
    }
    // Promise.resolve: fake/test clients may not expose usage/finishReason promises.
    const usage = buildTurnTelemetry({
      usage: (await Promise.resolve(result.usage).catch(() => null)) ?? null,
      finishReason:
        (await Promise.resolve(result.finishReason).catch(() => null)) ?? null,
      status: 'completed',
      modelId: input.client.model,
      latencyMs: Date.now() - startedAt,
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
}

/** Parse an env string to a positive finite number, or undefined when unusable. */
function positiveEnvNumber(raw: string | undefined): number | undefined {
  const value = Number(raw);

  return isPositiveFinite(value) ? value : undefined;
}
