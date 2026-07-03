import { isBudgetExceeded, readRunBudget } from './run-budget';

describe('readRunBudget', () => {
  it('reads the cap from a run config snapshot', () => {
    expect(
      readRunBudget({
        effective: { run: { maxOutputTokens: 256 } },
        provenance: {},
        layers: [],
        computedAt: 'x',
      }),
    ).toEqual({ maxOutputTokens: 256 });
  });

  it('floors fractional caps', () => {
    expect(
      readRunBudget({ effective: { run: { maxOutputTokens: 512.9 } } }),
    ).toEqual({ maxOutputTokens: 512 });
  });

  it.each([
    null,
    undefined,
    {},
    { effective: {} },
    { effective: { run: {} } },
    { effective: { run: { maxOutputTokens: 0 } } },
    { effective: { run: { maxOutputTokens: -5 } } },
    { effective: { run: { maxOutputTokens: 'many' } } },
  ])('returns null for snapshot without a valid cap: %p', (snapshot) => {
    expect(readRunBudget(snapshot)).toBeNull();
  });
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

describe('readRunBudget — cumulative token cap (#91)', () => {
  it('reads maxRunTokens (with or without maxOutputTokens)', () => {
    expect(
      readRunBudget({ effective: { run: { maxRunTokens: 5000 } } }),
    ).toEqual({ maxRunTokens: 5000 });
    expect(
      readRunBudget({
        effective: { run: { maxOutputTokens: 256, maxRunTokens: 5000 } },
      }),
    ).toEqual({ maxOutputTokens: 256, maxRunTokens: 5000 });
  });
});

describe('isBudgetExceeded — cumulative token cap (#91)', () => {
  const budget = { maxRunTokens: 1000 };

  it('fires when the loop is CUT at/over the cap (finishReason not a clean stop)', () => {
    expect(
      isBudgetExceeded(budget, {
        finishReason: 'tool-calls',
        totalTokens: 1200,
      }),
    ).toBe(true);
    expect(
      isBudgetExceeded(budget, {
        finishReason: 'tool-calls',
        totalTokens: 1000,
      }),
    ).toBe(true); // exactly at cap, cut
  });

  it('does NOT fire on a natural stop, even over the cap (completion, not a breach)', () => {
    expect(
      isBudgetExceeded(budget, { finishReason: 'stop', totalTokens: 1200 }),
    ).toBe(false);
  });

  it('does not fire below the cap', () => {
    expect(
      isBudgetExceeded(budget, {
        finishReason: 'tool-calls',
        totalTokens: 500,
      }),
    ).toBe(false);
  });
});
