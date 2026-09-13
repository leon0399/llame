/**
 * Continuation-state boundary fixtures (#154): verify retained digest and
 * compaction states survive later source updates and select the expected
 * order by contextRevision, not timestamps.
 *
 * Exercises the full lifecycle: Monday baseline → told-set append →
 * subsequent re-bake → transition checkpoint. Assertions target state
 * observable through the message_turn_contexts and compactions tables.
 *
 * Requires TEST_DATABASE_URL (self-provisioned by the integration project).
 */

import type { Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, desc, eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import {
  chats,
  compactions,
  messageTurnContexts,
  messages,
} from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

describeIfDb('continuation-state boundary fixtures', () => {
  let sql: Sql;
  let db: Db;
  let tenantDb: TenantDbService;
  let owner: string;

  beforeAll(async () => {
    // Dynamic import: avoid connecting when TEST_DATABASE_URL is absent.
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    const sslOpt = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl: sslOpt, max: 3 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    owner = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES
      (${owner}, 'Fixture Owner', ${`fixture-${owner}@test.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${owner}`;
      await sql.end();
    }
  });

  it('Monday baseline, told-set append, re-bake, and transition checkpoint retain ordered state', async () => {
    // === Monday: first accepted turn with initial digest baseline ===
    const chatId = await tenantDb.runAs(owner, async (tx) => {
      const [chat] = await tx
        .insert(chats)
        .values({
          ownerUserId: owner,
          contextRevision: 0,
          recencyDigestBaseline: {
            pinned: [],
            recent: [
              { title: 'Monday chat', date: '2026-09-08', messageCount: 3 },
            ],
            pinnedShown: 0,
            pinnedTotal: 0,
            recentShown: 1,
            recentTotal: 1,
            compiledOn: '2026-09-08',
          },
          recencyDigestTold: [
            { chatId: 'other-chat-1', pinned: false, title: 'Monday chat' },
          ],
        })
        .returning();
      return chat.id;
    });

    // Insert messages: U1 A1
    await tenantDb.runAs(owner, async (tx) => {
      await tx.insert(messages).values([
        {
          chatId,
          seq: 1,
          role: 'user',
          senderUserId: owner,
          parts: [{ type: 'text', text: 'Monday question' }],
        },
        {
          chatId,
          seq: 2,
          role: 'assistant',
          parts: [{ type: 'text', text: 'Monday answer' }],
          usage: { status: 'completed', totalTokens: 100 },
          inReplyTo: undefined,
        },
      ]);

      // Record Monday's acceptance evidence at revision 1
      const runId1 = crypto.randomUUID();
      const [userMsg1] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.chatId, chatId), eq(messages.seq, 1)));
      await tx.insert(messageTurnContexts).values({
        chatId,
        originRunId: runId1,
        messageId: userMsg1.id,
        ownerUserId: owner,
        modelId: 'model-monday',
        acceptedAt: new Date('2026-09-08T10:00:00Z'),
        contextRevision: 1,
        sourceMaxSeq: 1,
        digestBaseline: {
          pinned: [],
          recent: [
            { title: 'Monday chat', date: '2026-09-08', messageCount: 3 },
          ],
          pinnedShown: 0,
          pinnedTotal: 0,
          recentShown: 1,
          recentTotal: 1,
          compiledOn: '2026-09-08',
        },
        digestTold: [
          { chatId: 'other-chat-1', pinned: false, title: 'Monday chat' },
        ],
      });

      await tx
        .update(chats)
        .set({ contextRevision: 1 })
        .where(eq(chats.id, chatId));
    });

    // === Tuesday: told-set append (new chat announced) + second turn ===
    await tenantDb.runAs(owner, async (tx) => {
      await tx.insert(messages).values([
        {
          chatId,
          seq: 3,
          role: 'user',
          senderUserId: owner,
          parts: [{ type: 'text', text: 'Tuesday question' }],
        },
        {
          chatId,
          seq: 4,
          role: 'assistant',
          parts: [{ type: 'text', text: 'Tuesday answer' }],
          usage: { status: 'completed', totalTokens: 200 },
        },
      ]);

      // Update told-set on chat (simulating digest delta)
      await tx
        .update(chats)
        .set({
          recencyDigestTold: [
            { chatId: 'other-chat-1', pinned: false, title: 'Monday chat' },
            { chatId: 'other-chat-2', pinned: false, title: 'Tuesday new' },
          ],
        })
        .where(eq(chats.id, chatId));

      // Record Tuesday's acceptance evidence at revision 2
      const runId2 = crypto.randomUUID();
      const [userMsg3Row] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.chatId, chatId), eq(messages.seq, 3)));
      const userMsg3 = userMsg3Row.id;

      await tx.insert(messageTurnContexts).values({
        chatId,
        originRunId: runId2,
        messageId: userMsg3,
        ownerUserId: owner,
        modelId: 'model-tuesday',
        acceptedAt: new Date('2026-09-09T10:00:00Z'),
        contextRevision: 2,
        sourceMaxSeq: 3,
        digestBaseline: {
          pinned: [],
          recent: [
            { title: 'Monday chat', date: '2026-09-08', messageCount: 3 },
          ],
          pinnedShown: 0,
          pinnedTotal: 0,
          recentShown: 1,
          recentTotal: 1,
          compiledOn: '2026-09-08',
        },
        digestTold: [
          { chatId: 'other-chat-1', pinned: false, title: 'Monday chat' },
          { chatId: 'other-chat-2', pinned: false, title: 'Tuesday new' },
        ],
      });

      await tx
        .update(chats)
        .set({ contextRevision: 2 })
        .where(eq(chats.id, chatId));
    });

    // === Wednesday: compaction + re-bake ===
    const compactionId = await tenantDb.runAs(owner, async (tx) => {
      const [comp] = await tx
        .insert(compactions)
        .values({
          chatId,
          uptoSeq: 2,
          summary: 'Monday discussion summary',
          replacementHistory: [
            {
              role: 'user',
              parts: [{ type: 'text', text: 'Monday question' }],
            },
          ],
          contextRevision: 3,
          sourceMaxSeq: 4,
          companionState: {
            contextRevision: 3,
            sourceMaxSeq: 4,
            digestBaseline: {
              pinned: [],
              recent: [
                { title: 'Monday chat', date: '2026-09-08', messageCount: 3 },
                {
                  title: 'Wednesday refresh',
                  date: '2026-09-10',
                  messageCount: 1,
                },
              ],
              pinnedShown: 0,
              pinnedTotal: 0,
              recentShown: 2,
              recentTotal: 2,
              compiledOn: '2026-09-10',
            },
            digestTold: [
              { chatId: 'other-chat-1', pinned: false, title: 'Monday chat' },
              { chatId: 'other-chat-2', pinned: false, title: 'Tuesday new' },
            ],
          },
        })
        .returning();
      const cId = comp.id;

      // Self-reference: this compaction is the active checkpoint
      await tx
        .update(compactions)
        .set({
          companionActiveCompactionId: cId,
          companionDigestRebakedFrom: cId,
        })
        .where(eq(compactions.id, cId));

      // Update chat state
      await tx
        .update(chats)
        .set({
          contextRevision: 3,
          recencyDigestBaseline: {
            pinned: [],
            recent: [
              { title: 'Monday chat', date: '2026-09-08', messageCount: 3 },
              {
                title: 'Wednesday refresh',
                date: '2026-09-10',
                messageCount: 1,
              },
            ],
            pinnedShown: 0,
            pinnedTotal: 0,
            recentShown: 2,
            recentTotal: 2,
            compiledOn: '2026-09-10',
          },
          recencyDigestRebakedFrom: cId,
        })
        .where(eq(chats.id, chatId));

      return cId;
    });

    // === Verify: retained states select in revision order ===

    const turnContexts = await tenantDb.runAs(owner, (tx) =>
      tx
        .select()
        .from(messageTurnContexts)
        .where(eq(messageTurnContexts.chatId, chatId))
        .orderBy(messageTurnContexts.contextRevision),
    );

    // Two turn evidence records, ordered by contextRevision
    expect(turnContexts).toHaveLength(2);
    expect(turnContexts[0].contextRevision).toBe(1);
    expect(turnContexts[0].modelId).toBe('model-monday');
    expect(turnContexts[0].sourceMaxSeq).toBe(1);
    // Monday's digest baseline had 1 recent entry
    expect(turnContexts[0].digestBaseline?.recentShown).toBe(1);

    expect(turnContexts[1].contextRevision).toBe(2);
    expect(turnContexts[1].modelId).toBe('model-tuesday');
    expect(turnContexts[1].sourceMaxSeq).toBe(3);
    // Tuesday's told-set had 2 entries
    expect(turnContexts[1].digestTold).toHaveLength(2);

    // Compaction at revision 3, with re-baked baseline (2 recent entries)
    const [comp] = await tenantDb.runAs(owner, (tx) =>
      tx
        .select()
        .from(compactions)
        .where(eq(compactions.chatId, chatId))
        .orderBy(desc(compactions.uptoSeq)),
    );
    expect(comp.contextRevision).toBe(3);
    expect(comp.sourceMaxSeq).toBe(4);
    expect(comp.companionActiveCompactionId).toBe(compactionId);
    expect(comp.companionDigestRebakedFrom).toBe(compactionId);
    expect(comp.companionState?.digestBaseline?.recentShown).toBe(2);

    // Chat's contextRevision is at 3 (after compaction)
    const [chat] = await tenantDb.runAs(owner, (tx) =>
      tx.select().from(chats).where(eq(chats.id, chatId)),
    );
    expect(chat.contextRevision).toBe(3);

    // Monday's state (revision 1) survives Tuesday and Wednesday changes
    expect(turnContexts[0].digestTold).toHaveLength(1);
    // Not the Wednesday re-bake baseline
    expect(turnContexts[0].digestBaseline?.compiledOn).toBe('2026-09-08');

    // Cleanup
    await tenantDb.runAs(owner, (tx) =>
      tx.delete(chats).where(eq(chats.id, chatId)),
    );
  });
});
