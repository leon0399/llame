/**
 * memories RLS integration test (agent memory tools + user-managed memories).
 *
 * The tenant-isolation property under FORCE RLS on a live Postgres: a user's
 * recall/search/list over memories returns ONLY their own rows, and a write
 * lands only in the writer's scope. Also asserts FORCE is enabled (single-role
 * bypass guard), the content-length CHECK constraint holds, and the
 * `listForInjection` trust boundary (source='user' only) is enforced.
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

  it('list returns only the caller’s own memories, newest first', async () => {
    const listA = await tenantDb.runAs(a, (tx) =>
      new MemoriesRepository(tx).list(a, 100),
    );
    expect(listA.every((m) => m.userId === a)).toBe(true);
    expect(listA.length).toBeGreaterThanOrEqual(1);
  });

  it('source persists; the user-facing create sets source=user', async () => {
    const mem = await tenantDb.runAs(a, (tx) =>
      new MemoriesRepository(tx).create(a, 'A user-typed memory', 'user'),
    );
    expect(mem.source).toBe('user');
    // The seeded remember-tool memory defaulted to 'agent'.
    const list = await tenantDb.runAs(a, (tx) =>
      new MemoriesRepository(tx).list(a, 100),
    );
    expect(list.some((m) => m.source === 'agent')).toBe(true);
  });

  it('listForInjection EXCLUDES source=agent memories (laundering boundary)', async () => {
    const c = await seedUser(sql, tenantDb, 'charlie'); // seeds one AGENT memory
    await tenantDb.runAs(c, (tx) =>
      new MemoriesRepository(tx).create(c, 'user fact for charlie', 'user'),
    );
    const inject = await tenantDb.runAs(c, (tx) =>
      new MemoriesRepository(tx).listForInjection(c, 2000),
    );
    expect(inject.length).toBe(1);
    expect(inject[0]?.source).toBe('user');
    expect(inject.every((m) => m.source === 'user')).toBe(true);
    await sql`DELETE FROM users WHERE id = ${c}`;
  });

  it('listForInjection truncates to the char budget', async () => {
    const d = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${d}, 'D', ${`d-${d}@t.com`})`;
    for (let i = 0; i < 5; i++) {
      await tenantDb.runAs(d, (tx) =>
        new MemoriesRepository(tx).create(d, 'y'.repeat(300), 'user'),
      );
    }
    const inject = await tenantDb.runAs(d, (tx) =>
      new MemoriesRepository(tx).listForInjection(d, 700),
    );
    // 300+1 per item → only 2 fit under 700.
    expect(inject.length).toBe(2);
    await sql`DELETE FROM users WHERE id = ${d}`;
  });

  it('existsByContent is scoped to the caller (dedupe check)', async () => {
    await tenantDb.runAs(a, (tx) =>
      new MemoriesRepository(tx).create(a, 'unique-dedupe-probe', 'user'),
    );
    expect(
      await tenantDb.runAs(a, (tx) =>
        new MemoriesRepository(tx).existsByContent(a, 'unique-dedupe-probe'),
      ),
    ).toBe(true);
    // B has no such content, and can't see A's.
    expect(
      await tenantDb.runAs(b, (tx) =>
        new MemoriesRepository(tx).existsByContent(b, 'unique-dedupe-probe'),
      ),
    ).toBe(false);
  });

  it('delete removes the caller’s own memory but not another tenant’s', async () => {
    const mem = await tenantDb.runAs(a, (tx) =>
      new MemoriesRepository(tx).create(a, 'to-be-deleted', 'user'),
    );
    // B cannot delete A's memory (RLS → no row).
    expect(
      await tenantDb.runAs(b, (tx) =>
        new MemoriesRepository(tx).delete(mem.id, b),
      ),
    ).toBe(false);
    // A can.
    expect(
      await tenantDb.runAs(a, (tx) =>
        new MemoriesRepository(tx).delete(mem.id, a),
      ),
    ).toBe(true);
  });
});
