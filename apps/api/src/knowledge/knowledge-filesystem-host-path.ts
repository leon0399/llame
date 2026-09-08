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

export type KnowledgeHostPathPort = {
  lstat(filePath: string): Promise<KnowledgeFilesystemStats>;
  mkdir(directoryPath: string): Promise<void>;
};

export type KnowledgeHostPathOptions = {
  /**
   * A write names a file that does not exist yet, and may name directories
   * above it that do not either. Those directories are created here, one
   * component at a time and each one `lstat`ed after creation, because a
   * recursive `mkdir` treats an existing symbolic link as satisfied and
   * silently builds the rest of the chain through it — which would place the
   * written file outside the Space while the result still named a locator
   * inside it.
   */
  readonly allowMissing?: boolean | undefined;
  /**
   * Create the missing directories rather than only tolerating them. This is a
   * filesystem effect, so it runs after the durable attempt is recorded, never
   * during the resolution that decides whether the call is admissible at all.
   */
  readonly createDirectories?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
};

export async function resolveKnowledgeHostPath(
  directory: string,
  relativePath: string | undefined,
  port: KnowledgeHostPathPort,
  options: KnowledgeHostPathOptions = {},
): Promise<string> {
  if (relativePath === undefined) return directory;
  const components = validatePath(relativePath);
  let current = directory;
  for (const [index, component] of components.entries()) {
    throwIfAborted(options.signal);
    current = path.join(current, component);
    const isLeaf = index === components.length - 1;
    const stats = await statOrCreate(current, port, {
      allowMissing: options.allowMissing,
      // The leaf is the file the caller is about to create; only the
      // directories above it are made here.
      create: options.createDirectories === true && !isLeaf,
    });
    // Nothing under a missing component can exist, so the rest of the path is
    // joined unchecked. When creating, only the leaf can be missing, and the
    // slice is empty.
    if (stats === undefined) {
      return path.join(current, ...components.slice(index + 1));
    }
    if (stats.isSymbolicLink()) {
      throw new KnowledgeFilesystemError('knowledge_not_found');
    }
    if (!isLeaf && !stats.isDirectory()) {
      // Present but unusable is a different answer from absent, and the write
      // contract reports it as such on every scheme.
      throw new KnowledgeFilesystemError('knowledge_not_directory');
    }
  }
  return current;
}

/**
 * Stat one component, creating it as a directory first when the caller is
 * building a path for a write. `undefined` means the component is absent and
 * the caller tolerates it — which happens only for the leaf, since every
 * directory above it has just been created.
 */
async function statOrCreate(
  current: string,
  port: KnowledgeHostPathPort,
  intent: { allowMissing: boolean | undefined; create: boolean },
): Promise<KnowledgeFilesystemStats | undefined> {
  try {
    return await port.lstat(current);
  } catch (error) {
    const missing =
      error instanceof KnowledgeFilesystemError &&
      error.code === 'knowledge_not_found';
    if (!missing || intent.allowMissing !== true) throw error;
    if (!intent.create) return undefined;
  }
  await port.mkdir(current);
  // Re-stat rather than assume: the creation raced if anything else won, and
  // a symbolic link that lost the race is still refused by the caller.
  return port.lstat(current);
}
