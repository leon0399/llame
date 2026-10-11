import type { ModelMediaType } from './media-ingest';

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
export type RetainedVariant = {
  bytes: Uint8Array;
  mediaType: ModelMediaType;
  width: number;
  height: number;
};

/**
 * One attempt's entry for an unstored image it read: what its placeholder
 * needs, plus the model variant while the epoch image window admits it.
 */
export type HeldImage = UnstoredImage & {
  mediaType: string;
  model?: RetainedVariant;
};

/**
 * The memory of one attempt (vision-media R1.4), keyed by tool call id. Every
 * attempt builds its own, empty, with its media resolver, so a retry or a
 * resume, on any worker, shares nothing with the attempt it supersedes, and
 * the memory goes when the attempt ends. Nothing in it is persisted.
 */
export type AttemptImageMemory = {
  hold(key: string, image: HeldImage): void;
  get(key: string): HeldImage | undefined;
  /**
   * Drop an entry's model variant for the rest of the attempt: the epoch
   * window refused it on entry, so no later step of the attempt attaches it.
   */
  release(key: string): void;
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
      const { model: _released, ...kept } = entry;
      entries.set(key, kept);
    },
  };
}
