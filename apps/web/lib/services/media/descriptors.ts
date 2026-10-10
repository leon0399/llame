import { getMedia } from "../../api/generated/media/media";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import type { MediaDescriptor } from "./uploads";

/** Loads one stored image's descriptor (`GET /api/v1/media/:id`) with the
 *  session cookie; rejects on any non-2xx answer (404 for another owner's or
 *  an unknown id). */
export function fetchMediaDescriptor(id: string): Promise<MediaDescriptor> {
  return getMedia(
    id,
    undefined,
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
}
