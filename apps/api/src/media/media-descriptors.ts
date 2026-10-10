import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { mediaBlobs, mediaObjects } from '../db/schema';
import type { Db, TenantRunner } from '../db/tenant-db.service';
import {
  isCanonicalMediaId,
  mediaLocator,
  parseMediaLocator,
} from './media-locator';

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
 * stored source label, the original's dimensions (shown in placeholders), and
 * the model variant's dimensions, size, and format (used to size and attach
 * it). Never carries bytes.
 */
export type MediaDescriptor = {
  id: string;
  name: string;
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
 * One Run's view of its owner's media (vision-media D6), passed on
 * `ModelStreamInput.media`. Every read runs in its own short owner-scoped
 * transaction, never one held across a model stream.
 */
export type RunMediaResolver = {
  /** Owned descriptors among `ids`; unknown and foreign ids are absent. */
  describe(
    ids: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, MediaDescriptor>>;
  /** The model variant's bytes of an owned id, or undefined. */
  loadModelBytes(id: string): Promise<Uint8Array | undefined>;
};

/**
 * The resolver for one Run attempt, bound to the Run owner's identity.
 * Descriptors are immutable (media is never updated), so they are cached for
 * the attempt, misses included; bytes are read per request and never cached.
 */
export function createRunMediaResolver(
  tenantDb: TenantRunner,
  ownerUserId: string,
): RunMediaResolver {
  const known = new Map<string, MediaDescriptor | undefined>();
  return {
    async describe(ids) {
      const missing = ids.filter((id) => !known.has(id));
      if (missing.length > 0) {
        const loaded = await tenantDb.runAs(ownerUserId, (tx) =>
          loadMediaDescriptors(tx, ownerUserId, missing),
        );
        for (const id of missing) known.set(id, loaded.get(id));
      }
      const result = new Map<string, MediaDescriptor>();
      for (const id of ids) {
        const descriptor = known.get(id);
        if (descriptor !== undefined) result.set(id, descriptor);
      }
      return result;
    },
    async loadModelBytes(id) {
      if (!isCanonicalMediaId(id)) return undefined;
      return tenantDb.runAs(ownerUserId, async (tx) => {
        const [row] = await tx
          .select({ data: mediaBlobs.data })
          .from(mediaBlobs)
          .innerJoin(mediaObjects, eq(mediaObjects.id, mediaBlobs.mediaId))
          .where(
            and(
              eq(mediaBlobs.mediaId, id),
              eq(mediaBlobs.variant, 'model'),
              eq(mediaObjects.ownerUserId, ownerUserId),
            ),
          );
        return row?.data;
      });
    },
  };
}

/**
 * The media ids of the stored owner `file` parts in `parts`, in stored order,
 * repeats kept. Parts are raw persisted JSON, so each is parsed; a file part
 * whose `url` is not a canonical `media://` reference is skipped.
 */
export function fileMediaIds(parts: ReadonlyArray<unknown>): Array<string> {
  return parts.flatMap((part) => {
    const parsed = storedFilePartSchema.safeParse(part);
    const id = parsed.success ? parseMediaLocator(parsed.data.url) : undefined;
    return id === undefined ? [] : [id];
  });
}

function describe(d: MediaDescriptor): string {
  return `image ${mediaLocator(d.id)} ${d.name} ${d.width}×${d.height}`;
}

/** The cause-free form used by `conversation_read` and title input. */
export function barePlaceholder(d: MediaDescriptor): string {
  return `[${describe(d)}]`;
}

/** A reference the owner's store cannot resolve. */
export function unavailablePlaceholder(id: string): string {
  return `[image ${mediaLocator(id)} unavailable]`;
}

/**
 * The cause-free line of one stored file part (`conversation_read`, title
 * input): bare when the owner's store resolves `id`, unavailable otherwise.
 */
export function filePlaceholder(
  id: string,
  descriptors: ReadonlyMap<string, MediaDescriptor>,
): string {
  const descriptor = descriptors.get(id);
  return descriptor === undefined
    ? unavailablePlaceholder(id)
    : barePlaceholder(descriptor);
}

/** A resolvable image sent to a model that does not declare `image` input. */
export function omittedPlaceholder(d: MediaDescriptor): string {
  return `[${describe(d)}, omitted: this model has no image input]`;
}

/** A resolvable image the epoch image window does not attach. */
export function limitPlaceholder(d: MediaDescriptor): string {
  return `[${describe(d)}, not attached: this context's image limit is reached]`;
}
