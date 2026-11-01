import { type FileHandle, open } from "node:fs/promises";

import { openFlags } from "../path";
import type { GrepFileStream, GrepReadRefusal } from "./types";

/** One chunk of a streamed read, so no file is held whole. */
const READ_CHUNK_BYTES = 64 * 1024;

/**
 * Open one file as a walk stream: without blocking on a FIFO, without
 * following a link where the scheme refuses one, and refusing anything that
 * is not a regular file after `fstat`. A failure to open is one skip.
 */
export async function openFileStream(
  path: string,
  followSymlinks: boolean,
  signal: AbortSignal | undefined,
  after?: () => Promise<boolean>,
): Promise<GrepFileStream | GrepReadRefusal> {
  signal?.throwIfAborted();
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, openFlags(followSymlinks));
    const stats = await handle.stat();
    if (!stats.isFile()) {
      await handle.close();
      return { kind: "unreadable" };
    }
    return fileStream(handle, stats.size, signal, after);
  } catch {
    await handle?.close().catch(() => undefined);
    return { kind: "unreadable" };
  }
}

/**
 * One open file as the walk reads it. The bytes come in 64 KiB chunks and end
 * with a refusal when a read fails; `after` runs once the last byte arrived,
 * so a Machine re-checks that the path it opened is still inside its roots.
 * The handle closes when the stream ends, when the consumer stops early, and
 * when a caller closes a stream it never started.
 */
export function fileStream(
  handle: FileHandle,
  size: number,
  signal: AbortSignal | undefined,
  after?: () => Promise<boolean>,
): GrepFileStream {
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= handle.close().catch(() => undefined);
    return closing;
  };
  async function* chunks(): AsyncGenerator<Uint8Array | GrepReadRefusal> {
    try {
      for (;;) {
        signal?.throwIfAborted();
        const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
        let bytesRead: number;
        try {
          ({ bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null));
        } catch {
          yield { kind: "unreadable" };
          return;
        }
        // A short or empty read is the end of the file.
        if (bytesRead <= 0) break;
        yield chunk.subarray(0, bytesRead);
      }
      if (after !== undefined && !(await after())) yield { kind: "unreadable" };
    } finally {
      await close();
    }
  }
  return { size, close, chunks: chunks() };
}
