import { invalidSelectorMessage } from '@workspace/native-file-tools';

export type LocatorParseFailure = {
  readonly type: 'invalid_path' | 'invalid_selector';
  readonly message: string;
};

/**
 * The one canonical encoding of a decoded relative path: each segment encoded,
 * the separators left as separators. A canonical resource identity and the
 * spelling a selector refusal names both encode exactly once this way.
 */
export function encodeRelativePath(relativePath: string): string {
  return relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Decode each path segment exactly once, rejecting encoded separators and
 * strings that cannot be passed through URI encoding safely.
 */
export function decodeRelativePath(path: string): string | undefined {
  try {
    const segments = path
      .split('/')
      .map((segment) => decodeURIComponent(segment));
    // Check before joining: validation cannot distinguish an introduced slash
    // or an unpaired surrogate after the segments have been combined.
    if (
      segments.some(
        (segment) => segment.includes('/') || hasUnpairedSurrogate(segment),
      )
    ) {
      return undefined;
    }
    return segments.join('/');
  } catch (error) {
    if (error instanceof URIError) return undefined;
    throw error;
  }
}

function hasUnpairedSurrogate(value: string): boolean {
  const withoutPairs = value.replaceAll(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, '');
  return /[\uD800-\uDFFF]/u.test(withoutPairs);
}

/**
 * The split-off suffix as a model resubmits it with its colon made literal.
 * The resubmitted locator is percent-decoded like any other, so a valid `%HH`
 * escape is kept and names the same character, while a stray `%` that would
 * not decode is encoded as `%25`.
 */
export function encodeSelectorSuffix(selector: string): string {
  return selector
    .replaceAll(/%(?![\dA-Fa-f]{2})/gu, '%25')
    .replaceAll(':', '%3A');
}

/**
 * The one refusal for a suffix outside the grammar: the shared sentence names
 * the working forms, and a locator that has an encoded spelling for a literal
 * colon follows them with that spelling. A source with no resource path to
 * name — the Space directory, a package root, the catalog — passes nothing and
 * gets the forms alone.
 */
export function selectorRefusalMessage(spelling: string | undefined): string {
  return invalidSelectorMessage(
    spelling === undefined
      ? undefined
      : `For a literal colon, write this locator as ${spelling}`,
  );
}
