import { NotFoundException } from '@nestjs/common';
/**
 * forkChat on a live DB (RLS) — the copy's correctness + tenancy:
 * - copies the seq-prefix into a NEW owned chat, order preserved, `in_reply_to`
 *   REMAPPED to the copied user turn (not the original id), usage NOT carried;
 * - a cross-tenant fork throws + creates nothing (owner-scoped).
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  ChatsRepository,
  CompactionsRepository,
  findLiveWindow,
  MessagesRepository,
} from './chats-repository';
import { ChatsService } from './chats.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { isRecord } from '../unknown-record';
import { renderConversationCheckpoint } from './context-builder';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = Sql;

function hasStringText(value: unknown): value is { text: string } {
  return isRecord(value) && typeof value.text === 'string';
}

const textOf = (parts: Array<unknown>): string | undefined => {
  if (!Array.isArray(parts)) return undefined;
  const text = parts.find(hasStringText);
  return text?.text;
};

describeIfDb('forkChat — copy correctness + RLS', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let service: ChatsService;
  let a: string;
  let b: string;

  beforeAll(async () => {
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 5 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    service = new ChatsService(
      tenantDb,
      new RunAbortRegistry(),
      noopReindexDispatch(),
      noopEmbedDispatch(),
      noopQueryEmbedder(),
    );
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
        parts: [
          {
            type: 'data-context',
            data: {
              v: 1,
              producer: 'temporal',
              form: 'snapshot',
              runId: '11111111-2222-4333-8444-555555555555',
              payload: {
                instant: '2026-08-19T16:36:00.000Z',
                timeZone: 'Europe/Madrid',
              },
            },
          },
          { type: 'text', text: 'q1' },
        ],
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
    // A turn's temporal row travels with it: the copy records when the
    // ORIGINAL turn was received, which is what it is a copy of.
    expect(copied[0].parts[0]).toEqual({
      type: 'data-context',
      data: {
        v: 1,
        producer: 'temporal',
        form: 'snapshot',
        runId: '11111111-2222-4333-8444-555555555555',
        payload: {
          instant: '2026-08-19T16:36:00.000Z',
          timeZone: 'Europe/Madrid',
        },
      },
    });
    // in_reply_to REMAPPED to the copied user turn, not the original id.
    const [copiedUser, copiedAsst] = copied;
    expect(copied.map(({ seq }) => seq)).toEqual([1, 2]);
    expect(copiedAsst.inReplyTo).toBe(copiedUser.id);
    expect(copiedAsst.inReplyTo).not.toBe(asst1Id);
    // usage is NOT carried (a fork made no API calls → no cost double-count).
    expect(copiedAsst.usage).toBeNull();
  });

  it('a cross-tenant fork throws and creates nothing', async () => {
    const { chatId, asst1Id } = await seedChat(a);

    await expect(service.forkChat(chatId, b, asst1Id)).rejects.toThrow(
      NotFoundException,
    );

    const bChats = await service.listChatsWithLastMessage(b);
    expect(bChats).toEqual([]);
  });

  it('forks the WHOLE chat when fromMessageId is omitted (clone, sidebar "Fork")', async () => {
    const { chatId } = await seedChat(a);

    const forked = await service.forkChat(chatId, a, undefined);

    expect(forked.ownerUserId).toBe(a);
    expect(forked.id).not.toBe(chatId);

    const copied = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).findByChatId(forked.id, a),
    );
    // All 4 source messages, not just a prefix.
    expect(copied.map((m) => textOf(m.parts))).toEqual([
      'q1',
      'a1',
      'q2',
      'a2',
    ]);
    // in_reply_to remapped for every link, including the second (unnamed) turn.
    const [copiedUser1, copiedAsst1, copiedUser2, copiedAsst2] = copied;
    expect(copiedAsst1.inReplyTo).toBe(copiedUser1.id);
    expect(copiedAsst2.inReplyTo).toBe(copiedUser2.id);
  });

  it('a cross-tenant whole-chat fork (clone) throws and creates nothing', async () => {
    const { chatId } = await seedChat(a);

    await expect(service.forkChat(chatId, b, undefined)).rejects.toThrow(
      NotFoundException,
    );

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
      const rows: Array<{
        id: string;
        chatId: string;
        seq: number;
        role: 'user' | 'assistant';
        senderUserId: string | null;
        parts: Array<{ type: string; text: string }>;
        attachments: Array<unknown>;
        inReplyTo: string | null;
      }> = Array.from({ length: MESSAGE_COUNT }, (_, i) => ({
        id: crypto.randomUUID(),
        chatId: chat.id,
        seq: i + 1,
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

      const lastRow = rows.at(-1);
      if (lastRow === undefined) expect.unreachable('expected seeded rows');
      return { chatId: chat.id, lastId: lastRow.id };
    });

    const forked = await service.forkChat(chatId, a, lastId);

    const copied = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).findByChatId(forked.id, a),
    );

    expect(copied).toHaveLength(MESSAGE_COUNT);
    expect(copied.map(({ seq }) => seq)).toEqual(
      Array.from({ length: MESSAGE_COUNT }, (_, i) => i + 1),
    );
    // Order preserved across chunk boundaries (explicit Chat-local sequence
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

  it('copies a compacted source wholesale and leaves the fork on uncompacted replay', async () => {
    const source = await tenantDb.runAs(a, async (tx) => {
      const chats = new ChatsRepository(tx);
      const messages = new MessagesRepository(tx);
      const compactions = new CompactionsRepository(tx);
      const chat = await chats.create({ ownerUserId: a, title: 'Compacted' });
      const prefixUserParts = [
        {
          type: 'data-context',
          data: {
            v: 1,
            producer: 'temporal',
            form: 'snapshot',
            runId: '11111111-2222-4333-8444-555555555555',
            text: '<system-reminder>source-time</system-reminder>',
            payload: {
              instant: '2026-08-25T04:13:39.795Z',
              timeZone: 'Europe/Madrid',
            },
          },
        },
        { type: 'text', text: 'before compaction' },
        {
          type: 'source-url',
          sourceId: 'private-source',
          url: 'https://private.example/source',
        },
      ];
      const prefixAssistantParts = [
        { type: 'reasoning', text: 'private reasoning' },
        { type: 'text', text: 'prefix answer' },
        {
          type: 'tool-search_conversations',
          toolCallId: 'private-call',
          state: 'output-available',
          input: { query: 'private' },
          output: { results: ['private result'] },
        },
      ];
      const prefixUser = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: a,
        parts: prefixUserParts,
      });
      const prefixAssistant = await messages.create({
        chatId: chat.id,
        role: 'assistant',
        senderUserId: null,
        parts: prefixAssistantParts,
        inReplyTo: prefixUser.id,
      });
      const liveUser = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: a,
        parts: [{ type: 'text', text: 'after compaction' }],
      });
      const liveAssistant = await messages.create({
        chatId: chat.id,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: 'live answer' }],
        inReplyTo: liveUser.id,
      });

      await compactions.create({
        chatId: chat.id,
        uptoSeq: prefixAssistant.seq,
        summary: 'source summary',
        replacementHistory: [
          {
            role: 'user',
            parts: [
              {
                type: 'text',
                text: renderConversationCheckpoint('source summary'),
              },
            ],
          },
        ],
      });

      return {
        chat,
        messages: [prefixUser, prefixAssistant, liveUser, liveAssistant],
      };
    });

    const compactedSource = await tenantDb.runAs(a, (tx) =>
      findLiveWindow(tx, source.chat.id, a),
    );
    expect(compactedSource.compaction?.summary).toBe('source summary');
    expect(compactedSource.history.map((message) => message.parts)).toEqual([
      source.messages[2].parts,
      source.messages[3].parts,
    ]);

    const forked = await service.forkChat(source.chat.id, a);
    const copied = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).findByChatId(forked.id, a),
    );
    const sourceParts = source.messages.map((message) => message.parts);

    expect(copied.map((message) => message.parts)).toEqual(sourceParts);
    const forkReplay = await tenantDb.runAs(a, (tx) =>
      findLiveWindow(tx, forked.id, a),
    );
    expect(forkReplay.compaction).toBeUndefined();
    expect(forkReplay.history.map((message) => message.parts)).toEqual(
      sourceParts,
    );
  });
});
