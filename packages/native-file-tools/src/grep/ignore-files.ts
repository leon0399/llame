import { dirname, relative, sep } from "node:path";

/**
 * The directories an ignore walk reads above a scope prefix: the registered
 * root itself down to the prefix's parent, shallowest first. A prefix at its
 * root has none.
 */
export function ignoreAncestorDirectories(
  prefix: string,
  root: string,
): ReadonlyArray<string> {
  if (prefix === root) return [];
  const directories: Array<string> = [];
  let current = dirname(prefix);
  for (;;) {
    directories.push(current);
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories.reverse();
}

/** The path from one ancestor directory to the prefix, `/`-separated and ending with '/'. */
export function ignoreAbovePath(directory: string, prefix: string): string {
  return `${relative(directory, prefix).split(sep).join("/")}/`;
}
