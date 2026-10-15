import type {
  MediaDecodeSuccess,
  MediaReadHook,
} from '@workspace/native-file-tools';

import type { MediaObject } from '../db/schema';
import type { ModelInput } from '../models/model-catalog';
import type { HeldMedia } from './attempt-media';
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
import { PDF_MEDIA_TYPE, preparePdf } from './pdf-preparation';

/** The owner's stored image a `media://` read returns. */
export type StoredImage = {
  status: 'success';
  kind: 'image';
  media: string;
  mediaType: string;
  width: number;
  height: number;
};

/** The owner's stored PDF a `media://` read returns. */
export type StoredPdf = {
  status: 'success';
  kind: 'pdf';
  media: string;
  mediaType: typeof PDF_MEDIA_TYPE;
  pages: number;
  byteSize: number;
};

/**
 * The Run owner's media as native `read` sees it (vision-media D7), bound at
 * construction to one owner and one attempt, so nothing a model supplies can
 * widen either.
 */
export type ToolMediaStore = {
  /**
   * The media hook of one read of `locator`, as the model submitted it.
   * It prepares the file without storing it;
   * the attempt's memory keeps an entry under `key`, the read's tool call id.
   * A file over the byte bound is refused before it is read; every
   * preparation refusal is the read's structured failure.
   */
  readonly readMedia: (
    locator: string,
    key: string | undefined,
  ) => MediaReadHook;
  /**
   * The owner's image or PDF, or undefined for a foreign or unknown id alike.
   */
  readonly findMedia: (
    id: string,
  ) => Promise<StoredImage | StoredPdf | undefined>;
};

function storedOf(stored: MediaObject): StoredImage | StoredPdf | undefined {
  // Only a PDF row has a page count (media_objects_shape).
  if (stored.pageCount !== null) {
    return {
      status: 'success',
      kind: 'pdf',
      media: mediaLocator(stored.id),
      mediaType: PDF_MEDIA_TYPE,
      pages: stored.pageCount,
      byteSize: stored.byteSize,
    };
  }
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

type PreparedRead = { result: MediaDecodeSuccess; entry: HeldMedia };

async function preparePdfRead(
  bytes: Buffer,
  locator: string,
  retain: boolean,
): Promise<PreparedRead> {
  const pages = await preparePdf(bytes);
  return {
    result: {
      status: 'success',
      kind: 'pdf',
      mediaType: PDF_MEDIA_TYPE,
      pages,
      byteSize: bytes.byteLength,
    },
    entry: {
      locator,
      pages,
      ...(retain && { bytes, byteSize: bytes.byteLength }),
    },
  };
}

async function prepareImageRead(
  bytes: Buffer,
  locator: string,
  retain: boolean,
): Promise<PreparedRead> {
  const { original, model } = await prepareMedia(bytes);
  const thumbnail = await encodeThumbnail(model.bytes);
  const { mediaType, width, height } = original;
  return {
    result: {
      status: 'success',
      kind: 'image',
      mediaType,
      width,
      height,
      ...(thumbnail !== undefined && { thumbnail }),
    },
    entry: { locator, width, height, ...(retain && { model }) },
  };
}

/** Prepare one read; abandoned reads retain nothing in the attempt. */
function unstoredRead(
  held: Map<string, HeldMedia>,
  input: ReadonlyArray<ModelInput>,
  locator: string,
  key: string | undefined,
): MediaReadHook {
  return async ({ kind, byteSize, readBytes, signal }) => {
    try {
      if (byteSize > MEDIA_MAX_BYTES) {
        throw new MediaIngestError(
          kind === 'pdf'
            ? MEDIA_REFUSAL.pdfTooLarge
            : MEDIA_REFUSAL.imageTooLarge,
        );
      }
      const bytes = await readBytes();
      const prepared = await (kind === 'pdf'
        ? preparePdfRead(bytes, locator, input.includes(kind))
        : prepareImageRead(bytes, locator, input.includes(kind)));
      signal?.throwIfAborted();
      if (key !== undefined) held.set(key, prepared.entry);
      return prepared.result;
    } catch (error) {
      if (!(error instanceof MediaIngestError)) throw error;
      return { status: 'error', type: error.code, message: error.message };
    }
  };
}

/** The store of one attempt, reading into `held`. */
export function createToolMediaStore(
  media: Pick<MediaService, 'findOwned'>,
  ownerUserId: string,
  held: Map<string, HeldMedia>,
  input: ReadonlyArray<ModelInput>,
): ToolMediaStore {
  return {
    readMedia: (locator, key) => unstoredRead(held, input, locator, key),
    async findMedia(id) {
      const stored = await media.findOwned(ownerUserId, id);
      return stored && storedOf(stored);
    },
  };
}
