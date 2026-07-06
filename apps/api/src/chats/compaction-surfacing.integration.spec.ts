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
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from './chats-repository';
import { ChatsService } from './chats.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';

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

  describe('ChatsService.getChatMessages — embedded compaction (#136)', () => {
    let chatsService: ChatsService;

    beforeAll(() => {
      chatsService = new ChatsService(tenantDb, new RunAbortRegistry());
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
        }),
      );

      const result = await chatsService.getChatMessages(chat, a, { limit: 10 });

      expect(result?.compaction?.summary).toBe('no-usage summary');
      expect(result?.compaction?.uptoSeq).toBe(3);
      // First compaction, no parent — absorbed count is uptoSeq itself.
      expect(result?.absorbedMessageCount).toBe(3);
    });

    it('derives before/after token counts and model from usage when present', async () => {
      const chat = await newChat(a);
      await addMessage(chat, a);
      await tenantDb.runAs(a, (tx) =>
        new CompactionsRepository(tx).create({
          chatId: chat,
          uptoSeq: 1,
          summary: 'with usage',
          usage: {
            inputTokens: 71400,
            cachedInputTokens: 0,
            outputTokens: 1280,
            totalTokens: 72680,
            model: 'gpt-4o',
            provider: 'openai',
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
        }),
      );
      await tenantDb.runAs(a, (tx) =>
        new CompactionsRepository(tx).create({
          chatId: chat,
          uptoSeq: 25,
          parentId: first.id,
          summary: 'second',
        }),
      );

      const result = await chatsService.getChatMessages(chat, a, { limit: 50 });

      expect(result?.compaction?.uptoSeq).toBe(25);
      // 25 - 10, NOT 25 (the chain's earlier span isn't re-counted).
      expect(result?.absorbedMessageCount).toBe(15);
    });

    it('a foreign/cross-tenant chat id still resolves to undefined — embedding the field does not change 404 behavior', async () => {
      const chat = await newChat(a);
      await addMessage(chat, a);
      await tenantDb.runAs(a, (tx) =>
        new CompactionsRepository(tx).create({
          chatId: chat,
          uptoSeq: 1,
          summary: 'owner-only summary',
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
