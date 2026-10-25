/**
 * Every source this layer can walk: the host filesystem, one bound Knowledge
 * Space, and one installed skill package. Each port adapts its own trusted
 * source to the engine's `GrepWalkPort`, and each keeps its own link rule —
 * the host and Knowledge never follow a link, and a skill package follows one
 * exactly as agent-skills does. Only the host port honors `.gitignore`.
 */

import { constants, type Dirent } from 'node:fs';
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { type FileHandle } from 'node:fs/promises';
import path from 'node:path';

import {
  type GrepEntry,
  type GrepWalkPort,
} from '@workspace/native-file-tools';

import {
  createKnowledgeWalkAdapter,
  type KnowledgeFilesystemBinding,
} from '../knowledge/knowledge-filesystem';
import { mapKnowledgeResolutionFailure } from '../knowledge/knowledge-locator';
import { skillUnavailableResult } from '../skills/skill-target';
import {
  GrepScopeFailure,
  hostPathFailureResult,
  notFoundResult,
  type GrepToolError,
} from './grep-results';

/** What one scope path is on its own scheme, or the result that ends the call. */
export type ScopeProbe =
  | { readonly kind: 'file' | 'directory' | 'missing' }
  | { readonly result: GrepToolError };

/** What the host port returns instead of bytes it will not hand over. */
type HostReadRefusal = { readonly kind: 'oversized' | 'unreadable' };

/** The path two relative parts join to, with no separator for an empty part. */
export function joinedPath(prefix: string, rel: string): string {
  if (prefix.length === 0) return rel;
  if (rel.length === 0) return prefix;
  return `${prefix}/${rel}`;
}

/** The chunk a bounded read asks a handle for, so no file is held whole. */
const READ_CHUNK_BYTES = 64 * 1024;

/** The one file-handle operation a bounded read needs. */
type BoundedFileReader = {
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
};

/**
 * Read an open file up to `maxBytes` + 1 bytes, so a caller can tell a file
 * that overflows the bound from one exactly at it. The read stops at the extra
 * byte: a file far larger than the bound is never buffered beyond it.
 */
export async function readBoundedFileBytes(
  file: BoundedFileReader,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  const chunks: Array<Uint8Array> = [];
  let totalBytes = 0;
  while (totalBytes <= maxBytes) {
    signal?.throwIfAborted();
    const chunk = Buffer.allocUnsafe(
      Math.min(READ_CHUNK_BYTES, maxBytes + 1 - totalBytes),
    );
    const { bytesRead } = await file.read(
      chunk,
      0,
      chunk.byteLength,
      totalBytes,
    );
    if (!Number.isInteger(bytesRead) || bytesRead <= 0) break;
    chunks.push(chunk.subarray(0, Math.min(bytesRead, chunk.byteLength)));
    totalBytes += bytesRead;
  }
  return Buffer.concat(chunks, Math.min(totalBytes, maxBytes + 1));
}

/** The largest `.gitignore` the walk reads; a larger one applies no rules. */
const IGNORE_FILE_BYTES = 256 * 1024;

/**
 * One host path as the process sees it: a symbolic link is never one of the
 * two things a scope may name, because a host walk never follows one.
 */
export async function probeHostPath(
  root: string,
  signal: AbortSignal | undefined,
): Promise<ScopeProbe> {
  signal?.throwIfAborted();
  try {
    const stats = await lstat(root);
    if (stats.isDirectory()) return { kind: 'directory' };
    return stats.isFile() ? { kind: 'file' } : { kind: 'missing' };
  } catch {
    return { kind: 'missing' };
  }
}

/**
 * The host tree as the operating system reports it. A link is reported as a
 * link and never entered, hidden entries stay visible, and each directory's
 * `.gitignore` becomes walk policy; the engine prunes `.git` itself.
 */
export function createHostWalkPort(
  root: string,
  signal: AbortSignal | undefined,
): GrepWalkPort {
  return {
    followsLinks: false,
    list: (rel) => listHostDirectory(root, rel, signal),
    read: (rel, maxBytes) => readHostFile(root, rel, maxBytes, signal),
    ignoreFile: (rel) => readIgnoreFile(root, rel, signal),
  };
}

/** One directory of the host tree, with links reported and never entered. */
async function listHostDirectory(
  root: string,
  rel: string,
  signal: AbortSignal | undefined,
): Promise<ReadonlyArray<GrepEntry>> {
  signal?.throwIfAborted();
  const directory = hostPath(root, rel);
  if (rel.length === 0) await refuseNonDirectoryRoot(directory);
  let dirents: Array<Dirent>;
  try {
    dirents = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    // A subdirectory the process cannot list, or one that vanished mid-walk,
    // contributes nothing; only the scope root itself fails the call.
    if (rel.length > 0) return [];
    const code =
      error instanceof Error && 'code' in error ? String(error.code) : '';
    throw new GrepScopeFailure(
      code === 'ENOENT' || code === 'ENOTDIR'
        ? notFoundResult()
        : hostPathFailureResult(),
    );
  }
  return dirents.map((dirent): GrepEntry => ({
    name: dirent.name,
    kind: dirent.isSymbolicLink()
      ? 'link'
      : dirent.isDirectory()
        ? 'directory'
        : dirent.isFile()
          ? 'file'
          : 'other',
  }));
}

/**
 * Refuse a scope root that is not a directory of its own: a listing reports a
 * link as a link and never enters it, so lstat is the view that names the link
 * instead of the tree behind it. An lstat the process cannot make decides
 * nothing, and the listing that follows reports that refusal as it always has.
 */
async function refuseNonDirectoryRoot(target: string): Promise<void> {
  let ownDirectory: boolean;
  try {
    ownDirectory = (await lstat(target)).isDirectory();
  } catch {
    return;
  }
  if (!ownDirectory) throw new GrepScopeFailure(notFoundResult());
}

/** One host file, opened without following a link or blocking on a FIFO. */
async function readHostFile(
  root: string,
  rel: string,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array | HostReadRefusal> {
  signal?.throwIfAborted();
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      hostPath(root, rel),
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    const stats = await handle.stat();
    if (!stats.isFile()) return { kind: 'unreadable' };
    if (stats.size > maxBytes) return { kind: 'oversized' };
    // Only the bound reaches memory: a file that grew past its declared size
    // is refused on the extra byte instead of being buffered whole.
    const bytes = await readBoundedFileBytes(handle, maxBytes, signal);
    return bytes.byteLength > maxBytes ? { kind: 'oversized' } : bytes;
  } catch {
    return { kind: 'unreadable' };
  } finally {
    await handle?.close();
  }
}

function hostPath(root: string, rel: string): string {
  return rel.length === 0 ? root : path.join(root, rel);
}

/** One directory's ignore text, when it is a bounded regular file. */
async function readIgnoreFile(
  root: string,
  rel: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  const file = path.join(hostPath(root, rel), '.gitignore');
  let handle: FileHandle | undefined;
  try {
    // Policy comes from a real file only, opened by the walk's own rule: a
    // link is never followed and a FIFO never blocks the walk.
    handle = await open(
      file,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    const stats = await handle.stat();
    if (!stats.isFile()) return undefined;
    // The cap applies to the bytes read, so a file that announced the wrong
    // size applies no rules either way.
    const bytes = await readBoundedFileBytes(handle, IGNORE_FILE_BYTES, signal);
    return bytes.byteLength > IGNORE_FILE_BYTES
      ? undefined
      : bytes.toString('utf8');
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

export function createKnowledgeWalkPort(
  binding: KnowledgeFilesystemBinding,
  prefixPath: string,
  signal: AbortSignal | undefined,
): GrepWalkPort {
  const adapter = createKnowledgeWalkAdapter(binding);
  return {
    followsLinks: false,
    async list(rel) {
      try {
        return await adapter.listWalk(joinedPath(prefixPath, rel), signal);
      } catch (error) {
        throw new GrepScopeFailure(mapKnowledgeResolutionFailure(error));
      }
    },
    async read(rel, maxBytes) {
      try {
        return await adapter.readWalk(
          joinedPath(prefixPath, rel),
          maxBytes,
          signal,
        );
      } catch (error) {
        throw new GrepScopeFailure(mapKnowledgeResolutionFailure(error));
      }
    },
  };
}

export async function probeKnowledgePath(
  binding: KnowledgeFilesystemBinding,
  prefixPath: string,
  signal: AbortSignal | undefined,
): Promise<ScopeProbe> {
  try {
    const kind = await createKnowledgeWalkAdapter(binding).inspectWalk(
      prefixPath,
      signal,
    );
    return { kind };
  } catch (error) {
    const result = mapKnowledgeResolutionFailure(error);
    return result.type === 'not_found' ? { kind: 'missing' } : { result };
  }
}

export async function probeSkillPath(
  root: string,
  signal: AbortSignal | undefined,
): Promise<ScopeProbe> {
  signal?.throwIfAborted();
  try {
    const stats = await stat(root);
    return { kind: stats.isDirectory() ? 'directory' : 'file' };
  } catch {
    return { kind: 'missing' };
  }
}

/**
 * The package tree as the operating system reports it, with links resolved the
 * way agent-skills resolves them: a link to a package file or directory is
 * searched, and a link that points back at an ancestor is a loop the walk
 * counts and never enters.
 */
export function createSkillWalkPort(
  root: string,
  signal: AbortSignal | undefined,
): GrepWalkPort {
  return {
    followsLinks: true,
    list: (rel) => listSkillDirectory(root, rel, signal),
    async read(rel, maxBytes) {
      signal?.throwIfAborted();
      const file = rel.length === 0 ? root : path.join(root, rel);
      let handle: FileHandle | undefined;
      try {
        handle = await open(file, 'r');
        const stats = await handle.stat();
        if (!stats.isFile()) return { kind: 'unreadable' as const };
        if (stats.size > maxBytes) return { kind: 'oversized' as const };
        const bytes = await readBoundedFileBytes(handle, maxBytes, signal);
        return bytes.byteLength > maxBytes
          ? { kind: 'oversized' as const }
          : bytes;
      } catch {
        return { kind: 'unreadable' as const };
      } finally {
        await handle?.close();
      }
    },
  };
}

async function listSkillDirectory(
  root: string,
  rel: string,
  signal: AbortSignal | undefined,
): Promise<ReadonlyArray<GrepEntry>> {
  signal?.throwIfAborted();
  const directory = rel.length === 0 ? root : path.join(root, rel);
  let dirents: Array<Dirent>;
  try {
    dirents = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new GrepScopeFailure(skillUnavailableResult());
  }
  const currentReal = await realpathOrUndefined(directory);
  return Promise.all(
    dirents.map((dirent) => skillEntry(directory, dirent, currentReal)),
  );
}

async function skillEntry(
  directory: string,
  dirent: Dirent,
  currentReal: string | undefined,
): Promise<GrepEntry> {
  const child = path.join(directory, dirent.name);
  if (!dirent.isSymbolicLink()) {
    if (dirent.isDirectory()) {
      const identity = await realpathOrUndefined(child);
      if (identity === undefined)
        return { name: dirent.name, kind: 'directory' };
      return { name: dirent.name, kind: 'directory', identity };
    }
    return { name: dirent.name, kind: dirent.isFile() ? 'file' : 'other' };
  }
  const real = await realpathOrUndefined(child);
  if (real === undefined) return { name: dirent.name, kind: 'link' };
  // A link back to the directory being listed, or to one of its ancestors, is
  // the loop the walk must not enter.
  if (
    currentReal !== undefined &&
    (real === currentReal || currentReal.startsWith(`${real}${path.sep}`))
  ) {
    return { name: dirent.name, kind: 'link' };
  }
  try {
    const stats = await stat(child);
    if (stats.isDirectory()) {
      return { name: dirent.name, kind: 'directory', identity: real };
    }
    return { name: dirent.name, kind: stats.isFile() ? 'file' : 'other' };
  } catch {
    return { name: dirent.name, kind: 'link' };
  }
}

async function realpathOrUndefined(
  target: string,
): Promise<string | undefined> {
  try {
    return await realpath(target);
  } catch {
    return undefined;
  }
}
