/**
 * forkChat on a live DB (RLS) — the copy's correctness + tenancy:
 * - copies the seq-prefix into a NEW owned chat, order preserved, `in_reply_to`
 *   REMAPPED to the copied user turn (not the original id), usage NOT carried;
 * - a cross-tenant fork throws + creates nothing (owner-scoped).
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
import { ChatsService } from './chats.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

const textOf = (parts: unknown): string | undefined =>
  Array.isArray(parts) ? (parts[0] as { text?: string })?.text : undefined;

describeIfDb('forkChat — copy correctness + RLS', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let service: ChatsService;
  let a: string;
  let b: string;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 5 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    service = new ChatsService(tenantDb, new RunAbortRegistry());
    a = crypto.randomUUID();
    b = crypto.randomUUID();
    for (const id of [a, b]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'F', ${`f-${id}@t.com`})`;
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${a}, ${b})`;
      await sql.end();
    }
  });

  // Seed [user1, asst1→user1, user2, asst2→user2]; return the chat + ids.
  const seedChat = async (owner: string) => {
    return tenantDb.runAs(owner, async (tx) => {
      const chats = new ChatsRepository(tx);
      const messages = new MessagesRepository(tx);
      const chat = await chats.create({
        ownerUserId: owner,
        title: 'Original',
      });
      const user1 = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: owner,
        parts: [{ type: 'text', text: 'q1' }],
      });
      const asst1 = await messages.create({
        chatId: chat.id,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: 'a1' }],
        usage: { costUsd: 0.5, model: 'gpt-x' },
        inReplyTo: user1.id,
      });
      const user2 = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: owner,
        parts: [{ type: 'text', text: 'q2' }],
      });
      await messages.create({
        chatId: chat.id,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: 'a2' }],
        inReplyTo: user2.id,
      });
      return { chatId: chat.id, user1Id: user1.id, asst1Id: asst1.id };
    });
  };

  it('copies the seq-prefix into a new owned chat, remaps in_reply_to, drops usage', async () => {
    const { chatId, asst1Id } = await seedChat(a);

    const forked = await service.forkChat(chatId, a, asst1Id);

    expect(forked.ownerUserId).toBe(a);
    expect(forked.title).toBe('Original (fork)');
    expect(forked.id).not.toBe(chatId);

    const copied = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).findByChatId(forked.id, a),
    );
    // Only up to + including asst1 (2 of the 4 source messages), in order.
    expect(copied.map((m) => textOf(m.parts))).toEqual(['q1', 'a1']);
    // in_reply_to REMAPPED to the copied user turn, not the original id.
    const [copiedUser, copiedAsst] = copied;
    expect(copiedAsst.inReplyTo).toBe(copiedUser.id);
    expect(copiedAsst.inReplyTo).not.toBe(asst1Id);
    // usage is NOT carried (a fork made no API calls → no cost double-count).
    expect(copiedAsst.usage).toBeNull();
  });

  it('a cross-tenant fork throws and creates nothing', async () => {
    const { chatId, asst1Id } = await seedChat(a);

    await expect(service.forkChat(chatId, b, asst1Id)).rejects.toThrow();

    const bChats = await service.listChatsWithLastMessage(b);
    expect(bChats).toEqual([]);
  });
});
