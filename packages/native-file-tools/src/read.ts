import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { NativeFileError, resolveReadTarget } from "./path";
import type { ReadTarget } from "./path";

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_READ_LINES = 2000;
export const MAX_RESULT_CODE_UNITS = 30_000;

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

export async function loadText(path: string): Promise<string> {
  // Nonblocking open prevents a FIFO from hanging before the descriptor check.
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new NativeFileError("not_regular_file");
    if (stats.size > MAX_FILE_BYTES)
      throw new NativeFileError("file_too_large");
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        count,
        buffer.length - count,
        count,
      );
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    if (count > MAX_FILE_BYTES) throw new NativeFileError("file_too_large");
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        buffer.subarray(0, count),
      );
    } catch {
      throw new NativeFileError("invalid_utf8");
    }
  } finally {
    await file.close();
  }
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
  const requestedEnd = Math.min(
    lines.length,
    target.offset + (target.limit ?? MAX_READ_LINES),
  );
  const boundedEnd = Math.min(requestedEnd, target.offset + MAX_READ_LINES);
  const start = target.raw ? target.offset : Math.max(0, target.offset - 1);
  const end = target.raw ? boundedEnd : Math.min(lines.length, boundedEnd + 1);
  const result: ReadSuccess = {
    status: "success",
    kind: "file",
    path: target.path,
    representation: target.raw ? "raw" : "text",
    content: "",
    requestedRange: lines.length
      ? { startLine: target.offset + 1, endLine: requestedEnd }
      : null,
    shownRange: null,
    truncated:
      boundedEnd < requestedEnd ||
      (target.limit === undefined && boundedEnd < lines.length),
  };
  if (boundedEnd < lines.length) result.nextOffset = boundedEnd;
  return renderSelection(lines, target, result, { start, end, boundedEnd });
}

function renderSelection(
  lines: Array<string>,
  target: ReadTarget,
  result: ReadSuccess,
  window: { start: number; end: number; boundedEnd: number },
): ReadSuccess {
  const { start, end, boundedEnd } = window;
  for (let index = start; index < end; index += 1) {
    const candidate: ReadSuccess = {
      ...result,
      content:
        result.content +
        (target.raw ? lines[index] : `${index + 1}: ${lines[index]}`),
      shownRange: { startLine: start + 1, endLine: index + 1 },
    };
    // Reserve room for continuation metadata even if the unbounded result is EOF.
    if (
      JSON.stringify({
        ...candidate,
        nextOffset: Math.max(target.offset, index + 1),
        truncated: true,
      }).length > MAX_RESULT_CODE_UNITS
    ) {
      result.truncated = true;
      result.nextOffset = Math.max(target.offset, Math.min(index, boundedEnd));
      break;
    }
    Object.assign(result, candidate);
  }
  return result;
}

export async function readFile(input: {
  path: string;
}): Promise<ReadSuccess | FileFailure> {
  try {
    const target = await resolveReadTarget(input.path);
    return selectSourceLines(await loadText(target.path), target);
  } catch (error) {
    if (error instanceof NativeFileError)
      return { status: "error", type: error.type, message: error.message };
    const missing =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    return {
      status: "error",
      type: missing ? "not_found" : "executor_unavailable",
      message: missing ? "File not found." : "File could not be read.",
    };
  }
}
