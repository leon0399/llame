/**
 * todos RLS integration test (agent todo tools + the user-facing panel).
 *
 * Tenant isolation under FORCE RLS on a live Postgres: a chat's todos are
 * visible/writable only through the owning user; replace-all preserves order
 * via `position`; FORCE + the content CHECK hold; the agent's replace-all
 * (source='agent') never wipes the user's own todos (source='user').
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

  it('user add appends a source=user todo; toggle + delete work', async () => {
    const c = crypto.randomUUID();
    await tenantDb.runAs(a.userId, (tx) =>
      new ChatsRepository(tx).createIfAbsent({ id: c, ownerUserId: a.userId }),
    );
    const t1 = await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).add(c, 'buy milk'),
    );
    expect(t1.source).toBe('user');
    expect(t1.status).toBe('pending');
    const t2 = await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).add(c, 'call dentist'),
    );
    expect(t2.position).toBeGreaterThan(t1.position);

    const toggled = await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).updateStatus(c, t1.id, 'completed'),
    );
    expect(toggled?.status).toBe('completed');

    expect(
      await tenantDb.runAs(a.userId, (tx) =>
        new TodosRepository(tx).deleteById(c, t2.id),
      ),
    ).toBe(true);
    const rows = await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).list(c),
    );
    expect(rows.map((r) => r.content)).toEqual(['buy milk']);
  });

  it('AGENT replace-all preserves the user’s own todos (the source boundary)', async () => {
    const c = crypto.randomUUID();
    await tenantDb.runAs(a.userId, (tx) =>
      new ChatsRepository(tx).createIfAbsent({ id: c, ownerUserId: a.userId }),
    );
    // User adds their own todo.
    await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).add(c, 'MY user todo'),
    );
    // Agent writes a plan (replace-all) — must NOT wipe the user todo.
    await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).replace(c, [
        { content: 'agent step 1' },
        { content: 'agent step 2' },
      ]),
    );
    const rows = await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).list(c),
    );
    // Agent plan first (its order), then the user's todo — user survives.
    expect(rows.map((r) => `${r.source}:${r.content}`)).toEqual([
      'agent:agent step 1',
      'agent:agent step 2',
      'user:MY user todo',
    ]);
  });

  it('cross-tenant user add / toggle / delete is denied (RLS)', async () => {
    // B cannot add a todo to A's chat.
    await expect(
      tenantDb.runAs(b.userId, (tx) =>
        new TodosRepository(tx).add(a.chatId, 'intruder'),
      ),
    ).rejects.toThrow();
    // A adds one; B can neither toggle nor delete it.
    const c = crypto.randomUUID();
    await tenantDb.runAs(a.userId, (tx) =>
      new ChatsRepository(tx).createIfAbsent({ id: c, ownerUserId: a.userId }),
    );
    const mine = await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).add(c, 'private'),
    );
    expect(
      await tenantDb.runAs(b.userId, (tx) =>
        new TodosRepository(tx).updateStatus(c, mine.id, 'completed'),
      ),
    ).toBeUndefined();
    expect(
      await tenantDb.runAs(b.userId, (tx) =>
        new TodosRepository(tx).deleteById(c, mine.id),
      ),
    ).toBe(false);
  });

  it('updateStatus/deleteById cannot mutate an AGENT todo (source-scoped)', async () => {
    const c = crypto.randomUUID();
    await tenantDb.runAs(a.userId, (tx) =>
      new ChatsRepository(tx).createIfAbsent({ id: c, ownerUserId: a.userId }),
    );
    const [agentTodo] = await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).replace(c, [{ content: 'agent plan item' }]),
    );
    // Same owner, same chat — but the todo is source='agent', so the
    // user-facing surface (updateStatus/deleteById) must not touch it.
    expect(
      await tenantDb.runAs(a.userId, (tx) =>
        new TodosRepository(tx).updateStatus(c, agentTodo.id, 'completed'),
      ),
    ).toBeUndefined();
    expect(
      await tenantDb.runAs(a.userId, (tx) =>
        new TodosRepository(tx).deleteById(c, agentTodo.id),
      ),
    ).toBe(false);
    const rows = await tenantDb.runAs(a.userId, (tx) =>
      new TodosRepository(tx).list(c),
    );
    expect(rows.map((r) => r.content)).toEqual(['agent plan item']);
  });
});
