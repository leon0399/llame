import { compactionAttemptStarted } from './automatic-boundary-trigger';

describe('compaction attempt progress guard', () => {
  it('does not treat a woken attempt as the compaction attempt', () => {
    expect(
      compactionAttemptStarted({
        wakeCompaction: false,
        startsAfterCompaction: true,
        isWakeAttempt: true,
      }),
    ).toBe(false);
  });

  it('checks a requested wake compaction', () => {
    expect(
      compactionAttemptStarted({
        wakeCompaction: true,
        startsAfterCompaction: false,
        isWakeAttempt: true,
      }),
    ).toBe(true);
  });
});
