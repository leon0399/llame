/** Cross-version writer proof against an isolated post-uniqueness schema. */

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../db/schema';
import { knowledgeSpaces } from '../db/schema/knowledge-spaces';
import { TenantDbService } from '../db/tenant-db.service';
import { KnowledgeSpaceRepository } from './knowledge-space.repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
if (!TEST_DB_URL) {
  throw new Error(
    'TEST_DATABASE_URL is required for Knowledge Space compatibility tests',
  );
}
type SqlClient = ReturnType<typeof postgres>;

describe('Knowledge Space legacy-writer compatibility', () => {
  let adminSql: SqlClient;
  let compatSql: SqlClient;
  let tenantDb: TenantDbService;
  const schemaName = `knowledge_compat_${crypto.randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL) ? 'require' : false;
    adminSql = postgres(TEST_DB_URL, { ssl, max: 1 });
    await adminSql`CREATE SCHEMA ${adminSql(schemaName)}`;

    compatSql = postgres(TEST_DB_URL, {
      ssl,
      max: 6,
      connection: { search_path: schemaName },
    });
    await compatSql`
      CREATE TABLE users (
        id text PRIMARY KEY
      )`;
    await compatSql`
      CREATE TABLE knowledge_spaces (
        knowledge_space_id uuid PRIMARY KEY,
        owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name text NOT NULL DEFAULT 'Personal',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
    tenantDb = new TenantDbService(drizzle(compatSql, { schema }));
  });

  afterAll(async () => {
    await compatSql?.end();
    if (adminSql) {
      await adminSql`DROP SCHEMA IF EXISTS ${adminSql(schemaName)} CASCADE`;
      await adminSql.end();
    }
  });

  async function addOwner(ownerUserId: string): Promise<void> {
    await compatSql`INSERT INTO users (id) VALUES (${ownerUserId})`;
  }

  it('converges on one row after owner uniqueness has been removed', async () => {
    const ownerUserId = crypto.randomUUID();
    await addOwner(ownerUserId);

    const rows = await Promise.all(
      Array.from({ length: 12 }, () =>
        tenantDb.runAs(ownerUserId, (tx) =>
          new KnowledgeSpaceRepository(tx).createOrGet(ownerUserId),
        ),
      ),
    );

    expect(new Set(rows.map((row) => row.knowledgeSpaceId)).size).toBe(1);
    await expect(
      compatSql`
        SELECT knowledge_space_id
        FROM knowledge_spaces
        WHERE owner_user_id = ${ownerUserId}`,
    ).resolves.toHaveLength(1);
  });

  it('selects one deterministic existing row and never creates a third', async () => {
    const ownerUserId = crypto.randomUUID();
    const firstId = '10000000-0000-4000-8000-000000000000';
    const secondId = '20000000-0000-4000-8000-000000000000';
    await addOwner(ownerUserId);
    await compatSql`
      INSERT INTO knowledge_spaces (knowledge_space_id, owner_user_id)
      VALUES (${secondId}, ${ownerUserId}), (${firstId}, ${ownerUserId})`;

    const rows = await Promise.all(
      Array.from({ length: 4 }, () =>
        tenantDb.runAs(ownerUserId, (tx) =>
          new KnowledgeSpaceRepository(tx).createOrGet(ownerUserId),
        ),
      ),
    );

    expect(rows.map((row) => row.knowledgeSpaceId)).toEqual(
      Array.from({ length: 4 }, () => firstId),
    );
    await expect(
      compatSql`
        SELECT knowledge_space_id
        FROM knowledge_spaces
        WHERE owner_user_id = ${ownerUserId}`,
    ).resolves.toHaveLength(2);
  });

  it('proves the pre-compatibility conflict target fails after cutover', async () => {
    const ownerUserId = crypto.randomUUID();
    await addOwner(ownerUserId);

    await expect(
      tenantDb.runAs(ownerUserId, (tx) =>
        tx
          .insert(knowledgeSpaces)
          .values({
            knowledgeSpaceId: crypto.randomUUID(),
            ownerUserId,
          })
          .onConflictDoNothing({ target: knowledgeSpaces.ownerUserId })
          .returning(),
      ),
    ).rejects.toMatchObject({ cause: { code: '42P10' } });

    await expect(
      tenantDb.runAs(ownerUserId, (tx) =>
        tx
          .select({ id: knowledgeSpaces.knowledgeSpaceId })
          .from(knowledgeSpaces)
          .where(eq(knowledgeSpaces.ownerUserId, ownerUserId)),
      ),
    ).resolves.toHaveLength(0);
  });
});
