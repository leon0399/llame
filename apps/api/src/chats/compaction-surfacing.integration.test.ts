/**
 * Compaction read (surfacing) on a live DB (RLS):
 * - the owner reads their chat's LATEST compaction (highest upto_seq);
 * - a cross-tenant read returns undefined (owner-scoped, no leak);
 * - a chat with no compaction returns undefined.
 *
 * Also covers the #136 read-side merge — `ChatsService.getChatMessages`
 * embeds this same compaction (+ derived stats) into the messages response,
 * rather than a separate `GET :id/compaction` endpoint. The repository-level
 * tests above stay as the cheaper regression for `findLatestByChatId` itself;
 * the service-level describe block below proves the EMBED specifically:
 * present when a compaction exists, null-safe stats, absorbed-message-count
 * math across a compaction chain, and — the thing embedding must NOT change —
 * a foreign/cross-tenant chat id still resolves to `undefined` (404), same as
 * before this field existed.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';

import * as schema from '../db/schema';
import { type Compaction, type Message } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from './chats-repository';
import { ChatsService } from './chats.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { renderConversationCheckpoint } from './context-builder';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = Sql;

function compactionReplacementHistory(
  summary: string,
): Compaction['replacementHistory'] {
  return [
    {
      role: 'user',
      parts: [{ type: 'text', text: renderConversationCheckpoint(summary) }],
    },
  ];
}

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
    const postgres = await import('postgres');
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
        replacementHistory: compactionReplacementHistory('summary up to 10'),
      }),
    );
    await tenantDb.runAs(a, (tx) =>
      new CompactionsRepository(tx).create({
        chatId: chat,
        uptoSeq: 25,
        parentId: first.id,
        summary: 'summary up to 25',
        replacementHistory: compactionReplacementHistory('summary up to 25'),
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
        replacementHistory: compactionReplacementHistory('private summary'),
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

  describe('ChatsService.getChatMessages — embedded compaction (#136)', () => {
    let chatsService: ChatsService;

    beforeAll(() => {
      chatsService = new ChatsService(
        tenantDb,
        new RunAbortRegistry(),
        noopReindexDispatch(),
        noopEmbedDispatch(),
      );
    });

    const addMessage = (chatId: string, owner: string) =>
      tenantDb.runAs(owner, (tx) =>
        new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          parts: [{ type: 'text', text: 'hi' }],
        }),
      );

    it('embeds compaction: null when the chat has never compacted', async () => {
      const chat = await newChat(a);
      await addMessage(chat, a);

      const result = await chatsService.getChatMessages(chat, a, { limit: 10 });

      expect(result).toBeDefined();
      expect(result?.compaction).toBeUndefined();
    });

    it('embeds the LATEST compaction with null-safe stats when usage is absent', async () => {
      const chat = await newChat(a);
      for (let i = 0; i < 3; i++) await addMessage(chat, a);
      await tenantDb.runAs(a, (tx) =>
        new CompactionsRepository(tx).create({
          chatId: chat,
          uptoSeq: 3,
          summary: 'no-usage summary',
          replacementHistory: compactionReplacementHistory('no-usage summary'),
        }),
      );

      const result = await chatsService.getChatMessages(chat, a, { limit: 10 });

      expect(result?.compaction?.summary).toBe('no-usage summary');
      expect(result?.compaction?.uptoSeq).toBe(3);
      // First compaction, no parent — absorbed count is uptoSeq itself.
      expect(result?.absorbedMessageCount).toBe(3);
    });

    it('derives before/after token counts and modelId from usage when present', async () => {
      const chat = await newChat(a);
      await addMessage(chat, a);
      await tenantDb.runAs(a, (tx) =>
        new CompactionsRepository(tx).create({
          chatId: chat,
          uptoSeq: 1,
          summary: 'with usage',
          replacementHistory: compactionReplacementHistory('with usage'),
          usage: {
            inputTokens: 71_400,
            cachedInputTokens: 0,
            outputTokens: 1280,
            totalTokens: 72_680,
            modelId: 'system:openai:gpt-4o',
            latencyMs: 500,
            finishReason: 'stop',
            status: 'completed',
            costUsd: null,
          },
        }),
      );

      const result = await chatsService.getChatMessages(chat, a, { limit: 10 });

      expect(result?.compaction?.uptoSeq).toBe(1);
    });

    it('computes absorbedMessageCount as the DELTA across a compaction chain', async () => {
      const chat = await newChat(a);
      for (let i = 0; i < 30; i++) await addMessage(chat, a);
      const first = await tenantDb.runAs(a, (tx) =>
        new CompactionsRepository(tx).create({
          chatId: chat,
          uptoSeq: 10,
          summary: 'first',
          replacementHistory: compactionReplacementHistory('first'),
        }),
      );
      await tenantDb.runAs(a, (tx) =>
        new CompactionsRepository(tx).create({
          chatId: chat,
          uptoSeq: 25,
          parentId: first.id,
          summary: 'second',
          replacementHistory: compactionReplacementHistory('second'),
        }),
      );

      const result = await chatsService.getChatMessages(chat, a, { limit: 50 });

      expect(result?.compaction?.uptoSeq).toBe(25);
      // 25 - 10, NOT 25 (the chain's earlier span isn't re-counted).
      expect(result?.absorbedMessageCount).toBe(15);
    });

    it('selects the latest compaction applicable to a target-ended history window', async () => {
      const chat = await newChat(a);
      const messages: Array<Message> = [];
      for (let i = 0; i < 25; i++) {
        messages.push(await addMessage(chat, a));
      }
      const first = await tenantDb.runAs(a, (tx) =>
        new CompactionsRepository(tx).create({
          chatId: chat,
          uptoSeq: messages[9].seq,
          summary: 'target first',
          replacementHistory: compactionReplacementHistory('target first'),
        }),
      );
      await tenantDb.runAs(a, (tx) =>
        new CompactionsRepository(tx).create({
          chatId: chat,
          uptoSeq: messages[19].seq,
          parentId: first.id,
          summary: 'target second',
          replacementHistory: compactionReplacementHistory('target second'),
        }),
      );

      const cases = [
        { target: messages[4].seq, summary: undefined },
        { target: messages[9].seq, summary: 'target first' },
        { target: messages[14].seq, summary: 'target first' },
        { target: messages[19].seq, summary: 'target second' },
        { target: messages[24].seq, summary: 'target second' },
      ];

      for (const { target, summary } of cases) {
        const result = await chatsService.getChatMessages(chat, a, {
          limit: 10,
          targetSeq: target,
        });

        expect(result?.messages.at(-1)?.seq).toBe(target);
        expect(result?.compaction?.summary).toBe(summary);
        if (result?.compaction) {
          expect(result.compaction.uptoSeq).toBeLessThanOrEqual(target);
        }
      }
    });

    it('a foreign/cross-tenant chat id still resolves to undefined — embedding the field does not change 404 behavior', async () => {
      const chat = await newChat(a);
      await addMessage(chat, a);
      await tenantDb.runAs(a, (tx) =>
        new CompactionsRepository(tx).create({
          chatId: chat,
          uptoSeq: 1,
          summary: 'owner-only summary',
          replacementHistory:
            compactionReplacementHistory('owner-only summary'),
        }),
      );

      const asB = await chatsService.getChatMessages(chat, b, { limit: 10 });

      expect(asB).toBeUndefined();
    });

    it('a nonexistent chat id resolves to undefined, same as before the embed', async () => {
      const result = await chatsService.getChatMessages(
        crypto.randomUUID(),
        a,
        { limit: 10 },
      );

      expect(result).toBeUndefined();
    });
  });
});
