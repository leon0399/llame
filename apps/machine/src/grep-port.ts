/**
 * The Machine filesystem as the shared grep engine walks it: a directory tree
 * reported with links never entered, hidden entries visible, `.git` pruned by
 * the engine, and each `.gitignore` becoming walk policy, exactly as the hub's
 * host port does. The one difference is the layout: every path here is inside
 * the prefix the hub's request named, which the root guard already admitted.
 */

import { constants, type Dirent } from "node:fs";
import {
  lstat,
  open,
  readdir,
  readFile,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

import type { NativeFailureResult } from "@workspace/machine-protocol";
import {
  GrepPortError,
  type GrepEntry,
  type GrepWalkPort,
} from "@workspace/native-file-tools";

/** The largest `.gitignore` the walk reads; a larger one applies no rules. */
const IGNORE_FILE_BYTES = 256 * 1024;
const NOT_FOUND_MESSAGE = "The target does not exist.";
const NOT_DIRECTORY_MESSAGE = "The target is not a directory.";
const LISTING_FAILED_MESSAGE = "The directory could not be listed.";

/** A walk refusal the call reports as its result, never as an answer. */
export class GrepWalkFailure extends GrepPortError {
  constructor(readonly result: NativeFailureResult) {
    super(result.message);
  }
}

function failure(
  type: NativeFailureResult["type"],
  message: string,
): NativeFailureResult {
  return { status: "error", type, message };
}

export function createGrepWalkPort(
  root: string,
  signal: AbortSignal | undefined,
): GrepWalkPort {
  return {
    followsLinks: false,
    list: (rel) => listDirectory(root, rel, signal),
    read: (rel, maxBytes) => readFileAt(root, rel, maxBytes, signal),
    ignoreFile: (rel) => readIgnoreFile(root, rel),
  };
}

/** One directory, with links reported and never entered. */
async function listDirectory(
  root: string,
  rel: string,
  signal: AbortSignal | undefined,
): Promise<ReadonlyArray<GrepEntry>> {
  signal?.throwIfAborted();
  const target = at(root, rel);
  let dirents: Array<Dirent>;
  try {
    dirents = await readdir(target, { withFileTypes: true });
  } catch (error) {
    // A subdirectory that cannot be listed, or one that vanished mid-walk,
    // contributes nothing; only the prefix the request named fails the call.
    if (rel.length > 0) return [];
    const code =
      error instanceof Error && "code" in error ? String(error.code) : "";
    throw new GrepWalkFailure(
      code === "ENOENT"
        ? failure("not_found", NOT_FOUND_MESSAGE)
        : code === "ENOTDIR"
          ? failure("not_regular_file", NOT_DIRECTORY_MESSAGE)
          : failure("executor_unavailable", LISTING_FAILED_MESSAGE),
    );
  }
  return dirents.map(
    (dirent): GrepEntry => ({
      name: dirent.name,
      kind: dirent.isSymbolicLink()
        ? "link"
        : dirent.isDirectory()
          ? "directory"
          : dirent.isFile()
            ? "file"
            : "other",
    }),
  );
}

/** One file, opened without following a link or blocking on a FIFO. */
async function readFileAt(
  root: string,
  rel: string,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array | { readonly kind: "oversized" | "unreadable" }> {
  signal?.throwIfAborted();
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      at(root, rel),
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    const stats = await handle.stat();
    if (!stats.isFile()) return { kind: "unreadable" };
    if (stats.size > maxBytes) return { kind: "oversized" };
    const bytes = await handle.readFile();
    return bytes.byteLength > maxBytes ? { kind: "oversized" } : bytes;
  } catch {
    return { kind: "unreadable" };
  } finally {
    await handle?.close();
  }
}

/** One directory's ignore text, when it is a bounded regular file. */
async function readIgnoreFile(
  root: string,
  rel: string,
): Promise<string | undefined> {
  const file = path.join(at(root, rel), ".gitignore");
  try {
    // Policy comes from a real file only: a link is never followed here, as
    // the walk never follows one.
    const stats = await lstat(file);
    if (!stats.isFile() || stats.size > IGNORE_FILE_BYTES) return undefined;
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

function at(root: string, rel: string): string {
  return rel.length === 0 ? root : path.join(root, rel);
}
