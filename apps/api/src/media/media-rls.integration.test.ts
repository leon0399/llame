/**
 * RLS integration tests — media store tenancy (vision-media D1). Requires a
 * real PostgreSQL connection whose role is NOT a superuser, NOT BYPASSRLS,
 * and owns the tables, so only FORCE ROW LEVEL SECURITY constrains it. The
 * test:integration globalSetup provisions exactly that.
 *
 * Acceptance criteria (media-store spec):
 * - RLS ENABLED *and* FORCED on media_objects and media_blobs
 * - another owner's metadata and bytes are invisible without any owner
 *   predicate; identity-absent scopes see and change nothing
 * - the datastore rejects metadata or bytes written for another owner, and
 *   no tenant scope can update or delete media
 * - ingest dedups per owner only, also under concurrency, and commits the
 *   object with both variants atomically
 * - `media://` resolution returns only the caller's objects
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import sharp from 'sharp';
import { z } from 'zod';

import * as schema from '../db/schema';
import {
  type Db,
  TenantDbService,
  type TenantRunner,
} from '../db/tenant-db.service';
import { parseMediaLocator } from './media-locator';
import { MediaService } from './media.service';

const roleRow = z.tuple([
  z.object({ rolsuper: z.boolean(), rolbypassrls: z.boolean() }),
]);
const rlsRows = z.array(
  z.object({
    relname: z.string(),
    relrowsecurity: z.boolean(),
    relforcerowsecurity: z.boolean(),
  }),
);
const countRow = z.tuple([z.object({ n: z.number() })]);
const variantRows = z.array(z.object({ variant: z.string() }));

vi.setConfig({ testTimeout: 30_000 });

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

/** A unique small PNG, so no two tests share a digest by accident. */
function uniquePng(): Promise<Buffer> {
  return sharp(randomBytes(8 * 8 * 3), {
    raw: { width: 8, height: 8, channels: 3 },
  })
    .png()
    .toBuffer();
}

describeIfDb('RLS integration — media store tenancy', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  let media: MediaService;
  let userAId: string;
  let userBId: string;
  let objectAId: string;

  const asUser = <T>(userId: string, fn: (tx: Sql) => Promise<T>) =>
    sql.begin(async (tx: Sql) => {
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });

  const ingestAs = async (userId: string, bytes: Buffer) =>
    media.ingest(userId, { bytes, provenance: 'read', source: 'kb://a.png' });

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = postgres(TEST_DB_URL!, { ssl, max: 4 });
    const db: Db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    media = new MediaService(tenantDb);

    userAId = randomUUID();
    userBId = randomUUID();
    // users has no RLS — seed directly.
    await sql`INSERT INTO users (id, name, email) VALUES (${userAId}, 'Media A', ${`media-a-${userAId}@test.com`})`;
    await sql`INSERT INTO users (id, name, email) VALUES (${userBId}, 'Media B', ${`media-b-${userBId}@test.com`})`;

    objectAId = (await ingestAs(userAId, await uniquePng())).media.id;
  });

  afterAll(async () => {
    if (sql) {
      // media_objects cascades from users, media_blobs from media_objects.
      await sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
      await sql.end();
    }
  });

  it('the harness is meaningful: non-superuser role, RLS ENABLED + FORCED on both tables', async () => {
    const [role] = roleRow.parse(
      await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    const rows = rlsRows.parse(
      await sql`
        SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname IN ('media_blobs', 'media_objects')
        ORDER BY relname`,
    );
    expect(rows).toEqual([
      {
        relname: 'media_blobs',
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
      {
        relname: 'media_objects',
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
    ]);
  });

  it('the owner sees the object and both variants', async () => {
    const counts = await asUser(userAId, async (tx) => {
      const [objects] = countRow.parse(
        await tx`SELECT count(*)::int AS n FROM media_objects WHERE id = ${objectAId}`,
      );
      // Ordered by the text value, so 'model' sorts before 'original'.
      const blobs = variantRows.parse(
        await tx`SELECT variant::text AS variant FROM media_blobs WHERE media_id = ${objectAId} ORDER BY variant::text`,
      );
      return { objects: objects.n, variants: blobs.map((b) => b.variant) };
    });
    expect(counts).toEqual({ objects: 1, variants: ['model', 'original'] });
  });

  it("blocks a cross-owner read of A's metadata and bytes without any owner predicate", async () => {
    const seen = await asUser(userBId, async (tx) => ({
      objects: await tx`SELECT id FROM media_objects WHERE id = ${objectAId}`,
      blobs:
        await tx`SELECT media_id FROM media_blobs WHERE media_id = ${objectAId}`,
    }));
    expect(seen.objects).toHaveLength(0);
    expect(seen.blobs).toHaveLength(0);
  });

  it('shows and changes nothing without a current owner identity', async () => {
    const emptyIdentity = await sql.begin(async (tx: Sql) => {
      await tx`SELECT set_config('app.current_user_id', '', true)`;
      return {
        objects: await tx`SELECT id FROM media_objects WHERE id = ${objectAId}`,
        blobs:
          await tx`SELECT media_id FROM media_blobs WHERE media_id = ${objectAId}`,
      };
    });
    expect(emptyIdentity.objects).toHaveLength(0);
    expect(emptyIdentity.blobs).toHaveLength(0);

    // No set_config in this transaction: current_setting(..., true) is NULL,
    // or '' on a pooled connection that set it in an earlier transaction.
    const unset = await sql.begin(async (tx: Sql) => ({
      objects: await tx`SELECT id FROM media_objects WHERE id = ${objectAId}`,
      blobs:
        await tx`SELECT media_id FROM media_blobs WHERE media_id = ${objectAId}`,
      updated:
        await tx`UPDATE media_objects SET name = 'x' WHERE id = ${objectAId} RETURNING id`,
    }));
    expect(unset.objects).toHaveLength(0);
    expect(unset.blobs).toHaveLength(0);
    expect(unset.updated).toHaveLength(0);
  });

  it('rejects metadata written by B as owned by A', async () => {
    await expect(
      asUser(
        userBId,
        (tx) => tx`
          INSERT INTO media_objects (
            id, owner_user_id, provenance, name, media_type, width, height,
            byte_size, model_media_type, model_width, model_height,
            model_byte_size, sha256
          ) VALUES (
            ${randomUUID()}, ${userAId}, 'upload', 'forged.png', 'image/png',
            1, 1, 1, 'image/png', 1, 1, 1, ${'f'.repeat(64)}
          )`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it("rejects bytes written by B against A's object", async () => {
    await expect(
      asUser(
        userBId,
        (tx) =>
          tx`INSERT INTO media_blobs (media_id, variant, data) VALUES (${objectAId}, 'model', ${Buffer.from('evil')})`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it("cannot update or delete A's media from B's scope, nor from A's own", async () => {
    for (const userId of [userBId, userAId]) {
      const changed = await asUser(userId, async (tx) => ({
        renamed:
          await tx`UPDATE media_objects SET name = 'renamed' WHERE id = ${objectAId} RETURNING id`,
        rewritten:
          await tx`UPDATE media_blobs SET data = ${Buffer.from('x')} WHERE media_id = ${objectAId} RETURNING media_id`,
        deletedBlobs:
          await tx`DELETE FROM media_blobs WHERE media_id = ${objectAId} RETURNING media_id`,
        deletedObjects:
          await tx`DELETE FROM media_objects WHERE id = ${objectAId} RETURNING id`,
      }));
      expect(changed.renamed).toHaveLength(0);
      expect(changed.rewritten).toHaveLength(0);
      expect(changed.deletedBlobs).toHaveLength(0);
      expect(changed.deletedObjects).toHaveLength(0);
    }
    expect(await media.findOwned(userAId, objectAId)).toMatchObject({
      id: objectAId,
      name: 'kb://a.png',
    });
  });

  it("resolves A's object for A only, and B's lookup matches an unknown id", async () => {
    const id = parseMediaLocator(`media://${objectAId}`);
    if (id === undefined) throw new Error('Expected a canonical locator');

    expect(await media.findOwned(userAId, id)).toMatchObject({ id });
    expect(
      (await media.readVariant(userAId, id, 'original'))?.length,
    ).toBeGreaterThan(0);

    const unknownId = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';
    expect(await media.findOwned(userBId, id)).toBeUndefined();
    expect(await media.findOwned(userBId, unknownId)).toBeUndefined();
    expect(await media.readVariant(userBId, id, 'original')).toBeUndefined();
    expect(await media.readVariant(userBId, id, 'model')).toBeUndefined();
  });

  it('yields one object for concurrent identical ingests', async () => {
    const bytes = await uniquePng();
    const results = await Promise.all([
      ingestAs(userAId, bytes),
      ingestAs(userAId, bytes),
    ]);

    expect(results[0].media.id).toBe(results[1].media.id);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const [count] = countRow.parse(
      await asUser(
        userAId,
        (tx) =>
          tx`SELECT count(*)::int AS n FROM media_objects WHERE sha256 = ${results[0].media.sha256}`,
      ),
    );
    expect(count.n).toBe(1);
  });

  it('leaves no partial object when a variant write fails', async () => {
    // The first insert of the transaction (the object row) runs for real;
    // every later insert (the blob variants) throws.
    const failingBlobWrites: TenantRunner = {
      runAs: <T>(userId: string, fn: (tx: Db) => Promise<T>) =>
        tenantDb.runAs(userId, (tx) => {
          const objectInsert = vi
            .spyOn(tx, 'insert')
            .mockImplementationOnce((table) => {
              expect(table).toBe(schema.mediaObjects);
              objectInsert.mockRestore();
              const builder = tx.insert(table);
              vi.spyOn(tx, 'insert').mockImplementation(() => {
                throw new Error('blob write failed');
              });
              return builder;
            });
          return fn(tx);
        }),
    };
    const bytes = await uniquePng();

    await expect(
      new MediaService(failingBlobWrites).ingest(userAId, {
        bytes,
        provenance: 'upload',
        source: 'atomic.png',
      }),
    ).rejects.toThrow('blob write failed');

    const [count] = countRow.parse(
      await asUser(
        userAId,
        (tx) =>
          tx`SELECT count(*)::int AS n FROM media_objects WHERE name = 'atomic.png' AND owner_user_id = ${userAId}`,
      ),
    );
    expect(count.n).toBe(0);
  });
});
