/**
 * Test fixtures for owner media (vision-media, pdf-media): descriptors, a
 * resolver over fixed descriptors with an empty attempt memory, a stored PDF
 * row, and unique PNG bytes.
 */
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

import type { MediaObject } from '../db/schema';
import type {
  ImageDescriptor,
  MediaDescriptor,
  PdfDescriptor,
  RunMediaResolver,
} from './media-descriptors';

/** A 1600×900 PNG descriptor named after the id's last two characters. */
export function descriptor(
  id: string,
  overrides: Partial<Omit<ImageDescriptor, 'id' | 'kind'>> = {},
): ImageDescriptor {
  return {
    kind: 'image',
    id,
    name: `${id.slice(-2)}.png`,
    mediaType: 'image/png',
    width: 1600,
    height: 900,
    modelWidth: 1600,
    modelHeight: 900,
    modelByteSize: 3,
    modelMediaType: 'image/png',
    ...overrides,
  };
}

/** A small 10-page PDF descriptor named after the id's last two characters. */
export function pdfDescriptor(
  id: string,
  overrides: Partial<Pick<PdfDescriptor, 'name' | 'pages' | 'byteSize'>> = {},
): PdfDescriptor {
  return {
    kind: 'pdf',
    id,
    name: `${id.slice(-2)}.pdf`,
    mediaType: 'application/pdf',
    pages: 10,
    byteSize: 3,
    ...overrides,
  };
}

/**
 * The row `loadMediaDescriptors` selects for `d`: an image row without a page
 * count, or a PDF row without dimensions or a model variant.
 */
export function descriptorRow(d: MediaDescriptor) {
  const image = d.kind === 'image' ? d : undefined;
  return {
    id: d.id,
    name: d.name,
    mediaType: d.mediaType,
    width: image?.width ?? null,
    height: image?.height ?? null,
    modelWidth: image?.modelWidth ?? null,
    modelHeight: image?.modelHeight ?? null,
    modelByteSize: image?.modelByteSize ?? null,
    modelMediaType: image?.modelMediaType ?? null,
    pageCount: d.kind === 'pdf' ? d.pages : null,
    byteSize: d.kind === 'pdf' ? d.byteSize : d.modelByteSize,
  };
}

/**
 * A resolver over fixed descriptors whose requested byte loads are recorded in
 * `loads`; an owned id loads one byte (its model variant or PDF original), any
 * other id nothing.
 */
export function fakeResolver(descriptors: ReadonlyArray<MediaDescriptor>) {
  const known = new Map(descriptors.map((entry) => [entry.id, entry]));
  const loads: Array<string> = [];
  const resolver: RunMediaResolver = {
    images: new Map(),
    describe: (ids) =>
      Promise.resolve(
        new Map(
          ids.flatMap((id) => {
            const found = known.get(id);
            return found === undefined ? [] : [[id, found] as const];
          }),
        ),
      ),
    loadModelBytes: (ids) => {
      loads.push(...ids);
      return Promise.resolve(
        new Map(
          ids.flatMap((id) =>
            known.has(id)
              ? [[id, new Uint8Array([id.codePointAt(35) ?? 0])] as const]
              : [],
          ),
        ),
      );
    },
  };
  return { resolver, loads };
}

/** A stored one-page PDF row: no dimensions and no model variant. */
export function storedPdfRow(
  overrides: Partial<MediaObject> = {},
): MediaObject {
  return {
    id: '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e',
    ownerUserId: 'owner',
    name: 'scan.pdf',
    mediaType: 'application/pdf',
    width: null,
    height: null,
    byteSize: 1234,
    modelMediaType: null,
    modelWidth: null,
    modelHeight: null,
    modelByteSize: null,
    pageCount: 1,
    sha256: 'a'.repeat(64),
    createdAt: new Date('2026-10-10T00:00:00.000Z'),
    ...overrides,
  };
}

/** A PNG of random pixels, so no two share a digest by accident. */
export function randomPng(width = 8, height = 8): Promise<Buffer> {
  return sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer();
}
