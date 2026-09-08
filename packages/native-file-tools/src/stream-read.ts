import { open, type FileHandle } from "node:fs/promises";
import { NativeFileError, openFlags, type ReadTarget } from "./path";
import {
  appendReadLine,
  boundedReadLineCount,
  splitSourceLines,
  emptyReadResult,
  MAX_READ_LINES,
  MAX_RESULT_CODE_UNITS,
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
    return await collectWindow(file, target, source.signal);
  } finally {
    await file.close();
  }
}
