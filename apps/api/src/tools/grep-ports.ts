/**
 * The two schemas this layer can walk: one bound Knowledge Space and one
 * installed skill package. Each port adapts its own trusted source to the
 * engine's `GrepWalkPort`, and each keeps its own link rule — Knowledge never
 * follows a link, and a skill package follows one exactly as agent-skills does.
 */

import { open, readdir, realpath, stat } from 'node:fs/promises';
import { type Dirent } from 'node:fs';
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
import { GrepScopeFailure, type GrepToolError } from './grep-results';

/** What one scope path is on its own scheme, or the result that ends the call. */
export type ScopeProbe =
  | { readonly kind: 'file' | 'directory' | 'missing' }
  | { readonly result: GrepToolError };

/** The path two relative parts join to, with no separator for an empty part. */
export function joinedPath(prefix: string, rel: string): string {
  if (prefix.length === 0) return rel;
  if (rel.length === 0) return prefix;
  return `${prefix}/${rel}`;
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
        const bytes = await handle.readFile();
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
