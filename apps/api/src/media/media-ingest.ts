/**
 * Media ingest preparation (vision-media D2): every check and every `sharp`
 * decode/encode runs here, before any database transaction opens, so a pooled
 * connection is never held across image work. `MediaService.ingest` persists
 * the result.
 */

import { createHash } from 'node:crypto';
import sharp from 'sharp';

/** Largest accepted original, checked before any decode. */
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
/** Largest accepted original area, checked from the header before decode. */
export const MEDIA_MAX_PIXELS = 40_000_000;
/** Long-edge bound of the model variant. */
export const MODEL_MAX_EDGE = 2000;
/** Byte bound of the model variant: 3.75 MiB. */
export const MODEL_MAX_BYTES = 3_932_160;

const MODEL_JPEG_QUALITY = 85;
const MODEL_DOWNSCALE_STEP = 0.75;

export type MediaIngestErrorCode = 'image_too_large' | 'unsupported_media_type';

/** A refused ingest input; nothing was stored. */
export class MediaIngestError extends Error {
  constructor(readonly code: MediaIngestErrorCode) {
    super(
      code === 'image_too_large'
        ? 'Image exceeds 20 MiB or 40 megapixels'
        : 'Only PNG, JPEG, GIF, and WebP images are accepted',
    );
    this.name = 'MediaIngestError';
  }
}

export type OriginalMediaType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp';

export type ModelMediaType = 'image/png' | 'image/jpeg';

type EncodedImage<TMediaType extends string> = {
  mediaType: TMediaType;
  width: number;
  height: number;
  bytes: Buffer;
};

export type PreparedMedia = {
  sha256: string;
  original: EncodedImage<OriginalMediaType>;
  model: EncodedImage<ModelMediaType>;
};

/** Decoded, normalized model pixels: 8-bit sRGB, any channel count. */
export type ModelPixels = {
  data: Buffer;
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
};

const SHARP_FORMAT: Record<OriginalMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** The format named by the leading magic bytes, or undefined. */
export function detectMediaType(bytes: Buffer): OriginalMediaType | undefined {
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  const gif = bytes.toString('latin1', 0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
  if (
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return undefined;
}

/**
 * Validate an input and build its model variant. Throws `MediaIngestError`
 * for every refusal; the declared name or Content-Type never takes part.
 */
export async function prepareMedia(input: Buffer): Promise<PreparedMedia> {
  if (input.length > MEDIA_MAX_BYTES) {
    throw new MediaIngestError('image_too_large');
  }
  const mediaType = detectMediaType(input);
  if (mediaType === undefined) {
    throw new MediaIngestError('unsupported_media_type');
  }

  // Header only: libvips reads dimensions without decoding pixel data. For an
  // animated image `height` is one frame's height.
  const header = await sharp(input)
    .metadata()
    .catch(() => {
      throw new MediaIngestError('unsupported_media_type');
    });
  if (header.format !== SHARP_FORMAT[mediaType]) {
    throw new MediaIngestError('unsupported_media_type');
  }
  if (header.width * header.height > MEDIA_MAX_PIXELS) {
    throw new MediaIngestError('image_too_large');
  }

  const pixels = await decodeModelPixels(input).catch(() => {
    throw new MediaIngestError('unsupported_media_type');
  });

  return {
    sha256: createHash('sha256').update(input).digest('hex'),
    original: {
      mediaType,
      width: header.width,
      height: header.height,
      bytes: input,
    },
    model: await encodeModelVariant(pixels),
  };
}

/**
 * Full decode of the first frame, oriented, scaled to the long-edge bound
 * without upscaling. Raw output carries no metadata.
 */
async function decodeModelPixels(input: Buffer): Promise<ModelPixels> {
  const { data, info } = await sharp(input, {
    limitInputPixels: MEDIA_MAX_PIXELS,
    pages: 1,
  })
    .autoOrient()
    .resize({
      width: MODEL_MAX_EDGE,
      height: MODEL_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toColourspace('srgb')
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

/**
 * PNG; else JPEG quality 85; else JPEG scaled by successive 0.75 steps until
 * it fits. `maxBytes` is a test seam: at 2000 px a quality-85 JPEG stays
 * under 3.75 MiB even for noise, so the downscale branch needs a lower bound
 * to be exercised.
 */
export async function encodeModelVariant(
  pixels: ModelPixels,
  maxBytes: number = MODEL_MAX_BYTES,
): Promise<EncodedImage<ModelMediaType>> {
  const raw = {
    raw: {
      width: pixels.width,
      height: pixels.height,
      channels: pixels.channels,
    },
  };
  const png = await sharp(pixels.data, raw).png().toBuffer();
  if (png.length <= maxBytes) {
    return {
      mediaType: 'image/png',
      width: pixels.width,
      height: pixels.height,
      bytes: png,
    };
  }

  for (let scale = 1; ; scale *= MODEL_DOWNSCALE_STEP) {
    const width = Math.max(1, Math.round(pixels.width * scale));
    const height = Math.max(1, Math.round(pixels.height * scale));
    const jpeg = await sharp(pixels.data, raw)
      .resize(width, height)
      // JPEG has no alpha; composite transparent pixels onto white.
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: MODEL_JPEG_QUALITY })
      .toBuffer();
    if (jpeg.length <= maxBytes || (width === 1 && height === 1)) {
      return { mediaType: 'image/jpeg', width, height, bytes: jpeg };
    }
  }
}
