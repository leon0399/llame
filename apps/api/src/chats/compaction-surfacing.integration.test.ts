/**
 * Checkpoint read (surfacing) on a live DB (RLS):
 * - the owner reads the latest checkpoint by absorbed-history boundary;
 * - a cross-tenant read returns undefined (owner-scoped, no leak);
 * - a chat with no checkpoint returns undefined.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';

import * as schema from '../db/schema';
import { type Message } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { ChatsService } from './chats.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import {
  createCompactionCheckpointPart,
  readCheckpointText,
} from './context-item-producers';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = Sql;

describeIfDb('checkpoint surfacing — RLS + latest', () => {
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

  const addMessage = (chatId: string, owner: string): Promise<Message> =>
    tenantDb.runAs(owner, (tx) =>
      new MessagesRepository(tx).create({
        chatId,
        role: 'user',
        parts: [{ type: 'text', text: 'hi' }],
      }),
    );

  const addCheckpoint = (
    chatId: string,
    owner: string,
    absorbedThroughSeq: number,
    summary: string,
  ) =>
    tenantDb.runAs(owner, (tx) =>
      new MessagesRepository(tx).createCheckpoint({
        chatId,
        absorbedThroughSeq,
        part: createCompactionCheckpointPart(summary),
      }),
    );

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

  it('returns the latest checkpoint boundary for the owner', async () => {
    const chat = await newChat(a);
    const firstMessage = await addMessage(chat, a);
    await addCheckpoint(chat, a, firstMessage.seq, 'summary up to one');
    const secondMessage = await addMessage(chat, a);
    await addCheckpoint(chat, a, secondMessage.seq, 'summary up to two');

    const latest = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).findActiveCheckpoint(chat, a, {
        beforeSeq: secondMessage.seq + 2,
      }),
    );

    expect(latest?.role).toBe('checkpoint');
    expect(latest?.absorbedThroughSeq).toBe(secondMessage.seq);
    expect(latest ? readCheckpointText(latest) : '').toContain(
      'summary up to two',
    );
  });

  it('a cross-tenant read returns undefined (owner-scoped, no leak)', async () => {
    const chat = await newChat(a);
    const message = await addMessage(chat, a);
    await addCheckpoint(chat, a, message.seq, 'private summary');

    const asB = await tenantDb.runAs(b, (tx) =>
      new MessagesRepository(tx).findActiveCheckpoint(chat, b, {
        beforeSeq: message.seq + 2,
      }),
    );
    expect(asB).toBeUndefined();
  });

  it('a chat with no checkpoint returns undefined', async () => {
    const chat = await newChat(a);
    const message = await addMessage(chat, a);
    const none = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).findActiveCheckpoint(chat, a, {
        beforeSeq: message.seq + 1,
      }),
    );
    expect(none).toBeUndefined();
  });

  describe('ChatsService.getChatMessages — checkpoint rows', () => {
    let chatsService: ChatsService;

    beforeAll(() => {
      chatsService = new ChatsService(
        tenantDb,
        new RunAbortRegistry(),
        noopReindexDispatch(),
        noopEmbedDispatch(),
        noopQueryEmbedder(),
      );
    });

    it('returns checkpoint rows with their boundary and absorbed count', async () => {
      const chat = await newChat(a);
      const first = await addMessage(chat, a);
      const second = await addMessage(chat, a);
      await addCheckpoint(chat, a, second.seq, 'older context');

      const result = await chatsService.getChatMessages(chat, a, { limit: 10 });
      const checkpoint = result?.messages.find(
        (message) => message.role === 'checkpoint',
      );

      expect(checkpoint).toMatchObject({
        role: 'checkpoint',
        absorbedThroughSeq: second.seq,
        absorbedMessageCount: 2,
      });
      expect(first.seq).toBeLessThan(second.seq);
      expect(checkpoint ? readCheckpointText(checkpoint) : '').toContain(
        'older context',
      );
    });

    it('does not leak checkpoint rows across tenants', async () => {
      const chat = await newChat(a);
      const message = await addMessage(chat, a);
      await addCheckpoint(chat, a, message.seq, 'owner-only summary');

      const asB = await chatsService.getChatMessages(chat, b, { limit: 10 });
      expect(asB).toBeUndefined();
    });

    it('returns undefined for a nonexistent chat', async () => {
      const result = await chatsService.getChatMessages(
        crypto.randomUUID(),
        a,
        { limit: 10 },
      );
      expect(result).toBeUndefined();
    });
  });
});
