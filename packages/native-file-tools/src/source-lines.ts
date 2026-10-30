import {
  neutralizeReservedDelimiters,
  RESULT_TRUNCATE_CHARS,
  type UnknownRecord,
} from "@workspace/runtime-safety";
import { renderReadText } from "./model-text";
import { assertResolvedTarget, NativeFileError, type ReadTarget } from "./path";
import { selectMarkdownSourceLines } from "./markdown-ancestors";
export const MAX_READ_LINES = 2000;
export const MAX_RESULT_CODE_UNITS = RESULT_TRUNCATE_CHARS;

/** The shared cap minus any room a caller withheld for its own envelope. */
export function resultBudget(target: { reserveCodeUnits?: number }): number {
  return MAX_RESULT_CODE_UNITS - (target.reserveCodeUnits ?? 0);
}

/**
 * Width the model receives for a read candidate: its text rendering after the
 * one reserved-name rule, so escaped delimiters and the framing count against
 * the bound (tool-result-rendering "Bounds are measured on the neutralized
 * rendering"). A caller measuring a cut candidate passes the next offset it
 * would store, so the continuation line is inside the measured width.
 */
export function measureReadRendering(
  result: UnknownRecord,
  nextOffset?: number,
): number {
  return neutralizeReservedDelimiters(
    renderReadText(
      nextOffset === undefined
        ? result
        : { ...result, truncated: true, nextOffset },
    ),
  ).length;
}

export type LineRange = { startLine: number; endLine: number };
type ReadSuccessBase = {
  status: "success";
  kind: "file";
  path: string;
  /** Canonical host path when it differs from the given one. Both result
   *  constructors copy it before measuring, so it counts against the cap. */
  realPath?: string;
  representation: "text" | "raw" | "outline";
  content: string;
  nextOffset?: number;
  truncated: boolean;
  /** The source's line count, when it is known: a text read of a file small
   *  enough to count by byte scan, or an in-memory selection, whose lines are
   *  already in hand. Absent for an outline and for a file past
   *  `READ_LINE_COUNT_MAX_BYTES`. */
  lineCount?: number;
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
): SingleReadSuccess;
export function selectSourceLines(
  source: string,
  target: ReadTarget,
  mediaType?: string,
): ReadSuccess;
export function selectSourceLines(
  source: string,
  target: ReadTarget,
  mediaType?: string,
): ReadSuccess {
  if (target.ranges !== undefined) throw new NativeFileError("invalid_input");
  assertResolvedTarget(target);
  const lines = splitSourceLines(source);
  const placed: ReadTarget = { ...target, lineCount: lines.length };
  if (mediaType === "text/markdown" && placed.offset > 0 && !placed.raw)
    return selectMarkdownSourceLines(source, placed);
  if (
    placed.offset >= lines.length &&
    (lines.length > 0 || placed.offset !== 0)
  ) {
    throw new NativeFileError("invalid_selector");
  }
  const requestedEnd = placed.offset + (placed.limit ?? MAX_READ_LINES);
  const boundedEnd = Math.min(
    lines.length,
    placed.offset + boundedReadLineCount(placed.limit),
  );
  const start = placed.raw ? placed.offset : Math.max(0, placed.offset - 1);
  const end = placed.raw ? boundedEnd : Math.min(lines.length, boundedEnd + 1);
  const result = emptyReadResult(placed, lines.length === 0 ? 0 : requestedEnd);
  result.truncated =
    boundedEnd < Math.min(requestedEnd, lines.length) ||
    (placed.limit === undefined && boundedEnd < lines.length);
  if (boundedEnd < lines.length) result.nextOffset = boundedEnd;
  return renderSelection(lines, placed, result, { start, end });
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
  // Measure with the offset the failed append would store: `retryOffset`
  // resumes at the line inside the window, and at the window end once the
  // appended line is the trailing context line, whose stored offset is the
  // window end. A label measured one line ahead can gain a digit.
  const overflows =
    line === undefined ||
    measureReadRendering(candidate, retryOffset(target, index + 1)) >
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
  if (target.realPath !== undefined) result.realPath = target.realPath;
  if (target.lineCount !== undefined) result.lineCount = target.lineCount;
  if (measureReadRendering(result, target.offset) > resultBudget(target))
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
  if (target.realPath !== undefined) result.realPath = target.realPath;
  if (target.lineCount !== undefined) result.lineCount = target.lineCount;
  if (measureReadRendering(result, target.offset) > resultBudget(target))
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
    measureReadRendering(candidate, index + 1) > resultBudget(target);
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
