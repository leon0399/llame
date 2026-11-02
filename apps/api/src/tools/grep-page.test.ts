import { describe, expect, it } from 'vitest';

import {
  grepWarningsUnits,
  type GrepBudget,
} from '@workspace/native-file-tools';

import {
  createPageState,
  deadlineUnits,
  remainingBudget,
  resumePointOf,
} from './grep-page';

const BUDGET: GrepBudget = {
  files: null,
  entries: null,
  bytes: null,
  maxFileBytes: null,
  deadlineMs: 0,
  limit: 20,
  pageUnits: 15_000,
  fixedReserve: 120,
};

/** The deadline line the hub reserves when it adds its own warning. */
const DEADLINE_LINE = grepWarningsUnits(new Map([['deadline', 1]]));

describe('grep page reserves', () => {
  it('keeps the warnings and deadline lines back from a segment room', () => {
    const state = createPageState();
    state.warnings.set('binary', 5);
    const remaining = remainingBudget(BUDGET, state, Date.now() + 1000);
    // The warnings line plus the deadline's marginal width, measured as the
    // merged line the page would render.
    expect(remaining.pageUnits).toBe(
      15_000 -
        grepWarningsUnits(
          new Map([
            ['binary', 5],
            ['deadline', 1],
          ]),
        ),
    );
    expect(remaining.fixedReserve).toBe(BUDGET.fixedReserve);
  });

  it('reserves the deadline count once, and nothing once it is reported', () => {
    expect(deadlineUnits(new Map())).toBe(DEADLINE_LINE);
    expect(deadlineUnits(new Map([['binary', 5]]))).toBe(
      grepWarningsUnits(
        new Map([
          ['binary', 5],
          ['deadline', 1],
        ]),
      ) - grepWarningsUnits(new Map([['binary', 5]])),
    );
    // A daemon page that already reported the deadline needs no more room,
    // even when its count accumulated past a digit boundary.
    expect(deadlineUnits(new Map([['deadline', 10]]))).toBe(0);
  });
});

describe('grep page resume points', () => {
  it('keeps an incoming position cursor as a position', () => {
    expect(
      resumePointOf({
        kind: 'position',
        scopeIndex: 2,
        rel: 'b.md',
        inputHash: 'hash',
      }),
    ).toStrictEqual({ kind: 'position', scopeIndex: 2, rel: 'b.md' });
  });

  it('hands a passage cursor back with its cut and cap marks', () => {
    expect(
      resumePointOf({
        kind: 'passage',
        scopeIndex: 1,
        rel: 'a.go',
        startLine: 3,
        endLine: 4,
        truncated: true,
        inputHash: 'hash',
      }),
    ).toStrictEqual({
      kind: 'passage',
      end: {
        scopeIndex: 1,
        rel: 'a.go',
        startLine: 3,
        endLine: 4,
        capped: true,
      },
    });
    expect(
      resumePointOf({
        kind: 'passage',
        scopeIndex: 0,
        rel: 'a.go',
        startLine: 1,
        inputHash: 'hash',
      }),
    ).toStrictEqual({
      kind: 'passage',
      end: { scopeIndex: 0, rel: 'a.go', startLine: 1, capped: false },
    });
  });
});
