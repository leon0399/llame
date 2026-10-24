/**
 * Remote normalization (openspec `repositories` design D1).
 *
 * A repository's identity is its normalized remote: the scheme and any
 * userinfo are removed, the host is lowercased while the path keeps its case,
 * and one trailing `.git` and one trailing slash are dropped. The function is
 * pure and total, so `git@github.com:leon0399/llame.git` and
 * `https://github.com/leon0399/llame` are one repository, and nothing a clone
 * URL carries in its userinfo part — a token above all — survives into storage.
 */

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;
/** The `git@host:path` form: one user, one host, then the path. */
const SCP_FORM = /^[^@/\s:]+@([^:/\s]+):(.+)$/u;
const TRAILING_SLASHES = /\/+$/u;

/** Drop everything before an optional `@`, up to the end of the authority. */
function stripUserinfo(value: string): string {
  const slash = value.indexOf('/');
  const authorityEnd = slash === -1 ? value.length : slash;
  const at = value.lastIndexOf('@', authorityEnd);
  return at === -1 ? value : value.slice(at + 1);
}

/** Lowercase the host segment and leave the path's case alone. */
function lowercaseHost(value: string): string {
  const slash = value.indexOf('/');
  return slash === -1
    ? value
    : `${value.slice(0, slash).toLowerCase()}${value.slice(slash)}`;
}

function stripSuffixes(value: string): string {
  const withoutSlash = value.replace(TRAILING_SLASHES, '');
  const withoutGit = withoutSlash.endsWith('.git')
    ? withoutSlash.slice(0, -'.git'.length)
    : withoutSlash;
  return withoutGit.replace(TRAILING_SLASHES, '');
}

/**
 * The canonical form of one remote. A string with no host and path shape — one
 * that is not a remote at all — keeps its trimmed text.
 */
export function normalizeRemote(value: string): string {
  const text = value.trim();
  if (text === '') return '';

  const scheme = URL_SCHEME.exec(text);
  if (scheme !== null) {
    return stripSuffixes(
      lowercaseHost(stripUserinfo(text.slice(scheme[0].length))),
    );
  }

  const scp = SCP_FORM.exec(text);
  if (scp !== null) {
    return stripSuffixes(lowercaseHost(`${scp[1]}/${scp[2]}`));
  }

  return text.includes('/') ? stripSuffixes(lowercaseHost(text)) : text;
}

/**
 * The canonical remote of a clone: the normalized URL of its remote named
 * `origin`, or `null` for a clone without one. A clone with only `upstream` is
 * a clone without a remote (design D1), so no other name is consulted.
 */
export function canonicalOrigin(
  remotes: ReadonlyArray<{ readonly name: string; readonly url: string }>,
): string | null {
  const origin = remotes.find((remote) => remote.name === 'origin');
  if (origin === undefined) return null;
  const normalized = normalizeRemote(origin.url);
  return normalized === '' ? null : normalized;
}
