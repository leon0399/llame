import type {
  ImageIngestSuccess,
  ImageReadHook,
} from '@workspace/native-file-tools';

import type { MediaObject, MediaProvenance } from '../db/schema';
import { MEDIA_MAX_BYTES, MediaIngestError } from './media-ingest';
import { mediaLocator } from './media-locator';
import type { MediaService } from './media.service';

/**
 * The Run owner's media as native `read` sees it (vision-media D7), bound at
 * construction to one owner and one provenance, so nothing a model supplies
 * can widen either.
 */
export type ToolMediaStore = {
  /**
   * The image hook of one read, labelling what it ingests with `source`, the
   * locator as the model submitted it. A file over the byte bound is refused
   * before it is read; every ingest refusal is the read's structured failure.
   */
  readonly ingestImage: (source: string) => ImageReadHook;
  /** The owner's image, or undefined for a foreign or unknown id alike. */
  readonly findImage: (id: string) => Promise<ImageIngestSuccess | undefined>;
};

function imageOf(stored: MediaObject): ImageIngestSuccess {
  return {
    status: 'success',
    media: mediaLocator(stored.id),
    mediaType: stored.mediaType,
    width: stored.width,
    height: stored.height,
  };
}

export function createToolMediaStore(
  media: Pick<MediaService, 'ingest' | 'findOwned'>,
  ownerUserId: string,
  provenance: MediaProvenance,
): ToolMediaStore {
  return {
    ingestImage:
      (source) =>
      async ({ byteSize, readBytes }) => {
        try {
          if (byteSize > MEDIA_MAX_BYTES) {
            throw new MediaIngestError('image_too_large');
          }
          const { media: stored } = await media.ingest(ownerUserId, {
            bytes: await readBytes(),
            provenance,
            source,
          });
          return imageOf(stored);
        } catch (error) {
          if (!(error instanceof MediaIngestError)) throw error;
          return { status: 'error', type: error.code, message: error.message };
        }
      },
    async findImage(id) {
      const stored = await media.findOwned(ownerUserId, id);
      return stored && imageOf(stored);
    },
  };
}
