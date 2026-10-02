import { open, type FileHandle } from "node:fs/promises";
import {
  NativeFileError,
  openFlags,
  resolveEndRelativeSelector,
  type ReadTarget,
} from "./path";
import { fileMediaType, outlineReader } from "./representations";
import { MultiCollector } from "./markdown-range";
import {
  appendMarkdownDropped,
  createMarkdownDroppedState,
  markdownLineRecord,
  markdownScannedLine,
  SingleCollector,
  type MarkdownDroppedState,
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

type SourceLineState = {
  partial: string;
  oversized: boolean;
  dropped: MarkdownDroppedState;
};

function lineBodyAndTerminator(fragment: string) {
  if (fragment.endsWith("\r\n"))
    return { body: fragment.slice(0, -2), terminator: "\r\n" };
  if (fragment.endsWith("\n"))
    return { body: fragment.slice(0, -1), terminator: "\n" };
  return { body: fragment, terminator: "" };
}

function resetSourceLine(state: SourceLineState): void {
  state.partial = "";
  state.oversized = false;
  state.dropped = createMarkdownDroppedState();
}

function consumeOversizedFragment(
  fragment: string,
  state: SourceLineState,
): MarkdownLineRecord | null {
  const { body, terminator } = lineBodyAndTerminator(fragment);
  appendMarkdownDropped(body, state.dropped);
  if (terminator === "") return null;
  const scanned = markdownScannedLine(state.partial, state.dropped, terminator);
  resetSourceLine(state);
  return { scanned, rendered: undefined };
}

function takeSourceFragment(
  fragment: string,
  state: SourceLineState,
): MarkdownLineRecord | null {
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
  state.dropped = createMarkdownDroppedState(state.partial);
  appendMarkdownDropped(combined.slice(MAX_RESULT_CODE_UNITS), state.dropped);
  if (terminator === "") return null;
  const scanned = markdownScannedLine(state.partial, state.dropped, terminator);
  resetSourceLine(state);
  return { scanned, rendered: undefined };
}
export async function* sourceLineRecords(
  file: FileHandle,
  signal: AbortSignal | undefined,
): AsyncGenerator<MarkdownLineRecord> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const state: SourceLineState = {
    partial: "",
    oversized: false,
    dropped: createMarkdownDroppedState(),
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
      if (line !== null) yield line;
    }
    if (bytesRead === 0) break;
  }
  if (state.oversized)
    yield {
      scanned: markdownScannedLine(state.partial, state.dropped, ""),
      rendered: undefined,
    };
  else if (state.partial.length > 0)
    yield { scanned: state.partial, rendered: state.partial };
}

async function* sourceLines(
  file: FileHandle,
  signal: AbortSignal | undefined,
): AsyncGenerator<string | undefined> {
  for await (const record of sourceLineRecords(file, signal))
    yield record.rendered;
}

async function* outlineSourceLines(
  file: FileHandle,
  signal: AbortSignal | undefined,
): AsyncGenerator<string> {
  for await (const record of sourceLineRecords(file, signal))
    yield record.scanned;
}

async function drainCollector<T>(
  collector: {
    push(index: number, line: MarkdownLineRecord): boolean;
    finish(count: number): T;
  },
  file: FileHandle,
  signal: AbortSignal | undefined,
): Promise<T> {
  let count = 0;
  for await (const line of sourceLineRecords(file, signal)) {
    const keepReading = collector.push(count, line);
    count += 1;
    if (!keepReading) break;
  }
  return collector.finish(count);
}
async function collectMarkdownWindow(
  file: FileHandle,
  target: ReadTarget,
  signal: AbortSignal | undefined,
): Promise<ReadSuccess> {
  return drainCollector(new SingleCollector(target), file, signal);
}

async function collectMarkdownMultiWindow(
  file: FileHandle,
  target: ReadTarget,
  signal: AbortSignal | undefined,
): Promise<MultiReadSuccess> {
  return drainCollector(new MultiCollector(target), file, signal);
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

const LF = 0x0a;

/**
 * The source's line count, in one forward pass on the open handle: LF count
 * plus the final line a file without a trailing LF still has, which is the
 * model `splitSourceLines` reads text with. A selector carrying `N-` or `-K`
 * needs it before any line can be placed, and nothing else on a regular file
 * does.
 */
async function countSourceLines(
  file: FileHandle,
  signal: AbortSignal | undefined,
): Promise<number> {
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  let terminators = 0;
  let last = 0;
  for (;;) {
    signal?.throwIfAborted();
    const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    for (let index = 0; index < bytesRead; index += 1)
      if (buffer[index] === LF) terminators += 1;
    last = buffer[bytesRead - 1];
    position += bytesRead;
  }
  return position > 0 ? terminators + (last === LF ? 0 : 1) : 0;
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
  if (mediaType === "text/markdown" && !target.raw) {
    const collector = new MultiCollector(target);
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
    // The count pass runs on this handle and only here: a device or FIFO was
    // refused above, and a target with no end-relative member skips it.
    const resolved =
      target.pending === undefined
        ? target
        : resolveEndRelativeSelector(
            target,
            await countSourceLines(file, source.signal),
          );
    const mediaType = fileMediaType(source.hostPath);
    if (resolved.outline)
      return await outlineReader(mediaType)(
        outlineSourceLines(file, source.signal),
        resolved,
      );
    if (resolved.ranges !== undefined) {
      return mediaType === "text/markdown" && !resolved.raw
        ? await collectMarkdownMultiWindow(file, resolved, source.signal)
        : await collectMultiWindow(file, resolved, source.signal);
    }
    return mediaType === "text/markdown" && resolved.offset > 0 && !resolved.raw
      ? await collectMarkdownWindow(file, resolved, source.signal)
      : await collectWindow(file, resolved, source.signal);
  } finally {
    await file.close();
  }
}
