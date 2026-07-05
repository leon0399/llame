/**
 * updateUserMessageContent (edit & resubmit) on a live DB (RLS) — the mutation's
 * security surface:
 * - the owner overwrites their own USER message's text;
 * - a cross-tenant caller CANNOT (owner-scoped by chat ownership → 0 rows);
 * - it refuses a non-user (assistant) message (role guard).
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
import { ChatsRepository, MessagesRepository } from './chats-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

const textOf = (parts: unknown): string | undefined => {
  const first = Array.isArray(parts)
    ? (parts[0] as { text?: string })
    : undefined;
  return first?.text;
};

describeIfDb('updateUserMessageContent — RLS + role guard', () => {
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
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'E', ${`e-${id}@t.com`})`;
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${a}, ${b})`;
      await sql.end();
    }
  });

  it('the owner overwrites their own user message text', async () => {
    const chat = await newChat(a);
    const msg = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).create({
        chatId: chat,
        role: 'user',
        senderUserId: a,
        parts: [{ type: 'text', text: 'orignial typo' }],
      }),
    );
    const updated = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).updateUserMessageContent(
        msg.id,
        chat,
        'fixed text',
      ),
    );
    expect(updated?.id).toBe(msg.id); // same message, only content changed
    expect(textOf(updated?.parts)).toBe('fixed text');
  });

  it('a cross-tenant caller cannot edit (owner-scoped, 0 rows → undefined)', async () => {
    const chat = await newChat(a);
    const msg = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).create({
        chatId: chat,
        role: 'user',
        senderUserId: a,
        parts: [{ type: 'text', text: 'private' }],
      }),
    );
    const asB = await tenantDb.runAs(b, (tx) =>
      new MessagesRepository(tx).updateUserMessageContent(
        msg.id,
        chat,
        'hacked',
      ),
    );
    // 0 rows updated (RLS blocked the cross-tenant write) → undefined; the row is
    // therefore untouched. A's own read confirms the original text survives.
    expect(asB).toBeUndefined();
    const asA = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).findLastUserMessage(chat, a),
    );
    expect(textOf(asA?.parts)).toBe('private');
  });

  it('refuses a non-user (assistant) message — role guard', async () => {
    const chat = await newChat(a);
    const assistant = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).create({
        chatId: chat,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: 'model reply' }],
      }),
    );
    const result = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).updateUserMessageContent(
        assistant.id,
        chat,
        'tamper',
      ),
    );
    expect(result).toBeUndefined();
  });
});
