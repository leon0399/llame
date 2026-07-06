import { runTokenCapReached, sumStepTotalTokens } from './step-budget';

describe('sumStepTotalTokens', () => {
  it('sums totalTokens across steps', () => {
    expect(
      sumStepTotalTokens([
        { usage: { totalTokens: 100 } },
        { usage: { totalTokens: 250 } },
      ]),
    ).toBe(350);
  });

  it('treats missing / partial / null usage as 0 for that step', () => {
    expect(
      sumStepTotalTokens([{ usage: null }, {}, { usage: { totalTokens: 50 } }]),
    ).toBe(50);
  });

  it('empty → 0', () => {
    expect(sumStepTotalTokens([])).toBe(0);
  });
});

describe('runTokenCapReached', () => {
  const steps = [
    { usage: { totalTokens: 600 } },
    { usage: { totalTokens: 500 } },
  ]; // 1100

  it('true at or over the cap', () => {
    expect(runTokenCapReached(1000, steps)).toBe(true);
    expect(runTokenCapReached(1100, steps)).toBe(true); // exactly at cap
  });

  it('false below the cap', () => {
    expect(runTokenCapReached(2000, steps)).toBe(false);
  });
});
