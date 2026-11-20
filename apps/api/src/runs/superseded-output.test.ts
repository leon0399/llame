import { describe, expect, it } from 'vitest';
import {
  hasSupersededOutput,
  supersededWindow,
  supersededWindows,
} from './superseded-output';
import type { RunEventLike } from './run-event-chunks';

const marker = (
  fromSequence: number | string | undefined,
  step: number | string | undefined,
  sequence: number | undefined,
): RunEventLike => ({
  eventType: 'model.superseded',
  payload: { fromSequence, step },
  sequence,
});

describe('superseded output windows', () => {
  it.each([
    ['zero start', marker(0, 0, 1)],
    ['negative start', marker(-1, 0, 1)],
    ['fractional start', marker(1.5, 0, 2)],
    [
      'unsafe start',
      marker(Number.MAX_SAFE_INTEGER + 1, 0, Number.MAX_SAFE_INTEGER + 1),
    ],
    ['negative step', marker(1, -1, 2)],
    ['fractional step', marker(1, 0.5, 2)],
    ['unsafe step', marker(1, Number.MAX_SAFE_INTEGER + 1, 2)],
    ['zero end', marker(1, 0, 0)],
    ['negative end', marker(1, 0, -1)],
    ['fractional end', marker(1, 0, 1.5)],
    ['unsafe end', marker(1, 0, Number.MAX_SAFE_INTEGER + 1)],
    ['start after end', marker(3, 0, 2)],
    ['missing start', marker(undefined, 0, 2)],
    ['missing step', marker(1, undefined, 2)],
    ['missing end', marker(1, 0, undefined)],
    ['non-number start', marker('1', 0, 2)],
    ['non-number step', marker(1, '0', 2)],
  ])('rejects %s', (_name, event) => {
    expect(supersededWindow(event)).toBeUndefined();
  });

  it('accepts step zero and inclusive equal start/end', () => {
    expect(supersededWindow(marker(4, 0, 4))).toEqual({ from: 4, to: 4 });
  });

  it('ignores valid-looking markers on non-model events', () => {
    const events: Array<RunEventLike> = [
      {
        eventType: 'reasoning.delta',
        payload: { fromSequence: 1, step: 0 },
        sequence: 2,
      },
      {
        eventType: 'tool.requested',
        payload: { fromSequence: 1, step: 0 },
        sequence: 3,
      },
    ];

    expect(events.map(supersededWindow)).toEqual([undefined, undefined]);
    expect(hasSupersededOutput(events)).toBe(false);
    expect(supersededWindows(events)).toEqual([]);
  });

  it('sorts reverse-ordered windows and merges nested, equal, and touching ranges', () => {
    const events = [
      marker(12, 0, 15),
      marker(3, 1, 7),
      marker(4, 2, 5),
      marker(3, 3, 7),
      marker(7, 4, 12),
      marker(20, 0, 22),
      { eventType: 'reasoning.delta', payload: {}, sequence: 99 },
    ];

    expect(supersededWindows(events)).toEqual([
      { from: 3, to: 15 },
      { from: 20, to: 22 },
    ]);
    expect(hasSupersededOutput(events)).toBe(true);
  });

  it('orders same-start windows by end before merging', () => {
    const events = [marker(2, 0, 9), marker(2, 0, 4), marker(2, 0, 6)];

    expect(supersededWindows(events)).toEqual([{ from: 2, to: 9 }]);
  });
});
