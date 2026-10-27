/**
 * A revised reply leaves the evidence (turn-actions D7, conversation-reads,
 * search-projection): after a Regenerate replaced a `completed` reply, the
 * lexical rebuild drops its text, `conversation_read` cannot address it, and
 * timeline discovery no longer counts it. The owner scope of every read still
 * decides what the caller may see.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { findConversationMessage } from './conversation-message-lookup';
import { timelineByOwner } from './chats-timeline-repository';
import { SearchIndexService } from '../search/search-index.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

const OLD_ANSWER = 'obsolete answer marker';
const NEW_ANSWER = 'replacement answer marker';

describeIfDb('a revised reply', () => {
  let sql: Sql;
  let db: Db;
  let tenantDb: TenantDbService;
  let owner: string;
  let otherOwner: string;

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL!, {
      max: 4,
      ssl: /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false,
    });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    owner = crypto.randomUUID();
    otherOwner = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${owner}, 'Revised owner', ${`revised-${owner}@test.com`})`;
    await sql`INSERT INTO users (id, name, email) VALUES (${otherOwner}, 'Other owner', ${`other-${otherOwner}@test.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${owner}, ${otherOwner})`;
      await sql.end();
    }
  });

  /** One Chat whose turn answered with `OLD_ANSWER`, indexed and searchable. */
  async function seedAnsweredChat(): Promise<{
    chatId: string;
    userSeq: number;
    replySeq: number;
    replyId: string;
  }> {
    const seeded = await tenantDb.runAs(owner, async (tx) => {
      const chat = await new ChatsRepository(tx).create({
        ownerUserId: owner,
        title: 'Revised reply',
      });
      const messages = new MessagesRepository(tx);
      const user = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: owner,
        parts: [{ type: 'text', text: 'ask the question' }],
      });
      const reply = await messages.create({
        chatId: chat.id,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: OLD_ANSWER }],
        usage: {
          status: 'completed',
          complete: true,
          runId: crypto.randomUUID(),
          modelId: 'model-a',
        },
        inReplyTo: user.id,
      });
      return {
        chatId: chat.id,
        userSeq: user.seq,
        replySeq: reply.seq,
        replyId: reply.id,
      };
    });
    await new SearchIndexService(tenantDb).reindexChat(seeded.chatId, owner);
    return seeded;
  }

  const projectionText = (chatId: string) =>
    tenantDb.runAs(owner, async (tx) => {
      const rows = await tx
        .select({ content: schema.searchChatDocuments.content })
        .from(schema.searchChatDocuments)
        .where(eq(schema.searchChatDocuments.chatId, chatId));
      return rows.map(({ content }) => content).join('\n');
    });

  const readOf = (chatId: string, seq: number, userId = owner) =>
    tenantDb.runAs(userId, (tx) =>
      findConversationMessage(tx, chatId, userId, seq),
    );

  const timelineOf = (userId: string) =>
    tenantDb.runAs(userId, (tx) => timelineByOwner(tx, userId, { limit: 10 }));

  /** Mark the reply revised, as a Regenerate dispatch does. */
  const markRevised = (replyId: string) =>
    tenantDb.runAs(owner, (tx) =>
      tx
        .update(schema.messages)
        .set({ revisedAt: new Date() })
        .where(eq(schema.messages.id, replyId)),
    );

  it('leaves the projection when the Regenerate finalizes and reindex runs', async () => {
    const seeded = await seedAnsweredChat();

    // The dispatch of a Regenerate Run resets the reply and marks it revised.
    await tenantDb.runAs(owner, (tx) =>
      tx
        .update(schema.messages)
        .set({
          parts: [{ type: 'text', text: NEW_ANSWER }],
          revisedAt: new Date(),
          usage: {
            status: 'completed',
            complete: false,
            runId: crypto.randomUUID(),
            modelId: 'model-b',
          },
        })
        .where(eq(schema.messages.id, seeded.replyId)),
    );
    // The finalization path rebuilds the lexical projection synchronously.
    await new SearchIndexService(tenantDb).reindexChat(seeded.chatId, owner);

    const text = await projectionText(seeded.chatId);
    expect(text).not.toContain(OLD_ANSWER);
    // The revised row is excluded entirely, the new answer with it: the mark
    // stays on the row the new answer is stored in.
    expect(text).not.toContain(NEW_ANSWER);
    // The user message of the turn stays canonical.
    expect(text).toContain('ask the question');
  });

  it('cannot be addressed by conversation_read, and skips it as a neighbour', async () => {
    const seeded = await seedAnsweredChat();
    await markRevised(seeded.replyId);

    await expect(
      readOf(seeded.chatId, seeded.replySeq),
    ).resolves.toBeUndefined();
    // The user message resolves, and its next eligible sequence skips the
    // revised row rather than naming it.
    const userRead = await readOf(seeded.chatId, seeded.userSeq);
    expect(userRead).toMatchObject({ role: 'user' });
    expect(userRead?.nextMessageSeq).toBeUndefined();
  });

  it('is not counted by timeline discovery', async () => {
    const seeded = await seedAnsweredChat();
    const before = (await timelineOf(owner)).find(
      ({ chatId }) => chatId === seeded.chatId,
    );
    expect(before?.messageCount).toBe(2);

    await markRevised(seeded.replyId);

    const after = (await timelineOf(owner)).find(
      ({ chatId }) => chatId === seeded.chatId,
    );
    expect(after?.messageCount).toBe(1);
  });

  it('reveals nothing to another owner, revised or not', async () => {
    const seeded = await seedAnsweredChat();
    await markRevised(seeded.replyId);

    await expect(
      readOf(seeded.chatId, seeded.replySeq, otherOwner),
    ).resolves.toBeUndefined();
    await expect(
      readOf(seeded.chatId, seeded.userSeq, otherOwner),
    ).resolves.toBeUndefined();
    expect(await timelineOf(otherOwner)).toEqual([]);
  });
});
