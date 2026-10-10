import {
  getGetMediaModelUrl,
  getGetMediaOriginalUrl,
} from "../../api/generated/media/media";
import { getApiUrl } from "../../api/fetch";

/** The api's `media://<id>` grammar: a lower-case canonical UUID only. */
const MEDIA_LOCATOR_PATTERN =
  /^media:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export type MediaVariant = "original" | "model";

/** The media id a `media://<id>` locator names, or `null` for any other
 *  string. */
export function mediaIdFromLocator(locator: string): string | null {
  return MEDIA_LOCATOR_PATTERN.exec(locator)?.[1] ?? null;
}

/** The absolute API URL serving one variant of a stored image, or `null`
 *  when `locator` is not a `media://` locator. The image element loads it
 *  with the session cookie (same-site), so no token is embedded. */
export function mediaVariantUrl(
  locator: string,
  variant: MediaVariant,
): string | null {
  const id = mediaIdFromLocator(locator);
  if (id === null) return null;
  const path =
    variant === "model" ? getGetMediaModelUrl(id) : getGetMediaOriginalUrl(id);
  return `${getApiUrl()}${path}`;
}
