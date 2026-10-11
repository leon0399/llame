import {
  base64Size,
  EPOCH_MAX_BASE64_BYTES,
  EPOCH_MAX_IMAGES,
} from './epoch-admission';
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
 * needs, plus the model variant while the epoch image window admits it.
 */
export type HeldImage = UnstoredImage & { model?: RetainedVariant };

/**
 * The memory of one attempt (vision-media R1.4), keyed by tool call id. Every
 * attempt builds its own, empty, with its media resolver, so a retry or a
 * resume, on any worker, shares nothing with the attempt it supersedes, and
 * the memory goes when the attempt ends. Nothing in it is persisted.
 *
 * The variants it retains never exceed the epoch window's bounds, 100 images
 * and 24 MiB of base64, even between steps: an entry whose variant would
 * exceed either is held without it, as one the window refused on entry.
 */
export type AttemptImageMemory = {
  hold(key: string, image: HeldImage): void;
  get(key: string): HeldImage | undefined;
  /**
   * Drop an entry's model variant for the rest of the attempt: the epoch
   * window refused it on entry, so no later step of the attempt attaches it.
   */
  release(key: string): void;
  /**
   * Remove an entry, so the image counts as not retained: a wire that never
   * sends tool-result images keeps none of them.
   */
  forget(key: string): void;
};

export function createAttemptImageMemory(): AttemptImageMemory {
  const entries = new Map<string, HeldImage>();
  let retained = 0;
  let retainedBase64 = 0;
  /** `key`'s entry without its variant, uncounted, or undefined. */
  const unretain = (key: string): UnstoredImage | undefined => {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    const { model, ...kept } = entry;
    if (model !== undefined) {
      retained -= 1;
      retainedBase64 -= base64Size(model.bytes.byteLength);
    }
    return kept;
  };
  return {
    hold: (key, { model, ...image }) => {
      unretain(key);
      const size = model && base64Size(model.bytes.byteLength);
      const fits =
        size !== undefined &&
        retained < EPOCH_MAX_IMAGES &&
        retainedBase64 + size <= EPOCH_MAX_BASE64_BYTES;
      entries.set(key, fits ? { ...image, model } : image);
      if (!fits) return;
      retained += 1;
      retainedBase64 += size;
    },
    get: (key) => entries.get(key),
    release: (key) => {
      const kept = unretain(key);
      if (kept !== undefined) entries.set(key, kept);
    },
    forget: (key) => {
      unretain(key);
      entries.delete(key);
    },
  };
}
