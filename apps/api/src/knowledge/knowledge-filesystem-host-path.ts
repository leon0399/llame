/**
 * Resolves a Knowledge-relative path to its host path for a caller that opens
 * the target itself. Every component is `lstat`ed and a symbolic link anywhere
 * on the way is refused without being followed, so no link can redirect the
 * walk outside the Space; the caller closes the remaining check-to-open window
 * with `O_NOFOLLOW`.
 */

import path from 'node:path';

import { KnowledgeFilesystemError } from './knowledge-filesystem-errors';
import { throwIfAborted } from './knowledge-filesystem-io';
import { validatePath } from './knowledge-filesystem-validation';
import type { KnowledgeFilesystemStats } from './knowledge-filesystem';

export type KnowledgeHostPathLstat = (
  filePath: string,
) => Promise<KnowledgeFilesystemStats>;

export type KnowledgeHostPathOptions = {
  /** A write names a file that does not exist yet, and may name directories
   *  above it that do not either. Nothing below a missing component can exist,
   *  so the walk stops there and the rest of the path is joined unchecked. */
  readonly allowMissing?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
};

export async function resolveKnowledgeHostPath(
  directory: string,
  relativePath: string | undefined,
  lstat: KnowledgeHostPathLstat,
  options: KnowledgeHostPathOptions = {},
): Promise<string> {
  if (relativePath === undefined) return directory;
  const components = validatePath(relativePath);
  let current = directory;
  for (const [index, component] of components.entries()) {
    throwIfAborted(options.signal);
    current = path.join(current, component);
    const stats = await statOrMissing(current, lstat, options.allowMissing);
    if (stats === undefined) {
      return path.join(current, ...components.slice(index + 1));
    }
    if (stats.isSymbolicLink()) {
      throw new KnowledgeFilesystemError('knowledge_not_found');
    }
    if (index < components.length - 1 && !stats.isDirectory()) {
      throw new KnowledgeFilesystemError('knowledge_not_found');
    }
  }
  return current;
}

/** `undefined` means the component is absent and the caller tolerates it. */
async function statOrMissing(
  current: string,
  lstat: KnowledgeHostPathLstat,
  allowMissing: boolean | undefined,
): Promise<KnowledgeFilesystemStats | undefined> {
  try {
    return await lstat(current);
  } catch (error) {
    if (
      allowMissing === true &&
      error instanceof KnowledgeFilesystemError &&
      error.code === 'knowledge_not_found'
    ) {
      return undefined;
    }
    throw error;
  }
}
