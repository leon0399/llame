/**
 * The walk policy's fixed set, which a listing renders without children.
 * The Machine daemon cannot tell a child read from a requested one, so the
 * listing presentation skips the child read itself.
 */
const WALK_FIXED_SET = new Set([".git", ".jj", ".hg", ".svn", "node_modules"]);

/** Whether the walk policy's fixed set names this entry. */
export function isWalkFixedName(name: string): boolean {
  return WALK_FIXED_SET.has(name);
}

/** Whether a listing reads the entries below this child entry. */
export function readsChildEntries(entry: { kind: string; name: string }) {
  return entry.kind === "directory" && !isWalkFixedName(entry.name);
}
