import { readFileSync } from 'node:fs';

import { NotFoundException } from '@nestjs/common';
/**
 * forkChat on a live DB (RLS) — the copy's correctness + tenancy:
 * - copies the seq-prefix into a NEW owned chat, order preserved, with
 *   `in_reply_to` REMAPPED to the copied user turn (not the original id) and
 *   `createdAt`/`usage` carried verbatim (design D2);
 * - copies the source's compactions and the frozen prompt state on its Chat
 *   row, so the fork's first turn renders the prefix its source would
 *   (design D1-D3);
 * - `forkSharedChat` stays the text-only public projection (D5);
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
import { type Chat, type Compaction } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  ChatsRepository,
  CompactionsRepository,
  findLiveWindow,
  MessagesRepository,
} from './chats-repository';
import { ChatsService } from './chats.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { toStoredMessages } from '../compaction/compaction.service';
import { isRecord } from '@workspace/runtime-safety';
import {
  buildContext,
  renderConversationCheckpoint,
  type StoredMessage,
} from './context-builder';
import { resolveTurnSkillState } from './skill-turn-state';
import { type SkillCatalogPort } from '../skills/skill-catalog';
import { formatTemporalAnchor } from '../prompts/temporal-anchor';
import {
  DEFAULT_CHAT_SYSTEM_PROMPT_PATH,
  renderSystemPromptTemplate,
} from '../instance-config/prompt-loader';

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

// Fixed instants for the inherited-context cases. The source Chat predates both
// checkpoints, so a fork that lost the latest checkpoint resolves a DIFFERENT
// temporal anchor and cannot pass by accident. `SOURCE_CREATED_AT` is also the
// value the owner fork must copy and the shared fork must not.
const SOURCE_CREATED_AT = new Date('2026-08-01T09:15:00.000Z');
const FIRST_CHECKPOINT_CREATED_AT = new Date('2026-08-10T11:00:00.000Z');
const LATEST_CHECKPOINT_CREATED_AT = new Date('2026-08-20T13:30:00.000Z');

// Frozen prompt state, deliberately non-trivial: every inheritance assertion
// compares real entries and told names rather than two NULLs.
const DIGEST_BASELINE: NonNullable<Chat['recencyDigestBaseline']> = {
  pinned: [],
  recent: [
    {
      title: 'Digest source',
      date: '2026-07-30',
      messageCount: 4,
      excerpt: 'digest opening',
    },
  ],
  pinnedShown: 0,
  pinnedTotal: 0,
  recentShown: 1,
  recentTotal: 1,
  compiledOn: '2026-07-31',
};
const DIGEST_TOLD: NonNullable<Chat['recencyDigestTold']> = [
  {
    chatId: '11111111-1111-4111-8111-111111111111',
    pinned: false,
    title: 'Digest source',
  },
];
const SKILL_BASELINE: NonNullable<Chat['skillCatalogBaseline']> = {
  entries: [{ name: 'research', description: 'Plan research' }],
  omitted: 0,
};

// The LIVE catalog a re-resolution would reach: it holds an entry the frozen
// baseline above does not, so "reused the copy" and "resolved the live catalog"
// are distinguishable by name.
const LIVE_CATALOG: SkillCatalogPort = {
  getSnapshot: () => ({
    available: true,
    directories: ['/skills'],
    entries: [
      {
        name: 'live-only',
        description: 'Installed after the fork point',
        proactive: true,
        sourceDirectory: '/skills',
        skillDirectory: '/skills/live-only',
        available: true,
        diagnostics: [],
      },
    ],
    diagnostics: [],
  }),
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

  // Seed a COMPACTED, context-bearing source: three turns (6 messages) with two
  // compaction generations — C1 covering seq 1-2, C2 covering seq 1-4 and
  // pointing at C1 — every frozen prompt column bound to C2, and a creation
  // time preceding both checkpoints. Returns the rows as stored, which is
  // exactly what a fork has to reproduce.
  const seedCompactedSource = async (
    options: { visibility?: 'private' | 'public'; bindMarkers?: boolean } = {},
  ) => {
    const { bindMarkers = true } = options;
    return tenantDb.runAs(a, async (tx) => {
      const messages = new MessagesRepository(tx);
      const compactions = new CompactionsRepository(tx);
      const firstCheckpointId = crypto.randomUUID();
      const latestCheckpointId = crypto.randomUUID();
      const chat = await new ChatsRepository(tx).create({
        ownerUserId: a,
        title: 'Compacted source',
        visibility: options.visibility ?? 'private',
        createdAt: SOURCE_CREATED_AT,
        recencyDigestBaseline: DIGEST_BASELINE,
        recencyDigestTold: DIGEST_TOLD,
        recencyDigestRebakedFrom: bindMarkers ? latestCheckpointId : null,
        skillCatalogBaseline: SKILL_BASELINE,
        skillCatalogTold: ['research'],
        skillCatalogRebakedFrom: bindMarkers ? latestCheckpointId : null,
      });

      const q1 = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: a,
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
      const a1 = await messages.create({
        chatId: chat.id,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: 'a1' }],
        usage: { costUsd: 0.25, model: 'gpt-x', runId: 'run-1' },
        inReplyTo: q1.id,
      });
      const q2 = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: a,
        parts: [{ type: 'text', text: 'q2' }],
      });
      const a2 = await messages.create({
        chatId: chat.id,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: 'a2' }],
        usage: { costUsd: 0.75, model: 'gpt-x', runId: 'run-2' },
        inReplyTo: q2.id,
      });
      const q3 = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: a,
        parts: [{ type: 'text', text: 'q3' }],
      });
      const a3 = await messages.create({
        chatId: chat.id,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: 'a3' }],
        usage: { costUsd: 0.5, model: 'gpt-x', runId: 'run-3' },
        inReplyTo: q3.id,
      });

      const first = await compactions.create({
        id: firstCheckpointId,
        chatId: chat.id,
        uptoSeq: a1.seq,
        summary: 'Checkpoint 1',
        replacementHistory: [
          {
            role: 'user',
            parts: [
              {
                type: 'text',
                text: renderConversationCheckpoint('Checkpoint 1'),
              },
            ],
          },
        ],
        usage: { model: 'gpt-x', inputTokens: 10 },
        createdAt: FIRST_CHECKPOINT_CREATED_AT,
      });
      const latest = await compactions.create({
        id: latestCheckpointId,
        chatId: chat.id,
        uptoSeq: a2.seq,
        parentId: first.id,
        summary: 'Checkpoint 2',
        replacementHistory: [
          {
            role: 'user',
            parts: [
              {
                type: 'text',
                text: renderConversationCheckpoint('Checkpoint 2'),
              },
            ],
          },
        ],
        usage: { model: 'gpt-x', inputTokens: 20 },
        createdAt: LATEST_CHECKPOINT_CREATED_AT,
      });

      return {
        chat,
        messages: [q1, a1, q2, a2, q3, a3],
        compactions: [first, latest],
      };
    });
  };

  // The system prompt a turn after the fork sends, rendered by the PRODUCTION
  // template renderer from ONE side's own stored state. The anchor resolution
  // mirrors run-execution.service.ts: the latest checkpoint's creation time
  // wins over the chat's.
  const renderFirstTurnSystemPrompt = (
    chat: Chat,
    compaction: Compaction | undefined,
  ) =>
    renderSystemPromptTemplate({
      template: readFileSync(DEFAULT_CHAT_SYSTEM_PROMPT_PATH, 'utf8'),
      model: { id: 'system:fork:test', name: 'Fork Test' },
      anchor: formatTemporalAnchor(
        compaction?.createdAt ?? chat.createdAt,
        'UTC',
      ),
      chats: chat.recencyDigestBaseline ?? undefined,
      ...(chat.skillCatalogBaseline !== null && {
        skills: chat.skillCatalogBaseline,
      }),
    });

  // A first turn through the REAL skill resolver, with the live catalog a
  // re-resolution would reach. The reuse path returns before the catalog is
  // read, so which baseline a turn renders is decided by the Chat row alone.
  const skillStateFor = (chat: Chat, latestCompactionId: string | null) =>
    resolveTurnSkillState(
      { skillCatalog: LIVE_CATALOG, skillDirectories: ['/skills'] },
      {
        chat,
        runId: crypto.randomUUID(),
        latestCompactionId,
        modelReferencesSkills: true,
      },
    );

  it('copies the seq-prefix into a new owned chat, remaps in_reply_to, carries usage', async () => {
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
    // usage travels with the copied assistant turn: it is the price of the
    // message this row is a copy of (design D2 — the SHARED path still drops
    // it, see the shared-fork case at the end of this suite).
    expect(copiedAsst.usage).toEqual({ costUsd: 0.5, model: 'gpt-x' });
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

  it('copies a compacted source wholesale and replays its checkpoint, not uncompacted history', async () => {
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

      const checkpoint = await compactions.create({
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
        checkpoint,
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
    // The fork replays its source's checkpoint instead of re-expanding the
    // turns that checkpoint absorbed — same replacement history, same retained
    // tail, new row identity. (Copying the messages without the checkpoint is
    // what left the fork rendering a different model-facing prefix.)
    expect(forkReplay.compaction?.summary).toBe('source summary');
    expect(forkReplay.compaction?.uptoSeq).toBe(source.checkpoint.uptoSeq);
    expect(forkReplay.compaction?.replacementHistory).toEqual(
      source.checkpoint.replacementHistory,
    );
    expect(forkReplay.compaction?.id).not.toBe(source.checkpoint.id);
    expect(forkReplay.history.map((message) => message.parts)).toEqual(
      compactedSource.history.map((message) => message.parts),
    );
  });

  it('forks a compacted, baseline-bearing source into the same model-facing prefix', async () => {
    const source = await seedCompactedSource();

    const forked = await service.forkChat(source.chat.id, a);

    const copiedMessages = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).findByChatId(forked.id, a),
    );
    const copiedCompactions = await tenantDb.runAs(a, (tx) =>
      new CompactionsRepository(tx).findByChatId(forked.id, a),
    );

    expect(copiedMessages).toHaveLength(source.messages.length);
    copiedMessages.forEach((copied, index) => {
      const original = source.messages[index];
      // Dense sequences from 1 in copied order, every stored value verbatim —
      // including the Run id inside `usage` and the ids inside the context
      // part, which are copied as VALUES and never rewritten — with only
      // identity replaced.
      expect(copied.seq).toBe(index + 1);
      expect(copied.id).not.toBe(original.id);
      expect(copied.chatId).toBe(forked.id);
      expect(copied.role).toBe(original.role);
      expect(copied.parts).toEqual(original.parts);
      expect(copied.attachments).toEqual(original.attachments);
      expect(copied.senderUserId).toBe(original.senderUserId);
      expect(copied.createdAt).toEqual(original.createdAt);
      expect(copied.usage).toEqual(original.usage);
      // Threading points at the COPIED turn, never at a source row.
      expect(copied.inReplyTo).toBe(
        original.inReplyTo === null ? null : copiedMessages[index - 1].id,
      );
    });

    expect(copiedCompactions).toHaveLength(source.compactions.length);
    const copiedLatest = copiedCompactions.at(-1);
    if (copiedLatest === undefined)
      expect.unreachable('expected copied compactions');
    copiedCompactions.forEach((copied, index) => {
      const original = source.compactions[index];
      expect(copied.id).not.toBe(original.id);
      expect(copied.chatId).toBe(forked.id);
      expect(copied.uptoSeq).toBe(original.uptoSeq);
      expect(copied.summary).toBe(original.summary);
      expect(copied.replacementHistory).toEqual(original.replacementHistory);
      expect(copied.usage).toEqual(original.usage);
      expect(copied.createdAt).toEqual(original.createdAt);
      // Lineage stays internal to the fork: the child points at the COPIED
      // parent, so the whole chain the checkpoint UI walks came across.
      expect(copied.parentId).toBe(
        index === 0 ? null : copiedCompactions[index - 1].id,
      );
    });

    // The destination carries the source's creation time — the fork's context
    // began where its source's did — and every frozen prompt column...
    expect(forked.createdAt).toEqual(source.chat.createdAt);
    expect({
      recencyDigestBaseline: forked.recencyDigestBaseline,
      recencyDigestTold: forked.recencyDigestTold,
      skillCatalogBaseline: forked.skillCatalogBaseline,
      skillCatalogTold: forked.skillCatalogTold,
    }).toEqual({
      recencyDigestBaseline: source.chat.recencyDigestBaseline,
      recencyDigestTold: source.chat.recencyDigestTold,
      skillCatalogBaseline: source.chat.skillCatalogBaseline,
      skillCatalogTold: source.chat.skillCatalogTold,
    });
    // ...with the two markers naming the COPIED checkpoint. The skill marker is
    // what `baselineMatchesEpoch` compares against the chat's active
    // compaction, so a source id (or a null beside a copied baseline) would
    // re-resolve the live catalog on the fork's first turn.
    expect(forked.recencyDigestRebakedFrom).toBe(copiedLatest.id);
    expect(forked.skillCatalogRebakedFrom).toBe(copiedLatest.id);
    // Non-vacuous: the inherited context is the seeded content, not two NULLs.
    expect(forked.recencyDigestBaseline).toEqual(DIGEST_BASELINE);
    expect(forked.skillCatalogBaseline).toEqual(SKILL_BASELINE);

    // The checkpoint UI's absorbed count comes from the copied CHAIN: with the
    // earlier checkpoint copied too, the fork absorbs 2 messages (4 - 2) like
    // its source. A lone parentless copy of the latest checkpoint would report
    // 4 and misdescribe the fork's coverage.
    const [sourceRead, forkRead] = await Promise.all([
      service.getChatMessages(source.chat.id, a, { limit: 50 }),
      service.getChatMessages(forked.id, a, { limit: 50 }),
    ]);
    expect(sourceRead?.absorbedMessageCount).toBe(2);
    expect(forkRead?.absorbedMessageCount).toBe(
      sourceRead?.absorbedMessageCount,
    );

    const [sourceWindow, forkWindow] = await Promise.all([
      tenantDb.runAs(a, (tx) => findLiveWindow(tx, source.chat.id, a)),
      tenantDb.runAs(a, (tx) => findLiveWindow(tx, forked.id, a)),
    ]);
    expect(sourceWindow.compaction?.summary).toBe('Checkpoint 2');
    expect(sourceWindow.history).toHaveLength(2);

    // The same new user input on both sides: identical content, and identity
    // fields deliberately not shared (each chat's own id, a fresh message id,
    // its own timestamp). Equal model-facing output therefore also proves that
    // storage identity does not reach the provider request.
    const nextInput: Pick<
      StoredMessage,
      'role' | 'senderUserId' | 'parts' | 'attachments'
    > = {
      role: 'user',
      senderUserId: a,
      parts: [{ type: 'text', text: 'what should I do next?' }],
      attachments: [],
    };
    const sourceInput: StoredMessage = {
      ...nextInput,
      id: crypto.randomUUID(),
      chatId: source.chat.id,
      seq: (sourceWindow.history.at(-1)?.seq ?? 0) + 1,
      createdAt: new Date(),
    };
    const forkInput: StoredMessage = {
      ...nextInput,
      id: crypto.randomUUID(),
      chatId: forked.id,
      seq: (forkWindow.history.at(-1)?.seq ?? 0) + 1,
      createdAt: new Date(),
    };

    // DB rows carry `parts: unknown[]`; narrow them exactly as production does
    // before handing stored rows to the builder.
    const sourceContext = buildContext(
      [...toStoredMessages(sourceWindow.history), sourceInput],
      {
        systemPrompt: renderFirstTurnSystemPrompt(
          source.chat,
          sourceWindow.compaction,
        ),
        requestKind: 'continuation',
        compaction: sourceWindow.compaction,
      },
    );
    const forkContext = buildContext(
      [...toStoredMessages(forkWindow.history), forkInput],
      {
        systemPrompt: renderFirstTurnSystemPrompt(
          forked,
          forkWindow.compaction,
        ),
        requestKind: 'continuation',
        compaction: forkWindow.compaction,
      },
    );

    // Guard against a vacuous comparison: the source's own prompt really does
    // carry the inherited digest and catalog.
    expect(sourceContext.system).toContain('Digest source');
    expect(sourceContext.system).toContain('Plan research');
    // Equal system prompt: the same temporal anchor (the copied checkpoint's
    // creation time, not the fork's own), the same digest, the same catalog.
    expect(forkContext.system).toBe(sourceContext.system);
    // Equal inherited history: the copied replacement history leads, the
    // retained tail follows, then the identical new input.
    expect(forkContext.messages).toEqual(sourceContext.messages);
  });

  it('an anchor before the latest checkpoint copies only the earlier one and keeps the baseline bound to it', async () => {
    const source = await seedCompactedSource();
    // seq 3 sits between the two checkpoints: C1 (uptoSeq 2) is inside the
    // copied prefix, C2 (uptoSeq 4 — the one both markers name) is not.
    const anchor = source.messages[2];

    const forked = await service.forkChat(source.chat.id, a, anchor.id);

    const copiedMessages = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).findByChatId(forked.id, a),
    );
    expect(copiedMessages.map((message) => textOf(message.parts))).toEqual([
      'q1',
      'a1',
      'q2',
    ]);
    const copiedCompactions = await tenantDb.runAs(a, (tx) =>
      new CompactionsRepository(tx).findByChatId(forked.id, a),
    );
    expect(copiedCompactions).toHaveLength(1);
    const [copiedEarlier] = copiedCompactions;
    expect(copiedEarlier.uptoSeq).toBe(source.compactions[0].uptoSeq);
    expect(copiedEarlier.summary).toBe(source.compactions[0].summary);
    expect(copiedEarlier.parentId).toBeNull();

    // The copied earlier checkpoint is the fork's ACTIVE one...
    const active = await tenantDb.runAs(a, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(forked.id, a),
    );
    expect(active?.id).toBe(copiedEarlier.id);
    // ...and both markers name it rather than the source's uncopied C2.
    expect(forked.recencyDigestRebakedFrom).toBe(copiedEarlier.id);
    expect(forked.skillCatalogRebakedFrom).toBe(copiedEarlier.id);

    // The consequence through the real turn resolver: the fork's first turn
    // REUSES the copied baseline instead of resolving the live catalog (whose
    // entries differ), and freezes nothing.
    const state = skillStateFor(forked, copiedEarlier.id);
    expect(state.baseline?.entries.map(({ name }) => name)).toEqual([
      'research',
    ]);
    expect(state.freeze).toBeUndefined();
  });

  it('keeps a NULL re-bake marker NULL when its source would re-resolve the baseline', async () => {
    const source = await seedCompactedSource({ bindMarkers: false });

    const forked = await service.forkChat(source.chat.id, a);
    const active = await tenantDb.runAs(a, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(forked.id, a),
    );
    const sourceLatest = source.compactions.at(-1);
    if (active === undefined || sourceLatest === undefined)
      expect.unreachable('expected a checkpoint on both sides');

    // The source holds a baseline whose marker is NULL while a compaction
    // exists, so its own next turn re-resolves the live catalog rather than
    // reusing that baseline. The fork inherits the DECISION: a marker pointed
    // at the copied checkpoint would freeze a baseline its source no longer
    // stands behind, and change the fork's prompt.
    expect(forked.recencyDigestRebakedFrom).toBeNull();
    expect(forked.skillCatalogRebakedFrom).toBeNull();

    const forkState = skillStateFor(forked, active.id);
    expect(forkState.baseline?.entries.map(({ name }) => name)).toEqual([
      'live-only',
    ]);
    expect(forkState.freeze?.rebakedFrom).toBe(active.id);
    const sourceState = skillStateFor(source.chat, sourceLatest.id);
    expect(sourceState.baseline?.entries.map(({ name }) => name)).toEqual([
      'live-only',
    ]);
    expect(sourceState.freeze?.rebakedFrom).toBe(sourceLatest.id);
  });

  it('forkSharedChat stays text-only — no compaction, context, usage, or copied creation time', async () => {
    const source = await seedCompactedSource({ visibility: 'public' });

    const forked = await service.forkSharedChat(source.chat.id, b);
    if (forked === undefined) expect.unreachable('expected a public fork');
    // A new PRIVATE chat: sharing the source must never share the visitor's
    // own fork of it.
    expect(forked.visibility).toBe('private');

    const copiedMessages = await tenantDb.runAs(b, (tx) =>
      new MessagesRepository(tx).findByChatId(forked.id, b),
    );
    // The transcript comes across...
    expect(copiedMessages).toHaveLength(source.messages.length);
    // ...but none of the owner's context: no copied usage, no compaction, no
    // frozen baseline or marker, and a creation time of its own.
    expect(copiedMessages.map(({ usage }) => usage)).toEqual(
      source.messages.map(() => null),
    );
    const copiedCompactions = await tenantDb.runAs(b, (tx) =>
      new CompactionsRepository(tx).findByChatId(forked.id, b),
    );
    expect(copiedCompactions).toEqual([]);
    expect({
      recencyDigestBaseline: forked.recencyDigestBaseline,
      recencyDigestTold: forked.recencyDigestTold,
      recencyDigestRebakedFrom: forked.recencyDigestRebakedFrom,
      skillCatalogBaseline: forked.skillCatalogBaseline,
      skillCatalogTold: forked.skillCatalogTold,
      skillCatalogRebakedFrom: forked.skillCatalogRebakedFrom,
    }).toEqual({
      recencyDigestBaseline: null,
      recencyDigestTold: null,
      recencyDigestRebakedFrom: null,
      skillCatalogBaseline: null,
      skillCatalogTold: null,
      skillCatalogRebakedFrom: null,
    });
    expect(forked.createdAt.getTime()).toBeGreaterThan(
      source.chat.createdAt.getTime(),
    );
  });
});
