import {
  isBudgetExceeded,
  isRunTokenBudgetExceeded,
  readRunBudget,
} from './run-budget';

function snapshotWith(run: Record<string, unknown>): unknown {
  return { effective: { run } };
}

describe('readRunBudget', () => {
  it('returns null when the snapshot sets neither cap', () => {
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

  it('reads maxRunTokens (with or without maxOutputTokens)', () => {
    expect(readRunBudget(snapshotWith({ maxRunTokens: 5000 }))).toEqual({
      maxRunTokens: 5000,
    });
    expect(
      readRunBudget(snapshotWith({ maxOutputTokens: 256, maxRunTokens: 5000 })),
    ).toEqual({ maxOutputTokens: 256, maxRunTokens: 5000 });
  });
});

describe('isBudgetExceeded — output-token cap', () => {
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

describe('isRunTokenBudgetExceeded / isBudgetExceeded — cumulative token cap (#91)', () => {
  const budget = { maxRunTokens: 1000 };

  it('fires when the loop is CUT at/over the cap (finishReason not a clean stop)', () => {
    expect(
      isRunTokenBudgetExceeded(budget, {
        finishReason: 'tool-calls',
        totalTokens: 1200,
      }),
    ).toBe(true);
    expect(
      isRunTokenBudgetExceeded(budget, {
        finishReason: 'tool-calls',
        totalTokens: 1000,
      }),
    ).toBe(true); // exactly at cap, cut
    expect(
      isBudgetExceeded(budget, {
        finishReason: 'tool-calls',
        totalTokens: 1200,
      }),
    ).toBe(true);
  });

  it('does NOT fire on a natural stop, even over the cap (completion, not a breach)', () => {
    expect(
      isRunTokenBudgetExceeded(budget, {
        finishReason: 'stop',
        totalTokens: 1200,
      }),
    ).toBe(false);
    expect(
      isBudgetExceeded(budget, { finishReason: 'stop', totalTokens: 1200 }),
    ).toBe(false);
  });

  it('does not fire below the cap', () => {
    expect(
      isRunTokenBudgetExceeded(budget, {
        finishReason: 'tool-calls',
        totalTokens: 500,
      }),
    ).toBe(false);
  });

  it('never fires without totalTokens (single-step fakes that omit totalUsage)', () => {
    expect(
      isRunTokenBudgetExceeded(budget, { finishReason: 'tool-calls' }),
    ).toBe(false);
  });
});

describe('isBudgetExceeded — either cap independently', () => {
  it('an output-cap-only budget never triggers the run-token check', () => {
    expect(
      isBudgetExceeded(
        { maxOutputTokens: 100 },
        { finishReason: 'tool-calls', totalTokens: 999_999 },
      ),
    ).toBe(false);
  });

  it('a maxRunTokens-only budget is not gated on maxOutputTokens being set', () => {
    expect(
      isBudgetExceeded(
        { maxRunTokens: 1000 },
        {
          finishReason: 'tool-calls',
          usage: { outputTokens: 1 },
          totalTokens: 1200,
        },
      ),
    ).toBe(true);
  });
});
