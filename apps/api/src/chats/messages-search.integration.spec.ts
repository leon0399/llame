/**
 * MessagesRepository.search RLS integration test (search_conversations tool).
 *
 * The security property, proven under FORCE RLS on a live Postgres: a search
 * run as user A returns ONLY user A's own messages — never user B's — even
 * though the tool takes no explicit userId in its SQL beyond the runAs scope.
 * Also proves the jsonb-text-VALUE match (not matching JSON structure keys).
 *
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh with the other
 * .integration suites.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = any;

async function seedUser(
  sql: SqlClient,
  tenantDb: TenantDbService,
  keyword: string,
): Promise<{ userId: string; chatId: string }> {
  const userId = crypto.randomUUID();
  const chatId = crypto.randomUUID();
  await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'S', ${`s-${userId}@t.com`})`;
  await tenantDb.runAs(userId, async (tx) => {
    await new ChatsRepository(tx).createIfAbsent({
      id: chatId,
      ownerUserId: userId,
    });
    await new MessagesRepository(tx).create({
      chatId,
      role: 'user',
      senderUserId: userId,
      parts: [{ type: 'text', text: `secret about ${keyword} project` }],
    });
  });
  return { userId, chatId };
}

describeIfDb('MessagesRepository.search (RLS cross-tenant isolation)', () => {
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
    sql = connect(TEST_DB_URL!, { ssl, max: 2 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    a = await seedUser(sql, tenantDb, 'alpha');
    b = await seedUser(sql, tenantDb, 'bravo');
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${a.userId}, ${b.userId})`;
      await sql.end();
    }
  });

  it('finds the searching user’s own matching message', async () => {
    const rows = await tenantDb.runAs(a.userId, (tx) =>
      new MessagesRepository(tx).search('alpha', a.userId, 5),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].chatId).toBe(a.chatId);
  });

  it('NEVER returns another user’s message, even matching the query', async () => {
    // User A searches for B's keyword — B has a message containing "bravo",
    // but RLS + the ownerUserId scope must exclude it entirely.
    const rows = await tenantDb.runAs(a.userId, (tx) =>
      new MessagesRepository(tx).search('bravo', a.userId, 5),
    );
    expect(rows).toEqual([]);
  });

  it('matches text VALUES, not the jsonb structure keys', async () => {
    // Every message's parts jsonb contains the keys "type" and "text"; a naive
    // parts::text search would match them. The value-scoped query must NOT.
    const rows = await tenantDb.runAs(a.userId, (tx) =>
      new MessagesRepository(tx).search('type', a.userId, 5),
    );
    expect(rows).toEqual([]);
  });

  it('escapes ILIKE wildcards so a query with % matches literally', async () => {
    const rows = await tenantDb.runAs(a.userId, (tx) =>
      new MessagesRepository(tx).search('%', a.userId, 5),
    );
    // No message literally contains "%", so this must not wildcard-match all.
    expect(rows).toEqual([]);
  });
});
