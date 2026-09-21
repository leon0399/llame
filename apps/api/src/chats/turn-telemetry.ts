import type { FinishReason, LanguageModelUsage } from 'ai';
import pino from 'pino';

import type { TokenPrice } from '../models/model-catalog';
import { type UnknownRecord } from '@workspace/runtime-safety';

export type { TokenPrice };

export type TurnStatus = 'completed' | 'aborted' | 'error';

export type TurnTelemetry = {
  inputTokens: number;
  cachedInputTokens: number;
  /**
   * Provider-reported cache-creation tokens, bounded in order against
   * `inputTokens` (cache reads first, then writes at the remainder) so the
   * recorded counts are exactly the ones `costUsd` prices. Always numeric:
   * 0 when the provider reports no cache-creation count, never estimated.
   */
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  modelId: string;
  /**
   * The effort this call ran at, recorded wherever `modelId` is (see the
   * available-models spec). Absent — never null — when the run carried none.
   *
   * A receipt, not a derivation: like `costUsd`, it is never recomputed when
   * the model's declared levels or default change later.
   */
  effort?: string;
  latencyMs: number;
  finishReason: FinishReason | null;
  status: TurnStatus;
  costUsd: number | null;
};

export type BuildTurnTelemetryInput = {
  usage?: Partial<LanguageModelUsage> | null;
  finishReason?: FinishReason | null;
  status: TurnStatus;
  modelId: string;
  effort?: string;
  latencyMs: number;
  /** The executing model's resolved pricing (`ModelClient.pricing`); absent means no configured price for this model. */
  price?: TokenPrice;
};

export type TurnTelemetryLogger = {
  info(payload: UnknownRecord): void;
};

export const turnTelemetryLogger = pino({
  name: 'turn-telemetry',
  enabled: process.env.NODE_ENV !== 'test',
});

export function buildTurnTelemetry(
  input: BuildTurnTelemetryInput,
): TurnTelemetry {
  const inputTokens = tokenCount(input.usage?.inputTokens);
  const cachedInputTokens = Math.min(
    tokenCount(input.usage?.cachedInputTokens),
    inputTokens,
  );
  // Cache-creation tokens the provider bills, read from the AI SDK's
  // normalized detail field every wire fills. Bounded at what cache reads left
  // of the input total, the same way `cachedInputTokens` is bounded at the
  // input total, so an inconsistent provider report can never make the priced
  // subsets exceed the input they are subtracted from.
  const cacheWriteTokens = Math.min(
    tokenCount(input.usage?.inputTokenDetails?.cacheWriteTokens),
    inputTokens - cachedInputTokens,
  );
  const outputTokens = tokenCount(input.usage?.outputTokens);
  // Floor the total to the component sum: providers sometimes omit totalTokens (yielding 0)
  // even when input/output were consumed, which would under-report aggregate usage.
  const totalTokens = Math.max(
    tokenCount(input.usage?.totalTokens),
    inputTokens + outputTokens,
  );
  const reasoningTokens = optionalTokenCount(input.usage?.reasoningTokens);
  const latencyMs = Math.max(0, Math.round(input.latencyMs));

  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    totalTokens,
    ...(reasoningTokens !== undefined && { reasoningTokens }),
    modelId: input.modelId,
    ...(input.effort !== undefined && { effort: input.effort }),
    latencyMs,
    finishReason: input.finishReason ?? null,
    status: input.status,
    costUsd: calculateCostUsd({
      inputTokens,
      cachedInputTokens,
      cacheWriteTokens,
      outputTokens,
      price: input.price,
    }),
  };
}

export function emitCompletedTurnTelemetryLog(
  logger: TurnTelemetryLogger,
  input: {
    chatId: string;
    messageId: string;
    inReplyTo: string;
    telemetry: TurnTelemetry;
    onError?: (error: unknown) => void;
  },
): void {
  if (input.telemetry.status !== 'completed') {
    return;
  }

  try {
    logger.info({
      event: 'assistant_turn_completed',
      chatId: input.chatId,
      messageId: input.messageId,
      inReplyTo: input.inReplyTo,
      inputTokens: input.telemetry.inputTokens,
      cachedInputTokens: input.telemetry.cachedInputTokens,
      cacheWriteTokens: input.telemetry.cacheWriteTokens,
      outputTokens: input.telemetry.outputTokens,
      totalTokens: input.telemetry.totalTokens,
      ...(input.telemetry.reasoningTokens !== undefined && {
        reasoningTokens: input.telemetry.reasoningTokens,
      }),
      modelId: input.telemetry.modelId,
      ...(input.telemetry.effort !== undefined && {
        effort: input.telemetry.effort,
      }),
      latencyMs: input.telemetry.latencyMs,
      finishReason: input.telemetry.finishReason,
      status: input.telemetry.status,
      costUsd: input.telemetry.costUsd,
    });
  } catch (error) {
    input.onError?.(error);
  }
}

function calculateCostUsd(input: {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  price: TokenPrice | undefined;
}): number | null {
  const price = input.price;
  if (!price) {
    return null;
  }

  // Both cache subsets are re-bounded here, in order — reads at the input
  // total, writes at the remainder — so the uncached remainder can never go
  // negative and a cache-write token is charged exactly once: at the declared
  // cache-write rate when the entry has one, otherwise at the input rate.
  const cachedInputTokens = Math.min(
    input.cachedInputTokens,
    input.inputTokens,
  );
  const cacheWriteTokens = Math.min(
    input.cacheWriteTokens,
    input.inputTokens - cachedInputTokens,
  );
  const uncachedInputTokens =
    input.inputTokens - cachedInputTokens - cacheWriteTokens;
  const cachedInputUsdPer1M = price.cachedInputUsdPer1M ?? price.inputUsdPer1M;
  const cacheWriteUsdPer1M = price.cacheWriteUsdPer1M ?? price.inputUsdPer1M;
  const cost =
    (uncachedInputTokens * price.inputUsdPer1M +
      cachedInputTokens * cachedInputUsdPer1M +
      cacheWriteTokens * cacheWriteUsdPer1M +
      input.outputTokens * price.outputUsdPer1M) /
    1_000_000;

  return Math.round(cost * 1_000_000_000_000) / 1_000_000_000_000;
}

function tokenCount(value: number | undefined): number {
  return optionalTokenCount(value) ?? 0;
}

function optionalTokenCount(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.round(value);
}
