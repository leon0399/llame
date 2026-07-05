/**
 * Compaction read (surfacing) on a live DB (RLS):
 * - the owner reads their chat's LATEST compaction (highest upto_seq);
 * - a cross-tenant read returns undefined (owner-scoped, no leak);
 * - a chat with no compaction returns undefined.
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
import { ChatsRepository, CompactionsRepository } from './chats-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

describeIfDb('compaction surfacing — RLS + latest', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let a: string;
  let b: string;

  const newChat = async (owner: string): Promise<string> => {
    const id = crypto.randomUUID();
    await tenantDb.runAs(owner, (tx) =>
      new ChatsRepository(tx).createIfAbsent({ id, ownerUserId: owner }),
    );
    return id;
  };

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 5 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    a = crypto.randomUUID();
    b = crypto.randomUUID();
    for (const id of [a, b]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'C', ${`c-${id}@t.com`})`;
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${a}, ${b})`;
      await sql.end();
    }
  });

  it('returns the LATEST compaction (highest upto_seq) for the owner', async () => {
    const chat = await newChat(a);
    const first = await tenantDb.runAs(a, (tx) =>
      new CompactionsRepository(tx).create({
        chatId: chat,
        uptoSeq: 10,
        summary: 'summary up to 10',
      }),
    );
    await tenantDb.runAs(a, (tx) =>
      new CompactionsRepository(tx).create({
        chatId: chat,
        uptoSeq: 25,
        parentId: first.id,
        summary: 'summary up to 25',
      }),
    );
    const latest = await tenantDb.runAs(a, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(chat, a),
    );
    expect(latest?.uptoSeq).toBe(25);
    expect(latest?.summary).toBe('summary up to 25');
  });

  it('a cross-tenant read returns undefined (owner-scoped, no leak)', async () => {
    const chat = await newChat(a);
    await tenantDb.runAs(a, (tx) =>
      new CompactionsRepository(tx).create({
        chatId: chat,
        uptoSeq: 5,
        summary: 'private summary',
      }),
    );
    const asB = await tenantDb.runAs(b, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(chat, b),
    );
    expect(asB).toBeUndefined();
  });

  it('a chat with no compaction returns undefined', async () => {
    const chat = await newChat(a);
    const none = await tenantDb.runAs(a, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(chat, a),
    );
    expect(none).toBeUndefined();
  });
});
