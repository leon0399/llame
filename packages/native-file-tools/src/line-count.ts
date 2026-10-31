import { type FileHandle } from "node:fs/promises";

/** Files up to this size carry a stored `lineCount`; the byte scan is a few
 *  milliseconds at the top of it, and above it a ranged read stays a window
 *  read instead of touching every byte of a multi-gigabyte log. */
export const READ_LINE_COUNT_MAX_BYTES = 32 * 1024 * 1024;

const LF = 0x0a;

/**
 * The source's line count, in one forward pass on the open handle: LF count
 * plus the final line a file without a trailing LF still has, which is the
 * model `splitSourceLines` reads text with. A selector carrying `N-` or `-K`
 * needs it before any line can be placed, and so does the stored total.
 */
export async function countSourceLines(
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
    const chunk = buffer.subarray(0, bytesRead);
    for (let at = chunk.indexOf(LF); at !== -1; at = chunk.indexOf(LF, at + 1))
      terminators += 1;
    last = buffer[bytesRead - 1];
    position += bytesRead;
  }
  return position > 0 ? terminators + (last === LF ? 0 : 1) : 0;
}

/**
 * The count a text result stores: the scan an end-relative member already
 * took, or one taken here. An outline stores none (its scan can stop early),
 * and neither does a file past `READ_LINE_COUNT_MAX_BYTES`, where a whole-file
 * pass is not worth it and the read stays a window read.
 */
export async function storedLineCount(
  file: FileHandle,
  size: number,
  counted: number | undefined,
  signal: AbortSignal | undefined,
): Promise<number | undefined> {
  if (size > READ_LINE_COUNT_MAX_BYTES) return undefined;
  return counted ?? (await countSourceLines(file, signal));
}
