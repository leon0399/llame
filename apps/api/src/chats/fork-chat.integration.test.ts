import { readFileSync } from 'node:fs';

import { NotFoundException } from '@nestjs/common';
/**
 * forkChat on a live DB (RLS) — the copy's correctness + tenancy:
 * - copies the seq-prefix into a NEW owned chat, order preserved, with
 *   `in_reply_to` REMAPPED to the copied user turn (not the original id) and
 *   `createdAt`/`usage` carried verbatim (design D2);
 * - copies the source's checkpoint rows — remapping each absorbed boundary to
 *   the copy of the row it named — and the frozen prompt state on its Chat
 *   row, so the fork's first turn renders the prefix its source would
 *   (design D1-D3, D8);
 * - `forkSharedChat` stays the text-only public projection (D5, D6);
 * - a cross-tenant fork throws + creates nothing (owner-scoped).
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { asc, eq, sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { type Sql } from 'postgres';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopQueryEmbedder } from '../search/chat-search-query-embedder.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';

import * as schema from '../db/schema';
import { type Chat, type Message } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { RunningReplyRepository } from './running-reply-repository';
import { toSharedChatResponse } from './dto/chats.dto';
import { ChatsService } from './chats.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { toStoredMessages } from '../compaction/compaction.service';
import { isRecord } from '@workspace/runtime-safety';
import { buildContext, type StoredMessage } from './context-builder';
import {
  createCompactionCheckpointPart,
  toContextCheckpoint,
} from './context-item-producers';
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
// checkpoint rows, so a fork that lost the latest checkpoint resolves a DIFFERENT
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
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = postgres(TEST_DB_URL!, { ssl, max: 5 });
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

  // Seed a COMPACTED, context-bearing source whose checkpoint rows sit where
  // production publishes them — after the user row that triggered them:
  //   seq 1 q1, 2 a1, 3 q2, 4 presentation row (never copied),
  //   5 C1 (absorbs through 2), 6 a2, 7 q3, 8 C2 (absorbs through 6), 9 a3.
  // Every frozen prompt column is bound to C2 (unless `bindMarkers` is off) and
  // the Chat's creation time precedes both checkpoints. Returns the rows a fork
  // copies, as stored, which is exactly what it has to reproduce.
  const seedCompactedSource = async (
    options: { visibility?: 'private' | 'public'; bindMarkers?: boolean } = {},
  ) => {
    const { bindMarkers = true } = options;
    return tenantDb.runAs(a, async (tx) => {
      const messages = new MessagesRepository(tx);
      const chat = await new ChatsRepository(tx).create({
        ownerUserId: a,
        title: 'Compacted source',
        visibility: options.visibility ?? 'private',
        createdAt: SOURCE_CREATED_AT,
        recencyDigestBaseline: DIGEST_BASELINE,
        recencyDigestTold: DIGEST_TOLD,
        skillCatalogBaseline: SKILL_BASELINE,
        skillCatalogTold: ['research'],
      });
      const checkpoint = async (
        summary: string,
        absorbedThroughSeq: number,
        createdAt: Date,
        inputTokens: number,
      ) => {
        const row = await messages.createCheckpoint({
          chatId: chat.id,
          absorbedThroughSeq,
          part: createCompactionCheckpointPart(summary),
          usage: { model: 'gpt-x', inputTokens },
        });
        await tx.execute(
          dsql`UPDATE messages SET created_at = ${createdAt.toISOString()}::timestamptz WHERE id = ${row.id}`,
        );
        return { ...row, createdAt };
      };

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
          {
            type: 'source-url',
            sourceId: 'prefix-source',
            url: 'https://prefix.example/source',
          },
        ],
      });
      const a1 = await messages.create({
        chatId: chat.id,
        role: 'assistant',
        senderUserId: null,
        // A copy is literal: tool observations and opaque provider metadata
        // ride with the part they are bound to, even inside the absorbed prefix.
        parts: [
          { type: 'text', text: 'a1' },
          {
            type: 'tool-search_conversations',
            toolCallId: 'prefix-call',
            state: 'output-available',
            input: { query: 'prefix' },
            output: { results: ['prefix result'] },
          },
          {
            type: 'reasoning',
            text: 'prefix reasoning',
            providerMetadata: {
              openai: {
                itemId: 'rs-prefix-1',
                reasoningEncryptedContent: 'ENCRYPTED_PREFIX_STATE',
              },
            },
          },
        ],
        usage: { costUsd: 0.25, model: 'gpt-x', runId: 'run-1' },
        inReplyTo: q1.id,
      });
      const q2 = await messages.create({
        chatId: chat.id,
        role: 'user',
        senderUserId: a,
        parts: [{ type: 'text', text: 'q2' }],
      });
      // A row no fork copies, so the later boundary has to move.
      await messages.create({
        chatId: chat.id,
        role: 'system',
        senderUserId: null,
        parts: [{ type: 'text', text: 'internal presentation row' }],
      });
      const first = await checkpoint(
        'Checkpoint 1',
        a1.seq,
        FIRST_CHECKPOINT_CREATED_AT,
        10,
      );
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
      const latest = await checkpoint(
        'Checkpoint 2',
        a2.seq,
        LATEST_CHECKPOINT_CREATED_AT,
        20,
      );
      const a3 = await messages.create({
        chatId: chat.id,
        role: 'assistant',
        senderUserId: null,
        // D17: opaque provider metadata is copied verbatim with its part, and
        // the fork replays its OWN copy — so the model-facing prefix equals its
        // source's at the copied boundary, metadata included.
        parts: [
          {
            type: 'reasoning',
            text: 'live reasoning',
            providerMetadata: {
              openai: {
                itemId: 'rs-live-1',
                reasoningEncryptedContent: 'ENCRYPTED_LIVE_STATE',
              },
            },
          },
          { type: 'text', text: 'a3' },
        ],
        usage: { costUsd: 0.5, model: 'gpt-x', runId: 'run-3' },
        inReplyTo: q3.id,
      });

      if (bindMarkers) {
        await tx.execute(dsql`
          UPDATE chats
          SET recency_digest_rebaked_from = ${latest.id},
              skill_catalog_rebaked_from = ${latest.id}
          WHERE id = ${chat.id} AND owner_user_id = ${a}
        `);
      }
      const bound = await new ChatsRepository(tx).findById(chat.id, a);
      if (bound === undefined) expect.unreachable('expected the seeded chat');

      return {
        chat: bound,
        rows: [q1, a1, q2, first, a2, q3, latest, a3],
        checkpoints: [first, latest],
      };
    });
  };

  const readMessages = (chatId: string, userId = a) =>
    tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );

  // The two reads a turn after the fork makes (as `rebuildContextForChat`
  // does): the active checkpoint, then every row past its boundary.
  const replayWindow = (chatId: string) =>
    tenantDb.runAs(a, async (tx) => {
      const messages = new MessagesRepository(tx);
      const checkpoint = await messages.findActiveCheckpoint(chatId, a, {
        beforeSeq: Number.MAX_SAFE_INTEGER,
      });
      const history = await messages.findByChatId(chatId, a, {
        sinceSeq: checkpoint?.absorbedThroughSeq,
      });
      return { checkpoint, history };
    });

  // The system prompt a turn after the fork sends, rendered by the PRODUCTION
  // template renderer from ONE side's own stored state. The anchor resolution
  // mirrors run-execution.service.ts: the active checkpoint row's creation
  // time wins over the chat's.
  const renderFirstTurnSystemPrompt = (
    chat: Chat,
    checkpoint: Message | undefined,
  ) =>
    renderSystemPromptTemplate({
      template: readFileSync(DEFAULT_CHAT_SYSTEM_PROMPT_PATH, 'utf8'),
      model: { id: 'system:fork:test', name: 'Fork Test' },
      anchor: formatTemporalAnchor(
        checkpoint?.createdAt ?? chat.createdAt,
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
  const skillStateFor = (chat: Chat, latestCheckpointId: string | null) =>
    resolveTurnSkillState(
      { skillCatalog: LIVE_CATALOG, skillDirectories: ['/skills'] },
      {
        chat,
        runId: crypto.randomUUID(),
        latestCheckpointId,
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

  // Source `U1 A1 U2 A2` plus an accepted `U3` whose Run has dispatched: its
  // reply is `running`, with partial output and a stored in-Run item.
  const seedInFlightRun = async () => {
    const seeded = await seedChat(a);
    return tenantDb.runAs(a, async (tx) => {
      const messages = new MessagesRepository(tx);
      const user3 = await messages.create({
        chatId: seeded.chatId,
        role: 'user',
        senderUserId: a,
        parts: [{ type: 'text', text: 'q3' }],
      });
      const replies = new RunningReplyRepository(tx);
      const reply = await replies.upsertRunningReply({
        chatId: seeded.chatId,
        inReplyTo: user3.id,
        usage: {
          status: 'running',
          complete: false,
          runId: '33333333-3333-4333-8333-333333333333',
          attemptId: '44444444-4444-4444-8444-444444444444',
          modelId: 'model-a',
        },
      });
      if (reply === undefined) expect.unreachable('expected a running reply');
      const stored = await replies.updateRunningReplyParts({
        chatId: seeded.chatId,
        inReplyTo: user3.id,
        attemptId: '44444444-4444-4444-8444-444444444444',
        parts: [
          {
            type: 'data-context',
            data: {
              v: 1,
              producer: 'instructions',
              form: 'snapshot',
              runId: '33333333-3333-4333-8333-333333333333',
              payload: { files: [] },
              text: 'IN_RUN_ITEM',
            },
          },
          { type: 'text', text: 'PARTIAL_OUTPUT' },
        ],
      });
      expect(stored).toBe(true);
      return { ...seeded, user3Id: user3.id, replyId: reply.id };
    });
  };

  it('a whole-chat fork during a Run copies the accepted user turn but not its running reply', async () => {
    const source = await seedInFlightRun();

    const forked = await service.forkChat(source.chatId, a, undefined);

    const copied = await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).findByChatId(forked.id, a),
    );
    expect(copied.map((m) => textOf(m.parts))).toEqual([
      'q1',
      'a1',
      'q2',
      'a2',
      'q3',
    ]);
    // Not merely hidden on read: the destination holds no assistant row for U3.
    const destinationRows = await tenantDb.runAs(a, (tx) =>
      tx
        .select({ role: schema.messages.role })
        .from(schema.messages)
        .where(eq(schema.messages.chatId, forked.id))
        .orderBy(asc(schema.messages.seq)),
    );
    expect(destinationRows.map(({ role }) => role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(JSON.stringify(copied)).not.toContain('PARTIAL_OUTPUT');
    expect(JSON.stringify(copied)).not.toContain('IN_RUN_ITEM');

    // The Run's later settlement lands on the source reply only.
    await tenantDb.runAs(a, (tx) =>
      new MessagesRepository(tx).updateAssistantReply({
        id: source.replyId,
        chatId: source.chatId,
        inReplyTo: source.user3Id,
        parts: [{ type: 'text', text: 'a3' }],
        usage: { status: 'completed', modelId: 'model-a' },
      }),
    );
    const [sourceAfter, forkAfter] = await tenantDb.runAs(a, async (tx) => [
      await new MessagesRepository(tx).findByChatId(source.chatId, a),
      await new MessagesRepository(tx).findByChatId(forked.id, a),
    ]);
    expect(sourceAfter.map((m) => textOf(m.parts)).at(-1)).toBe('a3');
    expect(forkAfter.map((m) => textOf(m.parts))).toEqual([
      'q1',
      'a1',
      'q2',
      'a2',
      'q3',
    ]);
  });

  it('an anchor naming a running reply is not found and creates nothing', async () => {
    const source = await seedInFlightRun();
    const readSource = () =>
      tenantDb.runAs(a, async (tx) => ({
        ownedChats: await tx
          .select({ id: schema.chats.id })
          .from(schema.chats)
          .where(eq(schema.chats.ownerUserId, a)),
        rows: await tx
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.chatId, source.chatId))
          .orderBy(asc(schema.messages.seq)),
      }));
    const before = await readSource();

    await expect(
      service.forkChat(source.chatId, a, source.replyId),
    ).rejects.toThrow('Fork-point message not found in this chat');

    expect(await readSource()).toEqual(before);
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

  it('forks a compacted, baseline-bearing source into the same model-facing prefix', async () => {
    const source = await seedCompactedSource();

    const forked = await service.forkChat(source.chat.id, a);

    const copiedMessages = await readMessages(forked.id);
    expect(copiedMessages).toHaveLength(source.rows.length);
    const copiedIdBySourceId = new Map(
      source.rows.map((row, index) => [row.id, copiedMessages[index].id]),
    );
    copiedMessages.forEach((copied, index) => {
      const original = source.rows[index];
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
        original.inReplyTo === null
          ? null
          : copiedIdBySourceId.get(original.inReplyTo),
      );
    });

    // Each checkpoint's boundary names the COPY of the row it absorbed through.
    // The presentation row is not copied, so the later boundary moves from
    // source seq 6 to copied seq 5 while the earlier one stays at 2.
    const copiedCheckpoints = copiedMessages.filter(
      (message) => message.role === 'checkpoint',
    );
    expect(source.checkpoints.map((c) => c.absorbedThroughSeq)).toEqual([2, 6]);
    expect(copiedCheckpoints.map((c) => c.absorbedThroughSeq)).toEqual([2, 5]);
    const copiedLatest = copiedCheckpoints.at(-1);
    if (copiedLatest === undefined) {
      expect.unreachable('expected copied checkpoints');
    }

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
    // ...with the two markers naming the COPIED checkpoint message. The skill
    // marker is what `baselineMatchesEpoch` compares against the chat's active
    // checkpoint, so a source id (or a null beside a copied baseline) would
    // re-resolve the live catalog on the fork's first turn.
    expect(source.chat.skillCatalogRebakedFrom).toBe(source.checkpoints[1].id);
    expect(forked.recencyDigestRebakedFrom).toBe(copiedLatest.id);
    expect(forked.skillCatalogRebakedFrom).toBe(copiedLatest.id);
    // Non-vacuous: the inherited context is the seeded content, not two NULLs.
    expect(forked.recencyDigestBaseline).toEqual(DIGEST_BASELINE);
    expect(forked.skillCatalogBaseline).toEqual(SKILL_BASELINE);

    // The checkpoint UI's absorbed counts are API-computed from the boundaries:
    // the fork reports what its source does (2 rows through each boundary).
    const [sourceRead, forkRead] = await Promise.all([
      service.getChatMessages(source.chat.id, a, { limit: 50 }),
      service.getChatMessages(forked.id, a, { limit: 50 }),
    ]);
    const absorbedCounts = (read: typeof sourceRead) =>
      read
        ?.filter((message) => message.role === 'checkpoint')
        .map((message) => message.absorbedMessageCount);
    expect(absorbedCounts(sourceRead)).toEqual([2, 2]);
    expect(absorbedCounts(forkRead)).toEqual(absorbedCounts(sourceRead));

    const [sourceWindow, forkWindow] = await Promise.all([
      replayWindow(source.chat.id),
      replayWindow(forked.id),
    ]);
    if (
      sourceWindow.checkpoint === undefined ||
      forkWindow.checkpoint === undefined
    ) {
      expect.unreachable('expected an active checkpoint on both sides');
    }
    expect(sourceWindow.checkpoint.id).toBe(source.checkpoints[1].id);
    expect(forkWindow.checkpoint.id).toBe(copiedLatest.id);
    expect(
      sourceWindow.history.filter(({ role }) => role !== 'checkpoint'),
    ).toHaveLength(2);

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
          sourceWindow.checkpoint,
        ),
        requestKind: 'continuation',
        checkpoint: toContextCheckpoint(sourceWindow.checkpoint),
      },
    );
    const forkContext = buildContext(
      [...toStoredMessages(forkWindow.history), forkInput],
      {
        systemPrompt: renderFirstTurnSystemPrompt(
          forked,
          forkWindow.checkpoint,
        ),
        requestKind: 'continuation',
        checkpoint: toContextCheckpoint(forkWindow.checkpoint),
      },
    );

    // Guard against a vacuous comparison: the source's own prompt really does
    // carry the inherited digest and catalog.
    expect(sourceContext.system).toContain('Digest source');
    expect(sourceContext.system).toContain('Plan research');
    // Equal system prompt: the same temporal anchor (the copied checkpoint's
    // creation time, not the fork's own), the same digest, the same catalog.
    expect(forkContext.system).toBe(sourceContext.system);
    // Equal inherited history: the stored checkpoint text leads, the retained
    // tail follows (checkpoint rows are never replayed as ordinary rows), then
    // the identical new input.
    expect(forkContext.messages).toEqual(sourceContext.messages);
    // Non-vacuous for the metadata half: the retained tail's reasoning part is
    // there with its opaque provider metadata, replayed from the FORK's copied
    // part (D17) — a projection that dropped either side would still compare
    // equal to its source, so pin the fork's own request content.
    expect(forkContext.messages).toContainEqual({
      role: 'assistant',
      content: [
        {
          type: 'reasoning',
          text: 'live reasoning',
          providerOptions: {
            openai: {
              itemId: 'rs-live-1',
              reasoningEncryptedContent: 'ENCRYPTED_LIVE_STATE',
            },
          },
        },
        { type: 'text', text: 'a3' },
      ],
    });
  });

  it('an anchor before the latest checkpoint copies only the earlier one and keeps the baseline bound to it', async () => {
    const source = await seedCompactedSource();
    // seq 3 (q2) sits before BOTH checkpoint rows (seq 5 and 8), but C1
    // absorbs through seq 2 — inside the copied prefix — while C2 (through
    // seq 6, the one both markers name) is not.
    const anchor = source.rows[2];

    const forked = await service.forkChat(source.chat.id, a, anchor.id);

    const copiedMessages = await readMessages(forked.id);
    expect(copiedMessages.map(({ role }) => role)).toEqual([
      'user',
      'assistant',
      'user',
      'checkpoint',
    ]);
    expect(copiedMessages.map(({ seq }) => seq)).toEqual([1, 2, 3, 4]);
    const copiedEarlier = copiedMessages[3];
    expect(copiedEarlier.absorbedThroughSeq).toBe(
      source.checkpoints[0].absorbedThroughSeq,
    );
    expect(copiedEarlier.parts).toEqual(source.checkpoints[0].parts);
    expect(copiedEarlier.id).not.toBe(source.checkpoints[0].id);

    // The copied earlier checkpoint is the fork's ACTIVE one...
    const { checkpoint: active } = await replayWindow(forked.id);
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
    const { checkpoint: active } = await replayWindow(forked.id);
    const sourceLatest = source.checkpoints.at(-1);
    if (active === undefined || sourceLatest === undefined) {
      expect.unreachable('expected a checkpoint on both sides');
    }

    // The source holds a baseline whose marker is NULL while a checkpoint
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

  it('owner forks copy the active binding but not narration or detach state', async () => {
    const source = await seedChat(a);
    await tenantDb.runAs(a, (tx) =>
      tx.execute(dsql`
        UPDATE chats
        SET workspace_root = '/work/project',
            workspace_executor_id = 'worker-a',
            workspace_generation = 4,
            workspace_told = NULL,
            workspace_told_from = NULL,
            workspace_detach_reason = NULL
        WHERE id = ${source.chatId} AND owner_user_id = ${a}
      `),
    );

    const forked = await service.forkChat(source.chatId, a);

    expect(forked.workspaceRoot).toBe('/work/project');
    expect(forked.workspaceExecutorId).toBe('worker-a');
    expect(forked.workspaceGeneration).toBe(4);
    expect(forked.workspaceTold).toBeNull();
    expect(forked.workspaceToldFrom).toBeNull();
    expect(forked.workspaceDetachReason).toBeNull();
  });

  it('owner forks a detached Chat without restoring its Workspace binding', async () => {
    const source = await seedChat(a);
    await tenantDb.runAs(a, (tx) =>
      tx.execute(dsql`
        UPDATE chats
        SET workspace_root = NULL,
            workspace_executor_id = NULL,
            workspace_generation = 5,
            workspace_told = '/work/project',
            workspace_told_from = '33333333-3333-4333-8333-333333333333',
            workspace_detach_reason = 'root_missing'
        WHERE id = ${source.chatId} AND owner_user_id = ${a}
      `),
    );

    const forked = await service.forkChat(source.chatId, a);

    expect(forked.workspaceRoot).toBeNull();
    expect(forked.workspaceExecutorId).toBeNull();
    expect(forked.workspaceGeneration).toBe(5);
    expect(forked.workspaceTold).toBeNull();
    expect(forked.workspaceToldFrom).toBeNull();
    expect(forked.workspaceDetachReason).toBeNull();
  });

  it('forkSharedChat stays text-only — no checkpoint, context, usage, or copied creation time', async () => {
    const source = await seedCompactedSource({ visibility: 'public' });
    await tenantDb.runAs(a, (tx) =>
      tx.execute(dsql`
        UPDATE chats
        SET workspace_root = '/work/public',
            workspace_executor_id = 'worker-a',
            workspace_generation = 9,
            workspace_told = '/work/public',
            workspace_told_from = '22222222-2222-4222-8222-222222222222',
            workspace_detach_reason = 'root_moved'
        WHERE id = ${source.chat.id} AND owner_user_id = ${a}
      `),
    );

    const shared = await service.getSharedChat(source.chat.id);
    if (shared === undefined) expect.unreachable('expected a public chat');
    const sharedResponse = toSharedChatResponse(shared.chat, shared.messages);
    expect(sharedResponse).not.toHaveProperty('workspaceRoot');
    expect(JSON.stringify(sharedResponse)).not.toContain('/work/public');
    const forked = await service.forkSharedChat(source.chat.id, b);
    if (forked === undefined) expect.unreachable('expected a public fork');
    // A new PRIVATE chat: sharing the source must never share the visitor's
    // own fork of it.
    expect(forked.visibility).toBe('private');

    const copiedMessages = await readMessages(forked.id, b);
    const transcript = source.rows.filter(({ role }) => role !== 'checkpoint');
    // The transcript comes across...
    expect(copiedMessages).toHaveLength(transcript.length);
    // ...but none of the owner's context: no checkpoint row or summary, no
    // copied usage, no frozen baseline or marker, and a creation time of its
    // own.
    expect(copiedMessages.map(({ role }) => role)).not.toContain('checkpoint');
    expect(JSON.stringify(copiedMessages)).not.toContain('Checkpoint');
    expect(copiedMessages.map(({ usage }) => usage)).toEqual(
      transcript.map(() => null),
    );
    expect({
      recencyDigestBaseline: forked.recencyDigestBaseline,
      recencyDigestTold: forked.recencyDigestTold,
      recencyDigestRebakedFrom: forked.recencyDigestRebakedFrom,
      skillCatalogBaseline: forked.skillCatalogBaseline,
      skillCatalogTold: forked.skillCatalogTold,
      skillCatalogRebakedFrom: forked.skillCatalogRebakedFrom,
      workspaceRoot: forked.workspaceRoot,
      workspaceExecutorId: forked.workspaceExecutorId,
      workspaceGeneration: forked.workspaceGeneration,
      workspaceTold: forked.workspaceTold,
      workspaceToldFrom: forked.workspaceToldFrom,
      workspaceDetachReason: forked.workspaceDetachReason,
    }).toEqual({
      recencyDigestBaseline: null,
      recencyDigestTold: null,
      recencyDigestRebakedFrom: null,
      skillCatalogBaseline: null,
      skillCatalogTold: null,
      skillCatalogRebakedFrom: null,
      workspaceRoot: null,
      workspaceExecutorId: null,
      workspaceGeneration: 0,
      workspaceTold: null,
      workspaceToldFrom: null,
      workspaceDetachReason: null,
    });
    expect(forked.createdAt.getTime()).toBeGreaterThan(
      source.chat.createdAt.getTime(),
    );
  });
});
