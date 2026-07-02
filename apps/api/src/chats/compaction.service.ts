import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ModelMessage as AiModelMessage } from 'ai';

import { TenantDbService } from '../db/tenant-db.service';
import { type ModelClient } from '../models/model-client';
import { CompactionsRepository, MessagesRepository } from './chats-repository';
import {
  buildCompactionRequest,
  DEFAULT_COMPACTION_TOKEN_THRESHOLD,
  DEFAULT_KEEP_RECENT_MESSAGES,
  planCompaction,
} from './compaction';
import { type StoredMessage } from './context-builder';
import { buildTurnTelemetry } from './turn-telemetry';

/**
 * CompactionService (#57) — orchestrates lineage-based context compaction.
 *
 * Runs AFTER a completed turn (fire-and-forget from the chat loop): the freshly
 * finished turn is durable, the user's response latency is unaffected, and the
 * NEXT turn reads summary + recent turns. Compaction therefore triggers before
 * the context limit is ever hit, not as a reaction to a failure.
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

  private thresholdTokens(): number {
    const raw = Number(this.config.get<string>('COMPACTION_TOKEN_THRESHOLD'));
    return Number.isFinite(raw) && raw > 0
      ? raw
      : DEFAULT_COMPACTION_TOKEN_THRESHOLD;
  }

  /**
   * Compact the chat if its live window exceeds the token threshold.
   * Never throws — a compaction failure must not surface into the chat turn.
   */
  async maybeCompact(input: {
    chatId: string;
    userId: string;
    client: ModelClient;
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
  }): Promise<void> {
    // Read phase: latest compaction + the live window after it.
    const { previous, history } = await this.tenantDb.runAs(
      input.userId,
      async (tx) => {
        const compactionsRepo = new CompactionsRepository(tx);
        const messagesRepo = new MessagesRepository(tx);

        const previous = await compactionsRepo.findLatestByChatId(
          input.chatId,
          input.userId,
        );
        const history = await messagesRepo.findByChatId(
          input.chatId,
          input.userId,
          previous ? { sinceSeq: previous.uptoSeq } : undefined,
        );

        return { previous, history };
      },
    );

    const plan = planCompaction({
      history: history as StoredMessage[],
      previousSummary: previous?.summary,
      thresholdTokens: this.thresholdTokens(),
      keepRecentMessages: DEFAULT_KEEP_RECENT_MESSAGES,
    });
    if (!plan) {
      return;
    }

    // Model phase — outside any transaction.
    const request = buildCompactionRequest({
      previousSummary: previous?.summary,
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
      model: input.client.model,
      provider: input.client.provider,
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
