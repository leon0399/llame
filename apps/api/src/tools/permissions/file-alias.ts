/**
 * Pure `file:` alias classifier and strict decoder.
 *
 * This module is a leaf: it imports nothing from native executors, Knowledge,
 * Skill, web parsers, or workspace-path. Both `executeNative` and
 * `projectNativeFilePath` call it before any other scheme parsing or
 * Workspace-relative classification.
 */

/** Classifier: does the submitted text start with a case-insensitive `file:`? */
export function isFileAlias(value: string): boolean {
  return value.length >= 5 && value.slice(0, 5).toLowerCase() === 'file:';
}

/**
 * Result of {@link decodeFileAlias}. `ok: true` carries the decoded absolute
 * host path, with any read selector still on it for the caller's own
 * grammar; `ok: false` carries the `invalid_path` result.
 */
export type FileAliasResult =
  | { readonly ok: true; readonly hostPath: string }
  | {
      readonly ok: false;
      readonly message: string;
    };

const REMOTE_AUTHORITY_MESSAGE =
  'A file:// URL with a host other than localhost names another machine. ' +
  "Only this host's files are readable; write the absolute path instead.";

/**
 * Strict total decoder for `file:` aliases.
 *
 * **Pre-condition:** the caller has already verified {@link isFileAlias}.
 *
 * Returns the decoded absolute host path on success, or a structured
 * `invalid_path` on any validation failure. Never throws.
 */
export function decodeFileAlias(value: string): FileAliasResult {
  const raw = extractRawPath(value.slice(5));
  if ('ok' in raw) return raw;

  const refused = refuseLiteralChars(raw.path);
  if (refused !== undefined) return refused;
  const decoded = decodePercent(raw.path);
  if (decoded === undefined)
    return invalid('Malformed or non-UTF-8 percent escape in file URL.');

  return { ok: true, hostPath: decoded };
}

/** Parse the authority or minimal form and return the raw path, or an error. */
function extractRawPath(
  afterScheme: string,
): { path: string } | FileAliasResult {
  if (afterScheme.startsWith('//')) {
    const rest = afterScheme.slice(2);
    const slashIdx = rest.indexOf('/');
    if (slashIdx < 0)
      return invalid(
        'A file:// URL must include an absolute path after the authority.',
      );
    const authority = rest.slice(0, slashIdx);
    if (authority !== '' && authority.toLowerCase() !== 'localhost')
      return { ok: false, message: REMOTE_AUTHORITY_MESSAGE };
    return { path: rest.slice(slashIdx) };
  }
  if (!afterScheme.startsWith('/'))
    return invalid(
      'A file: URL without an authority must start with /; write the absolute path instead.',
    );
  return { path: afterScheme };
}

/** Refuse literal query, fragment, backslash, C0 controls, and DEL. */
function refuseLiteralChars(rawPath: string): FileAliasResult | undefined {
  for (let i = 0; i < rawPath.length; i++) {
    const ch = rawPath.charCodeAt(i);
    if (ch === 0x3f) return invalid('A file URL must not contain a query.');
    if (ch === 0x23) return invalid('A file URL must not contain a fragment.');
    if (ch === 0x5c) return invalid('A file URL must not contain a backslash.');
    if (ch <= 0x1f || ch === 0x7f)
      return invalid('A file URL must not contain control characters.');
  }
  return undefined;
}

/**
 * Decode each `%XX` escape once. Guards `%2F` and `%00` explicitly, then
 * delegates to `decodeURIComponent` which handles UTF-8 multibyte sequences
 * and rejects malformed or non-UTF-8 escapes.
 */
function decodePercent(raw: string): string | undefined {
  if (!raw.includes('%')) return raw;
  if (/%(?:2[fF]|00)/u.test(raw)) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

function invalid(message: string): FileAliasResult {
  return { ok: false, message };
}
