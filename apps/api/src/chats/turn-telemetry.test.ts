import type { LanguageModelUsage } from 'ai';

import {
  buildTurnTelemetry,
  emitCompletedTurnTelemetryLog,
  type TokenPrice,
  type TurnTelemetryLogger,
} from './turn-telemetry';
import { type UnknownRecord } from '@workspace/runtime-safety';

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
