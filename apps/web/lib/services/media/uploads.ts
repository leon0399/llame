import { uploadMedia } from "../../api/generated/media/media";
import type { MediaDescriptorResponse } from "../../api/generated/models";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

export type MediaDescriptor = MediaDescriptorResponse;

/** Image types the composer attaches; the API accepts exactly these. */
export const ATTACHABLE_IMAGE_TYPES: ReadonlyArray<string> = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

/** Stores one image through `POST /api/v1/media` with the session cookie;
 *  rejects on any non-2xx answer (413 too large, 415 unsupported), and on a
 *  PDF descriptor, which the API returns when the picked file's bytes are a
 *  PDF whatever its name: the composer attaches images only. */
export async function uploadImage(file: File): Promise<MediaDescriptor> {
  const descriptor = await uploadMedia(
    { file },
    undefined,
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
  if (!("width" in descriptor)) {
    throw new Error("Only images can be attached");
  }
  return descriptor;
}
