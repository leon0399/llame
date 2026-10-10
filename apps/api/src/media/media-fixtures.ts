/**
 * Test fixtures for owner media (vision-media): descriptors, a resolver over
 * fixed descriptors, and unique PNG bytes for ingest.
 */
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

import type { MediaDescriptor, RunMediaResolver } from './media-descriptors';

/** A 1600×900 PNG descriptor named after the id's last two characters. */
export function descriptor(
  id: string,
  overrides: Partial<Omit<MediaDescriptor, 'id'>> = {},
): MediaDescriptor {
  return {
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

/**
 * A resolver over fixed descriptors whose requested byte loads are recorded in
 * `loads`; an owned id loads one byte, any other id nothing.
 */
export function fakeResolver(descriptors: ReadonlyArray<MediaDescriptor>) {
  const known = new Map(descriptors.map((entry) => [entry.id, entry]));
  const loads: Array<string> = [];
  const resolver: RunMediaResolver = {
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

/** A PNG of random pixels, so no two share a digest by accident. */
export function randomPng(width = 8, height = 8): Promise<Buffer> {
  return sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer();
}
