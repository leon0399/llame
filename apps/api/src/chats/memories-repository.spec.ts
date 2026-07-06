import { pickMemoriesWithinBudget } from './memories-repository';

/**
 * Unit coverage for the pure budget-selection helper (no DB). The live-row
 * behavior (source filter, ordering, cap) is covered by
 * `memories-rls.integration.spec.ts`.
 */
describe('pickMemoriesWithinBudget', () => {
  it('includes a single item at EXACTLY the char budget (no leading separator charged)', () => {
    const rows = [{ content: 'x'.repeat(2000) }];
    expect(pickMemoriesWithinBudget(rows, 2000)).toEqual(rows);
  });

  it('charges a separator only BETWEEN items, not before the first', () => {
    const rows = [{ content: 'a'.repeat(10) }, { content: 'b'.repeat(10) }];
    // 10 (first, no separator) + 1 (separator) + 10 (second) = 21.
    expect(pickMemoriesWithinBudget(rows, 21)).toEqual(rows);
    expect(pickMemoriesWithinBudget(rows, 20)).toEqual([rows[0]]);
  });

  it('stops at the first item that would exceed the budget', () => {
    const rows = [
      { content: 'a'.repeat(300) },
      { content: 'b'.repeat(300) },
      { content: 'c'.repeat(300) },
    ];
    // 300 + 1 + 300 = 601 fits under 700; a third would need 902.
    expect(pickMemoriesWithinBudget(rows, 700)).toEqual([rows[0], rows[1]]);
  });

  it('returns an empty array when the budget is smaller than the first item', () => {
    expect(pickMemoriesWithinBudget([{ content: 'x'.repeat(50) }], 10)).toEqual(
      [],
    );
  });
});
