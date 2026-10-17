import { uploadMedia } from "../../api/generated/media/media";
import type {
  MediaDescriptorResponse,
  MediaPdfDescriptorResponse,
} from "../../api/generated/models";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

/** A stored upload's descriptor: an image's, carrying `width`/`height`, or a
 *  PDF's, carrying `pages`. */
export type MediaDescriptor =
  | MediaDescriptorResponse
  | MediaPdfDescriptorResponse;

/** Image types the composer attaches; the API accepts exactly these. */
export const ATTACHABLE_IMAGE_TYPES: ReadonlyArray<string> = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

/** The PDF type, attachable once the selected model declares `pdf` input. */
export const ATTACHABLE_PDF_TYPE = "application/pdf";

/** Stores one attachment through `POST /api/v1/media` with the session
 *  cookie and returns its descriptor, an image's or a PDF's; rejects on any
 *  non-2xx answer (413 too large, 415 unsupported). */
export async function uploadAttachment(file: File): Promise<MediaDescriptor> {
  return uploadMedia(
    { file },
    undefined,
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
}
