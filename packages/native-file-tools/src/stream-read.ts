import { open, type FileHandle } from "node:fs/promises";
import { NativeFileError, openFlags, type ReadTarget } from "./path";
import { fileMediaType, outlineReader } from "./representations";
import { createMarkdownMultiCollector } from "./markdown-range";
import {
  createMarkdownSingleCollector,
  markdownLineRecord,
  type MarkdownLineRecord,
} from "./markdown-ancestors";
import {
  appendMultiReadLine,
  appendReadLine,
  boundedReadLineCount,
  emptyMultiReadResult,
  splitSourceLines,
  emptyReadResult,
  MAX_READ_LINES,
  MAX_RESULT_CODE_UNITS,
  type LineRange,
  type MultiReadSuccess,
  type ReadSuccess,
} from "./source-lines";

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

type SourceLineState = {
  partial: string;
  oversized: boolean;
  closerCarry: string;
  droppedSummary: string;
  droppedClosers: Array<string>;
};

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

function appendDroppedClosers(dropped: string, state: SourceLineState): void {
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
}

function appendDroppedSummary(dropped: string, state: SourceLineState): void {
  for (const char of dropped) {
    const summary = summaryCharacter(char);
    if (!state.droppedSummary.includes(summary))
      state.droppedSummary += summary;
  }
}

function appendDroppedTail(dropped: string, state: SourceLineState): void {
  // Whole-line decisions depend on character classes and closer substrings.
  appendDroppedSummary(dropped, state);
  appendDroppedClosers(dropped, state);
}

function appendPreservedTail(
  state: SourceLineState,
  terminator: string,
): string {
  const closers = state.droppedClosers.join("");
  return `${state.partial}${state.droppedSummary}${closers}${terminator}`;
}

function resetSourceLine(state: SourceLineState): void {
  state.partial = "";
  state.oversized = false;
  state.closerCarry = "";
  state.droppedSummary = "";
  state.droppedClosers.length = 0;
}

function lineBodyAndTerminator(fragment: string) {
  if (fragment.endsWith("\r\n"))
    return { body: fragment.slice(0, -2), terminator: "\r\n" };
  if (fragment.endsWith("\n"))
    return { body: fragment.slice(0, -1), terminator: "\n" };
  return { body: fragment, terminator: "" };
}

type SourceLineRecord = MarkdownLineRecord;

function consumeOversizedFragment(
  fragment: string,
  state: SourceLineState,
): SourceLineRecord | null {
  const { body, terminator } = lineBodyAndTerminator(fragment);
  appendDroppedTail(body, state);
  if (terminator === "") return null;
  const scanned = appendPreservedTail(state, terminator);
  resetSourceLine(state);
  return { scanned, rendered: undefined };
}

function takeSourceFragment(
  fragment: string,
  state: SourceLineState,
): SourceLineRecord | undefined | null {
  if (state.oversized) return consumeOversizedFragment(fragment, state);
  if (state.partial.length + fragment.length <= MAX_RESULT_CODE_UNITS) {
    state.partial += fragment;
    if (!fragment.endsWith("\n")) return null;
    const line = state.partial;
    resetSourceLine(state);
    return { scanned: line, rendered: line };
  }
  const { body, terminator } = lineBodyAndTerminator(fragment);
  const combined = state.partial + body;
  state.oversized = true;
  state.partial = combined.slice(0, MAX_RESULT_CODE_UNITS);
  state.closerCarry = state.partial.slice(-CLOSER_OVERLAP);
  appendDroppedTail(combined.slice(MAX_RESULT_CODE_UNITS), state);
  if (terminator === "") return null;
  const scanned = appendPreservedTail(state, terminator);
  resetSourceLine(state);
  return { scanned, rendered: undefined };
}

/** Undefined marks a source line too large to fit any tool result. */
export async function* sourceLineRecords(
  file: FileHandle,
  signal: AbortSignal | undefined,
): AsyncGenerator<SourceLineRecord> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const state: SourceLineState = {
    partial: "",
    oversized: false,
    closerCarry: "",
    droppedSummary: "",
    droppedClosers: [],
  };
  while (true) {
    signal?.throwIfAborted();
    const { bytesRead } = await file.read(buffer);
    let text: string;
    try {
      text = decoder.decode(buffer.subarray(0, bytesRead), {
        stream: bytesRead > 0,
      });
    } catch {
      throw new NativeFileError("invalid_utf8");
    }
    for (const fragment of splitSourceLines(text)) {
      const line = takeSourceFragment(fragment, state);
      if (line !== null && line !== undefined) yield line;
    }
    if (bytesRead === 0) break;
  }
  if (state.oversized) {
    yield { scanned: appendPreservedTail(state, ""), rendered: undefined };
  } else if (state.partial.length > 0) {
    yield { scanned: state.partial, rendered: state.partial };
  }
}

async function* sourceLines(
  file: FileHandle,
  signal: AbortSignal | undefined,
  preserveOversized = false,
): AsyncGenerator<string | undefined> {
  for await (const record of sourceLineRecords(file, signal))
    yield preserveOversized ? record.scanned : record.rendered;
}

async function* outlineSourceLines(
  file: FileHandle,
  signal: AbortSignal | undefined,
): AsyncGenerator<string> {
  for await (const line of sourceLines(file, signal, true)) {
    if (line !== undefined) yield line;
  }
}

async function collectMarkdownWindow(
  file: FileHandle,
  target: ReadTarget,
  signal: AbortSignal | undefined,
): Promise<ReadSuccess> {
  const collector = createMarkdownSingleCollector(target);
  let count = 0;
  for await (const line of sourceLineRecords(file, signal)) {
    const keepReading = collector.push(count, line);
    count += 1;
    if (!keepReading) break;
  }
  return collector.finish(count);
}

async function collectMarkdownMultiWindow(
  file: FileHandle,
  target: ReadTarget,
  signal: AbortSignal | undefined,
): Promise<MultiReadSuccess> {
  const collector = createMarkdownMultiCollector(target);
  let count = 0;
  for await (const line of sourceLineRecords(file, signal)) {
    const keepReading = collector.push(count, line);
    count += 1;
    if (!keepReading) break;
  }
  return collector.finish(count);
}

async function collectWindow(
  file: FileHandle,
  target: ReadTarget,
  signal: AbortSignal | undefined,
): Promise<ReadSuccess> {
  const requestedEnd = target.offset + (target.limit ?? MAX_READ_LINES);
  const boundedEnd = target.offset + boundedReadLineCount(target.limit);
  const start = target.raw ? target.offset : Math.max(0, target.offset - 1);
  const result = emptyReadResult(target, requestedEnd);
  let count = 0;
  for await (const text of sourceLines(file, signal)) {
    const index = count++;
    if (index < start) continue;
    if (index >= boundedEnd) {
      result.nextOffset = boundedEnd;
      result.truncated =
        target.limit === undefined || requestedEnd > boundedEnd;
      if (!target.raw) appendReadLine(result, text, index, target);
      return result;
    }
    if (!appendReadLine(result, text, index, target)) return result;
  }
  if (target.offset >= count && (count > 0 || target.offset !== 0))
    throw new NativeFileError("invalid_selector");
  if (count === 0) result.requestedRange = null;
  return result;
}
/** A selected line exists past `index` in this or a later expanded range. */
function hasSelectedLineAfter(
  expanded: Array<{ offset: number; limit: number }>,
  rangeIndex: number,
  index: number,
): boolean {
  const range = expanded[rangeIndex];
  if (index + 1 < range.offset + range.limit) return true;
  return rangeIndex + 1 < expanded.length;
}

/** Index of the first expanded range that can still contain `index`. */
function activeRangeIndex(
  expanded: Array<{ offset: number; limit: number }>,
  rangeIndex: number,
  index: number,
): number {
  while (
    rangeIndex < expanded.length &&
    index >= expanded[rangeIndex].offset + expanded[rangeIndex].limit
  ) {
    rangeIndex++;
  }
  return rangeIndex;
}

/**
 * Position of the single-pass multi-range walk: the expanded selection, the
 * current range, and the source line under inspection.
 */
type RangePosition = {
  expanded: Array<{ offset: number; limit: number }>;
  rangeIndex: number;
  index: number;
};

/** An emittable selected line: its walk position plus its text. */
type MultiCursor = RangePosition & { text: string };

/** Result state as a later range started, for whole-range rollback. */
type RangeSnapshot = {
  content: string;
  shownRanges: Array<LineRange>;
};

type RangeAdmission =
  | { admitted: true; snapshot: RangeSnapshot | undefined }
  | { admitted: false; nextOffset: number };

/**
 * Rollback state at a later range's first line, so a budget failure deeper
 * in the range still omits it in full. Undefined for the first range and
 * for lines past a range's start.
 */
function entrySnapshot(
  expanded: Array<{ offset: number; limit: number }>,
  rangeIndex: number,
  index: number,
  result: MultiReadSuccess,
): RangeSnapshot | undefined {
  if (rangeIndex === 0 || index !== expanded[rangeIndex].offset)
    return undefined;
  return { content: result.content, shownRanges: [...result.shownRanges] };
}

/**
 * Whole-range admission against the shared emitted-line ceiling. The first
 * range may split at the ceiling; a later range refusal points at the range
 * start and the caller rolls it back whole. Skipped oversized lines never
 * reach the budget, so holes leave room for later lines.
 */
function admitRangeLine(
  position: RangePosition,
  emitted: number,
  result: MultiReadSuccess,
): RangeAdmission {
  if (position.rangeIndex === 0 && emitted >= MAX_READ_LINES) {
    return { admitted: false, nextOffset: position.index };
  }
  if (position.rangeIndex > 0 && emitted >= MAX_READ_LINES) {
    const range = position.expanded[position.rangeIndex];
    return { admitted: false, nextOffset: range.offset };
  }
  return {
    admitted: true,
    snapshot: entrySnapshot(
      position.expanded,
      position.rangeIndex,
      position.index,
      result,
    ),
  };
}

/**
 * Budget-failure recovery: roll a partial later range back so the retry
 * drops earlier ranges and fits on a fresh budget. Without a snapshot the
 * failing line is the first range's own split point, kept unless nothing
 * selected remains for a retry.
 */
function recoverAppendFailure(
  position: RangePosition,
  snapshot: RangeSnapshot | undefined,
  result: MultiReadSuccess,
): void {
  if (snapshot !== undefined) {
    result.content = snapshot.content;
    result.shownRanges = snapshot.shownRanges;
    result.nextOffset = position.expanded[position.rangeIndex].offset;
    return;
  }
  if (
    result.content === "" &&
    !hasSelectedLineAfter(
      position.expanded,
      position.rangeIndex,
      position.index,
    )
  ) {
    delete result.nextOffset;
  }
}
/**
 * End the read on a refused range: roll a partial later range back whole so
 * its retry fits on a fresh budget, keep a split first range's prefix, and
 * point continuation at the resume line.
 */
function haltRefusedRange(
  rangeIndex: number,
  snapshot: RangeSnapshot | undefined,
  nextOffset: number,
  result: MultiReadSuccess,
): void {
  if (rangeIndex > 0 && snapshot !== undefined) {
    result.content = snapshot.content;
    result.shownRanges = snapshot.shownRanges;
  }
  result.truncated = true;
  result.nextOffset = nextOffset;
}

/**
 * Append one selected line, recovering a partial later range on budget
 * failure. Returns true when the read ends here.
 */
function haltAfterAppend(
  cursor: MultiCursor,
  snapshot: RangeSnapshot | undefined,
  result: MultiReadSuccess,
  target: ReadTarget,
): boolean {
  if (appendMultiReadLine(result, cursor.text, cursor.index, target))
    return false;
  recoverAppendFailure(cursor, snapshot, result);
  return true;
}

/** EOF rule for a multi-range read: clip, fail a start past EOF, or empty. */
function finishMultiWindow(
  result: MultiReadSuccess,
  target: ReadTarget,
  count: number,
): MultiReadSuccess {
  if (target.offset >= count && (count > 0 || target.offset !== 0))
    throw new NativeFileError("invalid_selector");
  if (count === 0) result.requestedRanges = [];
  return result;
}

/**
 * Where the single-pass multi-range walk stands: the expanded selection, the
 * range and source line under inspection, the lines emitted against the
 * shared ceiling, and the result built so far.
 */
type MultiRangeWalk = {
  expanded: Array<{ offset: number; limit: number }>;
  rangeIndex: number;
  count: number;
  emitted: number;
  rangeSnapshot: RangeSnapshot | undefined;
  result: MultiReadSuccess;
};

/**
 * One step of the walk: `continue` while selected lines remain, `halted`
 * when this line ends the read with the result as it stands, and
 * `exhausted` when no selected line can follow, so the caller applies the
 * EOF rule.
 */
type MultiRangeStep = "continue" | "halted" | "exhausted";

function startMultiRangeWalk(target: ReadTarget): MultiRangeWalk {
  return {
    expanded: target.expandedRanges ?? [],
    rangeIndex: 0,
    count: 0,
    emitted: 0,
    rangeSnapshot: undefined,
    result: emptyMultiReadResult(target),
  };
}

/**
 * Feed one source line to the walk. The line source is what differs between
 * a file-backed read and one over text already in hand; everything the walk
 * decides from the line is shared.
 */
function stepMultiRangeWalk(
  walk: MultiRangeWalk,
  text: string | undefined,
  target: ReadTarget,
): MultiRangeStep {
  const { expanded, result } = walk;
  const index = walk.count++;
  walk.rangeIndex = activeRangeIndex(expanded, walk.rangeIndex, index);
  if (walk.rangeIndex >= expanded.length) return "exhausted";
  if (index < expanded[walk.rangeIndex].offset) return "continue";
  if (text === undefined) {
    // An oversized line is omitted and skipped without ending the read.
    result.truncated = true;
    const entry = entrySnapshot(expanded, walk.rangeIndex, index, result);
    if (entry !== undefined) walk.rangeSnapshot = entry;
    return "continue";
  }
  const cursor: MultiCursor = {
    expanded,
    rangeIndex: walk.rangeIndex,
    index,
    text,
  };
  const admission = admitRangeLine(cursor, walk.emitted, result);
  if (!admission.admitted) {
    haltRefusedRange(
      walk.rangeIndex,
      walk.rangeSnapshot,
      admission.nextOffset,
      result,
    );
    return "halted";
  }
  if (admission.snapshot !== undefined) walk.rangeSnapshot = admission.snapshot;
  if (haltAfterAppend(cursor, walk.rangeSnapshot, result, target))
    return "halted";
  walk.emitted += 1;
  return "continue";
}

async function collectMultiWindow(
  file: FileHandle,
  target: ReadTarget,
  signal: AbortSignal | undefined,
): Promise<MultiReadSuccess> {
  const walk = startMultiRangeWalk(target);
  for await (const text of sourceLines(file, signal)) {
    const step = stepMultiRangeWalk(walk, text, target);
    if (step === "halted") return walk.result;
    if (step === "exhausted") break;
  }
  return finishMultiWindow(walk.result, target, walk.count);
}

/**
 * The in-memory counterpart of `sourceLines`: the same line sequence for a
 * source already in hand, and the same `undefined` for a line too large to
 * fit any result.
 */
function* memorySourceLines(source: string): Generator<string | undefined> {
  for (const line of splitSourceLines(source)) {
    yield line.length > MAX_RESULT_CODE_UNITS ? undefined : line;
  }
}

/**
 * Select lines from an in-memory source for a comma request: the same walk,
 * context, shared ceiling, result budget, rollback, and continuation rules a
 * file-backed multi-range read reports. `selectSourceLines` serves the
 * single-range target; this is its multi-range twin for callers holding the
 * text instead of a path.
 */
export function selectMultiRangeLines(
  source: string,
  target: ReadTarget,
  mediaType?: string,
): MultiReadSuccess {
  if (target.ranges === undefined) throw new NativeFileError("invalid_input");
  if (mediaType === "text/markdown" && !target.raw && !target.outline) {
    const collector = createMarkdownMultiCollector(target);
    let count = 0;
    for (const line of splitSourceLines(source)) {
      const keepReading = collector.push(count, markdownLineRecord(line));
      count += 1;
      if (!keepReading) break;
    }
    return collector.finish(count);
  }
  const walk = startMultiRangeWalk(target);
  for (const text of memorySourceLines(source)) {
    const step = stepMultiRangeWalk(walk, text, target);
    if (step === "halted") return walk.result;
    if (step === "exhausted") break;
  }
  return finishMultiWindow(walk.result, target, walk.count);
}

export async function streamFileWindow(
  target: ReadTarget,
  source: {
    hostPath: string;
    followSymlinks: boolean;
    signal?: AbortSignal | undefined;
  },
): Promise<ReadSuccess> {
  const file = await open(source.hostPath, openFlags(source.followSymlinks));
  try {
    if (!(await file.stat()).isFile())
      throw new NativeFileError("not_regular_file");
    const mediaType = fileMediaType(source.hostPath);
    if (target.outline)
      return await outlineReader(mediaType)(
        outlineSourceLines(file, source.signal),
        target,
      );
    if (target.ranges !== undefined) {
      return mediaType === "text/markdown" && !target.raw
        ? await collectMarkdownMultiWindow(file, target, source.signal)
        : await collectMultiWindow(file, target, source.signal);
    }
    return mediaType === "text/markdown" && target.offset > 0 && !target.raw
      ? await collectMarkdownWindow(file, target, source.signal)
      : await collectWindow(file, target, source.signal);
  } finally {
    await file.close();
  }
}
