import { RESULT_TRUNCATE_CHARS } from "@workspace/runtime-safety";
import { NativeFileError, type ReadTarget } from "./path";
export const MAX_READ_LINES = 2000;
export const MAX_RESULT_CODE_UNITS = RESULT_TRUNCATE_CHARS;

export type LineRange = { startLine: number; endLine: number };
export type ReadSuccess = {
  status: "success";
  kind: "file";
  path: string;
  representation: "text" | "raw";
  content: string;
  requestedRange: LineRange | null;
  shownRange: LineRange | null;
  nextOffset?: number;
  truncated: boolean;
};
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
): ReadSuccess {
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
    requestedEnd,
    target.offset + MAX_READ_LINES,
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
  result: ReadSuccess,
  window: { start: number; end: number },
): ReadSuccess {
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
    Math.min(
      index,
      target.offset + Math.min(target.limit ?? MAX_READ_LINES, MAX_READ_LINES),
    ),
  );
}

export function appendReadLine(
  result: ReadSuccess,
  text: string | undefined,
  index: number,
  target: ReadTarget,
): boolean {
  const line =
    text === undefined
      ? undefined
      : target.raw
        ? text
        : `${index + 1}: ${text}`;
  const candidate: ReadSuccess = {
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
    JSON.stringify({ ...candidate, nextOffset: index + 1 }).length >
      MAX_RESULT_CODE_UNITS;
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
): ReadSuccess {
  const result: ReadSuccess = {
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
    JSON.stringify({ ...result, nextOffset: target.offset }).length >
    MAX_RESULT_CODE_UNITS
  )
    throw new NativeFileError("invalid_path");
  return result;
}
