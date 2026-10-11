import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { mediaBlobs, mediaObjects } from '../db/schema';
import type { Db, TenantRunner } from '../db/tenant-db.service';
import {
  createAttemptImageMemory,
  type AttemptImageMemory,
  type UnstoredImage,
} from './attempt-images';
import {
  isCanonicalMediaId,
  mediaLocator,
  parseMediaLocator,
} from './media-locator';
import { mediaSourceLabel } from './media-source-label';

/** The formats ingest writes for a model variant (vision-media D2). */
const modelMediaTypeSchema = z.enum(['image/png', 'image/jpeg']);

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
export type MediaDescriptor = {
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
    })
    .from(mediaObjects)
    .where(
      and(
        inArray(mediaObjects.id, wanted),
        eq(mediaObjects.ownerUserId, ownerUserId),
      ),
    );
  // A row whose variant format ingest could not have written resolves as
  // absent, like an unknown id.
  return new Map(
    rows.flatMap((row) => {
      const modelMediaType = modelMediaTypeSchema.safeParse(row.modelMediaType);
      return modelMediaType.success
        ? [[row.id, { ...row, modelMediaType: modelMediaType.data }] as const]
        : [];
    }),
  );
}

/**
 * One Run attempt's view of its owner's media (vision-media D6), passed on
 * `ModelStreamInput.media` and built anew for each attempt, so a retry or a
 * resume shares nothing with the attempt it supersedes. Every read runs in its
 * own short owner-scoped transaction, never one held across a model stream.
 * It also holds the attempt's memory of the unstored images it read (R1.4).
 */
export type RunMediaResolver = {
  /** The attempt's unstored images, keyed by tool call id. */
  readonly images: AttemptImageMemory;
  /** Owned descriptors among `ids`; unknown and foreign ids are absent. */
  describe(
    ids: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, MediaDescriptor>>;
  /**
   * The model variant bytes of the owned ids among `ids`; unknown, foreign,
   * and non-canonical ids are absent.
   */
  loadModelBytes(
    ids: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, Uint8Array>>;
};

/**
 * The resolver for one Run attempt, bound to the Run owner's identity.
 * Descriptors are immutable (media is never updated), so they are cached for
 * the attempt, misses included. Loaded model bytes are cached for the attempt
 * too, since the composer asks for them on every step: each attached blob is
 * read at most once, and the set is bounded by the epoch image window. Only
 * found bytes are cached, so a miss or a failed read is retried next step.
 */
export function createRunMediaResolver(
  tenantDb: TenantRunner,
  ownerUserId: string,
): RunMediaResolver {
  const known = new Map<string, MediaDescriptor | undefined>();
  const bytes = new Map<string, Uint8Array>();
  return {
    images: createAttemptImageMemory(),
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
          loadModelVariants(tx, ownerUserId, missing),
        );
        for (const row of rows) bytes.set(row.id, row.data);
      }
      return pickKnown(bytes, ids);
    },
  };
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

/** The owner's model variant blobs among canonical `ids`, in one statement. */
function loadModelVariants(
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
        eq(mediaBlobs.variant, 'model'),
        eq(mediaObjects.ownerUserId, ownerUserId),
      ),
    );
}

/** The canonical `media://` file parts of `parts`, raw persisted JSON. */
function storedFileRefs(
  parts: ReadonlyArray<unknown>,
): Array<{ id: string; filename: string | undefined }> {
  return parts.flatMap((part) => {
    const parsed = storedFilePartSchema.safeParse(part);
    if (!parsed.success) return [];
    const id = parseMediaLocator(parsed.data.url);
    return id === undefined ? [] : [{ id, filename: parsed.data.filename }];
  });
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
 * title input), in stored order: `[image media://<id> <name>]`, rendered from
 * the part alone. `<name>` is its `filename` through the source-label
 * sanitizer, so a forged part cannot break the line; a part without one
 * renders `[image media://<id>]`.
 */
export function fileImageLines(parts: ReadonlyArray<unknown>): Array<string> {
  return storedFileRefs(parts).map(
    ({ id, filename }) =>
      `[image ${mediaLocator(id)}${filename === undefined ? '' : ` ${mediaSourceLabel(filename)}`}]`,
  );
}

/**
 * What a placeholder names (vision-media D6): `media://<id> <name>` for a
 * stored object, or an unstored image's locator as an exact JSON string
 * literal; and the original's dimensions.
 */
export type ImageSubject = { subject: string; width: number; height: number };

export function storedSubject(d: MediaDescriptor): ImageSubject {
  return {
    subject: `${mediaLocator(d.id)} ${d.name}`,
    width: d.width,
    height: d.height,
  };
}

export function unstoredSubject(image: UnstoredImage): ImageSubject {
  return {
    subject: locatorLiteral(image.locator),
    width: image.width,
    height: image.height,
  };
}

/**
 * A locator as its `JSON.stringify` string literal: one line, never
 * truncated, and `JSON.parse` returns it exactly.
 */
export function locatorLiteral(locator: string): string {
  return JSON.stringify(locator);
}

function describe(s: ImageSubject): string {
  return `image ${s.subject} ${s.width}×${s.height}`;
}

/** A reference the owner's store cannot resolve. */
export function unavailablePlaceholder(id: string): string {
  return `[image ${mediaLocator(id)} unavailable]`;
}

/** A resolvable image sent to a model that does not declare `image` input. */
export function omittedPlaceholder(s: ImageSubject): string {
  return `[${describe(s)}, omitted: this model has no image input]`;
}

/**
 * An unstored image the current attempt's memory holds no entry for, on a
 * model that declares `image` input. It names the image and carries no
 * directive: a compaction request or a step without `read` could not act on
 * one, and the `read` description already tells the model to read an image
 * again to view it in a later turn.
 */
export function notRetainedPlaceholder(s: ImageSubject): string {
  return `[${describe(s)}, not retained]`;
}

/** A resolvable image the epoch image window does not attach. */
export function limitPlaceholder(s: ImageSubject): string {
  return `[${describe(s)}, not attached: this context's image limit is reached]`;
}

/**
 * A tool-result image a vision model would receive, or could re-read, on a
 * Chat Completions wire, which cannot carry tool-result images yet
 * (vision-media D6, interim until `vision-read-completions`).
 */
export function completionsToolImagePlaceholder(s: ImageSubject): string {
  return `[${describe(s)}, omitted: this connection cannot carry tool-result images yet]`;
}
