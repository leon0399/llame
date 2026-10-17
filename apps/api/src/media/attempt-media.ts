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

/** An unstored PDF's attribution and page count, without its bytes. */
export type UnstoredPdf = {
  locator: string;
  pages: number;
};

export type UnstoredMedia = UnstoredImage | UnstoredPdf;

/** A decoded model variant an attempt retains for an unstored image. */
export type RetainedVariant = PreparedMedia['model'];

/**
 * One attempt's unstored media entry. Only an input-capable model retains
 * bytes; release preserves their size so epoch admission cannot change.
 */
export type HeldMedia =
  | (UnstoredImage & {
      model?: RetainedVariant;
      modelByteSize?: number;
    })
  | (UnstoredPdf & {
      bytes?: Buffer;
      byteSize?: number;
    });

/**
 * Drop an attempt's media bytes, retaining the size and source metadata.
 * Keys are tool call ids or prompt-import entry keys. A fresh map is created
 * for every attempt; retry, resume and fork never inherit retained bytes.
 * The composer releases every entry the epoch window does not attach.
 */
export function releaseMedia(held: Map<string, HeldMedia>, key: string): void {
  const entry = held.get(key);
  if (entry === undefined) return;
  if ('pages' in entry) {
    if (entry.bytes === undefined) return;
    const { bytes, ...kept } = entry;
    held.set(key, { ...kept, byteSize: bytes.byteLength });
    return;
  }
  if (entry.model === undefined) return;
  const { model, ...kept } = entry;
  held.set(key, { ...kept, modelByteSize: model.bytes.byteLength });
}
