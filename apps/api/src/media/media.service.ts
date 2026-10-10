import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  mediaBlobs,
  mediaObjects,
  type MediaObject,
  type MediaProvenance,
  type MediaVariant,
} from '../db/schema';
import {
  TenantDbService,
  type Db,
  type TenantRunner,
} from '../db/tenant-db.service';
import {
  loadMediaDescriptors,
  type MediaDescriptor,
} from './media-descriptors';
import { prepareMedia, type PreparedMedia } from './media-ingest';
import { isCanonicalMediaId } from './media-locator';
import { mediaSourceLabel } from './media-source-label';

export type MediaIngestInput = {
  bytes: Buffer;
  provenance: MediaProvenance;
  /** Upload filename, or the requesting locator for `read`/`prompt-import`. */
  source: string;
};

export type MediaIngestResult = {
  media: MediaObject;
  /** False when an object with the same owner and digest was reused. */
  created: boolean;
};

type NewMediaObject = typeof mediaObjects.$inferInsert;

/** The metadata row of a freshly prepared ingest, with a new UUIDv7 id. */
function toMediaRow(
  ownerUserId: string,
  input: MediaIngestInput,
  prepared: PreparedMedia,
): NewMediaObject {
  return {
    id: uuidv7(),
    ownerUserId,
    provenance: input.provenance,
    name: mediaSourceLabel(input.source),
    mediaType: prepared.original.mediaType,
    width: prepared.original.width,
    height: prepared.original.height,
    byteSize: prepared.original.bytes.length,
    modelMediaType: prepared.model.mediaType,
    modelWidth: prepared.model.width,
    modelHeight: prepared.model.height,
    modelByteSize: prepared.model.bytes.length,
    sha256: prepared.sha256,
  };
}

/**
 * Insert the object and both variants, or return the owner's existing object
 * with the same digest. Runs inside the caller's owner-scoped transaction.
 */
async function storeOrReuse(
  tx: Db,
  row: NewMediaObject,
  prepared: PreparedMedia,
): Promise<MediaIngestResult> {
  const [inserted] = await tx
    .insert(mediaObjects)
    .values(row)
    // A concurrent identical ingest waits on the unique index, then lands
    // here and reads the committed winner below.
    .onConflictDoNothing({
      target: [mediaObjects.ownerUserId, mediaObjects.sha256],
    })
    .returning();

  if (inserted === undefined) {
    const [existing] = await tx
      .select()
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.ownerUserId, row.ownerUserId),
          eq(mediaObjects.sha256, row.sha256),
        ),
      );
    if (existing === undefined) {
      throw new Error('Media dedup conflict without a visible row');
    }
    return { media: existing, created: false };
  }

  await tx.insert(mediaBlobs).values([
    {
      mediaId: inserted.id,
      variant: 'original',
      data: prepared.original.bytes,
    },
    { mediaId: inserted.id, variant: 'model', data: prepared.model.bytes },
  ]);
  return { media: inserted, created: true };
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
  ) {}

  /**
   * The single ingest path for upload, `read`, and prompt import. Throws
   * `MediaIngestError` (`image_too_large` | `unsupported_media_type`) and then
   * stores nothing. Image work finishes before the transaction opens; the
   * object and both variants commit together.
   */
  async ingest(
    ownerUserId: string,
    input: MediaIngestInput,
  ): Promise<MediaIngestResult> {
    const prepared = await prepareMedia(input.bytes);
    const row = toMediaRow(ownerUserId, input, prepared);
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      storeOrReuse(tx, row, prepared),
    );
  }

  /**
   * The owner's object, or undefined for another owner's id, an unknown id,
   * and a non-canonical id alike.
   */
  async findOwned(
    ownerUserId: string,
    id: string,
  ): Promise<MediaObject | undefined> {
    if (!isCanonicalMediaId(id)) return undefined;
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
      const [row] = await tx
        .select()
        .from(mediaObjects)
        .where(
          and(
            eq(mediaObjects.id, id),
            eq(mediaObjects.ownerUserId, ownerUserId),
          ),
        );
      return row;
    });
  }

  /** One variant's bytes of an owned object, or undefined. */
  async readVariant(
    ownerUserId: string,
    id: string,
    variant: MediaVariant,
  ): Promise<Buffer | undefined> {
    if (!isCanonicalMediaId(id)) return undefined;
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
      const [row] = await tx
        .select({ data: mediaBlobs.data })
        .from(mediaBlobs)
        .innerJoin(mediaObjects, eq(mediaObjects.id, mediaBlobs.mediaId))
        .where(
          and(
            eq(mediaBlobs.mediaId, id),
            eq(mediaBlobs.variant, variant),
            eq(mediaObjects.ownerUserId, ownerUserId),
          ),
        );
      return row?.data;
    });
  }

  /**
   * The descriptors of the given ids that the owner owns, read in the owner's
   * own short transaction. Unknown, foreign, and non-canonical ids are absent;
   * with no canonical id among `ids` no transaction is opened.
   */
  async describeOwned(
    ownerUserId: string,
    ids: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, MediaDescriptor>> {
    if (!ids.some(isCanonicalMediaId)) return new Map();
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      loadMediaDescriptors(tx, ownerUserId, ids),
    );
  }
}

/** The one MediaService capability a send needs: the sender's ownership read. */
export type MediaDescriber = Pick<MediaService, 'describeOwned'>;
