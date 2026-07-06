/**
 * Regenerate's load-bearing repository behavior on a live DB (RLS/FORCE):
 * - `findLastUserMessage` returns the newest user turn (regenerate targets it);
 * - deleting the assistant reply UNBLOCKS a fresh reply for the same user
 *   message (the unique `in_reply_to` + `onConflictDoNothing` means without the
 *   delete the regenerated reply silently would not persist — the crux the
 *   review flagged);
 * - `deleteById` is scoped by chatId (seatbelt) and by tenant (RLS).
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

const completed = { status: 'completed' };

describeIfDb('regenerate repository behavior', () => {
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
    sql = connect(TEST_DB_URL!, { ssl, max: 3 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    a = crypto.randomUUID();
    b = crypto.randomUUID();
    for (const id of [a, b]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'R', ${`r-${id}@t.com`})`;
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${a}, ${b})`;
      await sql.end();
    }
  });

  async function seedTurn(userId: string): Promise<{
    chatId: string;
    userMessageId: string;
    replyId: string;
  }> {
    const chatId = crypto.randomUUID();
    const userMessageId = crypto.randomUUID();
    const replyId = await tenantDb.runAs(userId, async (tx) => {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: userId,
      });
      const messagesRepo = new MessagesRepository(tx);
      await messagesRepo.createUserMessageIfAbsent({
        id: userMessageId,
        chatId,
        senderUserId: userId,
        parts: [{ type: 'text', text: 'q' }],
      });
      const reply = await messagesRepo.createAssistantReplyIfAbsent({
        chatId,
        parts: [{ type: 'text', text: 'first answer' }],
        usage: completed,
        inReplyTo: userMessageId,
      });
      return reply!.id;
    });
    return { chatId, userMessageId, replyId };
  }

  it('findLastUserMessage returns the newest user turn', async () => {
    const chatId = crypto.randomUUID();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    await tenantDb.runAs(a, async (tx) => {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: a,
      });
      const repo = new MessagesRepository(tx);
      await repo.createUserMessageIfAbsent({
        id: first,
        chatId,
        senderUserId: a,
        parts: [{ type: 'text', text: '1' }],
      });
      await repo.createUserMessageIfAbsent({
        id: second,
        chatId,
        senderUserId: a,
        parts: [{ type: 'text', text: '2' }],
      });
    });
    const last = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).findLastUserMessage(chatId, a),
    );
    expect(last?.id).toBe(second);
    await sql`DELETE FROM chats WHERE id = ${chatId}`;
  });

  it('deleting the reply UNBLOCKS a fresh reply for the same user message', async () => {
    const { chatId, userMessageId, replyId } = await seedTurn(a);

    // Without deleting, a second reply for the same user turn is a no-op
    // (unique in_reply_to → onConflictDoNothing).
    const blocked = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).createAssistantReplyIfAbsent({
        chatId,
        parts: [{ type: 'text', text: 'regenerated' }],
        usage: completed,
        inReplyTo: userMessageId,
      }),
    );
    expect(blocked).toBeUndefined();

    // Delete the stale reply, then the fresh reply persists.
    const removed = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).deleteById(replyId, chatId),
    );
    expect(removed).toBe(true);

    const fresh = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).createAssistantReplyIfAbsent({
        chatId,
        parts: [{ type: 'text', text: 'regenerated' }],
        usage: completed,
        inReplyTo: userMessageId,
      }),
    );
    expect(fresh?.id).toBeDefined();
    expect(fresh?.id).not.toBe(replyId);
    await sql`DELETE FROM chats WHERE id = ${chatId}`;
  });

  it('deleteById is scoped by chatId (wrong chat cannot delete)', async () => {
    const { chatId, replyId } = await seedTurn(a);
    const wrong = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).deleteById(replyId, crypto.randomUUID()),
    );
    expect(wrong).toBe(false);
    await sql`DELETE FROM chats WHERE id = ${chatId}`;
  });

  it('cross-tenant deleteById is denied (RLS)', async () => {
    const { chatId, userMessageId, replyId } = await seedTurn(a);
    // B tries to delete A's reply (even with the right chatId) → RLS no row.
    const denied = await tenantDb.runAs(b, (tx) =>
      new MessagesRepository(tx).deleteById(replyId, chatId),
    );
    expect(denied).toBe(false);
    // A's reply is still there (queried by the user turn it replies to).
    const still = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).findTurnState(chatId, a, userMessageId),
    );
    expect(still.assistantMessage?.id).toBe(replyId);
    await sql`DELETE FROM chats WHERE id = ${chatId}`;
  });
});
