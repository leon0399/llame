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

  it('forking an untitled chat keeps the fork untitled (nullable title, #78)', async () => {
    const chat = await tenantDb.runAs(a, (tx) =>
      new ChatsRepository(tx).create({ ownerUserId: a }),
    );
    const message = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).create({
        chatId: chat.id,
        role: 'user',
        senderUserId: a,
        parts: [{ type: 'text', text: 'q' }],
      }),
    );

    const forked = await service.forkChat(chat.id, a, message.id);

    expect(forked.title).toBeNull();
  });

  it('forks a conversation of 1200 messages faithfully — no cap, no truncation, order + in_reply_to preserved', async () => {
    // 1200 > the old MAX_FORK_MESSAGES (1000) and > MessagesRepository's
    // 500-row bulk-insert chunk size, so this exercises both removals in one
    // go: no length rejection, and correct ordering/remapping across chunks.
    const MESSAGE_COUNT = 1200;
    const { chatId, lastId } = await tenantDb.runAs(a, async (tx) => {
      const chats = new ChatsRepository(tx);
      const messages = new MessagesRepository(tx);
      const chat = await chats.create({ ownerUserId: a, title: 'Big chat' });

      // Bulk-seed via the same chunked path forkChat uses, for speed — this
      // test is about fork correctness at scale, not seeding performance.
      // Explicit element type (not `as`): contextually types `role` as the
      // literal union directly, instead of widening to `string`.
      const rows: {
        id: string;
        chatId: string;
        role: 'user' | 'assistant';
        senderUserId: string | null;
        parts: { type: string; text: string }[];
        attachments: unknown[];
        inReplyTo: string | null;
      }[] = Array.from({ length: MESSAGE_COUNT }, (_, i) => ({
        id: crypto.randomUUID(),
        chatId: chat.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        senderUserId: i % 2 === 0 ? a : null,
        parts: [{ type: 'text', text: `m${i}` }],
        attachments: [],
        inReplyTo: null,
      }));
      // Link each assistant reply to the user turn immediately before it.
      for (let i = 1; i < rows.length; i += 2) {
        rows[i].inReplyTo = rows[i - 1].id;
      }
      await messages.createMany(rows);

      return { chatId: chat.id, lastId: rows[rows.length - 1].id };
    });

    const forked = await service.forkChat(chatId, a, lastId);

    const copied = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).findByChatId(forked.id, a),
    );

    expect(copied).toHaveLength(MESSAGE_COUNT);
    // Order preserved across chunk boundaries (seq identity assignment
    // follows insertion order within and across the 500-row chunks).
    expect(copied.map((m) => textOf(m.parts))).toEqual(
      Array.from({ length: MESSAGE_COUNT }, (_, i) => `m${i}`),
    );
    // in_reply_to remapped to the COPIED predecessor's new id at every link,
    // never the source chat's original id.
    for (let i = 1; i < copied.length; i += 2) {
      expect(copied[i].inReplyTo).toBe(copied[i - 1].id);
    }
  });
});
