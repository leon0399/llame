import { NativeFileError, type ReadTarget } from "./path";
import {
  createMarkdownScanner,
  type MarkdownHeading,
  type MarkdownLine,
} from "./markdown-structure";
import { measureNativeModelOutput } from "./serialization";
import {
  appendReadLine,
  emptyMultiReadResult,
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

export type NativeEntry = { line: number; text: string };

export type MarkdownDroppedState = {
  closerCarry: string;
  droppedSummary: string;
  droppedClosers: Array<string>;
};

const HTML_CLOSERS = [
  "</script>",
  "</pre>",
  "</textarea>",
  "</style>",
  "-->",
  "?>",
  "]]>",
  ">",
] as const;
const CLOSER_OVERLAP =
  Math.max(...HTML_CLOSERS.map((closer) => closer.length)) - 1;

function summaryCharacter(char: string): string {
  if (char === " " || char === "\t") return " ";
  if (
    char === "`" ||
    char === "~" ||
    char === "=" ||
    char === "-" ||
    char === "*" ||
    char === "_"
  )
    return char;
  return "x";
}

export function createMarkdownDroppedState(prefix = ""): MarkdownDroppedState {
  return {
    closerCarry: prefix.slice(-CLOSER_OVERLAP),
    droppedSummary: "",
    droppedClosers: [],
  };
}

export function appendMarkdownDropped(
  dropped: string,
  state: MarkdownDroppedState,
): void {
  const searchable = state.closerCarry + dropped;
  const lowerSearchable = searchable.toLowerCase();
  for (const closer of HTML_CLOSERS) {
    if (
      lowerSearchable.includes(closer) &&
      !state.droppedClosers.includes(closer)
    )
      state.droppedClosers.push(closer);
  }
  state.closerCarry = searchable.slice(-CLOSER_OVERLAP);
  for (const char of dropped) {
    const summary = summaryCharacter(char);
    if (!state.droppedSummary.includes(summary))
      state.droppedSummary += summary;
  }
}

export function markdownScannedLine(
  prefix: string,
  state: MarkdownDroppedState,
  terminator: string,
): string {
  return `${prefix}${state.droppedSummary}${state.droppedClosers.join("")}${terminator}`;
}

export class MarkdownAncestorTracker {
  private readonly requestedLines: ReadonlySet<number>;
  private readonly stack: Array<MarkdownHeadingUnit> = [];
  private readonly chains = new Map<number, Array<MarkdownHeadingUnit>>();

  constructor(requestedLines: Iterable<number> = []) {
    this.requestedLines = new Set(requestedLines);
  }

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

/** Build scanner input and preserve the unrenderable-line semantics. */
export function markdownLineRecord(text: string): MarkdownLineRecord {
  if (text.length <= MAX_RESULT_CODE_UNITS)
    return { scanned: text, rendered: text };
  const terminator = text.endsWith("\r\n")
    ? "\r\n"
    : text.endsWith("\n")
      ? "\n"
      : "";
  const body = text.slice(0, text.length - terminator.length);
  const prefix = body.slice(0, MAX_RESULT_CODE_UNITS);
  const state = createMarkdownDroppedState(prefix);
  appendMarkdownDropped(body.slice(MAX_RESULT_CODE_UNITS), state);
  return {
    scanned: markdownScannedLine(prefix, state, terminator),
    rendered: undefined,
  };
}

type SingleInitialResult = {
  result: SingleReadSuccess;
  requestedEnd: number;
};
type SingleSelection = {
  selected: Map<number, MarkdownLineRecord>;
  shown: Set<number>;
  mandatory: Array<NativeEntry>;
};

export type AncestorChainContext = {
  units: ReadonlyArray<MarkdownHeadingUnit>;
  selected: Map<number, MarkdownLineRecord>;
  shown: ReadonlySet<number>;
  mandatory: Array<NativeEntry>;
  result: MultiReadSuccess;
  emitted: number;
  reserveNextOffset: number;
  target: ReadTarget;
  firstRequested: number;
  firstShownLine: number;
};

function lineIsInRanges(ranges: ReadonlyArray<LineRange>, line: number) {
  return ranges.some(
    (range) => line >= range.startLine && line <= range.endLine,
  );
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

export function withLineRanges(
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

export function appendPluralLine(
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
  const nextOffset = result.nextOffset ?? index + 1;
  if (
    measureNativeModelOutput({ ...candidate, nextOffset }) >
    resultBudget(target)
  )
    return false;
  Object.assign(result, candidate);
  return true;
}

function renderableHeadingLine(
  line: MarkdownLine,
  selected: Map<number, MarkdownLineRecord>,
): string | undefined {
  const selectedLine = selected.get(line.line - 1);
  if (selectedLine !== undefined) return selectedLine.rendered;
  return line.text.length > MAX_RESULT_CODE_UNITS ? undefined : line.text;
}

type ChainGroup = Array<NativeEntry> | undefined;

function chainGroups(context: AncestorChainContext): Array<ChainGroup> {
  const { units, selected, shown, firstShownLine, result } = context;
  const lastEmittedLine = result.shownRanges.at(-1)?.endLine ?? 0;
  const groups: Array<ChainGroup> = [];
  for (const unit of units) {
    const entries: Array<NativeEntry> = [];
    let renderable = true;
    for (const line of unit.lines) {
      if (
        line.line >= firstShownLine ||
        line.line <= lastEmittedLine ||
        shown.has(line.line)
      )
        continue;
      const text = renderableHeadingLine(line, selected);
      if (text === undefined) renderable = false;
      else entries.push({ line: line.line, text });
    }
    if (entries.length > 0 || !renderable)
      groups.push(renderable ? entries : undefined);
  }
  return groups;
}

function candidateFits(
  context: AncestorChainContext,
  entries: Array<NativeEntry>,
): boolean {
  const alreadyEmitted = (line: number) =>
    lineIsInRanges(context.result.shownRanges, line);
  const candidate = [
    ...entries,
    ...context.mandatory.filter((entry) => !alreadyEmitted(entry.line)),
  ];
  const lines = new Set(candidate.map((entry) => entry.line));
  if (context.emitted + lines.size > MAX_READ_LINES) return false;
  const content = candidate
    .map((entry) => renderSourceLine(entry.text, entry.line - 1))
    .join("");
  return (
    measureNativeModelOutput({
      ...context.result,
      content: context.result.content + content,
      shownRanges: withLineRanges(context.result.shownRanges, lines),
      nextOffset: context.reserveNextOffset,
    }) <= resultBudget(context.target)
  );
}

/** Admit complete outer-to-inner heading units with mandatory passage lines. */
export function admitAncestorChain(
  context: AncestorChainContext,
): Array<NativeEntry> {
  if (
    !context.mandatory.some(
      (entry) => entry.line === context.firstRequested + 1,
    )
  )
    return [];
  const groups = chainGroups(context);
  if (groups.length === 0) return [];
  for (let start = 0; start < groups.length; start += 1) {
    const retained = groups.slice(start);
    if (retained.some((group) => group === undefined)) continue;
    const entries = retained.flatMap((group) => group ?? []);
    if (entries.length > 0 && candidateFits(context, entries)) return entries;
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
  return { result, requestedEnd };
}

function prepareSingleSelection(
  selected: Map<number, MarkdownLineRecord>,
  target: ReadTarget,
): SingleSelection {
  const shown = new Set<number>();
  const mandatory: Array<NativeEntry> = [];
  for (const [index, line] of selected) {
    const sourceLine = index + 1;
    if (line.rendered !== undefined) shown.add(sourceLine);
    if (
      line.rendered !== undefined &&
      (index === target.offset - 1 || index === target.offset)
    )
      mandatory.push({ line: sourceLine, text: line.rendered });
  }
  return { selected, shown, mandatory };
}

export class SingleCollector {
  private readonly start: number;
  private readonly boundedEnd: number;
  private readonly selected = new Map<number, MarkdownLineRecord>();
  private readonly tracker: MarkdownAncestorTracker;
  private readonly scanner;
  private stopped = false;

  constructor(private readonly target: ReadTarget) {
    this.start = Math.max(0, target.offset - 1);
    this.boundedEnd =
      target.offset + Math.min(target.limit ?? MAX_READ_LINES, MAX_READ_LINES);
    this.tracker = new MarkdownAncestorTracker([target.offset + 1]);
    this.scanner = createMarkdownScanner({
      onLine: (line) => this.tracker.accept(line),
    });
  }

  push(index: number, line: MarkdownLineRecord): boolean {
    if (this.stopped) return false;
    this.scanner.push(line.scanned);
    if (index >= this.start && index <= this.boundedEnd)
      this.selected.set(index, line);
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

export function selectMarkdownSourceLines(
  source: string,
  target: ReadTarget,
): ReadSuccess {
  const collector = new SingleCollector(target);
  let count = 0;
  for (const line of splitSourceLines(source)) {
    const keepReading = collector.push(count, markdownLineRecord(line));
    count += 1;
    if (!keepReading) break;
  }
  return collector.finish(count);
}

function baseMulti(target: ReadTarget, requestedEnd: number): MultiReadSuccess {
  return {
    ...emptyMultiReadResult(target),
    requestedRanges: [{ startLine: target.offset + 1, endLine: requestedEnd }],
  };
}

function appendSingleWindow(
  result: MultiReadSuccess,
  selected: Map<number, MarkdownLineRecord>,
  target: ReadTarget,
  emitted: number,
): void {
  let windowEmitted = false;
  for (const [index, line] of selected) {
    if (line.rendered === undefined) {
      if (index < target.offset && !windowEmitted) continue;
      result.truncated = true;
      result.nextOffset = index + 1;
      break;
    }
    if (
      emitted >= MAX_READ_LINES ||
      !appendPluralLine(result, line.rendered, index, target)
    ) {
      if (index < target.offset && !windowEmitted) continue;
      result.truncated = true;
      result.nextOffset = Math.max(
        target.offset,
        Math.min(index, target.offset + (target.limit ?? MAX_READ_LINES)),
      );
      break;
    }
    emitted += 1;
    windowEmitted = true;
  }
}

type PromoteSingleContext = {
  base: MultiReadSuccess;
  singular: SingleReadSuccess;
  entries: Array<NativeEntry>;
  selected: Map<number, MarkdownLineRecord>;
  target: ReadTarget;
};

function promoteSingle(context: PromoteSingleContext): MultiReadSuccess {
  const { base, singular, entries, selected, target } = context;
  const result: MultiReadSuccess = {
    ...base,
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
  appendSingleWindow(result, selected, target, emitted);
  return result;
}

function renderSingle(
  selected: Map<number, MarkdownLineRecord>,
  count: number,
  tracker: MarkdownAncestorTracker,
  target: ReadTarget,
): ReadSuccess {
  const { result: singular, requestedEnd } = initialSingleResult(target, count);
  const selection = prepareSingleSelection(selected, target);
  const base = baseMulti(target, requestedEnd);
  const firstRequested = target.offset + 1;
  const entries = admitAncestorChain({
    units: tracker.ancestorsFor(firstRequested),
    selected: selection.selected,
    shown: selection.shown,
    mandatory: selection.mandatory,
    result: base,
    emitted: 0,
    reserveNextOffset: singular.nextOffset ?? target.offset,
    target,
    firstRequested: target.offset,
    firstShownLine: selection.mandatory[0]?.line ?? firstRequested,
  });
  if (entries.length === 0) {
    for (const [index, line] of selected)
      if (!appendReadLine(singular, line.rendered, index, target)) break;
    return singular;
  }
  return promoteSingle({
    base,
    singular,
    entries,
    selected,
    target,
  });
}
