import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { mediaBlobs, mediaObjects } from '../db/schema';
import type { MediaObject } from '../db/schema/media';
import type { Db, TenantRunner } from '../db/tenant-db.service';
import {
  retainedEntryBytes,
  type RetainedMedia,
  type UnstoredMedia,
} from './attempt-media';
import {
  isCanonicalMediaId,
  mediaLocator,
  parseMediaLocator,
} from './media-locator';
import { mediaSourceLabel } from './media-source-label';
import { PDF_MEDIA_TYPE } from './pdf-preparation';

/** The formats ingest writes for a model variant (vision-media D2). */
const modelMediaTypeSchema = z.enum(['image/png', 'image/jpeg']);

/** The columns only an image row carries; a PDF row has them null. */
const imageColumnsSchema = z.object({
  width: z.number(),
  height: z.number(),
  modelWidth: z.number(),
  modelHeight: z.number(),
  modelByteSize: z.number(),
  modelMediaType: modelMediaTypeSchema,
});

type ImageColumns = z.infer<typeof imageColumnsSchema>;

/**
 * The image columns of a stored row, or undefined for a PDF row and for a
 * row whose variant format ingest could not have written.
 */
export function imageColumns(
  row: Pick<MediaObject, keyof ImageColumns>,
): ImageColumns | undefined {
  const parsed = imageColumnsSchema.safeParse(row);
  return parsed.success ? parsed.data : undefined;
}

/**
 * A stored owner attachment part (vision-media D5), parsed from the raw
 * persisted JSON; any other keys are ignored.
 */
export const storedFilePartSchema = z.object({
  type: z.literal('file'),
  url: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
});

/**
 * What a request needs to know about one owned image without its bytes: the
 * stored source label, the original's format and dimensions (stored on owner
 * file parts and shown in placeholders), and the model variant's dimensions,
 * size, and format (used to size and attach it). Never carries bytes.
 */
export type ImageDescriptor = {
  kind: 'image';
  id: string;
  name: string;
  mediaType: string;
  width: number;
  height: number;
  modelWidth: number;
  modelHeight: number;
  modelByteSize: number;
  modelMediaType: z.infer<typeof modelMediaTypeSchema>;
};

/**
 * One owned PDF without its bytes (pdf-media D5): the stored source label, its
 * page count (shown in placeholders and charged by the estimate), and the
 * original's byte size (counted by the window; a PDF has no model variant).
 */
export type PdfDescriptor = {
  kind: 'pdf';
  id: string;
  name: string;
  mediaType: typeof PDF_MEDIA_TYPE;
  pages: number;
  byteSize: number;
};

export type MediaDescriptor = ImageDescriptor | PdfDescriptor;

/** The kind of media a reference names, matching the `ModelInput` it needs. */
export type MediaKind = MediaDescriptor['kind'];

/**
 * The descriptors of the given ids that the owner owns, read under the
 * caller's owner-scoped transaction. Unknown ids, another owner's ids, and
 * non-canonical ids are all simply absent from the result.
 */
export async function loadMediaDescriptors(
  tx: Db,
  ownerUserId: string,
  ids: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, MediaDescriptor>> {
  const wanted = [...new Set(ids)].filter(isCanonicalMediaId);
  if (wanted.length === 0) return new Map();
  const rows = await tx
    .select({
      id: mediaObjects.id,
      name: mediaObjects.name,
      mediaType: mediaObjects.mediaType,
      width: mediaObjects.width,
      height: mediaObjects.height,
      modelWidth: mediaObjects.modelWidth,
      modelHeight: mediaObjects.modelHeight,
      modelByteSize: mediaObjects.modelByteSize,
      modelMediaType: mediaObjects.modelMediaType,
      pageCount: mediaObjects.pageCount,
      byteSize: mediaObjects.byteSize,
    })
    .from(mediaObjects)
    .where(
      and(
        inArray(mediaObjects.id, wanted),
        eq(mediaObjects.ownerUserId, ownerUserId),
      ),
    );
  return new Map(
    rows.flatMap((row) => {
      const found = descriptorOf(row);
      return found === undefined ? [] : [[row.id, found] as const];
    }),
  );
}

type DescriptorRow = Pick<
  MediaObject,
  'id' | 'name' | 'mediaType' | 'pageCount' | 'byteSize' | keyof ImageColumns
>;

/**
 * A row's descriptor by its shape (`media_objects_shape`): a PDF has a page
 * count. A row of neither shape that ingest could have written resolves as
 * absent, like an unknown id.
 */
function descriptorOf(row: DescriptorRow): MediaDescriptor | undefined {
  const { id, name, mediaType } = row;
  if (row.pageCount !== null) {
    return mediaType === PDF_MEDIA_TYPE
      ? {
          kind: 'pdf',
          id,
          name,
          mediaType,
          pages: row.pageCount,
          byteSize: row.byteSize,
        }
      : undefined;
  }
  const image = imageColumns(row);
  return image && { kind: 'image', id, name, mediaType, ...image };
}

/**
 * One Run attempt's view of its owner's media (vision-media D6), passed on
 * `ModelStreamInput.media` and built anew for each attempt, so a retry or a
 * resume shares nothing with the attempt it supersedes. Every read runs in its
 * own short owner-scoped transaction, never one held across a model stream.
 * It also holds the attempt's retained media, keyed by marker key.
 */
export type RunMediaResolver = {
  /** The attempt's retained media, keyed by the marker that names it. */
  readonly retainedMedia: Map<string, RetainedMedia>;
  /** Owned descriptors among `ids`; unknown and foreign ids are absent. */
  describe(
    ids: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, MediaDescriptor>>;
  /**
   * The bytes a request attaches for the owned ids among `ids`: an image's
   * model variant, a PDF's original. Unknown, foreign, and non-canonical ids
   * are absent.
   */
  loadModelBytes(
    ids: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, Uint8Array>>;
  /**
   * The decoded bytes of the retained entry `key`, or undefined for a key the
   * attempt holds no bytes for. Decoded once per attempt: the composer asks on
   * every step, and the set is bounded by the epoch image window.
   */
  retainedBytes(key: string): Uint8Array | undefined;
};

/**
 * The resolver for one Run attempt, bound to the Run owner's identity.
 * Descriptors are immutable (media is never updated), so they are cached for
 * the attempt, misses included. Loaded bytes are cached for the attempt too,
 * since the composer asks for them on every step: each attached blob is read
 * at most once, and the set is bounded by the epoch media window. Only found
 * bytes are cached, so a miss or a failed read is retried next step.
 */
export function createRunMediaResolver(
  tenantDb: TenantRunner,
  ownerUserId: string,
): RunMediaResolver {
  const known = new Map<string, MediaDescriptor | undefined>();
  const bytes = new Map<string, Uint8Array>();
  const retained = new Map<string, RetainedMedia>();
  const decoded = new Map<string, Uint8Array>();
  return {
    retainedMedia: retained,
    async describe(ids) {
      const missing = ids.filter((id) => !known.has(id));
      if (missing.length > 0) {
        const loaded = await tenantDb.runAs(ownerUserId, (tx) =>
          loadMediaDescriptors(tx, ownerUserId, missing),
        );
        for (const id of missing) known.set(id, loaded.get(id));
      }
      return pickKnown(known, ids);
    },
    async loadModelBytes(ids) {
      const missing = [...new Set(ids)].filter(
        (id) => isCanonicalMediaId(id) && !bytes.has(id),
      );
      if (missing.length > 0) {
        const rows = await tenantDb.runAs(ownerUserId, (tx) =>
          loadAttachedBlobs(tx, ownerUserId, missing),
        );
        for (const row of rows) bytes.set(row.id, row.data);
      }
      return pickKnown(bytes, ids);
    },
    retainedBytes: (key) => decodeRetained(retained, decoded, key),
  };
}

/**
 * The bytes of the retained entry `key`, decoded once per attempt: the composer
 * asks on every step, and the set is bounded by the epoch image window.
 */
function decodeRetained(
  retained: ReadonlyMap<string, RetainedMedia>,
  decoded: Map<string, Uint8Array>,
  key: string,
): Uint8Array | undefined {
  const cached = decoded.get(key);
  if (cached !== undefined) return cached;
  const entry = retained.get(key);
  const data = entry === undefined ? undefined : retainedEntryBytes(entry);
  if (data !== undefined) decoded.set(key, data);
  return data;
}

/** The entries of `cache` found for `ids`; absent and `undefined` ones skipped. */
function pickKnown<T>(
  cache: ReadonlyMap<string, T | undefined>,
  ids: ReadonlyArray<string>,
): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const id of ids) {
    const found = cache.get(id);
    if (found !== undefined) result.set(id, found);
  }
  return result;
}

/**
 * The owner's attached blobs among canonical `ids`, in one statement: the
 * original of a PDF row (it has no model variant), the model variant of any
 * other row.
 */
function loadAttachedBlobs(
  tx: Db,
  ownerUserId: string,
  ids: ReadonlyArray<string>,
): Promise<ReadonlyArray<{ id: string; data: Uint8Array }>> {
  return tx
    .select({ id: mediaBlobs.mediaId, data: mediaBlobs.data })
    .from(mediaBlobs)
    .innerJoin(mediaObjects, eq(mediaObjects.id, mediaBlobs.mediaId))
    .where(
      and(
        inArray(mediaBlobs.mediaId, ids),
        eq(
          mediaBlobs.variant,
          sql`(case when ${mediaObjects.pageCount} is null then 'model' else 'original' end)::media_variant`,
        ),
        eq(mediaObjects.ownerUserId, ownerUserId),
      ),
    );
}

/** The canonical `media://` file parts of `parts`, raw persisted JSON. */
function storedFileRefs(
  parts: ReadonlyArray<unknown>,
): Array<{ id: string; filename: string | undefined; mediaType: string }> {
  return parts.flatMap((part) => {
    const parsed = storedFilePartSchema.safeParse(part);
    if (!parsed.success) return [];
    const id = parseMediaLocator(parsed.data.url);
    const { filename, mediaType } = parsed.data;
    return id === undefined ? [] : [{ id, filename, mediaType }];
  });
}

/** A media part's kind; an untyped image marker stays an image (pdf-media D4). */
export function fileKind(mediaType: string | undefined): MediaKind {
  return mediaType === PDF_MEDIA_TYPE ? 'pdf' : 'image';
}

/**
 * The media ids of the stored owner `file` parts in `parts`, in stored order,
 * repeats kept. Parts are raw persisted JSON, so each is parsed; a file part
 * whose `url` is not a canonical `media://` reference is skipped.
 */
export function fileMediaIds(parts: ReadonlyArray<unknown>): Array<string> {
  return storedFileRefs(parts).map((ref) => ref.id);
}

/**
 * The cause-free line of each stored owner `file` part (`conversation_read`,
 * title input), in stored order: `[pdf media://<id> <name>]` for a part whose
 * stored `mediaType` is `application/pdf`, `[image media://<id> <name>]` for
 * any other, rendered from the part alone. `<name>` is its `filename` through
 * the source-label sanitizer, so a forged part cannot break the line; a part
 * without one renders `[image media://<id>]` (or `[pdf …]`).
 */
export function fileAttachmentLines(
  parts: ReadonlyArray<unknown>,
): Array<string> {
  return storedFileRefs(parts).map(({ id, filename, mediaType }) => {
    const name = filename === undefined ? '' : ` ${mediaSourceLabel(filename)}`;
    return `[${fileKind(mediaType)} ${mediaLocator(id)}${name}]`;
  });
}

/**
 * What a placeholder names (vision-media D6, pdf-media D4): `media://<id>
 * <name>` for a stored object, or an unstored image's locator as an exact JSON
 * string literal; and the original's dimensions, or a PDF's page count.
 */
export type ImageSubject = {
  kind: 'image';
  subject: string;
  width: number;
  height: number;
};

export type PdfSubject = { kind: 'pdf'; subject: string; pages: number };

export type MediaSubject = ImageSubject | PdfSubject;

export function storedSubject(d: MediaDescriptor): MediaSubject {
  const subject = `${mediaLocator(d.id)} ${d.name}`;
  return d.kind === 'pdf'
    ? { kind: 'pdf', subject, pages: d.pages }
    : { kind: 'image', subject, width: d.width, height: d.height };
}

export function unstoredSubject(media: UnstoredMedia): MediaSubject {
  return 'pages' in media
    ? {
        kind: 'pdf',
        subject: JSON.stringify(media.locator),
        pages: media.pages,
      }
    : {
        kind: 'image',
        subject: JSON.stringify(media.locator),
        width: media.width,
        height: media.height,
      };
}

function describe(s: MediaSubject): string {
  return s.kind === 'pdf'
    ? `pdf ${s.subject} ${s.pages} pages`
    : `image ${s.subject} ${s.width}×${s.height}`;
}

/** How a cause names each kind. */
const KIND_NAME: Record<MediaKind, string> = { image: 'image', pdf: 'PDF' };

/** A reference of `kind` the owner's store cannot resolve. */
export function unavailablePlaceholder(id: string, kind: MediaKind): string {
  return `[${kind} ${mediaLocator(id)} unavailable]`;
}

/** A resolvable reference sent to a model that does not declare its kind. */
export function omittedPlaceholder(s: MediaSubject): string {
  return `[${describe(s)}, omitted: this model has no ${KIND_NAME[s.kind]} input]`;
}

/** A resolvable reference the epoch media window does not attach. */
export function limitPlaceholder(s: MediaSubject): string {
  return `[${describe(s)}, not attached: this context's ${KIND_NAME[s.kind]} limit is reached]`;
}
