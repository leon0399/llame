import type { LanguageModelUsage } from 'ai';

import {
  aggregateTurnTelemetry,
  buildTurnTelemetry,
  emitCompletedTurnTelemetryLog,
  type TokenPrice,
  type TurnTelemetryLogger,
} from './turn-telemetry';
import { type UnknownRecord } from '@workspace/runtime-safety';

function usageReceipt(
  input: {
    inputTokens?: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
  } = {},
): LanguageModelUsage {
  return {
    inputTokens: input.inputTokens,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: input.cachedInputTokens,
      cacheWriteTokens: input.cacheWriteTokens,
    },
    outputTokens: input.outputTokens,
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: input.reasoningTokens,
    },
    totalTokens: input.totalTokens,
    ...(input.cachedInputTokens !== undefined && {
      cachedInputTokens: input.cachedInputTokens,
    }),
    ...(input.reasoningTokens !== undefined && {
      reasoningTokens: input.reasoningTokens,
    }),
  };
}

describe('TurnTelemetry', () => {
  const price = {
    inputUsdPer1M: 1,
    cachedInputUsdPer1M: 0.1,
    outputUsdPer1M: 2,
  } satisfies TokenPrice;

  it('captures cached input tokens so cache-hit ratio is derivable', () => {
    const telemetry = buildTurnTelemetry({
      usage: {
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 10,
        totalTokens: 110,
        reasoningTokens: 3,
      },
      finishReason: 'stop',
      status: 'completed',
      modelId: 'priced-model',
      latencyMs: 123,
      price,
    });

    expect(telemetry).toEqual({
      inputTokens: 100,
      cachedInputTokens: 40,
      cacheWriteTokens: 0,
      outputTokens: 10,
      totalTokens: 110,
      reasoningTokens: 3,
      modelId: 'priced-model',
      latencyMs: 123,
      finishReason: 'stop',
      status: 'completed',
      costUsd: 0.000084,
    });
    expect(telemetry.cachedInputTokens / telemetry.inputTokens).toBe(0.4);
  });

  it('floors total tokens to the component sum when the provider omits the total', () => {
    const telemetry = buildTurnTelemetry({
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        // totalTokens omitted — some providers don't report it
      },
      finishReason: 'stop',
      status: 'completed',
      modelId: 'unknown-model',
      latencyMs: 10,
      price,
    });

    expect(telemetry.totalTokens).toBe(120);
  });

  it('records null cost when the model has no configured price', () => {
    const telemetry = buildTurnTelemetry({
      usage: {
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 10,
        totalTokens: 110,
      },
      finishReason: 'stop',
      status: 'completed',
      modelId: 'unpriced-model',
      latencyMs: 123,
    });

    expect(telemetry.costUsd).toBeNull();
  });

  describe('aggregateTurnTelemetry', () => {
    const loopPrice = {
      inputUsdPer1M: 2,
      cachedInputUsdPer1M: 0.5,
      outputUsdPer1M: 10,
    } satisfies TokenPrice;

    it('sums and prices each request in a two-request tool loop', () => {
      const telemetry = aggregateTurnTelemetry({
        receipts: [
          usageReceipt({
            inputTokens: 1000,
            outputTokens: 200,
            reasoningTokens: 150,
          }),
          usageReceipt({
            inputTokens: 1400,
            cachedInputTokens: 1000,
            outputTokens: 100,
            reasoningTokens: 60,
          }),
        ],
        finishReason: 'stop',
        status: 'completed',
        modelId: 'priced-model',
        latencyMs: 123,
        price: loopPrice,
        stepCount: 2,
      });

      expect(telemetry).toEqual({
        inputTokens: 2400,
        cachedInputTokens: 1000,
        cacheWriteTokens: 0,
        outputTokens: 300,
        totalTokens: 2700,
        reasoningTokens: 210,
        modelId: 'priced-model',
        latencyMs: 123,
        finishReason: 'stop',
        status: 'completed',
        costUsd: 0.0063,
        complete: true,
      });
    });

    it('re-rounds the sum of per-request costs to 1e-12 precision', () => {
      const telemetry = aggregateTurnTelemetry({
        receipts: [
          usageReceipt({ inputTokens: 7 }),
          usageReceipt({ inputTokens: 13 }),
        ],
        status: 'completed',
        modelId: 'priced-model',
        latencyMs: 1,
        price,
      });

      expect(telemetry.costUsd).toBe(0.00002);
    });

    it('matches per-request telemetry for a single-receipt turn', () => {
      const receipt = usageReceipt({
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 10,
        totalTokens: 110,
        reasoningTokens: 3,
      });
      const context = {
        finishReason: 'stop' as const,
        status: 'completed' as const,
        modelId: 'priced-model',
        effort: 'high',
        latencyMs: 123,
        price,
        billing: 'usage' as const,
      };

      expect(
        aggregateTurnTelemetry({
          ...context,
          receipts: [receipt],
          stepCount: 1,
        }),
      ).toEqual({
        ...buildTurnTelemetry({ ...context, usage: receipt }),
        complete: true,
      });
    });

    it('bounds cache reads and writes within each request before summing', () => {
      const telemetry = aggregateTurnTelemetry({
        receipts: [
          usageReceipt({
            inputTokens: 100,
            cachedInputTokens: 200,
            cacheWriteTokens: 20,
          }),
          usageReceipt({ inputTokens: 100, cacheWriteTokens: 200 }),
        ],
        status: 'completed',
        modelId: 'priced-model',
        latencyMs: 1,
        price,
      });

      expect(telemetry).toMatchObject({
        inputTokens: 200,
        cachedInputTokens: 100,
        cacheWriteTokens: 100,
        totalTokens: 200,
      });
      const cachedInputTokens = telemetry.cachedInputTokens ?? 0;
      const cacheWriteTokens = telemetry.cacheWriteTokens ?? 0;
      expect(cachedInputTokens + cacheWriteTokens).toBeLessThanOrEqual(
        telemetry.inputTokens ?? 0,
      );
    });

    it('omits token fields and cost when a priced model reports no counts', () => {
      const telemetry = aggregateTurnTelemetry({
        receipts: [usageReceipt(), usageReceipt()],
        status: 'completed',
        modelId: 'priced-model',
        latencyMs: 1,
        price,
      });

      for (const field of [
        'inputTokens',
        'cachedInputTokens',
        'cacheWriteTokens',
        'outputTokens',
        'totalTokens',
        'reasoningTokens',
        'costUsd',
      ]) {
        expect(telemetry).not.toHaveProperty(field);
      }
      expect(telemetry.complete).toBe(false);
    });

    it('records null cost and omits token fields when an unpriced model reports nothing', () => {
      const telemetry = aggregateTurnTelemetry({
        receipts: [usageReceipt()],
        status: 'completed',
        modelId: 'unpriced-model',
        latencyMs: 1,
      });
      expect(telemetry).toMatchObject({ costUsd: null, complete: false });
      for (const field of [
        'inputTokens',
        'cachedInputTokens',
        'cacheWriteTokens',
        'outputTokens',
        'totalTokens',
        'reasoningTokens',
      ]) {
        expect(telemetry).not.toHaveProperty(field);
      }
    });

    it('records token counts but keeps cost null for an unpriced model', () => {
      const telemetry = aggregateTurnTelemetry({
        receipts: [usageReceipt({ inputTokens: 100, outputTokens: 10 })],
        status: 'completed',
        modelId: 'unpriced-model',
        latencyMs: 1,
      });

      expect(telemetry).toMatchObject({
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
        costUsd: null,
      });
    });

    it('stamps billing without changing the cost of a priced subscription model', () => {
      const receipt = usageReceipt({ inputTokens: 100, outputTokens: 10 });
      const context = {
        receipts: [receipt],
        status: 'completed' as const,
        modelId: 'priced-model',
        latencyMs: 1,
        price,
      };
      const usageBilled = aggregateTurnTelemetry({
        ...context,
        billing: 'usage',
      });
      const subscription = aggregateTurnTelemetry({
        ...context,
        billing: 'subscription',
      });
      const perRequest = buildTurnTelemetry({
        usage: receipt,
        status: 'completed',
        modelId: 'priced-model',
        latencyMs: 1,
        price,
        billing: 'subscription',
      });

      expect(subscription).toMatchObject({
        billing: 'subscription',
        costUsd: 0.00012,
      });
      expect(subscription.costUsd).toBe(usageBilled.costUsd);
      expect(perRequest.billing).toBe('subscription');
      expect(perRequest.costUsd).toBe(0.00012);
    });

    it('omits reasoning when any request does not report it', () => {
      const telemetry = aggregateTurnTelemetry({
        receipts: [
          usageReceipt({
            inputTokens: 10,
            outputTokens: 5,
            reasoningTokens: 2,
          }),
          usageReceipt({ inputTokens: 10, outputTokens: 5 }),
        ],
        status: 'completed',
        modelId: 'priced-model',
        latencyMs: 1,
        price,
      });

      expect(telemetry).not.toHaveProperty('reasoningTokens');
      expect(telemetry.complete).toBe(true);
    });

    it('marks non-completed attempts incomplete despite reported counts', () => {
      const telemetry = aggregateTurnTelemetry({
        receipts: [usageReceipt({ inputTokens: 10, outputTokens: 5 })],
        status: 'error',
        modelId: 'priced-model',
        latencyMs: 1,
        price,
      });

      expect(telemetry.complete).toBe(false);
    });

    it('marks an attempt incomplete when a request omits both counts', () => {
      const telemetry = aggregateTurnTelemetry({
        receipts: [
          usageReceipt({ inputTokens: 10, outputTokens: 5 }),
          usageReceipt(),
        ],
        status: 'completed',
        modelId: 'priced-model',
        latencyMs: 1,
        price,
        stepCount: 2,
      });

      expect(telemetry).toMatchObject({
        inputTokens: 10,
        outputTokens: 5,
        complete: false,
      });
    });

    it('marks fewer receipts than SDK steps incomplete', () => {
      const telemetry = aggregateTurnTelemetry({
        receipts: [usageReceipt({ inputTokens: 10, outputTokens: 5 })],
        status: 'completed',
        modelId: 'priced-model',
        latencyMs: 1,
        price,
        stepCount: 2,
      });

      expect(telemetry.complete).toBe(false);
    });

    it('does not consider an attempt with no receipts complete', () => {
      const telemetry = aggregateTurnTelemetry({
        receipts: [],
        status: 'completed',
        modelId: 'priced-model',
        latencyMs: 1,
        price,
      });

      expect(telemetry.complete).toBe(false);
    });
  });

  describe('cache-write cost', () => {
    const base = {
      finishReason: 'stop' as const,
      status: 'completed' as const,
      modelId: 'priced-model',
      latencyMs: 1,
    };
    const cacheWritePrice = {
      inputUsdPer1M: 3,
      cachedInputUsdPer1M: 0.3,
      cacheWriteUsdPer1M: 3.75,
      outputUsdPer1M: 15,
    } satisfies TokenPrice;

    it('prices cache-write tokens at the declared rate and excludes them from the uncached term', () => {
      const telemetry = buildTurnTelemetry({
        ...base,
        usage: {
          inputTokens: 1000,
          cachedInputTokens: 200,
          inputTokenDetails: {
            noCacheTokens: 700,
            cacheReadTokens: 200,
            cacheWriteTokens: 100,
          },
          outputTokens: 50,
          totalTokens: 1050,
        },
        price: cacheWritePrice,
      });

      expect(telemetry.cacheWriteTokens).toBe(100);
      // 700 uncached x 3 + 200 cached x 0.3 + 100 written x 3.75 + 50 output x
      // 15. Charging the written tokens inside the uncached term as well would
      // total 0.003585, so the exact value is what proves they are priced once.
      expect(telemetry.costUsd).toBe(0.003285);
    });

    it('falls back to the input rate for a Messages usage payload, reproducing the pre-change cost', () => {
      // Anthropic's input total already includes cache creation and cache
      // reads (`total = input + cache_creation + cache_read`), so the written
      // tokens are inside `inputTokens` exactly as they were before this rate
      // existed.
      const telemetry = buildTurnTelemetry({
        ...base,
        usage: {
          inputTokens: 1000,
          cachedInputTokens: 400,
          inputTokenDetails: {
            noCacheTokens: 500,
            cacheReadTokens: 400,
            cacheWriteTokens: 100,
          },
          outputTokens: 10,
          totalTokens: 1010,
        },
        price,
      });

      expect(telemetry.cacheWriteTokens).toBe(100);
      // The pre-change formula for the same usage: 600 uncached x 1 + 400
      // cached x 0.1 + 10 output x 2.
      expect(telemetry.costUsd).toBe(0.00066);
    });

    it('falls back to the input rate for a Responses usage payload carrying cache_write_tokens', () => {
      // @ai-sdk/openai maps the Responses wire's
      // `input_tokens_details.cache_write_tokens` onto this same normalized
      // field, with the write tokens already inside the input total.
      const telemetry = buildTurnTelemetry({
        ...base,
        usage: {
          inputTokens: 2000,
          cachedInputTokens: 1500,
          inputTokenDetails: {
            noCacheTokens: 400,
            cacheReadTokens: 1500,
            cacheWriteTokens: 100,
          },
          outputTokens: 200,
          totalTokens: 2200,
        },
        price,
      });

      expect(telemetry.cacheWriteTokens).toBe(100);
      // Pre-change: 500 uncached x 1 + 1500 cached x 0.1 + 200 output x 2.
      expect(telemetry.costUsd).toBe(0.00105);
    });

    it('records zero cache-write tokens without inventing any when the provider reports none', () => {
      const telemetry = buildTurnTelemetry({
        ...base,
        usage: {
          inputTokens: 100,
          cachedInputTokens: 40,
          inputTokenDetails: {
            noCacheTokens: 60,
            cacheReadTokens: 40,
            cacheWriteTokens: 0,
          },
          outputTokens: 10,
          totalTokens: 110,
        },
        price,
      });

      expect(telemetry.cacheWriteTokens).toBe(0);
      expect(telemetry.costUsd).toBe(0.000084);
    });

    it('treats an undefined cache-write count as zero and leaves the cost unchanged', () => {
      const telemetry = buildTurnTelemetry({
        ...base,
        usage: {
          inputTokens: 100,
          cachedInputTokens: 40,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          },
          outputTokens: 10,
          totalTokens: 110,
        },
        price,
      });

      expect(telemetry.cacheWriteTokens).toBe(0);
      expect(telemetry.costUsd).toBe(0.000084);
    });

    it('caches up to the input total, then writes, so inconsistent counts stay non-negative', () => {
      const telemetry = buildTurnTelemetry({
        ...base,
        usage: {
          inputTokens: 100,
          cachedInputTokens: 90,
          inputTokenDetails: {
            noCacheTokens: 0,
            cacheReadTokens: 90,
            cacheWriteTokens: 20,
          },
          outputTokens: 10,
          totalTokens: 110,
        },
        price: cacheWritePrice,
      });

      // Reads cap at the input total and writes at what remains of it, so the
      // uncached term is zero: 90 cached x 0.3 + 10 written x 3.75 + 10 output
      // x 15. Without the capping the reported 20 writes would be priced, and
      // the uncached term would be negative.
      expect(telemetry.cacheWriteTokens).toBe(10);
      expect(telemetry.costUsd).toBe(0.0002145);
    });

    it('keeps costUsd null on an unpriced entry while still recording reported writes', () => {
      const telemetry = buildTurnTelemetry({
        ...base,
        usage: {
          inputTokens: 100,
          cachedInputTokens: 0,
          inputTokenDetails: {
            noCacheTokens: 60,
            cacheReadTokens: 0,
            cacheWriteTokens: 40,
          },
          outputTokens: 10,
          totalTokens: 110,
        },
      });

      expect(telemetry.cacheWriteTokens).toBe(40);
      expect(telemetry.costUsd).toBeNull();
    });

    it('includes the cache-write count in the structured log payload', () => {
      const info = vi.fn<(payload: UnknownRecord) => void>();
      const telemetry = buildTurnTelemetry({
        ...base,
        usage: {
          inputTokens: 100,
          cachedInputTokens: 0,
          inputTokenDetails: {
            noCacheTokens: 60,
            cacheReadTokens: 0,
            cacheWriteTokens: 40,
          },
          outputTokens: 10,
          totalTokens: 110,
        },
        price,
      });

      emitCompletedTurnTelemetryLog({ info } satisfies TurnTelemetryLogger, {
        chatId: 'chat-1',
        messageId: 'assistant-1',
        inReplyTo: 'user-1',
        telemetry,
      });

      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 100,
          cachedInputTokens: 0,
          cacheWriteTokens: 40,
        }),
      );
    });
  });

  it('does not throw when telemetry logging fails', () => {
    const logger = {
      info: vi.fn(() => {
        throw new Error('pino sink failed');
      }),
    } satisfies TurnTelemetryLogger;
    const onError = vi.fn();
    const telemetry = buildTurnTelemetry({
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      },
      finishReason: 'stop',
      status: 'completed',
      modelId: 'unknown-model',
      latencyMs: 12,
      price,
    });

    expect(() =>
      emitCompletedTurnTelemetryLog(logger, {
        chatId: 'chat-1',
        messageId: 'assistant-1',
        inReplyTo: 'user-1',
        telemetry,
        onError,
      }),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it.each(['aborted', 'error'] as const)(
    'does not emit a structured log for a %s turn',
    (status) => {
      const info = vi.fn<(payload: UnknownRecord) => void>();
      const logger = { info } satisfies TurnTelemetryLogger;
      const telemetry = buildTurnTelemetry({
        usage: null,
        finishReason: status === 'error' ? 'error' : null,
        status,
        modelId: 'unknown-model',
        latencyMs: 12,
        price,
      });

      emitCompletedTurnTelemetryLog(logger, {
        chatId: 'chat-1',
        messageId: 'assistant-1',
        inReplyTo: 'user-1',
        telemetry,
      });

      expect(info).not.toHaveBeenCalled();
    },
  );

  describe('reasoning effort (add-reasoning-effort)', () => {
    const base = {
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      finishReason: 'stop' as const,
      status: 'completed' as const,
      modelId: 'm',
      latencyMs: 1,
    };

    it('records the effort the call ran at, beside modelId', () => {
      expect(buildTurnTelemetry({ ...base, effort: 'xhigh' })).toMatchObject({
        modelId: 'm',
        effort: 'xhigh',
      });
    });

    // Absent, never null: matches the "omitted rather than fabricated" rule
    // every other optional telemetry field already follows.
    it('omits effort entirely when the call carried none', () => {
      expect(buildTurnTelemetry(base)).not.toHaveProperty('effort');
    });

    it('carries a disabling level through rather than dropping it', () => {
      expect(buildTurnTelemetry({ ...base, effort: 'none' })).toMatchObject({
        effort: 'none',
      });
    });

    it('includes the effort in the structured log payload', () => {
      const info = vi.fn<(payload: UnknownRecord) => void>();
      emitCompletedTurnTelemetryLog({ info } satisfies TurnTelemetryLogger, {
        chatId: 'c',
        messageId: 'a',
        inReplyTo: 'u',
        telemetry: buildTurnTelemetry({ ...base, effort: 'low' }),
      });

      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'm', effort: 'low' }),
      );
    });

    it('omits effort from the log payload when the call carried none', () => {
      const info = vi.fn<(payload: UnknownRecord) => void>();
      emitCompletedTurnTelemetryLog({ info } satisfies TurnTelemetryLogger, {
        chatId: 'c',
        messageId: 'a',
        inReplyTo: 'u',
        telemetry: buildTurnTelemetry(base),
      });

      const [payload] = info.mock.calls.at(-1) ?? [];
      expect(payload).not.toHaveProperty('effort');
    });
  });

  it('omits message content from the structured telemetry log payload', () => {
    const info = vi.fn<(payload: UnknownRecord) => void>();
    const logger = { info } satisfies TurnTelemetryLogger;
    const telemetry = buildTurnTelemetry({
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      } satisfies Partial<LanguageModelUsage>,
      finishReason: 'stop',
      status: 'completed',
      modelId: 'unknown-model',
      latencyMs: 12,
    });

    emitCompletedTurnTelemetryLog(logger, {
      chatId: 'chat-1',
      messageId: 'assistant-1',
      inReplyTo: 'user-1',
      telemetry,
    });

    expect(info).toHaveBeenCalledWith({
      event: 'assistant_turn_completed',
      chatId: 'chat-1',
      messageId: 'assistant-1',
      inReplyTo: 'user-1',
      inputTokens: 1,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 2,
      totalTokens: 3,
      modelId: 'unknown-model',
      latencyMs: 12,
      finishReason: 'stop',
      status: 'completed',
      costUsd: null,
    });
    expect(JSON.stringify(info.mock.calls[0]?.[0])).not.toContain('content');
  });
});
