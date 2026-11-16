import {
  boundaryStepBudgetUsed,
  readCompactionStepBudget,
} from './compaction-step-budget';

describe('readCompactionStepBudget', () => {
  it('includes steps from before a woken segment suspended', () => {
    expect(
      boundaryStepBudgetUsed({
        stepBudgetOffset: 0,
        stepBase: 3,
        stepsStarted: 2,
        wakeStepOffset: 3,
      }),
    ).toBe(8);
  });

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

  it('treats a malformed delivery payload as a fully used budget', () => {
    expect(
      readCompactionStepBudget([
        {
          eventType: 'run.delivered',
          payload: { cause: 'compaction', stepBudgetUsed: '3' },
        },
      ]),
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
});
