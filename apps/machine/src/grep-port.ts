/**
 * The Machine filesystem as the shared grep engine walks it: a directory tree
 * reported with links never entered, hidden entries visible, `.git` pruned by
 * the engine, and each `.gitignore` becoming walk policy, exactly as the hub's
 * host port does. The one difference is the layout: every path here is inside
 * the prefix the hub's request named, which the root guard already admitted.
 */

import { constants, type Dirent } from "node:fs";
import { open, readdir, type FileHandle } from "node:fs/promises";
import path from "node:path";

import type { NativeFailureResult } from "@workspace/machine-protocol";
import {
  GrepPortError,
  type GrepEntry,
  type GrepWalkPort,
} from "@workspace/native-file-tools";
import type { RootGuard } from "./guard";

/** The largest `.gitignore` the walk reads; a larger one applies no rules. */
const IGNORE_FILE_BYTES = 256 * 1024;
/** One read of a file at a time; a file never reaches memory whole. */
const READ_CHUNK_BYTES = 64 * 1024;
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

/**
 * What every call of one port shares: the prefix as the roots resolved it,
 * which is the address every call opens, and the guard that re-verifies it.
 * Opening the submitted spelling instead would follow an ancestor link that
 * was repointed after the guard ran, while the check still passed.
 */
type Walk = {
  readonly canonical: string;
  readonly guard: RootGuard;
  readonly signal: AbortSignal | undefined;
};

export function createGrepWalkPort(
  canonical: string,
  guard: RootGuard,
  signal: AbortSignal | undefined,
): GrepWalkPort {
  const walk: Walk = { canonical, guard, signal };
  return {
    followsLinks: false,
    list: (rel) => listDirectory(walk, rel),
    read: (rel, maxBytes) => readFileAt(walk, rel, maxBytes),
    ignoreFile: (rel) => readIgnoreFile(walk, rel),
  };
}

/**
 * The contract's re-verification after the call: the same address must still
 * resolve to the same canonical location inside the roots once the effect has
 * run. A directory or file swapped for a symbolic link in the meantime — even
 * one that points back inside the roots — resolves elsewhere and is refused,
 * as every other daemon operation refuses it with `verifyUnchanged`.
 */
async function unchanged(walk: Walk, rel: string): Promise<boolean> {
  const target = at(walk.canonical, rel);
  // The guard refuses a path outside the roots and any link hop that resolves
  // outside them; both arrive here as an absent result.
  const after = await walk.guard.resolvePath(target).catch(() => undefined);
  return after !== undefined && !after.isLink && after.canonical === target;
}

/** One directory, with links reported and never entered. */
async function listDirectory(
  walk: Walk,
  rel: string,
): Promise<ReadonlyArray<GrepEntry>> {
  walk.signal?.throwIfAborted();
  const target = at(walk.canonical, rel);
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
  // A directory swapped for a link after the listing keeps no entries: the
  // names it returned describe a tree the roots no longer hold.
  if (!(await unchanged(walk, rel))) return [];
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
  walk: Walk,
  rel: string,
  maxBytes: number,
): Promise<Uint8Array | { readonly kind: "oversized" | "unreadable" }> {
  walk.signal?.throwIfAborted();
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      at(walk.canonical, rel),
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    const stats = await handle.stat();
    if (!stats.isFile()) return { kind: "unreadable" };
    if (stats.size > maxBytes) return { kind: "oversized" };
    // Only the bound reaches memory: a file that grew past its declared size
    // is refused on the extra byte instead of being buffered whole.
    const bytes = await readBounded(handle, maxBytes, walk.signal);
    // A file reached through a directory swapped for a link after it was
    // listed came from outside the roots; its content is thrown away.
    if (!(await unchanged(walk, rel))) return { kind: "unreadable" };
    return bytes.byteLength > maxBytes ? { kind: "oversized" } : bytes;
  } catch {
    return { kind: "unreadable" };
  } finally {
    await handle?.close();
  }
}

/**
 * At most `maxBytes + 1` bytes of a handle, so a caller can tell an exact fit
 * from an over-long file without ever reading past that byte. A file that
 * announces a small size and then grows is cut at the same place.
 */
async function readBounded(
  handle: FileHandle,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  const chunks: Array<Buffer> = [];
  let total = 0;
  while (total <= maxBytes) {
    signal?.throwIfAborted();
    const room = Math.min(READ_CHUNK_BYTES, maxBytes + 1 - total);
    const chunk = Buffer.allocUnsafe(room);
    const { bytesRead } = await handle.read(chunk, 0, room, null);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  return Buffer.concat(chunks, total);
}

/** One directory's ignore text, when it is a bounded regular file. */
async function readIgnoreFile(
  walk: Walk,
  rel: string,
): Promise<string | undefined> {
  const ignoreRel =
    rel.length === 0 ? ".gitignore" : path.join(rel, ".gitignore");
  let handle: FileHandle | undefined;
  try {
    // Policy comes from a real file only, under the walk's own rule: a link is
    // never followed and a FIFO never blocks the walk.
    handle = await open(
      at(walk.canonical, ignoreRel),
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > IGNORE_FILE_BYTES) return undefined;
    const bytes = await readBounded(handle, IGNORE_FILE_BYTES, undefined);
    // An ignore file reached through a swapped directory or replaced by a
    // link applies no rules, exactly as a link at the address would not.
    if (!(await unchanged(walk, ignoreRel))) return undefined;
    return bytes.byteLength > IGNORE_FILE_BYTES
      ? undefined
      : bytes.toString("utf8");
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

function at(root: string, rel: string): string {
  return rel.length === 0 ? root : path.join(root, rel);
}
