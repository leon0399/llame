/**
 * todos RLS integration test (agent todo tools).
 *
 * Tenant isolation under FORCE RLS on a live Postgres: a chat's todos are
 * visible/writable only through the owning user; replace-all preserves order
 * via `position`; FORCE + the content CHECK hold.
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
import { ChatsRepository } from './chats-repository';
import { TodosRepository } from './todos-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

async function seedUserWithChat(
  sql: SqlClient,
  tenantDb: TenantDbService,
): Promise<{ userId: string; chatId: string }> {
  const userId = crypto.randomUUID();
  const chatId = crypto.randomUUID();
  await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'T', ${`t-${userId}@t.com`})`;
  await tenantDb.runAs(userId, (tx) =>
    new ChatsRepository(tx).createIfAbsent({ id: chatId, ownerUserId: userId }),
  );
  return { userId, chatId };
}

describeIfDb('todos RLS isolation', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let a: { userId: string; chatId: string };
  let b: { userId: string; chatId: string };

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 5 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    a = await seedUserWithChat(sql, tenantDb);
    b = await seedUserWithChat(sql, tenantDb);
    await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).replace(a.chatId, [
        { content: 'first', status: 'pending' },
        { content: 'second', status: 'in_progress' },
      ]),
    );
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${a.userId}, ${b.userId})`;
      await sql.end();
    }
  });

  it('FORCE ROW LEVEL SECURITY is enabled', async () => {
    const [row] =
      await sql`SELECT relforcerowsecurity FROM pg_class WHERE relname = 'todos'`;
    expect(row.relforcerowsecurity).toBe(true);
  });

  it('replace-all persists the list in position order', async () => {
    const rows = await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).list(a.chatId),
    );
    expect(rows.map((r) => r.content)).toEqual(['first', 'second']);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
  });

  it("user B cannot see or write user A's chat todos (cross-tenant)", async () => {
    // B lists A's chat → RLS returns nothing.
    const seen = await tenantDb.runAs(b.userId, (tx) =>
      new TodosRepository(tx).list(a.chatId),
    );
    expect(seen).toEqual([]);
    // B tries to replace A's chat todos → RLS blocks the insert (WITH CHECK).
    await expect(
      tenantDb.runAs(b.userId, (tx) =>
        new TodosRepository(tx).replace(a.chatId, [{ content: 'evil' }]),
      ),
    ).rejects.toThrow();
    // A's list is intact.
    const still = await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).list(a.chatId),
    );
    expect(still.map((r) => r.content)).toEqual(['first', 'second']);
  });

  it('replace-all is atomic — a later replace fully swaps the list', async () => {
    await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).replace(a.chatId, [
        { content: 'only one now', status: 'completed' },
      ]),
    );
    const rows = await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).list(a.chatId),
    );
    expect(rows.map((r) => r.content)).toEqual(['only one now']);
  });

  it('the content-length CHECK rejects an oversized todo', async () => {
    await expect(
      tenantDb.runAs(a.userId, (tx) =>
        new TodosRepository(tx).replace(a.chatId, [
          { content: 'x'.repeat(501) },
        ]),
      ),
    ).rejects.toThrow();
  });
});
