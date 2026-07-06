import { isBudgetExceeded, readRunBudget } from './run-budget';

function snapshotWith(run: Record<string, unknown>): unknown {
  return { effective: { run } };
}

describe('readRunBudget', () => {
  it('returns null when the snapshot sets no cap', () => {
    expect(readRunBudget(snapshotWith({}))).toBeNull();
  });

  it.each([null, undefined, 'x', 42, {}, { effective: null }])(
    'returns null for a non-snapshot value %p',
    (value) => {
      expect(readRunBudget(value)).toBeNull();
    },
  );

  it('reads a positive-integer output-token cap, flooring fractions', () => {
    expect(readRunBudget(snapshotWith({ maxOutputTokens: 512 }))).toEqual({
      maxOutputTokens: 512,
    });
    expect(readRunBudget(snapshotWith({ maxOutputTokens: 512.9 }))).toEqual({
      maxOutputTokens: 512,
    });
  });

  it.each([0, -5, 'abc'])(
    'ignores an invalid maxOutputTokens value %p',
    (raw) => {
      expect(readRunBudget(snapshotWith({ maxOutputTokens: raw }))).toBeNull();
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
