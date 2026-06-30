import type { LanguageModelUsage } from 'ai';

import {
  buildTurnTelemetry,
  emitCompletedTurnTelemetryLog,
  type TokenPriceMap,
  type TurnTelemetryLogger,
} from './turn-telemetry';

describe('TurnTelemetry', () => {
  const prices = {
    'priced-model': {
      inputUsdPer1M: 1,
      cachedInputUsdPer1M: 0.1,
      outputUsdPer1M: 2,
    },
  } satisfies TokenPriceMap;

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
      model: 'priced-model',
      provider: 'test-provider',
      latencyMs: 123,
      prices,
    });

    expect(telemetry).toEqual({
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 10,
      totalTokens: 110,
      reasoningTokens: 3,
      model: 'priced-model',
      provider: 'test-provider',
      latencyMs: 123,
      finishReason: 'stop',
      status: 'completed',
      costUsd: 0.000084,
    });
    expect(telemetry.cachedInputTokens / telemetry.inputTokens).toBe(0.4);
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
      model: 'unknown-model',
      provider: 'test-provider',
      latencyMs: 123,
      prices,
    });

    expect(telemetry.costUsd).toBeNull();
  });

  it('does not throw when telemetry logging fails', () => {
    const logger = {
      info: jest.fn(() => {
        throw new Error('pino sink failed');
      }),
    } satisfies TurnTelemetryLogger;
    const onError = jest.fn();
    const telemetry = buildTurnTelemetry({
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      },
      finishReason: 'stop',
      status: 'completed',
      model: 'unknown-model',
      provider: 'test-provider',
      latencyMs: 12,
      prices,
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
      const info = jest.fn<void, [Record<string, unknown>]>();
      const logger = { info } satisfies TurnTelemetryLogger;
      const telemetry = buildTurnTelemetry({
        usage: null,
        finishReason: status === 'error' ? 'error' : null,
        status,
        model: 'unknown-model',
        provider: 'test-provider',
        latencyMs: 12,
        prices,
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

  it('omits message content from the structured telemetry log payload', () => {
    const info = jest.fn<void, [Record<string, unknown>]>();
    const logger = { info } satisfies TurnTelemetryLogger;
    const telemetry = buildTurnTelemetry({
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      } satisfies LanguageModelUsage,
      finishReason: 'stop',
      status: 'completed',
      model: 'unknown-model',
      provider: 'test-provider',
      latencyMs: 12,
      prices,
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
      model: 'unknown-model',
      provider: 'test-provider',
      latencyMs: 12,
      finishReason: 'stop',
      status: 'completed',
      costUsd: null,
    });
    expect(JSON.stringify(info.mock.calls[0]?.[0])).not.toContain('content');
  });
});
