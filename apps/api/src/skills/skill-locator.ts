import { isSelectorSuffix } from '@workspace/native-file-tools';

import { isValidSkillName } from './skill-name';

/** The scheme this capability resolves; every other scheme fails closed. */
export const SKILL_LOCATOR_SCHEME = 'skill';

/**
 * Path bounds mirroring the Knowledge locator's: one operator-authored package
 * resource can be neither arbitrarily long nor arbitrarily deep.
 */
export const SKILL_MAX_PATH_BYTES = 1024;
export const SKILL_MAX_PATH_COMPONENTS = 32;

/**
 * A parsed `skill://` locator. Four shapes share one type:
 *
 * - `{ catalog: true }` — `skill://`, the bounded catalog listing.
 * - `{ name }` — `skill://pdf`, the package's `SKILL.md`.
 * - `{ name, trailingSeparator: true }` — `skill://pdf/`, its directory.
 * - `{ name, relativePath }` — `skill://pdf/references/formats.md`.
 */
export type ParsedSkillLocator =
  | { readonly catalog: true; readonly selector?: string }
  | {
      readonly catalog?: false;
      readonly name: string;
      readonly relativePath?: string;
      readonly selector?: string;
      /**
       * The locator ended in `/`, which addresses a directory. Kept rather than
       * normalized away: the native contract accepts it on a directory and
       * fails `not_found` on a file, and dropping it here would read the file.
       */
      readonly trailingSeparator?: true;
    };

/**
 * Parse the part after `skill://`. `undefined` means `invalid_path`.
 *
 * Segment decoding, selector separation, and traversal rules follow the
 * Knowledge locator convention, with a skill name where a Space ID sits. The
 * catalog and package-root forms have their own explicit grammar because
 * neither addresses a resource path.
 */
export function parseSkillLocator(
  rest: string,
): ParsedSkillLocator | undefined {
  // `skill://` and `skill://:raw` address the catalog itself.
  if (rest.length === 0) return { catalog: true };
  if (rest.startsWith(':')) {
    const selector = rest.slice(1);
    return isSelectorSuffix(selector) ? { catalog: true, selector } : undefined;
  }
  return parsePackageLocator(rest);
}

function parsePackageLocator(rest: string): ParsedSkillLocator | undefined {
  const separator = rest.indexOf('/');
  const nameField = separator < 0 ? rest : rest.slice(0, separator);
  // Split before decoding so an encoded colon remains part of a filename.
  const nameColon = nameField.indexOf(':');
  const name = nameColon < 0 ? nameField : nameField.slice(0, nameColon);
  if (!isValidSkillName(name)) return undefined;

  if (separator < 0) {
    if (nameColon < 0) return { name };
    const selector = nameField.slice(nameColon + 1);
    return isSelectorSuffix(selector) ? { name, selector } : undefined;
  }
  // A selector may not sit on the name when a resource path follows it.
  if (nameColon >= 0) return undefined;

  const remainder = rest.slice(separator + 1);
  if (remainder.length === 0) return { name, trailingSeparator: true };

  const colon = remainder.indexOf(':');
  const selector = colon < 0 ? undefined : remainder.slice(colon + 1);
  if (selector !== undefined && !isSelectorSuffix(selector)) return undefined;
  const rawPath = colon < 0 ? remainder : remainder.slice(0, colon);

  const trailing = rawPath.endsWith('/');
  const relativePath = decodeSkillPath(
    trailing ? rawPath.slice(0, -1) : rawPath,
  );
  if (relativePath === undefined) return undefined;
  if (relativePath.length === 0) {
    return selector === undefined
      ? { name, trailingSeparator: true }
      : { name, selector, trailingSeparator: true };
  }

  const base =
    selector === undefined
      ? { name, relativePath }
      : { name, relativePath, selector };
  return trailing ? { ...base, trailingSeparator: true } : base;
}

function decodeSkillPath(path: string): string | undefined {
  try {
    const segments = path
      .split('/')
      .map((segment) => decodeURIComponent(segment));
    // Check before joining: validation cannot distinguish an introduced slash.
    if (segments.some((segment) => segment.includes('/'))) return undefined;
    return segments.join('/');
  } catch (error) {
    if (error instanceof URIError) return undefined;
    throw error;
  }
}

/**
 * Reject a decoded resource path that escapes its package, hides a control
 * character, or exceeds the shared bounds. Returns the path components when
 * admissible.
 */
export function validateSkillResourcePath(
  relativePath: string,
): ReadonlyArray<string> | undefined {
  if (
    relativePath.length === 0 ||
    containsControlCharacter(relativePath) ||
    relativePath.includes('\\') ||
    relativePath.startsWith('/')
  ) {
    return undefined;
  }
  const components = relativePath.split('/');
  if (
    components.some(
      (component) =>
        component === '' || component === '.' || component === '..',
    )
  ) {
    return undefined;
  }
  if (
    Buffer.byteLength(relativePath, 'utf8') > SKILL_MAX_PATH_BYTES ||
    components.length > SKILL_MAX_PATH_COMPONENTS
  ) {
    return undefined;
  }
  return components;
}

function containsControlCharacter(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- a control character in a path component is exactly what this rejects.
  return /[\u0000-\u001F\u007F]/u.test(value);
}

/**
 * Canonical logical resource identity for a parsed locator: the skill name and
 * the relative path encoded exactly once, with any read selector excluded.
 * This is the shared projection for both the native resolver and permission
 * matching, so encoded spellings of the same target agree.
 */
export function formatSkillLocator(parsed: ParsedSkillLocator): string {
  if (parsed.catalog === true) return `${SKILL_LOCATOR_SCHEME}://`;
  const base = `${SKILL_LOCATOR_SCHEME}://${parsed.name}`;
  const relativePath = parsed.relativePath;
  if (relativePath === undefined || relativePath.length === 0) {
    return parsed.trailingSeparator === true ? `${base}/` : base;
  }
  const encoded = relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return parsed.trailingSeparator === true
    ? `${base}/${encoded}/`
    : `${base}/${encoded}`;
}
