import { open, type FileHandle } from "node:fs/promises";
import { NativeFileError, openFlags, type ReadTarget } from "./path";
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

/** Undefined marks a source line too large to fit any tool result. */
async function* sourceLines(
  file: FileHandle,
  signal: AbortSignal | undefined,
): AsyncGenerator<string | undefined> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let partial = "";
  let oversized = false;
  while (true) {
    // A cancelled or timed-out call must stop reading, not merely stop being
    // awaited: without this the loop keeps consuming a file no one will read.
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
      if (
        !oversized &&
        partial.length + fragment.length > MAX_RESULT_CODE_UNITS
      ) {
        oversized = true;
        yield undefined;
      }
      if (!oversized) partial += fragment;
      if (!fragment.endsWith("\n")) continue;
      if (!oversized) yield partial;
      partial = "";
      oversized = false;
    }
    if (bytesRead === 0) break;
  }
  if (partial.length > 0 && !oversized) yield partial;
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

async function collectMultiWindow(
  file: FileHandle,
  target: ReadTarget,
  signal: AbortSignal | undefined,
): Promise<MultiReadSuccess> {
  const expanded = target.expandedRanges ?? [];
  const result = emptyMultiReadResult(target);
  let emitted = 0,
    count = 0,
    rangeIndex = 0;
  let rangeSnapshot: RangeSnapshot | undefined;
  for await (const text of sourceLines(file, signal)) {
    const index = count++;
    rangeIndex = activeRangeIndex(expanded, rangeIndex, index);
    if (rangeIndex >= expanded.length) break;
    if (index < expanded[rangeIndex].offset) continue;
    if (text === undefined) {
      // An oversized line is omitted and skipped without ending the read.
      result.truncated = true;
      const entry = entrySnapshot(expanded, rangeIndex, index, result);
      if (entry !== undefined) rangeSnapshot = entry;
      continue;
    }
    const cursor: MultiCursor = { expanded, rangeIndex, index, text };
    const admission = admitRangeLine(cursor, emitted, result);
    if (!admission.admitted) {
      haltRefusedRange(rangeIndex, rangeSnapshot, admission.nextOffset, result);
      return result;
    }
    if (admission.snapshot !== undefined) rangeSnapshot = admission.snapshot;
    if (haltAfterAppend(cursor, rangeSnapshot, result, target)) return result;
    emitted += 1;
  }
  return finishMultiWindow(result, target, count);
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
    return target.ranges !== undefined
      ? await collectMultiWindow(file, target, source.signal)
      : await collectWindow(file, target, source.signal);
  } finally {
    await file.close();
  }
}
