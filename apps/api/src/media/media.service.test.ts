import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import sharp from 'sharp';

import * as schema from '../db/schema';
import { type MediaObject } from '../db/schema';
import { type TenantRunner } from '../db/tenant-db.service';
import { storedPdfRow } from './media-fixtures';
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
    name: 'shot.png',
    mediaType: 'image/png',
    width: 3,
    height: 2,
    byteSize: 100,
    modelMediaType: 'image/png',
    modelWidth: 3,
    modelHeight: 2,
    modelByteSize: 90,
    pageCount: null,
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
    const row = stored(createHash('sha256').update(input.bytes).digest('hex'));
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
    const existing = stored(
      createHash('sha256').update(input.bytes).digest('hex'),
    );
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

  it('stores a PDF with only its original in the owner transaction', async () => {
    const bytes = await readFile(join(__dirname, 'testing/pdf/one-page.pdf'));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const row = storedPdfRow({ sha256, byteSize: bytes.length });
    const { media, statements, owners } = scriptedTenantDb([
      [objectRow(row)],
      [],
    ]);

    await expect(
      media.ingest(OWNER, { bytes, source: 'scan.pdf' }),
    ).resolves.toEqual({ media: row, created: true });

    expect(owners).toEqual([OWNER]);
    expect(statements).toHaveLength(2);
    expect(statements[0]?.params).toEqual(
      expect.arrayContaining(['application/pdf', 1, sha256, bytes.length]),
    );
    expect(statements[1]).toEqual({
      sql: 'insert into "media_blobs" ("media_id", "variant", "data") values ($1, $2, $3)',
      params: [ID, 'original', bytes],
    });
  });
});

describe('MediaService listOwned', () => {
  const NEWEST = '01927c1e-8f3a-7b2c-9d4e-000000000004';
  const NEWER = '01927c1e-8f3a-7b2c-9d4e-000000000003';
  const MIDDLE = '01927c1e-8f3a-7b2c-9d4e-000000000002';
  const OLDEST = '01927c1e-8f3a-7b2c-9d4e-000000000001';
  const row = (id: string) => objectRow({ ...stored('digest'), id });

  it("reads one row past the page in the owner's scope, newest first", async () => {
    const { media, statements, owners } = scriptedTenantDb([
      [row(NEWEST), row(NEWER), row(MIDDLE), row(OLDEST)],
    ]);

    const page = await media.listOwned(OWNER, { limit: 3 });

    expect(page.items.map(({ id }) => id)).toEqual([NEWEST, NEWER, MIDDLE]);
    // The cursor is the page's LAST id, so the next page starts after it.
    expect(page.nextCursor).toBe(MIDDLE);
    expect(owners).toEqual([OWNER]);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).toMatch(
      /where "media_objects"\."owner_user_id" = \$1 order by "media_objects"\."id" desc limit \$2$/u,
    );
    expect(statements[0]?.params).toEqual([OWNER, 4]);
  });

  it('ends the list when no row lies past the page', async () => {
    const { media } = scriptedTenantDb([[row(MIDDLE), row(OLDEST)]]);

    const page = await media.listOwned(OWNER, { limit: 2 });

    expect(page.items.map(({ id }) => id)).toEqual([MIDDLE, OLDEST]);
    expect(page.nextCursor).toBeNull();
  });

  it('pages from the cursor with an id bound', async () => {
    const { media, statements } = scriptedTenantDb([[row(OLDEST)]]);

    const page = await media.listOwned(OWNER, { before: MIDDLE, limit: 2 });

    expect(page).toEqual({
      items: [expect.objectContaining({ id: OLDEST })],
      nextCursor: null,
    });
    expect(statements[0]?.sql).toMatch(
      /where \("media_objects"\."owner_user_id" = \$1 and "media_objects"\."id" < \$2\)/u,
    );
    expect(statements[0]?.params).toEqual([OWNER, MIDDLE, 3]);
  });
});
