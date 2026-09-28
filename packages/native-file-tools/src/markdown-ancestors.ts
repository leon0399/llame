import { NativeFileError, type ReadTarget } from "./path";
import {
  createMarkdownScanner,
  type MarkdownHeading,
  type MarkdownLine,
} from "./markdown-structure";
import { measureNativeModelOutput } from "./serialization";
import {
  appendReadLine,
  emptyReadResult,
  MAX_READ_LINES,
  MAX_RESULT_CODE_UNITS,
  renderSourceLine,
  resultBudget,
  splitSourceLines,
  type LineRange,
  type MultiReadSuccess,
  type ReadSuccess,
  type SingleReadSuccess,
} from "./source-lines";

export type MarkdownLineRecord = {
  scanned: string;
  rendered: string | undefined;
};

export type MarkdownHeadingUnit = {
  heading: MarkdownHeading;
  lines: Array<MarkdownLine>;
};

export type MarkdownAncestorTracker = {
  accept(line: MarkdownLine): void;
  current(): ReadonlyArray<MarkdownHeadingUnit>;
  ancestorsFor(line: number): ReadonlyArray<MarkdownHeadingUnit>;
};

class RootHeadingTracker implements MarkdownAncestorTracker {
  private readonly stack: Array<MarkdownHeadingUnit> = [];
  private readonly chains = new Map<number, Array<MarkdownHeadingUnit>>();

  constructor(private readonly requestedLines: ReadonlySet<number>) {}

  accept(line: MarkdownLine): void {
    const heading = line.heading;
    if (line.role === "heading" && heading !== undefined) {
      if (heading.line === line.line) this.open(heading);
      const current = this.stack.at(-1);
      if (current?.heading === heading) current.lines.push(line);
    }
    if (this.requestedLines.has(line.line))
      this.chains.set(line.line, [...this.stack]);
  }

  current(): ReadonlyArray<MarkdownHeadingUnit> {
    return this.stack;
  }

  ancestorsFor(line: number): ReadonlyArray<MarkdownHeadingUnit> {
    return this.chains.get(line) ?? [];
  }

  private open(heading: MarkdownHeading): void {
    while ((this.stack.at(-1)?.heading.depth ?? 0) >= heading.depth)
      this.stack.pop();
    this.stack.push({ heading, lines: [] });
  }
}

export function createMarkdownAncestorTracker(
  requestedLines: Iterable<number> = [],
): MarkdownAncestorTracker {
  return new RootHeadingTracker(new Set(requestedLines));
}

/** Build the scanner input and preserve today's unrenderable-line semantics. */
export function markdownLineRecord(text: string): MarkdownLineRecord {
  if (text.length <= MAX_RESULT_CODE_UNITS)
    return { scanned: text, rendered: text };
  const terminator = text.endsWith("\r\n")
    ? "\r\n"
    : text.endsWith("\n")
      ? "\n"
      : "";
  const body = text.slice(0, text.length - terminator.length);
  return {
    scanned: body.slice(0, MAX_RESULT_CODE_UNITS) + terminator,
    rendered: undefined,
  };
}

type NativeEntry = { line: number; text: string };
type SelectedLine = { index: number; text: string | undefined };
type SingleInitialResult = {
  result: SingleReadSuccess;
  boundedEnd: number;
  requestedEnd: number;
};
type SingleChainContext = {
  units: ReadonlyArray<MarkdownHeadingUnit>;
  selected: Map<number, MarkdownLineRecord>;
  shown: ReadonlySet<number>;
  base: MultiReadSuccess;
  mandatory: Array<NativeEntry>;
  target: ReadTarget;
};
type SingleSelection = {
  selectedMap: Map<number, MarkdownLineRecord>;
  shown: Set<number>;
  mandatory: Array<NativeEntry>;
};
type PromotedSingleContext = {
  base: MultiReadSuccess;
  singular: SingleReadSuccess;
  entries: Array<NativeEntry>;
  selected: Array<SelectedLine>;
  requestedEnd: number;
  target: ReadTarget;
};
type MarkdownSingleCollector = {
  push(index: number, line: MarkdownLineRecord): boolean;
  finish(count: number): ReadSuccess;
};

function scannerFor(
  tracker: MarkdownAncestorTracker,
): ReturnType<typeof createMarkdownScanner> {
  return createMarkdownScanner({ onLine: (line) => tracker.accept(line) });
}

class SingleCollector implements MarkdownSingleCollector {
  private readonly start: number;
  private readonly boundedEnd: number;
  private readonly selected: Array<SelectedLine> = [];
  private readonly scanner;
  private stopped = false;

  constructor(private readonly target: ReadTarget) {
    this.start = Math.max(0, target.offset - 1);
    this.boundedEnd =
      target.offset + Math.min(target.limit ?? MAX_READ_LINES, MAX_READ_LINES);
    const tracker = createMarkdownAncestorTracker([target.offset + 1]);
    this.tracker = tracker;
    this.scanner = scannerFor(tracker);
  }

  private readonly tracker: MarkdownAncestorTracker;

  push(index: number, line: MarkdownLineRecord): boolean {
    if (this.stopped) return false;
    this.scanner.push(line.scanned);
    if (index >= this.start && index <= this.boundedEnd)
      this.selected.push({ index, text: line.rendered });
    if (index >= this.boundedEnd) {
      this.stopped = true;
      return false;
    }
    return true;
  }

  finish(count: number): ReadSuccess {
    this.scanner.end();
    if (this.target.offset >= count && (count > 0 || this.target.offset !== 0))
      throw new NativeFileError("invalid_selector");
    return renderSingle(this.selected, count, this.tracker, this.target);
  }
}

export function createMarkdownSingleCollector(
  target: ReadTarget,
): MarkdownSingleCollector {
  if (target.ranges !== undefined) throw new NativeFileError("invalid_input");
  return new SingleCollector(target);
}

export function selectMarkdownSourceLines(
  source: string,
  target: ReadTarget,
): ReadSuccess {
  const collector = createMarkdownSingleCollector(target);
  const lines = splitSourceLines(source);
  let count = 0;
  for (const line of lines) {
    if (!collector.push(count, markdownLineRecord(line))) break;
    count += 1;
  }
  if (count < lines.length && lines.length > 0)
    count = Math.min(count + 1, lines.length);
  return collector.finish(count);
}

function baseMulti(target: ReadTarget, requestedEnd: number): MultiReadSuccess {
  const single = emptyReadResult(target, requestedEnd);
  const result: MultiReadSuccess = {
    status: single.status,
    kind: single.kind,
    path: single.path,
    representation: single.representation,
    content: "",
    requestedRanges: [{ startLine: target.offset + 1, endLine: requestedEnd }],
    shownRanges: [],
    truncated: false,
  };
  if (single.realPath !== undefined) result.realPath = single.realPath;
  return result;
}

export function rangesForLines(lines: Iterable<number>): Array<LineRange> {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const ranges: Array<LineRange> = [];
  for (const line of sorted) {
    const last = ranges.at(-1);
    if (last !== undefined && line === last.endLine + 1) last.endLine = line;
    else ranges.push({ startLine: line, endLine: line });
  }
  return ranges;
}

function withLineRange(
  ranges: Array<LineRange>,
  line: number,
): Array<LineRange> {
  return rangesForLines([
    ...ranges.flatMap((range) => {
      const values: Array<number> = [];
      for (let value = range.startLine; value <= range.endLine; value += 1)
        values.push(value);
      return values;
    }),
    line,
  ]);
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
    shownRanges: withLineRange(result.shownRanges, index + 1),
  };
  if (
    measureNativeModelOutput({ ...candidate, nextOffset: result.nextOffset }) >
    resultBudget(target)
  )
    return false;
  Object.assign(result, candidate);
  return true;
}
function candidateSingleChain(
  base: MultiReadSuccess,
  entries: Array<NativeEntry>,
  mandatory: Array<NativeEntry>,
  target: ReadTarget,
): boolean {
  const lines = [...entries, ...mandatory];
  const content = lines
    .map((entry) => renderSourceLine(entry.text, entry.line - 1))
    .join("");
  const shownRanges = rangesForLines(lines.map((entry) => entry.line));
  return (
    new Set(lines.map((entry) => entry.line)).size <= MAX_READ_LINES &&
    measureNativeModelOutput({
      ...base,
      content,
      shownRanges,
      nextOffset: target.offset,
    }) <= resultBudget(target)
  );
}

function renderableHeadingLine(
  line: MarkdownLine,
  selected: Map<number, MarkdownLineRecord>,
): string | undefined {
  const selectedLine = selected.get(line.line);
  if (selectedLine !== undefined) return selectedLine.rendered;
  return line.text.length > MAX_RESULT_CODE_UNITS ? undefined : line.text;
}

function chainEntries(
  units: ReadonlyArray<MarkdownHeadingUnit>,
  selected: Map<number, MarkdownLineRecord>,
  shown: ReadonlySet<number>,
): Array<Array<NativeEntry>> | undefined {
  const grouped: Array<Array<NativeEntry>> = [];
  for (const unit of units) {
    const entries: Array<NativeEntry> = [];
    for (const line of unit.lines) {
      const text = renderableHeadingLine(line, selected);
      if (text === undefined) return undefined;
      if (!shown.has(line.line)) entries.push({ line: line.line, text });
    }
    grouped.push(entries);
  }
  return grouped;
}

function admittedChain(context: SingleChainContext): Array<NativeEntry> {
  const { units, selected, shown, base, mandatory, target } = context;
  if (
    mandatory.length === 0 ||
    !mandatory.some((entry) => entry.line === target.offset + 1)
  )
    return [];
  const grouped = chainEntries(units, selected, shown);
  if (grouped === undefined) return [];
  for (let start = 0; start < grouped.length; start += 1) {
    const entries = grouped.slice(start).flat();
    if (entries.length === 0) return [];
    if (candidateSingleChain(base, entries, mandatory, target)) return entries;
  }
  return [];
}

function initialSingleResult(
  target: ReadTarget,
  count: number,
): SingleInitialResult {
  const requestedEnd = target.offset + (target.limit ?? MAX_READ_LINES);
  const boundedEnd =
    target.offset + Math.min(target.limit ?? MAX_READ_LINES, MAX_READ_LINES);
  const result = emptyReadResult(target, requestedEnd);
  result.truncated =
    boundedEnd < Math.min(requestedEnd, count) ||
    (target.limit === undefined && boundedEnd < count);
  if (boundedEnd < count) result.nextOffset = boundedEnd;
  return { result, boundedEnd, requestedEnd };
}

function prepareSingleSelection(
  selected: Array<SelectedLine>,
  target: ReadTarget,
): SingleSelection {
  const selectedMap = new Map<number, MarkdownLineRecord>();
  const shown = new Set<number>();
  const mandatory: Array<NativeEntry> = [];
  for (const line of selected) {
    const sourceLine = line.index + 1;
    selectedMap.set(sourceLine, {
      scanned: line.text ?? "",
      rendered: line.text,
    });
    if (line.text !== undefined) shown.add(sourceLine);
    if (
      line.text !== undefined &&
      (line.index === target.offset - 1 || line.index === target.offset)
    )
      mandatory.push({ line: sourceLine, text: line.text });
  }
  return { selectedMap, shown, mandatory };
}
type SingleWindowContext = {
  result: MultiReadSuccess;
  selected: Array<SelectedLine>;
  target: ReadTarget;
  emitted: number;
};

function appendSingleWindow(context: SingleWindowContext): void {
  const { result, selected, target } = context;
  let windowEmitted = false;
  for (const line of selected) {
    if (line.text === undefined) {
      if (line.index < target.offset && !windowEmitted) continue;
      result.truncated = true;
      result.nextOffset = line.index + 1;
      break;
    }
    if (
      context.emitted >= MAX_READ_LINES ||
      !appendPluralLine(result, line.text, line.index, target)
    ) {
      if (line.index < target.offset && !windowEmitted) continue;
      result.truncated = true;
      result.nextOffset = Math.max(
        target.offset,
        Math.min(line.index, target.offset + (target.limit ?? MAX_READ_LINES)),
      );
      break;
    }
    context.emitted += 1;
    windowEmitted = true;
  }
}

function promoteSingle(context: PromotedSingleContext): MultiReadSuccess {
  const { base, singular, entries, selected, requestedEnd, target } = context;
  const result: MultiReadSuccess = {
    ...base,
    content: "",
    requestedRanges: [{ startLine: target.offset + 1, endLine: requestedEnd }],
    shownRanges: [],
    truncated: singular.truncated,
  };
  if (singular.nextOffset !== undefined)
    result.nextOffset = singular.nextOffset;
  let emitted = 0;
  for (const entry of entries) {
    if (!appendPluralLine(result, entry.text, entry.line - 1, target)) {
      result.truncated = true;
      return result;
    }
    emitted += 1;
  }
  const window = {
    result,
    selected,
    target,
    emitted,
  };
  appendSingleWindow(window);
  return result;
}
function renderSingle(
  selected: Array<SelectedLine>,
  count: number,
  tracker: MarkdownAncestorTracker,
  target: ReadTarget,
): ReadSuccess {
  const { result: singular, requestedEnd } = initialSingleResult(target, count);
  const selection = prepareSingleSelection(selected, target);
  const base = baseMulti(target, requestedEnd);
  const entries = admittedChain({
    units: tracker.ancestorsFor(target.offset + 1),
    selected: selection.selectedMap,
    shown: selection.shown,
    base,
    mandatory: selection.mandatory,
    target,
  });
  if (entries.length === 0)
    return renderSingularWindow(singular, selected, target);
  return promoteSingle({
    base,
    singular,
    entries,
    selected,
    requestedEnd,
    target,
  });
}

function renderSingularWindow(
  result: SingleReadSuccess,
  selected: Array<SelectedLine>,
  target: ReadTarget,
): SingleReadSuccess {
  for (const line of selected) {
    if (!appendReadLine(result, line.text, line.index, target)) break;
  }
  return result;
}
