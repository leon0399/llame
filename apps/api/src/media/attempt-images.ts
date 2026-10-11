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
 * The memory of one attempt (vision-media R1.4), keyed by tool call id. Every
 * attempt builds its own, empty, with its media resolver, so a retry or a
 * resume, on any worker, shares nothing with the attempt it supersedes, and
 * the memory goes when the attempt ends. Nothing in it is persisted.
 *
 * It holds whatever it is given and counts nothing: the step composer
 * releases every variant the epoch window does not attach, so after each
 * compose it retains only what the window attached.
 */
export type AttemptImageMemory = {
  hold(key: string, image: HeldImage): void;
  get(key: string): HeldImage | undefined;
  /**
   * Drop an entry's model variant bytes for the rest of the attempt, keeping
   * their size: the epoch window refused it on entry, so no later step of the
   * attempt attaches it.
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
  return {
    hold: (key, image) => {
      entries.set(key, image);
    },
    get: (key) => entries.get(key),
    release: (key) => {
      const entry = entries.get(key);
      if (entry?.model === undefined) return;
      const { model, ...kept } = entry;
      entries.set(key, { ...kept, modelByteSize: model.bytes.byteLength });
    },
    forget: (key) => {
      entries.delete(key);
    },
  };
}
