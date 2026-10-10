const MEDIA_SCHEME = 'media://';

// Lower-case canonical UUID only: no braces, no upper-case hex, no suffix.
const CANONICAL_MEDIA_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function isCanonicalMediaId(id: string): boolean {
  return CANONICAL_MEDIA_ID.test(id);
}

export function mediaLocator(id: string): string {
  return `${MEDIA_SCHEME}${id}`;
}

/**
 * The media id a `media://` locator names, or undefined when the locator does
 * not match the canonical grammar. Bare `media://` is reserved and invalid.
 */
export function parseMediaLocator(locator: string): string | undefined {
  if (!locator.startsWith(MEDIA_SCHEME)) return undefined;
  const id = locator.slice(MEDIA_SCHEME.length);
  return isCanonicalMediaId(id) ? id : undefined;
}
