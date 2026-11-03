import { Logger } from '@nestjs/common';
import type { Warning } from 'ai';

import { installAiSdkWarningLogger, logModelWarnings } from './ai-sdk-warnings';

const ITEM_ID = 'rs_kept';
const ENCRYPTED = 'encrypted-reasoning-content';
const REASONING = 'the private chain of thought';

function otherWarning(message: string): Warning {
  return { type: 'other', message };
}

/** The log lines one batch of warnings produced. */
function loggedLines(warnings: Array<Warning>): string {
  const warn = vi
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);

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
