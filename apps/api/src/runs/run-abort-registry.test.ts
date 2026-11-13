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

  function segmentSnapshot(aborts: RunAbortRegistry) {
    const segment = aborts.segmentOf(RUN_ID);

    if (!segment) throw new Error('no segment');

    return segment;
  }

  it('an interrupt aborts the segment of its attempt with the interrupt reason, and leaves the Run alone', () => {
    const { aborts, run } = registry();
    const segment = aborts.beginSegment(RUN_ID, ATTEMPT_ID);

    expect(aborts.interrupt(RUN_ID, segmentSnapshot(aborts))).toBe(true);

    expect(segment?.abort.signal.aborted).toBe(true);
    expect(segment?.abort.signal.reason).toBe(INTERRUPT_ABORT_REASON);
    expect(run.signal.aborted).toBe(false);
  });

  it('refuses an interrupt for a replaced segment, even when the attempt changes', () => {
    const { aborts } = registry();
    const segment = aborts.beginSegment(RUN_ID, ATTEMPT_ID);
    const captured = segmentSnapshot(aborts);
    const replacement = aborts.beginSegment(RUN_ID, 'another-attempt');

    expect(aborts.interrupt(RUN_ID, captured)).toBe(false);
    expect(segment?.abort.signal.aborted).toBe(false);
    expect(replacement?.abort.signal.aborted).toBe(false);
  });

  it('has nothing to interrupt before a segment begins or after it ends', () => {
    const { aborts } = registry();
    expect(aborts.segmentOf(RUN_ID)).toBeUndefined();

    const segment = aborts.beginSegment(RUN_ID, ATTEMPT_ID);

    if (segment === undefined) throw new Error('no segment');
    expect(aborts.segmentOf(RUN_ID)?.attemptId).toBe(ATTEMPT_ID);
    const captured = segmentSnapshot(aborts);
    aborts.endSegment(RUN_ID, segment);

    expect(aborts.interrupt(RUN_ID, captured)).toBe(false);
  });

  it('a later call replaces the earlier one, which cannot end or be interrupted as the later one', () => {
    const { aborts } = registry();
    const earlier = aborts.beginSegment(RUN_ID, ATTEMPT_ID);
    const capturedEarlier = segmentSnapshot(aborts);
    const later = aborts.beginSegment(RUN_ID, ATTEMPT_ID);

    if (earlier === undefined) throw new Error('no segment');

    aborts.endSegment(RUN_ID, earlier);

    expect(aborts.interrupt(RUN_ID, capturedEarlier)).toBe(false);
    expect(aborts.interrupt(RUN_ID, segmentSnapshot(aborts))).toBe(true);
    expect(later?.abort.signal.aborted).toBe(true);
  });

  it('aborts a segment once', () => {
    const { aborts } = registry();
    aborts.beginSegment(RUN_ID, ATTEMPT_ID);
    const segment = segmentSnapshot(aborts);

    expect(aborts.interrupt(RUN_ID, segment)).toBe(true);
    expect(aborts.interrupt(RUN_ID, segment)).toBe(false);
  });

  describe('the yield signal', () => {
    it('is raised for the captured segment and never aborts the call', () => {
      const { aborts, run } = registry();
      const segment = aborts.beginSegment(RUN_ID, ATTEMPT_ID);

      expect(aborts.yield(RUN_ID, segmentSnapshot(aborts))).toBe(true);

      expect(segment?.yield.signal.aborted).toBe(true);
      expect(segment?.abort.signal.aborted).toBe(false);
      expect(run.signal.aborted).toBe(false);
    });

    it('refuses a replaced segment and a Run with no segment', () => {
      const { aborts } = registry();

      expect(aborts.segmentOf(RUN_ID)).toBeUndefined();

      const segment = aborts.beginSegment(RUN_ID, ATTEMPT_ID);
      const captured = segmentSnapshot(aborts);
      aborts.beginSegment(RUN_ID, 'another-attempt');

      expect(aborts.yield(RUN_ID, captured)).toBe(false);
      expect(segment?.yield.signal.aborted).toBe(false);
    });

    it('stays raised until the segment ends, and a later call starts clear', () => {
      const { aborts } = registry();
      const earlier = aborts.beginSegment(RUN_ID, ATTEMPT_ID);
      const captured = segmentSnapshot(aborts);

      aborts.yield(RUN_ID, captured);
      expect(earlier?.yield.signal.aborted).toBe(true);

      const later = aborts.beginSegment(RUN_ID, ATTEMPT_ID);

      expect(later?.yield.signal.aborted).toBe(false);
      expect(aborts.yield(RUN_ID, captured)).toBe(false);
      expect(later?.yield.signal.aborted).toBe(false);
    });

    it('is raised before an interrupt aborts the call', () => {
      const { aborts } = registry();
      const segment = aborts.beginSegment(RUN_ID, ATTEMPT_ID);
      const order: Array<string> = [];

      segment?.yield.signal.addEventListener('abort', () =>
        order.push('yield'),
      );
      segment?.abort.signal.addEventListener('abort', () =>
        order.push('abort'),
      );
      aborts.interrupt(RUN_ID, segmentSnapshot(aborts));

      expect(order).toEqual(['yield', 'abort']);
    });
  });

  it('does not begin a segment for a Run this process does not execute', () => {
    expect(
      new RunAbortRegistry().beginSegment(RUN_ID, ATTEMPT_ID),
    ).toBeUndefined();
  });
});
