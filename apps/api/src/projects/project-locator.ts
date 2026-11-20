import {
  parsePathScheme,
  splitSelectorSuffix,
} from '@workspace/native-file-tools';

/**
 * The scheme Project discovery resolves. Native `read` dispatches it through
 * the locator registry, and permission projection shares this parser rather
 * than keeping a second resource grammar.
 */
export const PROJECT_SCHEME = 'projects';

/**
 * A parsed `projects://` locator. The canonical text never carries a selector,
 * so Project identity and permission decisions ignore the native suffix while
 * the suffix stays available to the read that applies it to rendered lines.
 */
export type ProjectLocator =
  | {
      readonly kind: 'listing';
      readonly archived: boolean;
      readonly canonical: string;
      readonly selector: string | undefined;
    }
  | {
      readonly kind: 'detail';
      readonly projectId: string;
      readonly canonical: string;
      readonly selector: string | undefined;
    };

/** A plain, hyphenated UUID: eight, four, four, four, and twelve hex digits. */
const PROJECT_UUID =
  /^[\dA-Fa-f]{8}-[\dA-Fa-f]{4}-[\dA-Fa-f]{4}-[\dA-Fa-f]{4}-[\dA-Fa-f]{12}$/u;

/**
 * Characters the Project grammar never encodes: a percent escape, a query, or
 * a fragment. None can appear in the literal UUID or the `archived` keyword,
 * and none belongs in a native selector suffix either, so the whole submitted
 * text is refused before the database is visited.
 */
const RESERVED_CHARACTER = /[%?#]/u;

/**
 * Parse a full submitted Project locator, including the scheme and any native
 * selector suffix.
 *
 * The accepted forms are `projects://` and its root alias `projects:///` for
 * active Projects, `projects://archived` for archived Projects, and
 * `projects://<uuid>` for one Project. The scheme is parsed case-insensitively
 * by the shared native grammar and the UUID is lowercased. Unknown paths,
 * extra path segments, percent escapes, queries, fragments, and malformed
 * UUIDs are refused here, before any lookup. No path is percent-decoded and
 * nothing touches a filesystem.
 *
 * The selector is split with the native read grammar and returned as written:
 * the Project parser decides only the resource, and the native text reader
 * applies the suffix or refuses one outside its grammar.
 */
export function parseProjectLocator(
  submitted: string,
): ProjectLocator | undefined {
  if (RESERVED_CHARACTER.test(submitted)) return undefined;

  const { path, selector } = splitSelectorSuffix(submitted);
  const scheme = parsePathScheme(path);

  if (scheme?.scheme !== PROJECT_SCHEME) return undefined;

  const root = `${PROJECT_SCHEME}://`;

  // `projects://` and `projects:///` name the same listing. The alias exists
  // because the empty authority is commonly written with a separator.
  if (scheme.rest === '' || scheme.rest === '/') {
    return { kind: 'listing', archived: false, canonical: root, selector };
  }

  if (scheme.rest === 'archived') {
    return {
      kind: 'listing',
      archived: true,
      canonical: `${root}archived`,
      selector,
    };
  }

  if (!PROJECT_UUID.test(scheme.rest)) return undefined;

  const projectId = scheme.rest.toLowerCase();

  return {
    kind: 'detail',
    projectId,
    canonical: `${root}${projectId}`,
    selector,
  };
}
