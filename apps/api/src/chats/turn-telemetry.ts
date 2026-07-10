import type { FinishReason, LanguageModelUsage } from 'ai';
import pino from 'pino';

import {
  MODEL_TOKEN_PRICES_USD_PER_1M,
  type TokenPrice,
  type TokenPriceMap,
} from '../models/model-catalog';

// Re-exported so telemetry consumers/tests keep one import surface; the data
// itself lives in the model catalog (single source of per-model facts).
export { MODEL_TOKEN_PRICES_USD_PER_1M };
export type { TokenPrice, TokenPriceMap };

export type TurnStatus = 'completed' | 'aborted' | 'error';

export type TurnTelemetry = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  modelId: string;
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
  latencyMs: number;
  prices?: TokenPriceMap;
};

export type TurnTelemetryLogger = {
  info(payload: Record<string, unknown>): void;
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
    outputTokens,
    totalTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    modelId: input.modelId,
    latencyMs,
    finishReason: input.finishReason ?? null,
    status: input.status,
    costUsd: calculateCostUsd({
      modelId: input.modelId,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      prices: input.prices ?? MODEL_TOKEN_PRICES_USD_PER_1M,
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
      outputTokens: input.telemetry.outputTokens,
      totalTokens: input.telemetry.totalTokens,
      ...(input.telemetry.reasoningTokens !== undefined
        ? { reasoningTokens: input.telemetry.reasoningTokens }
        : {}),
      modelId: input.telemetry.modelId,
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
  modelId: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  prices: TokenPriceMap;
}): number | null {
  const price = input.prices[input.modelId];
  if (!price) {
    return null;
  }

  const cachedInputTokens = Math.min(
    input.cachedInputTokens,
    input.inputTokens,
  );
  const uncachedInputTokens = input.inputTokens - cachedInputTokens;
  const cachedInputUsdPer1M = price.cachedInputUsdPer1M ?? price.inputUsdPer1M;
  const cost =
    (uncachedInputTokens * price.inputUsdPer1M +
      cachedInputTokens * cachedInputUsdPer1M +
      input.outputTokens * price.outputUsdPer1M) /
    1_000_000;

  return Math.round(cost * 1_000_000_000_000) / 1_000_000_000_000;
}

function tokenCount(value: unknown): number {
  return optionalTokenCount(value) ?? 0;
}

function optionalTokenCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.round(value);
}
