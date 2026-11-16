import { readCompactionStepBudget } from './compaction-step-budget';

describe('readCompactionStepBudget', () => {
  it('reads a compaction delivery budget from the latest delivery', () => {
    expect(
      readCompactionStepBudget([
        {
          eventType: 'run.delivered',
          payload: { cause: 'compaction', stepBudgetUsed: 3 },
        },
        { eventType: 'model.requested', payload: {} },
      ]),
    ).toBe(3);
  });

  it('starts a fresh budget after another delivery cause', () => {
    expect(
      readCompactionStepBudget([
        {
          eventType: 'run.delivered',
          payload: { cause: 'compaction', stepBudgetUsed: 3 },
        },
        {
          eventType: 'run.delivered',
          payload: { cause: 'steer', stepBudgetUsed: 5 },
        },
      ]),
    ).toBe(0);
  });

  it('ignores malformed delivery payloads', () => {
    expect(
      readCompactionStepBudget([
        {
          eventType: 'run.delivered',
          payload: { cause: 'compaction', stepBudgetUsed: '3' },
        },
      ]),
    ).toBe(0);
  });
});
