import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { NativeFileError, type ReadTarget } from "./path";
import {
  appendReadLine,
  emptyReadResult,
  MAX_READ_LINES,
  MAX_RESULT_CODE_UNITS,
  type ReadSuccess,
} from "./source-lines";

/** Undefined marks a source line too large to fit any tool result. */
async function* sourceLines(
  file: FileHandle,
): AsyncGenerator<string | undefined> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let partial = "";
  let oversized = false;
  while (true) {
    const { bytesRead } = await file.read(buffer);
    let text: string;
    try {
      text = decoder.decode(buffer.subarray(0, bytesRead), {
        stream: bytesRead > 0,
      });
    } catch {
      throw new NativeFileError("invalid_utf8");
    }
    const fragments = text.split("\n");
    for (let index = 0; index < fragments.length; index += 1) {
      if (
        !oversized &&
        partial.length + fragments[index].length > MAX_RESULT_CODE_UNITS
      ) {
        oversized = true;
        yield undefined;
      }
      if (!oversized) partial += fragments[index];
      if (index === fragments.length - 1) continue;
      if (!oversized) yield `${partial}\n`;
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
): Promise<ReadSuccess> {
  const requestedEnd = target.offset + (target.limit ?? MAX_READ_LINES);
  const boundedEnd =
    target.offset + Math.min(target.limit ?? MAX_READ_LINES, MAX_READ_LINES);
  const start = target.raw ? target.offset : Math.max(0, target.offset - 1);
  const result = emptyReadResult(target, requestedEnd);
  let count = 0;
  for await (const text of sourceLines(file)) {
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
  result.requestedRange =
    count === 0
      ? null
      : {
          startLine: target.offset + 1,
          endLine: Math.min(requestedEnd, count),
        };
  return result;
}

export async function streamFileWindow(
  target: ReadTarget,
): Promise<ReadSuccess> {
  const file = await open(
    target.path,
    constants.O_RDONLY | constants.O_NONBLOCK,
  );
  try {
    if (!(await file.stat()).isFile())
      throw new NativeFileError("not_regular_file");
    return await collectWindow(file, target);
  } finally {
    await file.close();
  }
}
