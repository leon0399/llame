import { generateText } from 'ai';
import type { Warning } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';

import { installAiSdkWarningLogger, logModelWarnings } from './ai-sdk-warnings';

const ITEM_ID = 'rs_kept';
const ENCRYPTED = 'encrypted-reasoning-content';
const REASONING = 'the private chain of thought';

function otherWarning(message: string): Warning {
  return { type: 'other', message };
}

/** The log lines one batch of warnings produced. */
function loggedLines(warnings: Array<Warning>): string {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  logModelWarnings({
    warnings,
    provider: 'openai.responses',
    model: 'gpt-test',
  });

  const lines = warn.mock.calls
    .map((call) => call.map((part) => String(part)).join(' '))
    .join('\n');

  warn.mockRestore();

  return lines;
}

describe('logModelWarnings', () => {
  it('logs the adapter condition, never the reasoning part it embeds', () => {
    const part = JSON.stringify({
      type: 'reasoning',
      text: REASONING,
      providerOptions: {
        openai: { itemId: ITEM_ID, reasoningEncryptedContent: ENCRYPTED },
      },
    });

    const logged = loggedLines([
      otherWarning(
        `Cannot append empty reasoning part to existing reasoning sequence. Skipping reasoning part: ${part}.`,
      ),
      otherWarning(
        `Non-OpenAI reasoning parts are not supported. Skipping reasoning part: ${part}.`,
      ),
    ]);

    expect(logged).toContain('Cannot append empty reasoning part');
    expect(logged).toContain('Non-OpenAI reasoning parts are not supported');
    expect(logged).not.toContain(REASONING);
    expect(logged).not.toContain(ITEM_ID);
    expect(logged).not.toContain(ENCRYPTED);
  });

  it('redacts a warning the SDK raises during a model call', async () => {
    const previous = globalThis.AI_SDK_LOG_WARNINGS;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      installAiSdkWarningLogger();

      const part = JSON.stringify({
        type: 'reasoning',
        text: REASONING,
        providerOptions: {
          openai: { itemId: ITEM_ID, reasoningEncryptedContent: ENCRYPTED },
        },
      });

      const model = new MockLanguageModelV3({
        provider: 'openai.responses',
        modelId: 'gpt-test',
        doGenerate: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'ok' }],
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
            warnings: [
              otherWarning(
                `Non-OpenAI reasoning parts are not supported. Skipping reasoning part: ${part}.`,
              ),
            ],
          }),
      });

      // The SDK's own warning path calls the installed global, so this proves
      // the hook is in force for a model call, not only for a direct call.
      await generateText({ model, prompt: 'hello' });

      const logged = warn.mock.calls
        .map((call) => call.map((argument) => String(argument)).join(' '))
        .join('\n');

      expect(logged).toContain('AI SDK warning (openai.responses / gpt-test)');
      expect(logged).toContain('Non-OpenAI reasoning parts are not supported');
      expect(logged).not.toContain(REASONING);
      expect(logged).not.toContain(ITEM_ID);
      expect(logged).not.toContain(ENCRYPTED);
    } finally {
      warn.mockRestore();
      globalThis.AI_SDK_LOG_WARNINGS = previous;
    }
  });

  it('keeps the feature and details of a setting warning', () => {
    const logged = loggedLines([
      {
        type: 'unsupported',
        feature: 'temperature',
        details: 'temperature is not supported for reasoning models',
      },
    ]);

    expect(logged).toContain('AI SDK warning (openai.responses / gpt-test)');
    expect(logged).toContain('unsupported: temperature');
    expect(logged).toContain(
      'temperature is not supported for reasoning models',
    );
  });

  it('installs itself as the SDK warning logger', () => {
    const previous = globalThis.AI_SDK_LOG_WARNINGS;

    installAiSdkWarningLogger();

    expect(globalThis.AI_SDK_LOG_WARNINGS).toBe(logModelWarnings);
    globalThis.AI_SDK_LOG_WARNINGS = previous;
  });
});
