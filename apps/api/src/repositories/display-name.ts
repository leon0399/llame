/**
 * The display name of a repository is one path segment: the worktree directory
 * embeds it, so it can never carry a separator or a parent segment. Both the
 * owner's own submission and an adoption-derived name go through the same rule.
 */

/** The display-name cap, matching the DTO's `@MaxLength`. */
export const DISPLAY_NAME_MAX = 200;

/** Why `name` is not one path segment, or `null` when it is. */
export function displayNameProblem(name: string): string | null {
  if (name.trim() === '') return 'must not be blank';
  if (name === '.' || name === '..') return 'must not be "." or ".."';
  if (name.includes('/') || name.includes('\0'))
    return 'must not contain "/" or a NUL byte';
  return name.length > DISPLAY_NAME_MAX
    ? `must be at most ${DISPLAY_NAME_MAX} characters`
    : null;
}

/**
 * The name adoption gives a repository: the last segment of the canonical
 * remote, else the toplevel's basename, sanitized to the rule above. A
 * repository whose only candidates are unusable is named `repository`.
 */
export function derivedDisplayName(
  canonicalRemote: string | null,
  toplevel: string,
): string {
  const segment =
    (canonicalRemote ?? toplevel)
      .split('/')
      .filter((part) => part !== '')
      .at(-1) ?? '';
  return displayNameProblem(segment) === null ? segment : 'repository';
}
