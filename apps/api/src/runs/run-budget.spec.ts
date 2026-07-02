import { ConfigService } from '@nestjs/config';

import {
  isBudgetExceeded,
  readRunBudget,
  resolveRunBudget,
} from './run-budget';

function configWith(env: Record<string, string>): ConfigService {
  return new ConfigService(env);
}

describe('resolveRunBudget', () => {
  it('returns null when RUN_MAX_OUTPUT_TOKENS is unset', () => {
    expect(resolveRunBudget(configWith({}))).toBeNull();
  });

  it.each(['0', '-5', 'abc', ''])(
    'returns null for invalid value %p',
    (raw) => {
      expect(
        resolveRunBudget(configWith({ RUN_MAX_OUTPUT_TOKENS: raw })),
      ).toBeNull();
    },
  );

  it('resolves a positive integer cap, flooring fractions', () => {
    expect(
      resolveRunBudget(configWith({ RUN_MAX_OUTPUT_TOKENS: '512' })),
    ).toEqual({ maxOutputTokens: 512 });
    expect(
      resolveRunBudget(configWith({ RUN_MAX_OUTPUT_TOKENS: '512.9' })),
    ).toEqual({ maxOutputTokens: 512 });
  });
});

describe('readRunBudget', () => {
  it('round-trips a snapshot written by resolveRunBudget', () => {
    const budget = resolveRunBudget(
      configWith({ RUN_MAX_OUTPUT_TOKENS: '256' }),
    );
    expect(readRunBudget(JSON.parse(JSON.stringify(budget)))).toEqual({
      maxOutputTokens: 256,
    });
  });

  it.each([null, undefined, 'x', 42, {}, { maxOutputTokens: -1 }])(
    'returns null for non-budget value %p',
    (value) => {
      expect(readRunBudget(value)).toBeNull();
    },
  );
});

describe('isBudgetExceeded', () => {
  const budget = { maxOutputTokens: 100 };

  it('never fires without a budget', () => {
    expect(
      isBudgetExceeded(null, {
        finishReason: 'length',
        usage: { outputTokens: 10_000 },
      }),
    ).toBe(false);
  });

  it("fires on the provider's length finish", () => {
    expect(
      isBudgetExceeded(budget, {
        finishReason: 'length',
        usage: { outputTokens: 100 },
      }),
    ).toBe(true);
  });

  it('does not fire on a clean stop, even at exactly the cap', () => {
    expect(
      isBudgetExceeded(budget, {
        finishReason: 'stop',
        usage: { outputTokens: 100 },
      }),
    ).toBe(false);
  });

  it('falls back to usage when the finish reason is vague', () => {
    expect(
      isBudgetExceeded(budget, {
        finishReason: 'other',
        usage: { outputTokens: 100 },
      }),
    ).toBe(true);
    expect(
      isBudgetExceeded(budget, {
        finishReason: null,
        usage: { outputTokens: 99 },
      }),
    ).toBe(false);
  });
});
