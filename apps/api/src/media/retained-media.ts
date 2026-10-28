/**
 * Retained read media (`media-attachments`): the base64 bytes an unstored
 * `read` image or PDF keeps beside its result until compaction absorbs the row.
 *
 * The bytes never travel inside the result: a stored `tool-read` part carries
 * them in a top-level `retainedMedia` field, and so does a model-origin
 * `tool.completed` payload and each unstored prompt-import entry. A request
 * names the bytes by a byte-free marker and loads them from this map, so no
 * estimator, replay budget, or provider adapter ever sees them.
 */
import { isRecord } from '@workspace/runtime-safety';
import { z } from 'zod';

import { PDF_MEDIA_TYPE } from './pdf-preparation';

/** The field a retained record takes on a stored part, event, or entry. */
export const RETAINED_MEDIA_KEY = 'retainedMedia';

/**
 * The most retained base64 one stored message keeps: the epoch image window's
 * own byte bound. A reply of ten 20 MiB PDF reads would otherwise exceed the
 * 255 MiB one `jsonb` value allows and fail to persist.
 */
export const RETAINED_MESSAGE_BOUND = 29_360_128;

/** Non-empty base64 with only its own final padding. */
const base64DataSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/u);

const retainedImageSchema = z.strictObject({
  mediaType: z.enum(['image/png', 'image/jpeg']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  data: base64DataSchema,
});

const retainedPdfSchema = z.strictObject({
  mediaType: z.literal(PDF_MEDIA_TYPE),
  data: base64DataSchema,
});

const retainedExceededSchema = z.strictObject({ exceeded: z.literal(true) });

/**
 * The image form holds the model variant — the bytes a request attaches — with
 * its format and dimensions; the PDF form holds the original.
 */
const retainedMediaSchema = z.union([
  retainedImageSchema,
  retainedPdfSchema,
  retainedExceededSchema,
]);

/** The records an image keeps: its variant, or a read past its bound. */
export const retainedImageRecordSchema = z.union([
  retainedImageSchema,
  retainedExceededSchema,
]);

/** The records a PDF keeps: its original, or a read past its bound. */
export const retainedPdfRecordSchema = z.union([
  retainedPdfSchema,
  retainedExceededSchema,
]);

export type RetainedMediaJson = z.infer<typeof retainedMediaSchema>;

/**
 * A stored retained record, or undefined for an absent or malformed one. Stored
 * jsonb is untrusted: a record that does not match the closed shape names no
 * bytes, so its part replays as text like a result stored before retention.
 */
export function parseRetainedMedia(
  value: unknown,
): RetainedMediaJson | undefined {
  const parsed = retainedMediaSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The retained base64 that `parts` of one stored message already hold: each
 * part's own record and each prompt-import entry's. The per-message bound
 * counts them before a new read or import may keep bytes.
 */
export function retainedPartsBase64(parts: ReadonlyArray<unknown>): number {
  const records = parts.flatMap((part) => {
    if (!isRecord(part)) return [];
    const data = part['data'];
    const imports =
      isRecord(data) && isRecord(data['payload'])
        ? data['payload']['imports']
        : undefined;
    const entries = Array.isArray(imports) ? imports.filter(isRecord) : [];
    return [part, ...entries].map((holder) =>
      parseRetainedMedia(holder[RETAINED_MEDIA_KEY]),
    );
  });
  return records.reduce(
    (total, record) =>
      record !== undefined && 'data' in record
        ? total + record.data.length
        : total,
    0,
  );
}

/** The marker key of a stored `tool-read` part: its row identity and index. */
export function storedToolPartMediaKey(
  messageId: string,
  partIndex: number,
): string {
  return `${messageId}:${partIndex}`;
}

/** The marker key of a Continue Run's kept part, its index in the kept parts. */
export function continuedMediaKey(partIndex: number): string {
  return `continued:${partIndex}`;
}
