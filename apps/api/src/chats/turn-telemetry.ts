import type { FinishReason, LanguageModelUsage } from 'ai';
import pino from 'pino';

import type { TokenPrice } from '../models/model-catalog';
import type { BillingMode } from '../models/model-client';
import { type UnknownRecord } from '@workspace/runtime-safety';

export type { TokenPrice };

export type TurnStatus = 'completed' | 'aborted' | 'error';

export type TurnTelemetry = {
  inputTokens?: number;
  cachedInputTokens?: number;
  /**
   * Provider-reported cache-creation tokens, bounded in order against
   * `inputTokens` (cache reads first, then writes at the remainder) so the
   * recorded counts are exactly the ones `costUsd` prices. Per-request
   * telemetry uses 0 when the provider reports no cache-creation count; an
   * aggregate omits token counts when no request reports input or output.
   */
  cacheWriteTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
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
  costUsd?: number | null;
  billing?: BillingMode;
};

type PerRequestTurnTelemetry = TurnTelemetry &
  Required<
    Pick<
      TurnTelemetry,
      | 'inputTokens'
      | 'cachedInputTokens'
      | 'cacheWriteTokens'
      | 'outputTokens'
      | 'totalTokens'
      | 'costUsd'
    >
  >;

export type BuildTurnTelemetryInput = {
  usage?: Partial<LanguageModelUsage> | null;
  finishReason?: FinishReason | null;
  status: TurnStatus;
  modelId: string;
  effort?: string;
  latencyMs: number;
  /** The executing model's resolved pricing (`ModelClient.pricing`); absent means no configured price for this model. */
  price?: TokenPrice;
  billing?: BillingMode;
};

export type AggregateTurnTelemetryInput = Omit<
  BuildTurnTelemetryInput,
  'usage'
> & {
  receipts: ReadonlyArray<LanguageModelUsage>;
  stepCount?: number;
};

type AggregateTurnTelemetryTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  costUsd: number;
  hasReportedCounts: boolean;
  everyReceiptHasCounts: boolean;
  everyReceiptHasReasoning: boolean;
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
): PerRequestTurnTelemetry {
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

  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    totalTokens,
    ...(reasoningTokens !== undefined && { reasoningTokens }),
    modelId: input.modelId,
    ...(input.effort !== undefined && { effort: input.effort }),
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    finishReason: input.finishReason ?? null,
    status: input.status,
    costUsd: calculateCostUsd({
      inputTokens,
      cachedInputTokens,
      cacheWriteTokens,
      outputTokens,
      price: input.price,
    }),
    ...(input.billing !== undefined && { billing: input.billing }),
  };
}

export function aggregateTurnTelemetry(
  input: AggregateTurnTelemetryInput,
): TurnTelemetry & { complete: boolean } {
  const totals = aggregateReceiptTelemetry(input);
  return {
    ...(totals.hasReportedCounts && {
      inputTokens: totals.inputTokens,
      cachedInputTokens: totals.cachedInputTokens,
      cacheWriteTokens: totals.cacheWriteTokens,
      outputTokens: totals.outputTokens,
      totalTokens: totals.totalTokens,
    }),
    ...(totals.everyReceiptHasReasoning && {
      reasoningTokens: totals.reasoningTokens,
    }),
    modelId: input.modelId,
    ...(input.effort !== undefined && { effort: input.effort }),
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    finishReason: input.finishReason ?? null,
    status: input.status,
    ...(input.price === undefined
      ? { costUsd: null }
      : totals.hasReportedCounts && {
          costUsd:
            Math.round(totals.costUsd * 1_000_000_000_000) / 1_000_000_000_000,
        }),
    ...(input.billing !== undefined && { billing: input.billing }),
    complete:
      input.status === 'completed' &&
      totals.everyReceiptHasCounts &&
      (input.stepCount === undefined ||
        input.receipts.length >= input.stepCount),
  };
}

function aggregateReceiptTelemetry(
  input: AggregateTurnTelemetryInput,
): AggregateTurnTelemetryTotals {
  const totals: AggregateTurnTelemetryTotals = {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    hasReportedCounts: false,
    everyReceiptHasCounts: input.receipts.length > 0,
    everyReceiptHasReasoning: input.receipts.length > 0,
  };
  for (const receipt of input.receipts) {
    addReceiptTelemetry(totals, receipt, input);
  }
  return totals;
}

function addReceiptTelemetry(
  totals: AggregateTurnTelemetryTotals,
  receipt: LanguageModelUsage,
  input: AggregateTurnTelemetryInput,
): void {
  const hasInputTokens = optionalTokenCount(receipt.inputTokens) !== undefined;
  const hasOutputTokens =
    optionalTokenCount(receipt.outputTokens) !== undefined;
  totals.hasReportedCounts ||= hasInputTokens || hasOutputTokens;
  totals.everyReceiptHasCounts &&= hasInputTokens && hasOutputTokens;
  const receiptReasoningTokens = optionalTokenCount(receipt.reasoningTokens);
  if (receiptReasoningTokens === undefined) {
    totals.everyReceiptHasReasoning = false;
  } else {
    totals.reasoningTokens += receiptReasoningTokens;
  }

  const telemetry = buildTurnTelemetry({
    usage: receipt,
    finishReason: input.finishReason,
    status: input.status,
    modelId: input.modelId,
    ...(input.effort !== undefined && { effort: input.effort }),
    latencyMs: input.latencyMs,
    ...(input.price !== undefined && { price: input.price }),
    ...(input.billing !== undefined && { billing: input.billing }),
  });
  totals.inputTokens += telemetry.inputTokens;
  totals.cachedInputTokens += telemetry.cachedInputTokens;
  totals.cacheWriteTokens += telemetry.cacheWriteTokens;
  totals.outputTokens += telemetry.outputTokens;
  totals.totalTokens += telemetry.totalTokens;
  if (telemetry.costUsd !== null) {
    totals.costUsd += telemetry.costUsd;
  }
}

type CompletedTurnTelemetryLogInput = {
  chatId: string;
  messageId: string;
  inReplyTo: string;
  telemetry: TurnTelemetry;
  onError?: (error: unknown) => void;
};

export function emitCompletedTurnTelemetryLog(
  logger: TurnTelemetryLogger,
  input: CompletedTurnTelemetryLogInput,
): void {
  if (input.telemetry.status !== 'completed') {
    return;
  }

  try {
    logger.info(completedTurnTelemetryLogPayload(input));
  } catch (error) {
    input.onError?.(error);
  }
}

function completedTurnTelemetryLogPayload(
  input: CompletedTurnTelemetryLogInput,
): UnknownRecord {
  const telemetry = input.telemetry;
  return {
    event: 'assistant_turn_completed',
    chatId: input.chatId,
    messageId: input.messageId,
    inReplyTo: input.inReplyTo,
    ...(telemetry.inputTokens !== undefined && {
      inputTokens: telemetry.inputTokens,
    }),
    ...(telemetry.cachedInputTokens !== undefined && {
      cachedInputTokens: telemetry.cachedInputTokens,
    }),
    ...(telemetry.cacheWriteTokens !== undefined && {
      cacheWriteTokens: telemetry.cacheWriteTokens,
    }),
    ...(telemetry.outputTokens !== undefined && {
      outputTokens: telemetry.outputTokens,
    }),
    ...(telemetry.totalTokens !== undefined && {
      totalTokens: telemetry.totalTokens,
    }),
    ...(telemetry.reasoningTokens !== undefined && {
      reasoningTokens: telemetry.reasoningTokens,
    }),
    modelId: telemetry.modelId,
    ...(telemetry.effort !== undefined && { effort: telemetry.effort }),
    latencyMs: telemetry.latencyMs,
    finishReason: telemetry.finishReason,
    status: telemetry.status,
    ...(telemetry.costUsd !== undefined && { costUsd: telemetry.costUsd }),
  };
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

export function requestContextTokens(
  usage: LanguageModelUsage,
): number | undefined {
  const inputTokens = optionalTokenCount(usage.inputTokens);
  const outputTokens = optionalTokenCount(usage.outputTokens);
  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }
  return tokenCount(inputTokens) + tokenCount(outputTokens);
}
