import { createHash, randomBytes } from 'node:crypto';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';

import {
  encodeModelVariant,
  MEDIA_MAX_BYTES,
  MediaIngestError,
  type MediaIngestErrorCode,
  prepareMedia,
} from './media-ingest';

vi.setConfig({ testTimeout: 30_000 });

function solid(width: number, height: number, background = '#336699') {
  return sharp({ create: { width, height, channels: 3, background } });
}

/** A 1×1 PNG whose IHDR is patched to declare `width`×`height`. */
async function pngDeclaring(width: number, height: number): Promise<Buffer> {
  const png = await solid(1, 1).png().toBuffer();
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
  return png;
}

function noisePixels(width: number, height: number) {
  return {
    data: randomBytes(width * height * 3),
    width,
    height,
    channels: 3 as const,
  };
}

async function refusal(input: Buffer): Promise<MediaIngestErrorCode> {
  try {
    await prepareMedia(input);
  } catch (error) {
    if (error instanceof MediaIngestError) return error.code;
    throw error;
  }
  throw new Error('Expected a MediaIngestError refusal');
}

describe('prepareMedia refusals', () => {
  it('refuses SVG as unsupported_media_type', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    expect(await refusal(svg)).toBe('unsupported_media_type');
  });

  it('refuses HTML regardless of any declared name', async () => {
    const html = Buffer.from('<!doctype html><html><body>shot</body></html>');
    expect(await refusal(html)).toBe('unsupported_media_type');
  });

  it('refuses a PNG signature truncated after the header', async () => {
    const truncated = (await solid(10, 10).png().toBuffer()).subarray(0, 33);
    expect(await refusal(truncated)).toBe('unsupported_media_type');
  });

  it('refuses a JPEG signature with no decodable image', async () => {
    const corrupt = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(64, 0),
    ]);
    expect(await refusal(corrupt)).toBe('unsupported_media_type');
  });

  it('refuses a 21 MiB input as image_too_large before decoding it', async () => {
    // A PNG signature followed by garbage: decoding it would fail as
    // unsupported, so image_too_large proves the byte bound ran first.
    const signature = (await solid(1, 1).png().toBuffer()).subarray(0, 8);
    const big = Buffer.concat([signature, Buffer.alloc(21 << 20)]);
    expect(await refusal(big)).toBe('image_too_large');
  });

  // The files carry one real pixel, so a full decode would fail as
  // unsupported_media_type; image_too_large proves the header check ran.
  it.each([
    [8000, 5125],
    [20_000, 20_000],
    [65_535, 65_535],
  ])(
    'refuses a small PNG whose header declares %i×%i',
    async (width, height) => {
      expect(await refusal(await pngDeclaring(width, height))).toBe(
        'image_too_large',
      );
    },
  );
});

describe('prepareMedia original', () => {
  it('records an 800×600 PNG and keeps its bytes unchanged', async () => {
    const input = await solid(800, 600).png().toBuffer();
    const prepared = await prepareMedia(input);

    expect(prepared.original).toEqual({
      mediaType: 'image/png',
      width: 800,
      height: 600,
      bytes: input,
    });
    expect(prepared.sha256).toBe(
      createHash('sha256').update(input).digest('hex'),
    );
    expect(prepared.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('accepts WebP by its magic bytes', async () => {
    const webp = await solid(30, 20).webp().toBuffer();
    expect((await prepareMedia(webp)).original).toMatchObject({
      mediaType: 'image/webp',
      width: 30,
      height: 20,
    });
  });

  it('accepts an image of exactly 40 megapixels', async () => {
    const input = await solid(8000, 5000)
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(input.length).toBeLessThanOrEqual(MEDIA_MAX_BYTES);

    const prepared = await prepareMedia(input);
    expect(prepared.original).toMatchObject({ width: 8000, height: 5000 });
    expect(prepared.model).toMatchObject({ width: 2000, height: 1250 });
  });

  it('keeps the original JPEG EXIF while the model variant has none', async () => {
    const input = await solid(1200, 800)
      .jpeg()
      .withExif({
        IFD0: { Orientation: '6' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' },
      })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const inputMeta = await sharp(input).metadata();
    expect(inputMeta.orientation).toBe(6);
    expect(inputMeta.exif).toBeDefined();

    const prepared = await prepareMedia(input);

    expect(prepared.original.bytes.equals(input)).toBe(true);
    expect(prepared.original).toMatchObject({ width: 1200, height: 800 });
    expect(prepared.model).toMatchObject({
      mediaType: 'image/png',
      width: 800,
      height: 1200,
    });
    const modelMeta = await sharp(prepared.model.bytes).metadata();
    expect(modelMeta).toMatchObject({ width: 800, height: 1200 });
    expect(modelMeta.exif).toBeUndefined();
    expect(modelMeta.orientation).toBeUndefined();
    expect(modelMeta.icc).toBeUndefined();
    expect(modelMeta.xmp).toBeUndefined();
  });
});

describe('prepareMedia model variant', () => {
  it('scales a 4000×1000 PNG to 2000×500', async () => {
    const prepared = await prepareMedia(
      await solid(4000, 1000).png().toBuffer(),
    );
    expect(prepared.model).toMatchObject({
      mediaType: 'image/png',
      width: 2000,
      height: 500,
    });
    const meta = await sharp(prepared.model.bytes).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 2000, height: 500 });
  });

  it('never upscales a 300×200 PNG', async () => {
    const prepared = await prepareMedia(await solid(300, 200).png().toBuffer());
    expect(prepared.model).toMatchObject({ width: 300, height: 200 });
  });

  it('encodes a small JPEG as a PNG model variant', async () => {
    const prepared = await prepareMedia(
      await solid(300, 200).jpeg().toBuffer(),
    );
    expect(prepared.model.mediaType).toBe('image/png');
    expect((await sharp(prepared.model.bytes).metadata()).format).toBe('png');
  });

  it('keeps only the first frame of an animated GIF', async () => {
    const red = await solid(20, 10, '#ff0000').png().toBuffer();
    const blue = await solid(20, 10, '#0000ff').png().toBuffer();
    const gif = await sharp([red, blue], { join: { animated: true } })
      .gif()
      .toBuffer();
    expect((await sharp(gif).metadata()).pages).toBe(2);

    const prepared = await prepareMedia(gif);

    expect(prepared.original).toMatchObject({
      mediaType: 'image/gif',
      width: 20,
      height: 10,
    });
    expect(prepared.model).toMatchObject({ width: 20, height: 10 });
    const meta = await sharp(prepared.model.bytes).metadata();
    expect(meta.pages).toBeUndefined();
    const { channels } = await sharp(prepared.model.bytes).stats();
    expect(channels.slice(0, 3).map((channel) => channel.mean)).toEqual([
      255, 0, 0,
    ]);
  });

  it('falls back to JPEG when the PNG encoding exceeds 3.75 MiB', async () => {
    const pixels = noisePixels(2000, 2000);
    const input = await sharp(pixels.data, { raw: pixels }).png().toBuffer();
    expect(input.length).toBeGreaterThan(3_932_160);

    const prepared = await prepareMedia(input);

    expect(prepared.model).toMatchObject({
      mediaType: 'image/jpeg',
      width: 2000,
      height: 2000,
    });
    expect(prepared.model.bytes.length).toBeLessThanOrEqual(3_932_160);
    expect((await sharp(prepared.model.bytes).metadata()).format).toBe('jpeg');
  });
});

describe('encodeModelVariant', () => {
  it('scales by 0.75 steps until the JPEG fits the bound', async () => {
    const pixels = noisePixels(2000, 2000);
    const maxBytes = 1_000_000;

    const model = await encodeModelVariant(pixels, maxBytes);

    expect(model.mediaType).toBe('image/jpeg');
    expect(model.bytes.length).toBeLessThanOrEqual(maxBytes);
    expect(model.width).toBeLessThan(2000);
    // Each step multiplies the previous scale by 0.75: 1500, 1125, 844, ...
    expect([1500, 1125, 844, 633, 475]).toContain(model.width);
    expect(model.height).toBe(model.width);
    const meta = await sharp(model.bytes).metadata();
    expect(meta).toMatchObject({
      format: 'jpeg',
      width: model.width,
      height: model.height,
    });
  });

  it('flattens transparency onto white when falling back to JPEG', async () => {
    const pixels = {
      data: Buffer.alloc(4 * 4 * 4, 0),
      width: 4,
      height: 4,
      channels: 4 as const,
    };
    const model = await encodeModelVariant(pixels, 1);
    expect(model.mediaType).toBe('image/jpeg');
    const { channels } = await sharp(model.bytes).stats();
    expect(channels[0]?.mean).toBeGreaterThan(250);
  });
});
