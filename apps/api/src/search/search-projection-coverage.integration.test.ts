/**
 * Projection locator readiness and RLS (conversation provenance, task 2.6).
 *
 * TEST_DATABASE_URL-gated; run by test:integration. The suite proves that the
 * cross-tenant discovery function finds a current-version row whose locator is
 * incomplete, that a giant multi-part message converges through the normal
 * reindex writer, and that direct projection reads/writes remain tenant-owned.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import * as schema from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { CHUNKER_VERSION } from './chat/conversation-chunker';
import { getProjectionCoverageReport } from './operations/projection-coverage';
import { SearchIndexService } from './search-index.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const TEST_UNPRIVILEGED_DB_URL = process.env['TEST_UNPRIVILEGED_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;

describeIfDb('search projection locator coverage and RLS', () => {
  let sqlClient: SqlClient;
  let tenantDb: TenantDbService;
  let indexService: SearchIndexService;
  let ownerA: string;
  let ownerB: string;

  const textPart = (value: string) => ({ type: 'text', text: value });

  async function seedChat(
    ownerUserId: string,
    parts: unknown[],
    title = 'Projection coverage',
  ): Promise<string> {
    const chatId = crypto.randomUUID();
    await tenantDb.runAs(ownerUserId, async (tx) => {
      const chats = new ChatsRepository(tx);
      const messages = new MessagesRepository(tx);
      await chats.createIfAbsent({ id: chatId, ownerUserId, title });
      await messages.create({
        chatId,
        role: 'assistant',
        senderUserId: null,
        parts,
        usage: { status: 'completed' },
      });
    });
    return chatId;
  }

  const documentRowsAs = (ownerUserId: string, chatId: string) =>
    tenantDb
      .runAs(ownerUserId, (tx) =>
        tx.execute(sql`
          SELECT chunker_version, first_message_id, last_message_id,
                 first_message_text_offset, last_message_text_offset_exclusive,
                 content
          FROM search_chat_documents
          WHERE chat_id = ${chatId}
          ORDER BY chunk_ordinal
        `),
      )
      .then((rows) =>
        z
          .object({
            chunker_version: z.number(),
            first_message_id: z.string(),
            last_message_id: z.string(),
            first_message_text_offset: z.number().nullable(),
            last_message_text_offset_exclusive: z.number().nullable(),
            content: z.string(),
          })
          .array()
          .parse([...rows]),
      );

  const expectedDocumentCountAs = (ownerUserId: string, chatId: string) =>
    tenantDb
      .runAs(ownerUserId, (tx) =>
        tx.execute<{ expected_document_count: number | null }>(sql`
          SELECT expected_document_count
          FROM search_chat_state
          WHERE chat_id = ${chatId}
        `),
      )
      .then((rows) => [...rows][0]?.expected_document_count ?? null);

  const staleIds = () =>
    tenantDb
      .runAsPublic((tx) =>
        tx.execute<{ chat_id: string }>(sql`
          SELECT chat_id
          FROM llame_search_projection_stale_chats_v2(${CHUNKER_VERSION}, 1000)
        `),
      )
      .then((rows) => [...rows].map((row) => row.chat_id));

  beforeAll(async () => {
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sqlClient = connect(TEST_DB_URL!, { ssl, max: 5 });
    tenantDb = new TenantDbService(drizzle(sqlClient, { schema }));
    indexService = new SearchIndexService(tenantDb);
    ownerA = crypto.randomUUID();
    ownerB = crypto.randomUUID();
    for (const id of [ownerA, ownerB]) {
      await sqlClient`INSERT INTO users (id, name, email) VALUES (${id}, 'Projection', ${`projection-${id}@test.com`})`;
    }
  });

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient`DELETE FROM users WHERE id IN (${ownerA}, ${ownerB})`;
      await sqlClient.end();
    }
  });

  it('reindexes a giant multi-part message with complete locators on every current row', async () => {
    const parts: unknown[] = [];
    for (let index = 0; index < 8; index += 1) {
      parts.push(
        textPart(
          `part-${index} ` +
            Array.from(
              { length: 180 },
              (_, word) => `line-${index}-${word}`,
            ).join(' '),
        ),
      );
      parts.push({ type: 'reasoning', text: `hidden reasoning ${index}` });
      parts.push({
        type: 'tool-call',
        toolCallId: `tool-${index}`,
        toolName: 'hidden_tool',
        args: { index },
      });
    }
    const chatId = await seedChat(ownerA, parts, 'Giant multi-part source');

    await indexService.reindexChat(chatId, ownerA);

    const rows = await documentRowsAs(ownerA, chatId);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((row) => row.chunker_version === CHUNKER_VERSION)).toBe(
      true,
    );
    expect(
      rows.every(
        (row) =>
          row.first_message_text_offset !== null &&
          row.last_message_text_offset_exclusive !== null,
      ),
    ).toBe(true);
    expect(await expectedDocumentCountAs(ownerA, chatId)).toBe(rows.length);
    expect(rows.some((row) => row.content.includes('hidden reasoning'))).toBe(
      false,
    );
    expect(await staleIds()).not.toContain(chatId);
  });

  it('reports and discovers an incomplete current locator, then clears it after reindex', async () => {
    const chatId = await seedChat(
      ownerA,
      [textPart('a source that needs a locator repair')],
      'Locator repair coverage',
    );
    await indexService.reindexChat(chatId, ownerA);
    const before = await getProjectionCoverageReport(tenantDb, CHUNKER_VERSION);

    await tenantDb.runAs(ownerA, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents
        SET first_message_text_offset = NULL
        WHERE chat_id = ${chatId}
      `),
    );

    expect(await staleIds()).toContain(chatId);
    const incomplete = await getProjectionCoverageReport(
      tenantDb,
      CHUNKER_VERSION,
    );
    expect(incomplete.readyChatCount).toBe(before.readyChatCount - 1);
    expect(incomplete.staleChatCount).toBe(before.staleChatCount + 1);
    expect(incomplete.completeDocumentCount).toBe(
      before.completeDocumentCount - 1,
    );

    await indexService.reindexChat(chatId, ownerA);

    expect(await staleIds()).not.toContain(chatId);
    await expect(
      getProjectionCoverageReport(tenantDb, CHUNKER_VERSION),
    ).resolves.toEqual(before);
    const [row] = await documentRowsAs(ownerA, chatId);
    expect(row.first_message_text_offset).not.toBeNull();
    expect(row.last_message_text_offset_exclusive).not.toBeNull();
  });

  it('marks a ready chat stale when source freshness advances without a reindex', async () => {
    const chatId = await seedChat(
      ownerA,
      [textPart('freshness must be reflected in the readiness gate')],
      'Freshness gate',
    );
    await indexService.reindexChat(chatId, ownerA);
    const before = await getProjectionCoverageReport(tenantDb, CHUNKER_VERSION);
    expect(await staleIds()).not.toContain(chatId);

    await tenantDb.runAs(ownerA, (tx) =>
      tx.execute(sql`
        UPDATE chats
        SET updated_at = updated_at + interval '1 second'
        WHERE id = ${chatId}
      `),
    );

    expect(await staleIds()).toContain(chatId);
    const stale = await getProjectionCoverageReport(tenantDb, CHUNKER_VERSION);
    expect(stale.readyChatCount).toBe(before.readyChatCount - 1);
    expect(stale.staleChatCount).toBe(before.staleChatCount + 1);

    await indexService.reindexChat(chatId, ownerA);
    expect(await staleIds()).not.toContain(chatId);
  });

  it('marks a deleted current document stale and repairs it on reindex', async () => {
    const chatId = await seedChat(
      ownerA,
      [textPart('deleting the only current document must not look ready')],
      'Deleted projection row',
    );
    await indexService.reindexChat(chatId, ownerA);
    const before = await getProjectionCoverageReport(tenantDb, CHUNKER_VERSION);
    const readyRows = await documentRowsAs(ownerA, chatId);
    expect(readyRows).toHaveLength(1);
    expect(await expectedDocumentCountAs(ownerA, chatId)).toBe(1);

    await tenantDb.runAs(ownerA, (tx) =>
      tx.execute(sql`
        DELETE FROM search_chat_documents
        WHERE chat_id = ${chatId}
      `),
    );

    expect(await staleIds()).toContain(chatId);
    const stale = await getProjectionCoverageReport(tenantDb, CHUNKER_VERSION);
    expect(stale.readyChatCount).toBe(before.readyChatCount - 1);
    expect(stale.staleChatCount).toBe(before.staleChatCount + 1);
    expect(stale.documentCount).toBe(before.documentCount - 1);

    await indexService.reindexChat(chatId, ownerA);
    expect(await staleIds()).not.toContain(chatId);
    await expect(
      getProjectionCoverageReport(tenantDb, CHUNKER_VERSION),
    ).resolves.toEqual(before);
    await expect(documentRowsAs(ownerA, chatId)).resolves.toHaveLength(1);
  });

  it('treats a zero-document chat with expected count zero as ready', async () => {
    const chatId = await seedChat(
      ownerA,
      [{ type: 'tool-call', toolCallId: 'not-searchable' }],
      'Zero-document chat',
    );
    const before = await getProjectionCoverageReport(tenantDb, CHUNKER_VERSION);
    await indexService.reindexChat(chatId, ownerA);

    expect(await documentRowsAs(ownerA, chatId)).toEqual([]);
    const state = await tenantDb.runAs(ownerA, (tx) =>
      tx.execute<{ expected_document_count: number }>(sql`
        SELECT expected_document_count
        FROM search_chat_state
        WHERE chat_id = ${chatId}
      `),
    );
    expect([...state][0].expected_document_count).toBe(0);
    expect(await staleIds()).not.toContain(chatId);
    const after = await getProjectionCoverageReport(tenantDb, CHUNKER_VERSION);
    expect(after.readyChatCount).toBe(before.readyChatCount + 1);
    expect(after.staleChatCount).toBe(before.staleChatCount - 1);
  });

  it('treats a current-version state row with a null legacy expected count as stale', async () => {
    const chatId = await seedChat(
      ownerA,
      [textPart('legacy state has no expected document count')],
      'Legacy expected count',
    );
    await indexService.reindexChat(chatId, ownerA);
    const before = await getProjectionCoverageReport(tenantDb, CHUNKER_VERSION);

    await tenantDb.runAs(ownerA, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_state
        SET expected_document_count = NULL
        WHERE chat_id = ${chatId}
      `),
    );

    expect(await staleIds()).toContain(chatId);
    const stale = await getProjectionCoverageReport(tenantDb, CHUNKER_VERSION);
    expect(stale.readyChatCount).toBe(before.readyChatCount - 1);
    expect(stale.staleChatCount).toBe(before.staleChatCount + 1);
  });

  it('returns only aggregate fields from the coverage report', async () => {
    const rows = await tenantDb.runAsPublic((tx) =>
      tx.execute(
        sql`SELECT * FROM llame_search_projection_coverage_v2(${CHUNKER_VERSION})`,
      ),
    );
    expect(Object.keys([...rows][0] ?? {}).sort()).toEqual(
      [
        'chunker_version',
        'chat_count',
        'ready_chat_count',
        'stale_chat_count',
        'document_count',
        'complete_document_count',
      ].sort(),
    );
  });

  it('denies direct projection reads and writes in both cross-tenant directions', async () => {
    const chatA = await seedChat(ownerA, [textPart('owner A source')], 'A');
    const chatB = await seedChat(ownerB, [textPart('owner B source')], 'B');
    await indexService.reindexChat(chatA, ownerA);
    await indexService.reindexChat(chatB, ownerB);

    const countAs = (caller: string, chatId: string) =>
      tenantDb
        .runAs(caller, (tx) =>
          tx.execute<{ count: number }>(sql`
            SELECT count(*)::int AS count
            FROM search_chat_documents
            WHERE chat_id = ${chatId}
          `),
        )
        .then((rows) => [...rows][0].count);

    expect(await countAs(ownerA, chatB)).toBe(0);
    expect(await countAs(ownerB, chatA)).toBe(0);
    expect(
      await tenantDb
        .runAsPublic((tx) =>
          tx.execute<{ count: number }>(sql`
            SELECT count(*)::int AS count
            FROM search_chat_documents
            WHERE chat_id IN (${chatA}, ${chatB})
          `),
        )
        .then((rows) => [...rows][0].count),
    ).toBe(0);

    await tenantDb.runAs(ownerA, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents
        SET content = 'cross-tenant write'
        WHERE chat_id = ${chatB}
      `),
    );
    await tenantDb.runAs(ownerB, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents
        SET content = 'cross-tenant write'
        WHERE chat_id = ${chatA}
      `),
    );

    expect((await documentRowsAs(ownerA, chatA))[0].content).toContain(
      'owner A source',
    );
    expect((await documentRowsAs(ownerB, chatB))[0].content).toContain(
      'owner B source',
    );
  });

  it('does not leave the aggregate discovery function executable by PUBLIC', async () => {
    const aclRows = await sqlClient`
      SELECT p.proname,
             has_function_privilege('public', p.oid, 'EXECUTE') AS can_execute,
             r.rolbypassrls AS bypass
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname IN (
        'llame_search_projection_stale_chats_v2',
        'llame_search_projection_coverage_v2'
      )
      ORDER BY p.proname
    `;
    expect(aclRows).toEqual([
      {
        proname: 'llame_search_projection_coverage_v2',
        can_execute: false,
        bypass: true,
      },
      {
        proname: 'llame_search_projection_stale_chats_v2',
        can_execute: false,
        bypass: true,
      },
    ]);

    if (!TEST_UNPRIVILEGED_DB_URL) return;
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_UNPRIVILEGED_DB_URL)
      ? 'require'
      : false;
    const unprivileged = connect(TEST_UNPRIVILEGED_DB_URL, { ssl, max: 1 });
    try {
      await expect(
        unprivileged.unsafe(
          `SELECT * FROM llame_search_projection_coverage_v2(${CHUNKER_VERSION})`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await unprivileged.end();
    }
  });
});
