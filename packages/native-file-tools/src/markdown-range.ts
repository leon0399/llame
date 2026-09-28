import { NativeFileError, type ReadTarget } from "./path";
import { createMarkdownScanner } from "./markdown-structure";
import {
  createMarkdownAncestorTracker,
  rangesForLines,
  type MarkdownAncestorTracker,
  type MarkdownLineRecord,
} from "./markdown-ancestors";
import { measureNativeModelOutput } from "./serialization";
import {
  emptyMultiReadResult,
  MAX_READ_LINES,
  MAX_RESULT_CODE_UNITS,
  renderSourceLine,
  resultBudget,
  type LineRange,
  type MultiReadSuccess,
} from "./source-lines";

type NativeEntry = { line: number; text: string };
type MarkdownMultiCollector = {
  push(index: number, line: MarkdownLineRecord): boolean;
  finish(count: number): MultiReadSuccess;
};
type PassageLine = { index: number; record: MarkdownLineRecord };
type Passage = {
  range: { offset: number; limit: number };
  firstRequested: number;
  lines: Array<PassageLine>;
};
type MultiState = {
  result: MultiReadSuccess;
  emitted: number;
  emittedLines: Set<number>;
};
type ChainContext = {
  passage: Passage;
  selected: Map<number, MarkdownLineRecord>;
  tracker: MarkdownAncestorTracker;
  state: MultiState;
  target: ReadTarget;
};
type PassageContext = ChainContext & { passageIndex: number };
type MultiSnapshot = {
  content: string;
  shownRanges: Array<LineRange>;
  emitted: number;
  emittedLines: Set<number>;
};

function scannerFor(
  tracker: MarkdownAncestorTracker,
): ReturnType<typeof createMarkdownScanner> {
  return createMarkdownScanner({ onLine: (line) => tracker.accept(line) });
}

class MultiCollector implements MarkdownMultiCollector {
  private readonly expanded: ReadonlyArray<{ offset: number; limit: number }>;
  private readonly selected = new Map<number, MarkdownLineRecord>();
  private readonly scanner;
  private stopped = false;

  constructor(private readonly target: ReadTarget) {
    this.expanded = target.expandedRanges ?? [];
    const starts = this.expanded.map((range) => firstRequested(range, target));
    const tracker = createMarkdownAncestorTracker(
      starts.map((line) => line + 1),
    );
    this.tracker = tracker;
    this.scanner = scannerFor(tracker);
  }

  private readonly tracker: MarkdownAncestorTracker;

  push(index: number, line: MarkdownLineRecord): boolean {
    if (this.stopped) return false;
    this.scanner.push(line.scanned);
    if (this.inExpanded(index)) this.selected.set(index, line);
    const last = this.expanded.at(-1);
    if (last !== undefined && index >= last.offset + last.limit - 1) {
      this.stopped = true;
      return false;
    }
    return true;
  }

  finish(count: number): MultiReadSuccess {
    this.scanner.end();
    return renderMulti(this.selected, count, this.tracker, this.target);
  }

  private inExpanded(index: number): boolean {
    return this.expanded.some(
      (range) => index >= range.offset && index < range.offset + range.limit,
    );
  }
}

export function createMarkdownMultiCollector(
  target: ReadTarget,
): MarkdownMultiCollector {
  if (target.ranges === undefined) throw new NativeFileError("invalid_input");
  return new MultiCollector(target);
}

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

function passagesFor(
  selected: Map<number, MarkdownLineRecord>,
  target: ReadTarget,
): Array<Passage> {
  const passages: Array<Passage> = [];
  for (const range of target.expandedRanges ?? []) {
    const lines: Array<PassageLine> = [];
    for (const [index, record] of selected) {
      if (index >= range.offset && index < range.offset + range.limit)
        lines.push({ index, record });
    }
    passages.push({
      range,
      firstRequested: firstRequested(range, target),
      lines,
    });
  }
  return passages;
}

function withLineRanges(
  ranges: Array<LineRange>,
  lines: Iterable<number>,
): Array<LineRange> {
  const existing = ranges.flatMap((range) => {
    const values: Array<number> = [];
    for (let line = range.startLine; line <= range.endLine; line += 1)
      values.push(line);
    return values;
  });
  return rangesForLines([...existing, ...lines]);
}

function appendPluralLine(
  result: MultiReadSuccess,
  text: string,
  index: number,
  target: ReadTarget,
): boolean {
  const line = renderSourceLine(text, index);
  const candidate: MultiReadSuccess = {
    ...result,
    content: result.content + line,
    shownRanges: withLineRanges(result.shownRanges, [index + 1]),
  };
  if (
    measureNativeModelOutput({ ...candidate, nextOffset: result.nextOffset }) >
    resultBudget(target)
  )
    return false;
  Object.assign(result, candidate);
  return true;
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

function chainEntries(
  context: ChainContext,
): Array<Array<NativeEntry>> | undefined {
  const { passage, selected, tracker, state } = context;
  const passageLines = new Set(passage.lines.map(({ index }) => index + 1));
  const shown = new Set([...state.emittedLines, ...passageLines]);
  const grouped: Array<Array<NativeEntry>> = [];
  for (const unit of tracker.ancestorsFor(passage.firstRequested + 1)) {
    const entries: Array<NativeEntry> = [];
    for (const line of unit.lines) {
      const selectedLine = selected.get(line.line);
      const text =
        selectedLine === undefined ? line.text : selectedLine.rendered;
      if (text === undefined || text.length > MAX_RESULT_CODE_UNITS)
        return undefined;
      if (!shown.has(line.line)) entries.push({ line: line.line, text });
    }
    grouped.push(entries);
  }
  return grouped;
}

function admitChain(
  context: ChainContext,
  grouped: Array<Array<NativeEntry>> | undefined,
  mandatory: Array<NativeEntry>,
): Array<NativeEntry> {
  if (
    grouped === undefined ||
    !mandatory.some(
      (entry) => entry.line === context.passage.firstRequested + 1,
    )
  )
    return [];
  for (let start = 0; start < grouped.length; start += 1) {
    const entries = grouped.slice(start).flat();
    if (entries.length === 0) return [];
    const candidate = [...entries];
    for (const entry of mandatory) {
      if (!context.state.emittedLines.has(entry.line)) candidate.push(entry);
    }
    const lines = new Set(candidate.map((entry) => entry.line));
    if (context.state.emitted + lines.size > MAX_READ_LINES) continue;
    const result = context.state.result;
    const content =
      result.content +
      candidate
        .map((entry) => renderSourceLine(entry.text, entry.line - 1))
        .join("");
    if (
      measureNativeModelOutput({
        ...result,
        content,
        shownRanges: withLineRanges(result.shownRanges, lines),
        nextOffset: result.nextOffset,
      }) <= resultBudget(context.target)
    )
      return entries;
  }
  return [];
}

function chainForPassage(context: ChainContext): Array<NativeEntry> {
  const mandatory = mandatoryLines(context.passage);
  const grouped = chainEntries(context);
  return admitChain(context, grouped, mandatory);
}

function appendChain(
  state: MultiState,
  entries: Array<NativeEntry>,
  target: ReadTarget,
): boolean {
  for (const entry of entries) {
    if (!appendPluralLine(state.result, entry.text, entry.line - 1, target))
      return false;
    state.emitted += 1;
    state.emittedLines.add(entry.line);
  }
  return true;
}

function snapshot(state: MultiState): MultiSnapshot {
  return {
    content: state.result.content,
    shownRanges: [...state.result.shownRanges],
    emitted: state.emitted,
    emittedLines: new Set(state.emittedLines),
  };
}

function restore(state: MultiState, saved: MultiSnapshot): void {
  state.result.content = saved.content;
  state.result.shownRanges = saved.shownRanges;
  state.emitted = saved.emitted;
  state.emittedLines = saved.emittedLines;
}

function emitPassageLines(
  context: PassageContext,
  saved: MultiSnapshot,
): boolean {
  const { state, passage, passageIndex, target } = context;
  for (const { index, record } of passage.lines) {
    if (state.emittedLines.has(index + 1)) continue;
    if (record.rendered === undefined) {
      state.result.truncated = true;
      continue;
    }
    if (
      state.emitted >= MAX_READ_LINES ||
      !appendPluralLine(state.result, record.rendered, index, target)
    ) {
      if (passageIndex > 0) restore(state, saved);
      state.result.truncated = true;
      state.result.nextOffset =
        passageIndex > 0
          ? passage.range.offset
          : state.emitted === 0
            ? index + 1
            : index;
      return false;
    }
    state.emitted += 1;
    state.emittedLines.add(index + 1);
  }
  return true;
}

function emitPassage(context: PassageContext): boolean {
  const saved = snapshot(context.state);
  const chain = chainForPassage(context);
  if (!appendChain(context.state, chain, context.target)) {
    restore(context.state, saved);
    context.state.result.truncated = true;
    context.state.result.nextOffset = context.passage.range.offset;
    return false;
  }
  return emitPassageLines(context, saved);
}

function renderMulti(
  selected: Map<number, MarkdownLineRecord>,
  count: number,
  tracker: MarkdownAncestorTracker,
  target: ReadTarget,
): MultiReadSuccess {
  const result = emptyMultiReadResult(target);
  if (target.offset >= count && (count > 0 || target.offset !== 0))
    throw new NativeFileError("invalid_selector");
  if (count === 0) {
    result.requestedRanges = [];
    return result;
  }
  const state: MultiState = { result, emitted: 0, emittedLines: new Set() };
  for (const [passageIndex, passage] of passagesFor(
    selected,
    target,
  ).entries()) {
    const context: PassageContext = {
      passage,
      selected,
      tracker,
      state,
      target,
      passageIndex,
    };
    if (!emitPassage(context)) return result;
  }
  return result;
}
