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

export async function resolveKnowledgeHostPath(
  directory: string,
  relativePath: string | undefined,
  lstat: KnowledgeHostPathLstat,
  signal?: AbortSignal,
): Promise<string> {
  if (relativePath === undefined) return directory;
  const components = validatePath(relativePath, false);
  let current = directory;
  for (const [index, component] of components.entries()) {
    throwIfAborted(signal);
    current = path.join(current, component);
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) {
      throw new KnowledgeFilesystemError('knowledge_not_found');
    }
    if (index < components.length - 1 && !stats.isDirectory()) {
      throw new KnowledgeFilesystemError('knowledge_not_found');
    }
  }
  return current;
}
