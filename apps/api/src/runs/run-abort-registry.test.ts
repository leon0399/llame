import { INTERRUPT_ABORT_REASON, RunAbortRegistry } from './run-abort-registry';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';

describe('RunAbortRegistry segments (run-steering D7)', () => {
  function registry() {
    const aborts = new RunAbortRegistry();
    const run = aborts.register(RUN_ID, USER_ID);
    return { aborts, run };
  }

  it('an interrupt aborts the segment of its attempt with the interrupt reason, and leaves the Run alone', () => {
    const { aborts, run } = registry();
    const segment = aborts.beginSegment(RUN_ID, ATTEMPT_ID);

    expect(aborts.interrupt(RUN_ID, ATTEMPT_ID)).toBe(true);

    expect(segment?.signal.aborted).toBe(true);
    expect(segment?.signal.reason).toBe(INTERRUPT_ABORT_REASON);
    expect(run.signal.aborted).toBe(false);
  });

  it('refuses an interrupt for another attempt', () => {
    const { aborts } = registry();
    const segment = aborts.beginSegment(RUN_ID, ATTEMPT_ID);

    expect(aborts.interrupt(RUN_ID, 'another-attempt')).toBe(false);
    expect(segment?.signal.aborted).toBe(false);
  });

  it('has nothing to interrupt before a segment begins or after it ends', () => {
    const { aborts } = registry();
    expect(aborts.interrupt(RUN_ID, ATTEMPT_ID)).toBe(false);
    expect(aborts.segmentAttemptOf(RUN_ID)).toBeUndefined();

    const segment = aborts.beginSegment(RUN_ID, ATTEMPT_ID);
    if (segment === undefined) throw new Error('no segment');
    expect(aborts.segmentAttemptOf(RUN_ID)).toBe(ATTEMPT_ID);
    aborts.endSegment(RUN_ID, segment);

    expect(aborts.interrupt(RUN_ID, ATTEMPT_ID)).toBe(false);
  });

  it('a later call replaces the earlier one, which cannot end the later one', () => {
    const { aborts } = registry();
    const earlier = aborts.beginSegment(RUN_ID, ATTEMPT_ID);
    const later = aborts.beginSegment(RUN_ID, ATTEMPT_ID);
    if (earlier === undefined) throw new Error('no segment');

    aborts.endSegment(RUN_ID, earlier);

    expect(aborts.interrupt(RUN_ID, ATTEMPT_ID)).toBe(true);
    expect(later?.signal.aborted).toBe(true);
  });

  it('aborts a segment once', () => {
    const { aborts } = registry();
    aborts.beginSegment(RUN_ID, ATTEMPT_ID);

    expect(aborts.interrupt(RUN_ID, ATTEMPT_ID)).toBe(true);
    expect(aborts.interrupt(RUN_ID, ATTEMPT_ID)).toBe(false);
  });

  it('does not begin a segment for a Run this process does not execute', () => {
    expect(
      new RunAbortRegistry().beginSegment(RUN_ID, ATTEMPT_ID),
    ).toBeUndefined();
  });
});
