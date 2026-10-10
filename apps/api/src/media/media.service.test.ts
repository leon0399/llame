import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import sharp from 'sharp';

import * as schema from '../db/schema';
import { type MediaObject } from '../db/schema';
import { type TenantRunner } from '../db/tenant-db.service';
import { MediaIngestError, prepareMedia } from './media-ingest';
import { MediaService } from './media.service';

const ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';
const OWNER = 'owner';

function service() {
  const runAs = vi.fn();
  runAs.mockRejectedValue(new Error('unexpected database access'));
  return { media: new MediaService({ runAs }), runAs };
}

type Statement = { sql: string; params: ReadonlyArray<unknown> };

/**
 * A real drizzle database over a scripted postgres.js client: the service's
 * query builders run unchanged, and each statement answers the next scripted
 * row set (rows as positional values, the shape postgres.js `values()` gives).
 */
function scriptedTenantDb(answers: Array<Array<ReadonlyArray<unknown>>>) {
  const db = drizzle.mock({ schema });
  const statements: Array<Statement> = [];
  Object.assign(db.$client, {
    unsafe(sql: string, params: ReadonlyArray<unknown>) {
      statements.push({ sql, params });
      const rows = Promise.resolve(answers.shift() ?? []);
      return Object.assign(rows, { values: () => rows });
    },
  });
  const owners: Array<string> = [];
  const tenantDb: TenantRunner = {
    runAs: (ownerUserId, work) => {
      owners.push(ownerUserId);
      return work(db);
    },
  };
  return { media: new MediaService(tenantDb), statements, owners };
}

function objectRow(media: MediaObject): ReadonlyArray<unknown> {
  const values = new Map<string, unknown>(Object.entries(media));
  return Object.keys(getTableColumns(schema.mediaObjects)).map((key) =>
    values.get(key),
  );
}

function stored(sha256: string): MediaObject {
  return {
    id: ID,
    ownerUserId: OWNER,
    provenance: 'upload',
    name: 'shot.png',
    mediaType: 'image/png',
    width: 3,
    height: 2,
    byteSize: 100,
    modelMediaType: 'image/png',
    modelWidth: 3,
    modelHeight: 2,
    modelByteSize: 90,
    sha256,
    createdAt: new Date('2026-10-10T00:00:00.000Z'),
  };
}

const upload = async () => ({
  bytes: await sharp({
    create: { width: 3, height: 2, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer(),
  provenance: 'upload' as const,
  source: 'shot.png',
});

describe('MediaService authorization', () => {
  it.each([
    ['upper-case', ID.toUpperCase()],
    ['braced', `{${ID}}`],
    ['empty', ''],
    ['not a uuid', 'abc'],
  ])(
    'treats a %s id as not found without touching the database',
    async (_label, id) => {
      const { media, runAs } = service();
      await expect(media.findOwned('owner', id)).resolves.toBeUndefined();
      await expect(
        media.readVariant('owner', id, 'model'),
      ).resolves.toBeUndefined();
      await expect(media.describeOwned('owner', [id])).resolves.toEqual(
        new Map(),
      );
      expect(runAs).not.toHaveBeenCalled();
    },
  );

  it('describes no ids without opening a transaction', async () => {
    const { media, runAs } = service();

    await expect(media.describeOwned('owner', [])).resolves.toEqual(new Map());
    expect(runAs).not.toHaveBeenCalled();
  });

  it('refuses an unsupported input before opening a transaction', async () => {
    const { media, runAs } = service();

    await expect(
      media.ingest('owner', {
        bytes: Buffer.from('<svg/>'),
        provenance: 'upload',
        source: 'x.svg',
      }),
    ).rejects.toBeInstanceOf(MediaIngestError);
    expect(runAs).not.toHaveBeenCalled();
  });

  it('reads a canonical id as the owner', async () => {
    const row = stored('a'.repeat(64));
    const bytes = Buffer.from('model-bytes');
    const { media, owners } = scriptedTenantDb([
      [objectRow(row)],
      [[bytes]],
      [],
    ]);

    await expect(media.findOwned(OWNER, ID)).resolves.toEqual(row);
    await expect(media.readVariant(OWNER, ID, 'model')).resolves.toBe(bytes);
    await expect(
      media.readVariant(OWNER, ID, 'original'),
    ).resolves.toBeUndefined();
    expect(owners).toEqual([OWNER, OWNER, OWNER]);
  });
});

describe('MediaService ingest', () => {
  it('stores a new object with both variants in the owner transaction', async () => {
    const input = await upload();
    const prepared = await prepareMedia(input.bytes);
    const row = stored(prepared.sha256);
    const { media, statements, owners } = scriptedTenantDb([
      [objectRow(row)],
      [],
    ]);

    await expect(media.ingest(OWNER, input)).resolves.toEqual({
      media: row,
      created: true,
    });

    expect(owners).toEqual([OWNER]);
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toMatch(
      /^insert into "media_objects" .* on conflict \("owner_user_id","sha256"\) do nothing returning /u,
    );
    expect(statements[1]).toEqual({
      sql: 'insert into "media_blobs" ("media_id", "variant", "data") values ($1, $2, $3), ($4, $5, $6)',
      params: [ID, 'original', input.bytes, ID, 'model', prepared.model.bytes],
    });
  });

  it("reuses the owner's object with the same digest and stores no blob", async () => {
    const input = await upload();
    const existing = stored((await prepareMedia(input.bytes)).sha256);
    const { media, statements } = scriptedTenantDb([[], [objectRow(existing)]]);

    await expect(media.ingest(OWNER, input)).resolves.toEqual({
      media: existing,
      created: false,
    });

    expect(statements).toHaveLength(2);
    expect(statements[1]?.sql).toMatch(
      /^select .* from "media_objects" where/u,
    );
    expect(statements[1]?.params).toEqual([OWNER, existing.sha256]);
  });

  it('fails when a digest conflict leaves no visible row', async () => {
    const { media, statements } = scriptedTenantDb([[], []]);

    await expect(media.ingest(OWNER, await upload())).rejects.toThrow(
      'Media dedup conflict without a visible row',
    );
    expect(statements).toHaveLength(2);
  });
});
