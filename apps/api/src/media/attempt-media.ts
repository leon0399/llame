/**
 * One attempt's retained media, keyed by the marker key of each reference
 * (`media-attachments`): the live `read` writes its entry when it decodes, and
 * context assembly writes the entry each stored part, kept part, or import
 * entry records. Nothing is released: the stored part keeps the bytes until
 * compaction absorbs its row, so admission is append-only across attempts.
 */
import type { ModelMediaType } from './media-ingest';
import {
  RETAINED_MESSAGE_BOUND,
  type RetainedMediaJson,
} from './retained-media';

/**
 * An unstored image as a request names it: the locator submitted to `read`, and
 * the original's dimensions.
 */
type UnstoredImage = {
  locator: string;
  width: number;
  height: number;
};

/** An unstored PDF's attribution and page count, without its bytes. */
type UnstoredPdf = {
  locator: string;
  pages: number;
};

export type UnstoredMedia = UnstoredImage | UnstoredPdf;

/** An unstored image's model variant as base64, with its own dimensions. */
type RetainedImage = UnstoredImage & {
  model: {
    mediaType: ModelMediaType;
    width: number;
    height: number;
    data: string;
  };
};

/** An unstored PDF's original as base64. */
type RetainedPdf = UnstoredPdf & { data: string };

/**
 * A read whose bytes would have crossed the message bound of its stored
 * message: the reference keeps its attribution and dimensions or page count, so
 * the window and the placeholder still name it, but it carries no bytes.
 */
type RetainedExceeded = UnstoredMedia & { exceeded: true };

export type RetainedMedia = RetainedImage | RetainedPdf | RetainedExceeded;

/** The persisted record an entry keeps in its part, event, or import entry. */
export function retainedMediaJson(entry: RetainedMedia): RetainedMediaJson {
  if ('exceeded' in entry) return { exceeded: true };
  if ('pages' in entry) {
    return { mediaType: 'application/pdf', data: entry.data };
  }
  const { mediaType, width, height, data } = entry.model;
  return { mediaType, width, height, data };
}

/**
 * The entry a persisted record names, given the reference it belongs to (the
 * record carries the variant's dimensions, not the original's), or undefined
 * when the record and the reference disagree about the kind. Stored jsonb is
 * untrusted, so a mismatch names no bytes.
 */
export function retainedEntry(
  record: RetainedMediaJson,
  subject: UnstoredMedia,
): RetainedMedia | undefined {
  if ('exceeded' in record) return { ...subject, exceeded: true };
  if ('pages' in subject) {
    return record.mediaType === 'application/pdf'
      ? { locator: subject.locator, pages: subject.pages, data: record.data }
      : undefined;
  }
  if (record.mediaType === 'application/pdf') return undefined;
  const { mediaType, width, height, data } = record;
  return { ...subject, model: { mediaType, width, height, data } };
}

/** The entry an entry past its message bound keeps: its attribution, no bytes. */
export function exceededEntry(entry: RetainedMedia): RetainedMedia {
  return 'pages' in entry
    ? { locator: entry.locator, pages: entry.pages, exceeded: true }
    : {
        locator: entry.locator,
        width: entry.width,
        height: entry.height,
        exceeded: true,
      };
}

/** The base64 bytes an entry counts toward a message's retained bound. */
export function retainedEntrySize(entry: RetainedMedia): number {
  if ('exceeded' in entry) return 0;
  return ('pages' in entry ? entry.data : entry.model.data).length;
}

/** One settled entry's record, and the bound's used size after it. */
export type RetainedSettlement = {
  readonly record?: RetainedMediaJson;
  readonly used: number;
};

/**
 * Settle one entry against a message's retained bound (`media-attachments`):
 * while its base64 fits what the message already holds, it keeps its record and
 * the bound grows by its size; past it, it records `{ exceeded: true }`, which
 * the window latches at the limit, and the bound does not move.
 */
export function boundRetained(
  entry: RetainedMedia,
  used: number,
): RetainedSettlement {
  const size = retainedEntrySize(entry);
  return used + size <= RETAINED_MESSAGE_BOUND
    ? { record: retainedMediaJson(entry), used: used + size }
    : { record: { exceeded: true }, used };
}

/**
 * Add `entries` to an attempt's map. A stored part's entry supersedes a live
 * one for the same key: the part is what every later request reads.
 */
export function mergeRetainedMedia(
  target: Map<string, RetainedMedia>,
  entries: ReadonlyMap<string, RetainedMedia>,
): void {
  for (const [key, entry] of entries) target.set(key, entry);
}
