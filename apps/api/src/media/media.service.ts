import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  mediaBlobs,
  mediaObjects,
  type MediaObject,
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
import { isPdfSignature, PDF_MEDIA_TYPE, preparePdf } from './pdf-preparation';

export type MediaIngestInput = {
  bytes: Buffer;
  /** Upload filename. */
  source: string;
};

export type MediaIngestResult = {
  media: MediaObject;
  /** False when an object with the same owner and digest was reused. */
  created: boolean;
};

type NewMediaObject = typeof mediaObjects.$inferInsert;

/** A prepared ingest: its metadata row, with a new UUIDv7 id, and its blobs. */
type PreparedObject = {
  row: NewMediaObject;
  blobs: Array<{ variant: MediaVariant; data: Buffer }>;
};

type PreparedKind = Pick<PreparedObject, 'blobs'> & {
  columns: Omit<
    NewMediaObject,
    'id' | 'ownerUserId' | 'name' | 'byteSize' | 'sha256'
  >;
};

/** An image keeps both variants and their dimensions. */
function imageObject({ original, model }: PreparedMedia): PreparedKind {
  return {
    columns: {
      mediaType: original.mediaType,
      width: original.width,
      height: original.height,
      modelMediaType: model.mediaType,
      modelWidth: model.width,
      modelHeight: model.height,
      modelByteSize: model.bytes.length,
    },
    blobs: [
      { variant: 'original', data: original.bytes },
      { variant: 'model', data: model.bytes },
    ],
  };
}

/**
 * Every check and every decode or parse of an ingest, before any transaction.
 * A PDF keeps only its original (pdf-media D2). The digest is taken only after
 * preparation accepts the bytes.
 */
async function prepareObject(
  ownerUserId: string,
  input: MediaIngestInput,
): Promise<PreparedObject> {
  const { bytes } = input;
  const { columns, blobs } = isPdfSignature(bytes)
    ? {
        columns: {
          mediaType: PDF_MEDIA_TYPE,
          pageCount: await preparePdf(bytes),
        },
        blobs: [{ variant: 'original' as const, data: bytes }],
      }
    : imageObject(await prepareMedia(bytes));
  const row = {
    ...columns,
    id: uuidv7(),
    ownerUserId,
    name: mediaSourceLabel(input.source),
    byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  return { row, blobs };
}

/**
 * Insert the object and its blobs, or return the owner's existing object with
 * the same digest. Runs inside the caller's owner-scoped transaction.
 */
async function storeOrReuse(
  tx: Db,
  { row, blobs }: PreparedObject,
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

  await tx
    .insert(mediaBlobs)
    .values(blobs.map((blob) => ({ mediaId: inserted.id, ...blob })));
  return { media: inserted, created: true };
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
  ) {}

  /**
   * The ingest path of `POST /api/v1/media`. Throws
   * `MediaIngestError` (`media_too_large` | `unsupported_media_type`) and then
   * stores nothing. Image and PDF work finishes before the transaction opens;
   * the object and its blobs commit together.
   */
  async ingest(
    ownerUserId: string,
    input: MediaIngestInput,
  ): Promise<MediaIngestResult> {
    const prepared = await prepareObject(ownerUserId, input);
    return this.tenantDb.runAs(ownerUserId, (tx) => storeOrReuse(tx, prepared));
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

  /**
   * One newest-first page of the owner's media. Ids are UUIDv7, so id order
   * is creation order and the last id of a page is the cursor of the next;
   * `nextCursor` is null when nothing older remains.
   */
  async listOwned(
    ownerUserId: string,
    { before, limit }: { before?: string; limit: number },
  ): Promise<{ items: Array<MediaObject>; nextCursor: string | null }> {
    const rows = await this.tenantDb.runAs(ownerUserId, (tx) =>
      tx
        .select()
        .from(mediaObjects)
        .where(
          and(
            eq(mediaObjects.ownerUserId, ownerUserId),
            before === undefined ? undefined : lt(mediaObjects.id, before),
          ),
        )
        .orderBy(desc(mediaObjects.id))
        // One extra row says whether another page exists.
        .limit(limit + 1),
    );
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > limit && last ? last.id : null,
    };
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

/** The MediaService capability a send needs: the sender's ownership read. */
export type MediaDescriber = Pick<MediaService, 'describeOwned'>;
