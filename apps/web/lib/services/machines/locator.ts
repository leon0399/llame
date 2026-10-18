/**
 * The web side of a `machine://<name>/...` Workspace root. The hub owns the
 * full grammar (percent escapes, selectors, the bare listing forms); the
 * browser only needs the Machine a bound Workspace names, so this reads the
 * one fixed segment between the scheme and the first path separator.
 *
 * Machine names are the operator's configuration keys: lowercase alphanumerics
 * and dashes. The scheme comparison is case-insensitive because a locator may
 * arrive from a shared link or a hand-edited Chat; names are matched
 * case-insensitively by callers for the same reason.
 */
const MACHINE_ROOT = /^machine:\/\/([a-z0-9-]{1,63})(?:\/|$)/iu;

/** The Machine a `machine://` Workspace root names, if it is one. */
export function machineNameFromRoot(workspaceRoot: string): string | undefined {
  const match = MACHINE_ROOT.exec(workspaceRoot);
  if (match === null) return undefined;
  return match[1];
}
