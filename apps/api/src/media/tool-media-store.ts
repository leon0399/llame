import type { ImageReadHook } from '@workspace/native-file-tools';

import type { MediaObject } from '../db/schema';
import type { HeldImage } from './attempt-images';
import { imageColumns } from './media-descriptors';
import {
  encodeThumbnail,
  MEDIA_MAX_BYTES,
  MEDIA_REFUSAL,
  MediaIngestError,
  prepareMedia,
} from './media-ingest';
import { mediaLocator } from './media-locator';
import type { MediaService } from './media.service';

/** The owner's stored image a `media://` read returns. */
export type StoredImage = {
  status: 'success';
  kind: 'image';
  media: string;
  mediaType: string;
  width: number;
  height: number;
};

/** The owner's stored PDF, which a `media://` read refuses until pdf-read. */
export type StoredPdf = { kind: 'pdf' };

/**
 * The Run owner's media as native `read` sees it (vision-media D7), bound at
 * construction to one owner and one attempt, so nothing a model supplies can
 * widen either.
 */
export type ToolMediaStore = {
  /**
   * The image hook of one read of `locator`, the path as the model submitted
   * it. It decodes the image with the upload preparation and stores nothing;
   * the attempt's memory keeps an entry under `key`, the read's tool call id.
   * A file over the byte bound is refused before it is read; every
   * preparation refusal is the read's structured failure.
   */
  readonly readImage: (
    locator: string,
    key: string | undefined,
  ) => ImageReadHook;
  /**
   * The owner's image or PDF, or undefined for a foreign or unknown id alike.
   */
  readonly findImage: (
    id: string,
  ) => Promise<StoredImage | StoredPdf | undefined>;
};

function storedOf(stored: MediaObject): StoredImage | StoredPdf | undefined {
  // Only a PDF row has a page count (media_objects_shape).
  if (stored.pageCount !== null) return { kind: 'pdf' };
  const image = imageColumns(stored);
  if (image === undefined) return undefined;
  const { width, height } = image;
  return {
    status: 'success',
    kind: 'image',
    media: mediaLocator(stored.id),
    mediaType: stored.mediaType,
    width,
    height,
  };
}

/**
 * The image hook of one read of `locator`: it decodes the image and holds the
 * attempt's memory entry under `key`, with the model variant whenever the
 * attempt's model declares `image` input (`imageInput`); otherwise the entry
 * keeps what its placeholder needs. The step composer admits a kept variant
 * into the epoch window when the next step is composed, and releases it when
 * the window does not attach it (R1.4). A read aborted before the entry is
 * held throws its abort reason and holds nothing.
 */
function unstoredRead(
  memory: { images: Map<string, HeldImage>; imageInput: boolean },
  locator: string,
  key: string | undefined,
): ImageReadHook {
  return async ({ byteSize, readBytes, signal }) => {
    try {
      if (byteSize > MEDIA_MAX_BYTES) {
        throw new MediaIngestError(MEDIA_REFUSAL.imageTooLarge);
      }
      const { original, model } = await prepareMedia(await readBytes());
      const thumbnail = await encodeThumbnail(model.bytes);
      const { mediaType, width, height } = original;
      // The decode outlives an abandoned read; nothing is held once it ends.
      signal?.throwIfAborted();
      if (key !== undefined) {
        memory.images.set(key, {
          locator,
          width,
          height,
          ...(memory.imageInput && { model }),
        });
      }
      return {
        status: 'success',
        mediaType,
        width,
        height,
        ...(thumbnail !== undefined && { thumbnail }),
      };
    } catch (error) {
      if (!(error instanceof MediaIngestError)) throw error;
      return { status: 'error', type: error.code, message: error.message };
    }
  };
}

/** The store of one attempt, reading into `images`. */
export function createToolMediaStore(
  media: Pick<MediaService, 'findOwned'>,
  ownerUserId: string,
  images: Map<string, HeldImage>,
  imageInput: boolean,
): ToolMediaStore {
  return {
    readImage: (locator, key) =>
      unstoredRead({ images, imageInput }, locator, key),
    async findImage(id) {
      const stored = await media.findOwned(ownerUserId, id);
      return stored && storedOf(stored);
    },
  };
}
