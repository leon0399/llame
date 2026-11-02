import { describe, expect, it } from 'vitest';

import {
  type GrepBudget,
  type GrepPassage,
} from '@workspace/native-file-tools';

import {
  addGrepPassages,
  appendSegment,
  budgetAfter,
  createPageState,
  grepArtifactBytes,
  grepArtifactText,
  pageResult,
} from './grep-page';
import { type GrepReadAdmission } from './grep-admission';

const BUDGET: GrepBudget = {
  files: 10,
  entries: 20,
  bytes: 1000,
  maxFileBytes: null,
  deadlineMs: 0,
  limit: 20,
  pageUnits: 15_000,
  fixedReserve: 120,
};

/** A `read` group that admits every locator the page names. */
const OPEN: GrepReadAdmission = {
  admit: () => true,
  allows: () => true,
  refused: 0,
  recordRefusals: () => undefined,
};

function passage(
  locator: string,
  content: string,
  matches: ReadonlyArray<number>,
  marks: { readonly cut?: boolean; readonly truncated?: boolean } = {},
): GrepPassage {
  return {
    locator,
    content,
    matches,
    ...(marks.cut === true && { cut: true as const }),
    ...(marks.truncated === true && { truncated: true as const }),
  };
}

describe('grep page budgets', () => {
  it('hands the next walk the bounds the earlier one left', () => {
    const consumed = { files: 3, entries: 7, bytes: 400 };
    const remaining = budgetAfter(BUDGET, consumed, Date.now() + 1000);
    expect(remaining).toMatchObject({
      files: 7,
      entries: 13,
      bytes: 600,
      limit: 20,
      pageUnits: 15_000,
    });
    expect(remaining.deadlineMs).toBeGreaterThan(0);
  });

  it('keeps an unset bound unset and stops a set one at zero', () => {
    expect(
      budgetAfter(BUDGET, { files: 12, entries: 30, bytes: 2000 }, 0),
    ).toMatchObject({ files: 0, entries: 0, bytes: 0 });
    const unset = budgetAfter(
      { ...BUDGET, files: null, entries: null, bytes: null },
      { files: 12, entries: 30, bytes: 2000 },
      0,
    );
    expect(unset).toMatchObject({ files: null, entries: null, bytes: null });
  });

  it('reports an expired deadline as zero', () => {
    const remaining = budgetAfter(
      BUDGET,
      { files: 0, entries: 0, bytes: 0 },
      Date.now() - 1,
    );
    expect(remaining.deadlineMs).toBe(0);
  });
});

/** A page state whose artifact takes any passage the tests hand it. */
function pageState() {
  return createPageState({
    maxBytes: 1_048_576,
    mayCarryKnowledge: false,
  });
}

describe('grep page assembly', () => {
  it('joins the passage a page cut and its continuation', () => {
    const state = pageState();
    addGrepPassages(state.artifact, [
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4], { cut: true }),
      passage('a.md:6-7', '6: d\n7: e', [7]),
    ]);
    expect(state.artifact.results).toEqual([
      passage('a.md:3-7', '3: a\n4: b\n5: c\n6: d\n7: e', [4, 7]),
    ]);
    expect(grepArtifactText(state.artifact)).toBe(
      '## a.md\n3: a\n*4: b\n5: c\n6: d\n*7: e',
    );
  });

  /** Append one page of passages with the fields a join test does not set. */
  function appendPassages(
    state: ReturnType<typeof createPageState>,
    results: ReadonlyArray<GrepPassage>,
  ): void {
    appendSegment(
      state,
      {
        results,
        complete: true,
        warnings: [],
        consumed: { files: 1, entries: 1, bytes: 10 },
        progressed: true,
      },
      OPEN,
    );
  }

  it('keeps a passage after one that was not cut', () => {
    const state = createPageState();
    appendPassages(state, [
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4]),
      passage('a.md:6-7', '6: d\n7: e', [7]),
    ]);
    expect(state.results.map((entry) => entry.locator)).toEqual([
      'a.md:3-5',
      'a.md:6-7',
    ]);
  });

  it('keeps the continuation of another file apart', () => {
    const state = createPageState();
    appendPassages(state, [
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4], { cut: true }),
      passage('b.md:6-7', '6: d\n7: e', [7]),
    ]);
    expect(state.results.map((entry) => entry.locator)).toEqual([
      'a.md:3-5',
      'b.md:6-7',
    ]);
  });

  it('keeps a passage that does not start after the cut apart', () => {
    const state = createPageState();
    appendPassages(state, [
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4], { cut: true }),
      passage('a.md:9-10', '9: d\n10: e', [9]),
    ]);
    expect(state.results.map((entry) => entry.locator)).toEqual([
      'a.md:3-5',
      'a.md:9-10',
    ]);
  });

  it('keeps the cap of either half of a joined passage', () => {
    const cappedFirst = createPageState();
    appendPassages(cappedFirst, [
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4], {
        cut: true,
        truncated: true,
      }),
      passage('a.md:6-7', '6: d\n7: e', [7]),
    ]);
    expect(cappedFirst.results[0]).toMatchObject({ truncated: true });

    const cappedSecond = createPageState();
    appendPassages(cappedSecond, [
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4], { cut: true }),
      passage('a.md:6-7', '6: d\n7: e', [7], { truncated: true }),
    ]);
    expect(cappedSecond.results[0]).toMatchObject({ truncated: true });
    expect(cappedSecond.results[0]).not.toHaveProperty('cut');
  });

  it('keeps a cut and a cap mark the continuation carries', () => {
    const state = createPageState();
    appendPassages(state, [
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4], { cut: true }),
      passage('a.md:6-9', '6: d\n7: e', [7], {
        cut: true,
        truncated: true,
      }),
    ]);
    expect(state.results).toHaveLength(1);
    expect(state.results[0]).toMatchObject({ cut: true, truncated: true });
  });

  it('counts an excluded directory a second page repeats once', () => {
    const state = createPageState();
    const page = {
      results: [],
      complete: true,
      warnings: [],
      consumed: { files: 0, entries: 0, bytes: 0 },
      progressed: false,
      ignored: { paths: ['/r/skip'], atLeast: false },
    };
    appendSegment(state, page, OPEN);
    appendSegment(state, page, OPEN);
    const result = pageResult(state);
    expect(result).toMatchObject({
      ignored: { count: 1, locators: ['/r/skip'] },
    });
  });

  it('keeps a cut passage the walk stopped in as it is', () => {
    const state = pageState();
    appendSegment(
      state,
      {
        complete: false,
        warnings: [{ kind: 'deadline', count: 1 }],
        consumed: { files: 1, entries: 1, bytes: 10 },
        progressed: true,
      },
      OPEN,
    );
    addGrepPassages(state.artifact, [
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4], { cut: true }),
    ]);
    expect(state.artifact.results).toEqual([
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4], { cut: true }),
    ]);
  });

  it('merges the counts, bounds, and exclusions of two segments', () => {
    const state = pageState();
    appendSegment(
      state,
      {
        complete: true,
        warnings: [{ kind: 'binary', count: 2 }],
        consumed: { files: 1, entries: 3, bytes: 10 },
        progressed: false,
        ignored: { paths: ['/r/skip'], atLeast: false },
      },
      OPEN,
    );
    addGrepPassages(state.artifact, [passage('a.md:1-1', '1: a', [1])]);
    appendSegment(
      state,
      {
        complete: true,
        warnings: [{ kind: 'binary', count: 1 }],
        consumed: { files: 1, entries: 2, bytes: 5 },
        progressed: true,
      },
      OPEN,
    );
    addGrepPassages(state.artifact, [passage('b.md:1-1', '1: b', [1])]);
    const result = pageResult(state);
    expect(result).toMatchObject({
      status: 'success',
      complete: true,
      warnings: [{ kind: 'binary', count: 3 }],
      ignored: { count: 1, locators: ['/r/skip'] },
    });
    expect(state.consumed).toEqual({ files: 2, entries: 5, bytes: 15 });
    expect(state.progressed).toBe(true);
  });

  it('stops the artifact at its byte bound and reports the stop', () => {
    const state = createPageState({
      maxBytes: 20,
      mayCarryKnowledge: false,
    });
    expect(
      addGrepPassages(state.artifact, [
        passage('a.md:1-1', '1: a', [1]),
        passage('b.md:1-1', '1: b', [1]),
      ]),
    ).toBe(false);
    expect(state.artifact.full).toBe(true);
    expect(state.artifact.results).toHaveLength(1);
    expect(grepArtifactBytes(state.artifact)).toBeLessThanOrEqual(20);
  });

  it('carries no cursor, whether the walk ended or a bound stopped it', () => {
    const stopped = pageState();
    appendSegment(
      stopped,
      {
        complete: false,
        warnings: [{ kind: 'file_bound', count: 1 }],
        consumed: { files: 1, entries: 1, bytes: 0 },
        progressed: false,
        unfinished: '/r/big.log',
      },
      OPEN,
    );
    // The caller records a segment's stop on the state, as the walk does.
    stopped.complete = false;
    const result = pageResult(stopped);
    expect(result).toMatchObject({
      status: 'success',
      results: [],
      complete: false,
      warnings: [{ kind: 'file_bound', count: 1 }],
      unfinishedFile: '/r/big.log',
    });
    expect(result).not.toHaveProperty('cursor');
    expect(pageResult(pageState())).not.toHaveProperty('cursor');
  });
});
