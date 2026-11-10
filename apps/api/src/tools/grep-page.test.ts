import { describe, expect, it } from 'vitest';

import {
  grepPassageBlockLines,
  type GrepBudget,
  type GrepPassage,
} from '@workspace/native-file-tools';

import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';

import {
  addGrepPassages,
  appendSegment,
  budgetAfter,
  createGrepArtifact,
  createPageState,
  grepArtifactBytes,
  grepArtifactFindings,
  grepArtifactHasNotice,
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

  /** Keep one page of passages; the join rules live in the artifact text. */
  function appendPassages(
    state: ReturnType<typeof pageState>,
    results: ReadonlyArray<GrepPassage>,
  ): void {
    addGrepPassages(state.artifact, results);
  }

  it('keeps a passage after one that was not cut', () => {
    const state = pageState();
    appendPassages(state, [
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4]),
      passage('a.md:6-7', '6: d\n7: e', [7]),
    ]);
    expect(state.artifact.results.map((entry) => entry.locator)).toEqual([
      'a.md:3-5',
      'a.md:6-7',
    ]);
  });

  it('keeps the continuation of another file apart', () => {
    const state = pageState();
    appendPassages(state, [
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4], { cut: true }),
      passage('b.md:6-7', '6: d\n7: e', [7]),
    ]);
    expect(state.artifact.results.map((entry) => entry.locator)).toEqual([
      'a.md:3-5',
      'b.md:6-7',
    ]);
  });

  it('keeps a passage that does not start after the cut apart', () => {
    const state = pageState();
    appendPassages(state, [
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4], { cut: true }),
      passage('a.md:9-10', '9: d\n10: e', [9]),
    ]);
    expect(state.artifact.results.map((entry) => entry.locator)).toEqual([
      'a.md:3-5',
      'a.md:9-10',
    ]);
  });

  it('keeps the cap of either half of a joined passage', () => {
    const cappedFirst = pageState();
    appendPassages(cappedFirst, [
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4], {
        cut: true,
        truncated: true,
      }),
      passage('a.md:6-7', '6: d\n7: e', [7]),
    ]);
    expect(cappedFirst.artifact.results[0]).toMatchObject({ truncated: true });

    const cappedSecond = pageState();
    appendPassages(cappedSecond, [
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4], { cut: true }),
      passage('a.md:6-7', '6: d\n7: e', [7], { truncated: true }),
    ]);
    expect(cappedSecond.artifact.results[0]).toMatchObject({ truncated: true });
    expect(cappedSecond.artifact.results[0]).not.toHaveProperty('cut');
  });

  it('keeps a cut and a cap mark the continuation carries', () => {
    const state = pageState();
    appendPassages(state, [
      passage('a.md:3-5', '3: a\n4: b\n5: c', [4], { cut: true }),
      passage('a.md:6-9', '6: d\n7: e', [7], {
        cut: true,
        truncated: true,
      }),
    ]);
    expect(state.artifact.results).toHaveLength(1);
    expect(state.artifact.results[0]).toMatchObject({
      cut: true,
      truncated: true,
    });
  });

  it('counts an excluded directory a second page repeats once', () => {
    const state = pageState();

    const page = {
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

  it('counts the blank line between passages in each finding range', () => {
    const state = pageState();
    addGrepPassages(state.artifact, [
      passage('a.md:1-1', '1: x', [1]),
      passage('a.md:5-5', '5: y', [5]),
      passage('b.md:2-2', '2: z', [2]),
    ]);
    const lines = grepArtifactText(state.artifact).split('\n');
    expect(lines).toEqual([
      '## a.md',
      '*1: x',
      '',
      '*5: y',
      '## b.md',
      '*2: z',
    ]);
    expect(grepArtifactFindings(state.artifact)).toEqual([
      { locators: ['a.md'], rule: 'allow_only', start: 1, end: 4 },
      { locators: ['b.md'], rule: 'allow_only', start: 5, end: 6 },
    ]);
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

describe('grep artifact text accounting', () => {
  const NOTICE_LINE = `notice: ${KNOWLEDGE_CONTENT_NOTICE}`;

  it('keeps the notice line and its newline back from the first passage', () => {
    const artifact = createGrepArtifact({
      maxBytes: 100_000,
      mayCarryKnowledge: true,
    });

    // An empty artifact already holds the notice's bytes back, without its
    // own terminator: the first passage takes that one.
    expect(grepArtifactBytes(artifact)).toBe(
      Buffer.byteLength(NOTICE_LINE, 'utf8'),
    );
    addGrepPassages(artifact, [passage('a.md:1-1', '1: a', [1])]);
    expect(grepArtifactText(artifact)).not.toContain('notice:');
    expect(grepArtifactBytes(artifact)).toBe(
      Buffer.byteLength(grepArtifactText(artifact), 'utf8') +
        Buffer.byteLength(NOTICE_LINE, 'utf8') +
        1,
    );
  });

  it('keeps no bytes back for a notice the call cannot carry', () => {
    const artifact = createGrepArtifact({
      maxBytes: 10,
      mayCarryKnowledge: false,
    });

    expect(grepArtifactBytes(artifact)).toBe(0);
  });

  it('accepts the passage that exactly fills the bound', () => {
    const one = passage('a.md:1-1', '1: a', [1]);

    const bytes = grepPassageBlockLines(undefined, one, false).reduce(
      (total, line) => total + Buffer.byteLength(line, 'utf8') + 1,
      0,
    );

    const artifact = createGrepArtifact({
      maxBytes: bytes,
      mayCarryKnowledge: false,
    });

    expect(addGrepPassages(artifact, [one])).toBe(true);
    // The next passage would pass the bound, so it is not stored and the walk
    // must stop.
    expect(addGrepPassages(artifact, [passage('b.md:1-1', '1: b', [1])])).toBe(
      false,
    );
    expect(artifact.full).toBe(true);
    expect(artifact.results).toHaveLength(1);
  });

  it('counts the blank line and never the inline cut marker', () => {
    const state = pageState();
    addGrepPassages(state.artifact, [
      passage('a.md:1-1', '1: a', [1], { cut: true }),
      passage('a.md:5-5', '5: b', [5]),
    ]);
    const text = grepArtifactText(state.artifact);
    expect(text).toBe('## a.md\n*1: a\n\n*5: b');
    expect(grepArtifactBytes(state.artifact)).toBe(
      Buffer.byteLength(text, 'utf8'),
    );
    expect(grepArtifactFindings(state.artifact)).toEqual([
      {
        locators: ['a.md'],
        rule: 'allow_only',
        start: 1,
        end: text.split('\n').length,
      },
    ]);
  });

  it('accepts a continuation that exactly fills the bound', () => {
    const cut = passage('a.md:1-2', '1: a\n2: b', [1], { cut: true });
    const next = passage('a.md:3-4', '3: c\n*4: d', [4]);
    const extra = passage('a.md:5-6', '5: e\n*6: f', [6]);

    const bytesOf = (lines: ReadonlyArray<string>): number =>
      lines.reduce(
        (total, line) => total + Buffer.byteLength(line, 'utf8') + 1,
        0,
      );

    const cutBytes = bytesOf(grepPassageBlockLines(undefined, cut, false));

    const added = bytesOf(
      grepPassageBlockLines(undefined, next, false).slice(1),
    );

    const addedExtra = bytesOf(
      grepPassageBlockLines(undefined, extra, false).slice(1),
    );

    const artifact = createGrepArtifact({
      maxBytes: cutBytes + added,
      mayCarryKnowledge: false,
    });

    expect(addGrepPassages(artifact, [cut])).toBe(true);
    // The continuation fills the bound exactly and is taken.
    expect(addGrepPassages(artifact, [next])).toBe(true);
    const text = grepArtifactText(artifact);
    expect(grepArtifactBytes(artifact)).toBe(Buffer.byteLength(text, 'utf8'));
    expect(grepArtifactFindings(artifact)[0]?.end).toBe(
      text.split('\n').length,
    );

    // The next continuation would pass the bound: it is dropped, the artifact
    // stops, and nothing it already holds changes.
    const before = artifact.results.slice();
    expect(artifact.maxBytes).toBeLessThan(cutBytes + added + addedExtra);
    expect(addGrepPassages(artifact, [extra])).toBe(false);
    expect(artifact.full).toBe(true);
    expect(artifact.results).toEqual(before);
  });

  it('appends only the continuation lines of a joined passage', () => {
    const state = pageState();
    addGrepPassages(state.artifact, [
      passage('a.md:1-2', '1: a\n2: b', [1], { cut: true }),
    ]);
    addGrepPassages(state.artifact, [passage('a.md:3-4', '3: c\n*4: d', [4])]);
    const text = grepArtifactText(state.artifact);
    expect(text).toBe('## a.md\n*1: a\n2: b\n3: c\n*4: d');
    expect(grepArtifactBytes(state.artifact)).toBe(
      Buffer.byteLength(text, 'utf8'),
    );
    expect(grepArtifactFindings(state.artifact)).toEqual([
      { locators: ['a.md'], rule: 'allow_only', start: 1, end: 5 },
    ]);
  });

  it('renders the notice line only for a Knowledge passage', () => {
    const withKnowledge = createGrepArtifact({
      maxBytes: 100_000,
      mayCarryKnowledge: true,
    });

    addGrepPassages(withKnowledge, [
      passage('kb://space/a.md:1-1', '1: a', [1]),
    ]);
    expect(grepArtifactHasNotice(withKnowledge)).toBe(true);
    expect(grepArtifactText(withKnowledge).split('\n')[0]).toBe(NOTICE_LINE);

    const plain = createGrepArtifact({
      maxBytes: 100_000,
      mayCarryKnowledge: true,
    });

    addGrepPassages(plain, [passage('/r/a.md:1-1', '1: a', [1])]);
    expect(grepArtifactHasNotice(plain)).toBe(false);
  });

  it('adds no ignored field or notice to a result that has neither', () => {
    const state = pageState();
    expect(pageResult(state)).not.toHaveProperty('ignored');
    expect(pageResult(state)).not.toHaveProperty('notice');
    appendSegment(
      state,
      {
        complete: true,
        warnings: [],
        consumed: { files: 0, entries: 0, bytes: 0 },
        progressed: false,
        ignored: { paths: ['/r/skip'], atLeast: false },
      },
      OPEN,
    );
    expect(pageResult(state)).toMatchObject({ ignored: { count: 1 } });
  });
});
