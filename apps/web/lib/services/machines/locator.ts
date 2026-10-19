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

/**
 * The path on the Machine itself, as a shell there would take it: the
 * locator's path with its one layer of `%XX` escapes (`%`, `#`, `?`, `\`, and
 * control characters) decoded. Undefined for a root that is not a Machine
 * locator.
 */
export function machinePathFromRoot(workspaceRoot: string): string | undefined {
  const match = MACHINE_ROOT.exec(workspaceRoot);
  if (match === null) return undefined;
  const encoded = match[0].endsWith("/")
    ? workspaceRoot.slice(match[0].length - 1)
    : "/";
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

/** The status entry for a Machine name, matched case-insensitively. */
export function findMachineByName<T extends { name: string }>(
  machines: ReadonlyArray<T> | undefined,
  machineName: string | undefined,
): T | undefined {
  if (machineName === undefined) return undefined;
  const wanted = machineName.toLowerCase();
  return machines?.find((entry) => entry.name.toLowerCase() === wanted);
}
