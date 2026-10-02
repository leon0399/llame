import { invalidSelectorMessage } from '@workspace/native-file-tools';

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
 * The split-off suffix as a model resubmits it with its colon made literal. A
 * `%` is encoded before a colon is, so neither can hide behind the other: a
 * hint that leaves either behind splits or decodes differently on the next
 * attempt.
 */
export function encodeSelectorSuffix(selector: string): string {
  return selector.replaceAll('%', '%25').replaceAll(':', '%3A');
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
