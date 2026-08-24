/**
 * Real-Postgres RLS and create-or-get coverage for Knowledge Spaces.
 *
 * The suite is intentionally skipped without TEST_DATABASE_URL. The
 * integration global setup supplies a non-superuser role that also owns the
 * table, so FORCE RLS is exercised rather than bypassed.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { knowledgeSpaces } from '../db/schema/knowledge-spaces';
import { TenantDbService } from '../db/tenant-db.service';
import { KnowledgeSpaceRepository } from './knowledge-space.repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const d = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

d('Knowledge Space RLS and tenant repository', () => {
  let sql: SqlClient;
  let tenantDb: TenantDbService;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 6 });
    tenantDb = new TenantDbService(drizzle(sql, { schema }));
    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userAId}, 'Knowledge A', ${`knowledge-a-${userAId}@test.com`})`;
    await sql`INSERT INTO users (id, name, email) VALUES (${userBId}, 'Knowledge B', ${`knowledge-b-${userBId}@test.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
      await sql.end();
    }
  });

  it('is ENABLED and FORCED for the table-owning non-bypass role', async () => {
    const [role] = await sql`
      SELECT current_user, rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user`;
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    const [table] = await sql`
      SELECT c.relrowsecurity, c.relforcerowsecurity,
             pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c
      WHERE c.relname = 'knowledge_spaces'`;
    expect(table.relrowsecurity).toBe(true);
    expect(table.relforcerowsecurity).toBe(true);
    expect(table.owner).toBe(role.current_user);
  });

  it('fails closed with no identity and across owners', async () => {
    const created = await tenantDb.runAs(userAId, (tx) =>
      new KnowledgeSpaceRepository(tx).createOrGet(userAId),
    );

    await expect(
      sql.begin(async (tx: SqlClient) => {
        await tx`SELECT set_config('app.current_user_id', '', true)`;
        const rows = await tx`
          SELECT knowledge_space_id
          FROM knowledge_spaces
          WHERE knowledge_space_id = ${created.knowledgeSpaceId}`;
        expect(rows).toHaveLength(0);
      }),
    ).resolves.toBeUndefined();

    await expect(
      tenantDb.runAs(userBId, (tx) =>
        new KnowledgeSpaceRepository(tx).findForOwner(userAId),
      ),
    ).resolves.toBeUndefined();

    const crossOwnerUpdate = await tenantDb.runAs(userBId, (tx) =>
      tx
        .update(knowledgeSpaces)
        .set({ knowledgeSpaceId: crypto.randomUUID() })
        .where(eq(knowledgeSpaces.knowledgeSpaceId, created.knowledgeSpaceId))
        .returning(),
    );
    expect(crossOwnerUpdate).toHaveLength(0);

    const crossOwnerDelete = await tenantDb.runAs(userBId, (tx) =>
      tx
        .delete(knowledgeSpaces)
        .where(eq(knowledgeSpaces.knowledgeSpaceId, created.knowledgeSpaceId))
        .returning(),
    );
    expect(crossOwnerDelete).toHaveLength(0);
    await expect(
      tenantDb.runAs(userAId, (tx) =>
        new KnowledgeSpaceRepository(tx).findForOwner(userAId),
      ),
    ).resolves.toMatchObject({ knowledgeSpaceId: created.knowledgeSpaceId });
  });

  it('concurrent create-or-get calls converge on one globally stable ID', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        tenantDb.runAs(userBId, (tx) =>
          new KnowledgeSpaceRepository(tx).createOrGet(userBId),
        ),
      ),
    );

    expect(new Set(results.map((row) => row.knowledgeSpaceId)).size).toBe(1);
    expect(results.every((row) => row.ownerUserId === userBId)).toBe(true);
    await expect(
      tenantDb.runAs(userBId, (tx) =>
        tx
          .select({ id: knowledgeSpaces.knowledgeSpaceId })
          .from(knowledgeSpaces)
          .where(eq(knowledgeSpaces.ownerUserId, userBId)),
      ),
    ).resolves.toHaveLength(1);
  });

  it('table owner cannot bypass policies by writing without identity', async () => {
    await expect(
      sql.begin(async (tx: SqlClient) => {
        await tx`SELECT set_config('app.current_user_id', '', true)`;
        await tx`
          INSERT INTO knowledge_spaces (knowledge_space_id, owner_user_id)
          VALUES (${crypto.randomUUID()}, ${userAId})`;
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });
});
