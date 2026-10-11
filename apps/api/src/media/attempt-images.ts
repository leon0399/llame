import type { PreparedMedia } from './media-ingest';

/**
 * An unstored image as a request names it (vision-media R1.4): the locator
 * submitted to `read`, and the original's dimensions.
 */
export type UnstoredImage = {
  locator: string;
  width: number;
  height: number;
};

/** A decoded model variant an attempt retains for an unstored image. */
export type RetainedVariant = PreparedMedia['model'];

/**
 * One attempt's entry for an unstored image it read: what its placeholder
 * needs, plus the model variant until the epoch image window refuses it.
 * A released entry keeps the variant's byte size (`modelByteSize`) without
 * its bytes, so the window keeps sizing it as it did when it refused it.
 */
export type HeldImage = UnstoredImage & {
  model?: RetainedVariant;
  modelByteSize?: number;
};

/**
 * Drop the model variant bytes of the attempt's image under `key` for the
 * rest of the attempt, keeping their size: the epoch window refused it on
 * entry, so no later step of the attempt attaches it.
 *
 * An attempt's images (vision-media R1.4) are a `Map` keyed by tool call id.
 * Every attempt builds its own, empty, with its media resolver, so a retry or
 * a resume, on any worker, shares nothing with the attempt it supersedes, and
 * the map goes when the attempt ends. Nothing in it is persisted. The step
 * composer releases every variant the epoch window does not attach, so after
 * each compose the map retains only what the window attached.
 */
export function releaseImage(
  images: Map<string, HeldImage>,
  key: string,
): void {
  const entry = images.get(key);
  if (entry?.model === undefined) return;
  const { model, ...kept } = entry;
  images.set(key, { ...kept, modelByteSize: model.bytes.byteLength });
}
