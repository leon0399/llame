import { quotaWaitElapsedMs } from './quota-budget';
import type { RunEvent } from '../db/schema/chats';

function event(
  sequence: number,
  eventType: RunEvent['eventType'],
  createdAt: string,
  payload: RunEvent['payload'],
): RunEvent {
  return {
    sequence,
    runId: 'run-1',
    eventType,
    createdAt: new Date(createdAt),
    payload,
  };
}

describe('quotaWaitElapsedMs', () => {
  it('counts quota waits paired by generation, excluding jobs and unmatched waits', () => {
    const events = [
      event(1, 'run.suspended', '2026-11-01T00:00:00Z', {
        kind: 'quota',
        generation: 2,
      }),
      event(2, 'run.suspended', '2026-11-02T00:00:00Z', { generation: 3 }),
      event(3, 'run.resumed', '2026-11-03T00:00:00Z', {
        kind: 'quota',
        generation: 3,
      }),
      event(4, 'run.resumed', '2026-11-04T00:00:00Z', {
        kind: 'quota',
        generation: 2,
      }),
      event(5, 'run.suspended', '2026-11-05T00:00:00Z', {
        kind: 'quota',
        generation: 4,
      }),
      event(6, 'run.resumed', '2026-11-06T00:00:00Z', {
        kind: 'jobs',
        generation: 4,
      }),
    ];

    expect(quotaWaitElapsedMs(events)).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it('adds each closed quota interval once and clamps negative clock movement', () => {
    const events = [
      event(1, 'run.suspended', '2026-11-01T00:00:00Z', {
        kind: 'quota',
        generation: 1,
      }),
      event(2, 'run.resumed', '2026-11-03T00:00:00Z', {
        kind: 'quota',
        generation: 1,
      }),
      event(3, 'run.suspended', '2026-11-04T00:00:00Z', {
        kind: 'quota',
        generation: 2,
      }),
      event(4, 'run.resumed', '2026-11-03T00:00:00Z', {
        kind: 'quota',
        generation: 2,
      }),
      event(5, 'run.suspended', '2026-11-05T00:00:00Z', {
        kind: 'quota',
        generation: 3,
      }),
      event(6, 'run.resumed', '2026-11-13T00:00:00Z', {
        kind: 'quota',
        generation: 3,
      }),
    ];

    expect(quotaWaitElapsedMs(events)).toBe(10 * 24 * 60 * 60 * 1000);
  });

  it('does not count an unmatched quota wait or a jobs wait', () => {
    const events = [
      event(1, 'run.suspended', '2026-11-01T00:00:00Z', {
        kind: 'quota',
        generation: 1,
      }),
      event(2, 'run.resumed', '2026-11-03T00:00:00Z', {
        kind: 'jobs',
        generation: 1,
      }),
      event(3, 'run.suspended', '2026-11-04T00:00:00Z', {
        kind: 'quota',
        generation: 2,
      }),
    ];

    expect(quotaWaitElapsedMs(events)).toBe(0);
  });

  it('ignores resume events without a later sequence than suspension', () => {
    for (const [suspensionSequence, resumeSequence] of [
      [2, 1],
      [1, 1],
    ]) {
      const events = [
        event(suspensionSequence, 'run.suspended', '2026-11-01T00:00:00Z', {
          kind: 'quota',
          generation: 1,
        }),
        event(resumeSequence, 'run.resumed', '2026-11-03T00:00:00Z', {
          kind: 'quota',
          generation: 1,
        }),
      ];

      expect(quotaWaitElapsedMs(events)).toBe(0);
    }
  });

  it('ignores invalid quota generations and duplicate resumes', () => {
    const events = [
      event(1, 'run.suspended', '2026-11-01T00:00:00Z', {
        kind: 'quota',
        generation: 0,
      }),
      event(2, 'run.resumed', '2026-11-03T00:00:00Z', {
        kind: 'quota',
        generation: 0,
      }),
      event(3, 'run.suspended', '2026-11-04T00:00:00Z', {
        kind: 'quota',
        generation: 1,
      }),
      event(4, 'run.resumed', '2026-11-06T00:00:00Z', {
        kind: 'quota',
        generation: 1,
      }),
      event(5, 'run.resumed', '2026-11-08T00:00:00Z', {
        kind: 'quota',
        generation: 1,
      }),
    ];

    expect(quotaWaitElapsedMs(events)).toBe(2 * 24 * 60 * 60 * 1000);
  });
});
