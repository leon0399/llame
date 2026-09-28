import { NativeFileError, type ReadTarget } from "./path";
import { createMarkdownScanner } from "./markdown-structure";
import {
  admitAncestorChain,
  appendPluralLine,
  MarkdownAncestorTracker,
  type MarkdownLineRecord,
  type NativeEntry,
} from "./markdown-ancestors";
import {
  emptyMultiReadResult,
  MAX_READ_LINES,
  MAX_RESULT_CODE_UNITS,
  renderSourceLine,
  type MultiReadSuccess,
} from "./source-lines";

type PassageLine = { index: number; record: MarkdownLineRecord };
type Passage = {
  range: { offset: number; limit: number };
  firstRequested: number;
  lines: Array<PassageLine>;
  oversizedAt?: number;
  cut?: boolean;
};
type MultiState = {
  result: MultiReadSuccess;
  emittedLines: Set<number>;
};
type PassageContext = {
  passage: Passage;
  selected: Map<number, MarkdownLineRecord>;
  tracker: MarkdownAncestorTracker;
  state: MultiState;
  target: ReadTarget;
  passageIndex: number;
};
type MultiSnapshot = {
  content: string;
  shownRanges: MultiReadSuccess["shownRanges"];
  emittedLines: Set<number>;
};

function firstRequested(
  expanded: { offset: number; limit: number },
  target: ReadTarget,
): number {
  return (
    target.ranges?.find(
      (range) =>
        range.offset >= expanded.offset &&
        range.offset < expanded.offset + expanded.limit,
    )?.offset ?? expanded.offset
  );
}

function mandatoryLines(passage: Passage): Array<NativeEntry> {
  const lines: Array<NativeEntry> = [];
  for (const { index, record } of passage.lines) {
    if (
      (index === passage.firstRequested - 1 ||
        index === passage.firstRequested) &&
      record.rendered !== undefined
    )
      lines.push({ line: index + 1, text: record.rendered });
  }
  return lines;
}

function snapshot(state: MultiState): MultiSnapshot {
  return {
    content: state.result.content,
    shownRanges: [...state.result.shownRanges],
    emittedLines: new Set(state.emittedLines),
  };
}

function restore(state: MultiState, saved: MultiSnapshot): void {
  state.result.content = saved.content;
  state.result.shownRanges = saved.shownRanges;
  state.emittedLines = saved.emittedLines;
}

function appendChain(
  state: MultiState,
  entries: Array<NativeEntry>,
  target: ReadTarget,
): boolean {
  for (const entry of entries) {
    if (!appendPluralLine(state.result, entry.text, entry.line - 1, target))
      return false;
    state.emittedLines.add(entry.line);
  }
  return true;
}

function emitPassageLines(
  context: PassageContext,
  saved: MultiSnapshot,
): boolean {
  const { state, passage, passageIndex, target } = context;
  if (passage.oversizedAt !== undefined) state.result.truncated = true;
  for (const { index, record } of passage.lines) {
    if (state.emittedLines.has(index + 1)) continue;
    if (
      state.emittedLines.size >= MAX_READ_LINES ||
      record.rendered === undefined ||
      !appendPluralLine(state.result, record.rendered, index, target)
    ) {
      if (passageIndex > 0) restore(state, saved);
      state.result.truncated = true;
      state.result.nextOffset =
        passageIndex > 0
          ? passage.range.offset
          : state.emittedLines.size === 0
            ? index + 1
            : index;
      return false;
    }
    state.emittedLines.add(index + 1);
  }
  return true;
}

function emitPassage(context: PassageContext): boolean {
  const { passage, selected, tracker, state, target, passageIndex } = context;
  const saved = snapshot(state);
  if (passage.cut && passageIndex > 0) {
    restore(state, saved);
    state.result.truncated = true;
    state.result.nextOffset = passage.range.offset;
    return false;
  }
  const shown = new Set([
    ...state.emittedLines,
    ...passage.lines.map(({ index }) => index + 1),
  ]);
  const mandatory = mandatoryLines(passage);
  const chain = admitAncestorChain({
    units: tracker.ancestorsFor(passage.firstRequested + 1),
    selected,
    shown,
    mandatory,
    result: state.result,
    emitted: state.emittedLines.size,
    reserveNextOffset: state.result.nextOffset ?? passage.firstRequested + 1,
    target,
    firstRequested: passage.firstRequested,
    firstShownLine: mandatory[0]?.line ?? passage.firstRequested + 1,
  });
  if (!appendChain(state, chain, target)) {
    restore(state, saved);
    state.result.truncated = true;
    state.result.nextOffset = passage.range.offset;
    return false;
  }
  return emitPassageLines(context, saved);
}

type MultiRenderContext = {
  passages: Array<Passage>;
  selected: Map<number, MarkdownLineRecord>;
  count: number;
  tracker: MarkdownAncestorTracker;
  target: ReadTarget;
};

function renderMulti(context: MultiRenderContext): MultiReadSuccess {
  const { passages, selected, count, tracker, target } = context;
  const result = emptyMultiReadResult(target);
  if (target.offset >= count && (count > 0 || target.offset !== 0))
    throw new NativeFileError("invalid_selector");
  if (count === 0) {
    result.requestedRanges = [];
    return result;
  }
  const state: MultiState = { result, emittedLines: new Set() };
  for (const [passageIndex, passage] of passages.entries()) {
    if (
      !emitPassage({ passage, selected, tracker, state, target, passageIndex })
    )
      return result;
  }
  return result;
}

export class MultiCollector {
  private readonly expanded: ReadonlyArray<{ offset: number; limit: number }>;
  private readonly passages: Array<Passage>;
  private readonly selected = new Map<number, MarkdownLineRecord>();
  private readonly tracker: MarkdownAncestorTracker;
  private readonly scanner;
  private activePassage = 0;
  private retainedLines = 0;
  private retainedCodeUnits = 0;
  private stopped = false;
  private haltedAt: number | undefined;

  constructor(private readonly target: ReadTarget) {
    this.expanded = target.expandedRanges ?? [];
    this.passages = this.expanded.map((range) => ({
      range,
      firstRequested: firstRequested(range, target),
      lines: [],
    }));
    this.tracker = new MarkdownAncestorTracker(
      this.passages.map((passage) => passage.firstRequested + 1),
    );
    this.scanner = createMarkdownScanner({
      onLine: (line) => this.tracker.accept(line),
    });
  }
  private retainSelectedLine(
    passage: Passage,
    index: number,
    line: MarkdownLineRecord,
  ): boolean {
    if (line.rendered === undefined) return true;
    if (this.retainedLines >= MAX_READ_LINES) {
      passage.cut = true;
      this.haltedAt = index;
      this.stopped = true;
      return false;
    }
    passage.lines.push({ index, record: line });
    this.selected.set(index, line);
    this.retainedLines += 1;
    this.retainedCodeUnits += renderSourceLine(line.rendered, index).length;
    if (
      this.retainedCodeUnits >
      MAX_RESULT_CODE_UNITS - (this.target.reserveCodeUnits ?? 0)
    ) {
      passage.cut = true;
      this.haltedAt = index + 1;
      this.stopped = true;
      return false;
    }
    return true;
  }
  push(index: number, line: MarkdownLineRecord): boolean {
    if (this.stopped) return false;
    this.scanner.push(line.scanned);
    while (
      this.activePassage < this.passages.length &&
      index >=
        this.passages[this.activePassage].range.offset +
          this.passages[this.activePassage].range.limit
    )
      this.activePassage += 1;
    const passage = this.passages[this.activePassage];
    if (passage !== undefined && index >= passage.range.offset) {
      if (line.rendered === undefined) passage.oversizedAt ??= index;
      else if (
        line.rendered !== undefined &&
        !this.retainSelectedLine(passage, index, line)
      )
        return false;
      if (
        this.activePassage === this.passages.length - 1 &&
        index >= passage.range.offset + passage.range.limit - 1
      ) {
        this.stopped = true;
        return false;
      }
    }
    return true;
  }

  finish(count: number): MultiReadSuccess {
    this.scanner.end();
    const result = renderMulti({
      passages: this.passages,
      selected: this.selected,
      count,
      tracker: this.tracker,
      target: this.target,
    });
    if (this.haltedAt !== undefined && result.nextOffset === undefined) {
      result.truncated = true;
      result.nextOffset = this.haltedAt;
    }
    return result;
  }
}
