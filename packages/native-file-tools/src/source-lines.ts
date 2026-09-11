import { RESULT_TRUNCATE_CHARS } from "@workspace/runtime-safety";
import { NativeFileError, type ReadTarget } from "./path";
import { measureNativeModelOutput } from "./serialization";
export const MAX_READ_LINES = 2000;
export const MAX_RESULT_CODE_UNITS = RESULT_TRUNCATE_CHARS;

/** The shared cap minus any room a caller withheld for its own envelope. */
export function resultBudget(target: { reserveCodeUnits?: number }): number {
  return MAX_RESULT_CODE_UNITS - (target.reserveCodeUnits ?? 0);
}

export type LineRange = { startLine: number; endLine: number };
type ReadSuccessBase = {
  status: "success";
  kind: "file";
  path: string;
  representation: "text" | "raw";
  content: string;
  nextOffset?: number;
  truncated: boolean;
};

export type SingleReadSuccess = ReadSuccessBase & {
  requestedRange: LineRange | null;
  shownRange: LineRange | null;
};

export type MultiReadSuccess = ReadSuccessBase & {
  requestedRanges: Array<LineRange>;
  shownRanges: Array<LineRange>;
};

export type ReadSuccess = SingleReadSuccess | MultiReadSuccess;
export type FileFailure = {
  status: "error";
  type: NativeFileError["type"];
  message: string;
};

/** LF terminates a logical line; CRLF stays intact and lone CR is source text. */
export function splitSourceLines(source: string): Array<string> {
  return source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export function selectSourceLines(
  source: string,
  target: ReadTarget,
): SingleReadSuccess {
  if (target.ranges !== undefined) throw new NativeFileError("invalid_input");
  const lines = splitSourceLines(source);
  if (
    target.offset >= lines.length &&
    (lines.length > 0 || target.offset !== 0)
  ) {
    throw new NativeFileError("invalid_selector");
  }
  const requestedEnd = target.offset + (target.limit ?? MAX_READ_LINES);
  const boundedEnd = Math.min(
    lines.length,
    target.offset + boundedReadLineCount(target.limit),
  );
  const start = target.raw ? target.offset : Math.max(0, target.offset - 1);
  const end = target.raw ? boundedEnd : Math.min(lines.length, boundedEnd + 1);
  const result = emptyReadResult(target, lines.length === 0 ? 0 : requestedEnd);
  result.truncated =
    boundedEnd < Math.min(requestedEnd, lines.length) ||
    (target.limit === undefined && boundedEnd < lines.length);
  if (boundedEnd < lines.length) result.nextOffset = boundedEnd;
  return renderSelection(lines, target, result, { start, end });
}

function renderSelection(
  lines: Array<string>,
  target: ReadTarget,
  result: SingleReadSuccess,
  window: { start: number; end: number },
): SingleReadSuccess {
  const { start, end } = window;
  for (let index = start; index < end; index += 1) {
    if (!appendReadLine(result, lines[index], index, target)) break;
  }
  return result;
}

/** Retry point for a line dropped only by content accumulated earlier in
 * this same call — a fresh read starting here has an empty budget again. */
function retryOffset(target: ReadTarget, index: number): number {
  return Math.max(
    target.offset,
    Math.min(index, target.offset + boundedReadLineCount(target.limit)),
  );
}

export function appendReadLine(
  result: SingleReadSuccess,
  text: string | undefined,
  index: number,
  target: ReadTarget,
): boolean {
  const line =
    text === undefined ? undefined : renderSourceLine(text, index, target.raw);
  const candidate: SingleReadSuccess = {
    ...result,
    content: result.content + (line ?? ""),
    shownRange: {
      startLine: result.shownRange?.startLine ?? index + 1,
      endLine: index + 1,
    },
  };
  const isFirstLineOfResult = result.content === "";
  const overflows =
    line === undefined ||
    measureNativeModelOutput({ ...candidate, nextOffset: index + 1 }) >
      resultBudget(target);
  // The only index below the requested offset is the single preceding
  // context line. One that cannot be rendered is unavailable context, not a
  // truncated result, so dropping it keeps the requested range reachable
  // instead of stalling every continuation read on the same line.
  if (overflows && isFirstLineOfResult && index < target.offset) return true;
  if (overflows) {
    result.truncated = true;
    // A line that is unreadable on its own (`line === undefined`), or that
    // overflows even as the first line of a fresh result, fails again at
    // this same index on any retry — nextOffset must skip past it instead.
    result.nextOffset =
      line === undefined || isFirstLineOfResult
        ? index + 1
        : retryOffset(target, index);
    return false;
  }
  Object.assign(result, candidate);
  return true;
}

export function emptyReadResult(
  target: ReadTarget,
  endLine: number,
): SingleReadSuccess {
  const result: SingleReadSuccess = {
    status: "success",
    kind: "file",
    path: target.path,
    representation: target.raw ? "raw" : "text",
    content: "",
    requestedRange:
      endLine === 0 ? null : { startLine: target.offset + 1, endLine },
    shownRange: null,
    truncated: false,
  };
  if (
    measureNativeModelOutput({ ...result, nextOffset: target.offset }) >
    resultBudget(target)
  )
    throw new NativeFileError("invalid_path");
  return result;
}

export function boundedReadLineCount(
  requested: number | undefined,
  maximum = MAX_READ_LINES,
): number {
  return Math.min(requested ?? maximum, maximum);
}

export function renderSourceLine(
  source: string,
  index: number,
  raw = false,
): string {
  return raw ? source : `${index + 1}: ${source}`;
}
export function emptyMultiReadResult(target: ReadTarget): MultiReadSuccess {
  const result: MultiReadSuccess = {
    status: "success",
    kind: "file",
    path: target.path,
    representation: target.raw ? "raw" : "text",
    content: "",
    requestedRanges: (target.ranges ?? []).map((range) => ({
      startLine: range.offset + 1,
      endLine: range.offset + range.limit,
    })),
    shownRanges: [],
    truncated: false,
  };
  if (
    measureNativeModelOutput({ ...result, nextOffset: target.offset }) >
    resultBudget(target)
  )
    throw new NativeFileError("invalid_selector");
  return result;
}

/**
 * Append one selected line to a multi-range result. Oversized lines never
 * reach here — the stream reader skips them and continues — so any overflow
 * ends the read.
 */
export function appendMultiReadLine(
  result: MultiReadSuccess,
  text: string,
  index: number,
  target: ReadTarget,
): boolean {
  const line = renderSourceLine(text, index, target.raw);
  const last = result.shownRanges.at(-1);
  const contiguous = last !== undefined && last.endLine === index;
  const shown: LineRange = {
    startLine: contiguous ? last.startLine : index + 1,
    endLine: index + 1,
  };
  const candidate: MultiReadSuccess = {
    ...result,
    content: result.content + line,
    shownRanges: contiguous
      ? [...result.shownRanges.slice(0, -1), shown]
      : [...result.shownRanges, shown],
  };
  const isFirstLineOfResult = result.content === "";
  const overflows =
    measureNativeModelOutput({ ...candidate, nextOffset: index + 1 }) >
    resultBudget(target);
  if (overflows) {
    result.truncated = true;
    // A line that fails even as the first line of a fresh result fails again
    // at this same index on any retry — nextOffset must skip past it instead.
    result.nextOffset = isFirstLineOfResult ? index + 1 : index;
    return false;
  }
  Object.assign(result, candidate);
  return true;
}
