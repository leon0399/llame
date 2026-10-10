/** The scheme native `read` routes to the owner's media (vision-media D4). */
export const MEDIA_LOCATOR_SCHEME = 'media';
const MEDIA_SCHEME = `${MEDIA_LOCATOR_SCHEME}://`;

// Lower-case canonical UUID only: no braces, no upper-case hex, no suffix.
const UUID_HEX = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CANONICAL_MEDIA_ID = new RegExp(`^${UUID_HEX}$`, 'u');

/** The whole-string grammar of a `media://<id>` locator. */
export const MEDIA_LOCATOR_PATTERN = new RegExp(
  `^${MEDIA_SCHEME}${UUID_HEX}$`,
  'u',
);

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
