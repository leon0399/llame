/**
 * Materialized-path helpers (#44, SPEC §7.2). Paths are ID-based —
 * `rootId/childId/grandchildId` — so a rename never touches paths; only a
 * subtree MOVE rewrites them. A root's path is its own id. Pure functions;
 * the repository owns the SQL that applies them.
 */

export const PATH_SEPARATOR = '/';

/** Path of a root unit. */
export function rootPath(id: string): string {
  return id;
}

/** Path of a child under the given parent path. */
export function childPath(parentPath: string, id: string): string {
  return `${parentPath}${PATH_SEPARATOR}${id}`;
}

/**
 * Ancestor-or-self ids encoded in a path, root first. This is the whole point
 * of id-based paths: the ancestor set needs no recursive query — and the RLS
 * policies rely on exactly this property (string_to_array(path, '/')).
 */
export function pathIds(path: string): string[] {
  return path.split(PATH_SEPARATOR).filter((segment) => segment.length > 0);
}

/** Depth of a node (root = 1). */
export function pathDepth(path: string): number {
  return pathIds(path).length;
}

/** True when `candidate` is strictly inside `ancestorPath`'s subtree. */
export function isDescendantPath(
  candidate: string,
  ancestorPath: string,
): boolean {
  return candidate.startsWith(`${ancestorPath}${PATH_SEPARATOR}`);
}

/**
 * Rebase a path from one subtree prefix onto another (the MOVE operation).
 * Throws when `path` is not the old root itself or inside its subtree —
 * rebasing an unrelated path would corrupt the tree silently.
 */
export function rebasePath(
  path: string,
  oldPrefix: string,
  newPrefix: string,
): string {
  if (path === oldPrefix) {
    return newPrefix;
  }
  if (!isDescendantPath(path, oldPrefix)) {
    throw new Error(
      `Path "${path}" is not inside subtree "${oldPrefix}" — refusing to rebase.`,
    );
  }
  return `${newPrefix}${path.slice(oldPrefix.length)}`;
}
