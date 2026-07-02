/**
 * memories RLS integration test (agent memory tools).
 *
 * The tenant-isolation property under FORCE RLS on a live Postgres: a user's
 * recall/search over memories returns ONLY their own rows, and a write lands
 * only in the writer's scope. Also asserts FORCE is enabled (single-role
 * bypass guard) and the content-length CHECK constraint holds.
 *
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { MemoriesRepository } from './memories-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = any;

async function seedUser(
  sql: SqlClient,
  tenantDb: TenantDbService,
  fact: string,
): Promise<string> {
  const userId = crypto.randomUUID();
  await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'M', ${`m-${userId}@t.com`})`;
  await tenantDb.runAs(userId, (tx) =>
    new MemoriesRepository(tx).create(userId, `remember: ${fact} detail`),
  );
  return userId;
}

describeIfDb('memories RLS isolation', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let a: string;
  let b: string;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 2 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    a = await seedUser(sql, tenantDb, 'alpha');
    b = await seedUser(sql, tenantDb, 'bravo');
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${a}, ${b})`;
      await sql.end();
    }
  });

  it('FORCE ROW LEVEL SECURITY is enabled (single-role bypass guard)', async () => {
    const [row] =
      await sql`SELECT relforcerowsecurity FROM pg_class WHERE relname = 'memories'`;
    expect(row.relforcerowsecurity).toBe(true);
  });

  it('recall finds the searching user’s own memory', async () => {
    const rows = await tenantDb.runAs(a, (tx) =>
      new MemoriesRepository(tx).search('alpha', a, 5),
    );
    expect(rows.length).toBe(1);
  });

  it('NEVER returns another user’s memory, even matching the query', async () => {
    const rows = await tenantDb.runAs(a, (tx) =>
      new MemoriesRepository(tx).search('bravo', a, 5),
    );
    expect(rows).toEqual([]);
  });

  it('countByUser is scoped to the caller', async () => {
    const countA = await tenantDb.runAs(a, (tx) =>
      new MemoriesRepository(tx).countByUser(a),
    );
    expect(countA).toBe(1); // only A's own row, never B's
  });

  it('the content-length CHECK rejects an oversized memory', async () => {
    await expect(
      tenantDb.runAs(a, (tx) =>
        new MemoriesRepository(tx).create(a, 'x'.repeat(2001)),
      ),
    ).rejects.toThrow();
  });
});
