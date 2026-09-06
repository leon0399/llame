/**
 * Search projection pipeline (SearchIndexService + the discovery function) on a
 * live DB (RLS), #195:
 * - reindex populates search_chat_documents; an unchanged reindex is a hash no-op;
 * - two sequential reindexes of the same chat converge (idempotent rebuild);
 * - search_chat_state.indexed_at only ever advances (monotonic watermark);
 * - editing a message rebuilds the covering chunk (new hash + content);
 * - deleting the chat cascades the projection away;
 * - llame_search_stale_chats flags un-indexed / version-stale chats, ignores
 *   fresh ones, and returns ONLY identifiers + timestamps (never content).
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { z } from 'zod';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { CHUNKER_VERSION } from './chat/conversation-chunker';
import { SearchIndexService } from './search-index.service';
import { type UnknownRecord } from '@workspace/runtime-safety';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = ReturnType<typeof postgres>;
const text = (t: string) => [{ type: 'text', text: t }];

describeIfDb('search projection — SearchIndexService + discovery', () => {
  let sqlClient: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let indexService: SearchIndexService;
  let u: string;

  // search_chat_documents / search_chat_state / messages are FORCE RLS — a raw client
  // has no identity and would see zero rows, so every projection read runs under
  // the owner's runAs.
  const docCount = (chatId: string): Promise<number> =>
    tenantDb
      .runAs(u, (tx) =>
        tx.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM search_chat_documents WHERE chat_id = ${chatId}`,
        ),
      )
      .then((rows) => [...rows][0].n);
  // Run an owner-scoped read of an RLS-protected table, validating each row
  // against the caller-supplied schema. Raw SQL rows are untyped at the
  // driver boundary — Zod parsing is real runtime evidence for the shape,
  // not a compile-time-only assertion, and throws on a malformed row.
  const ownedRows = <T extends UnknownRecord>(
    frag: ReturnType<typeof sql>,
    rowSchema: z.ZodType<T>,
  ): Promise<Array<T>> =>
    tenantDb
      .runAs(u, (tx) => tx.execute(frag))
      .then((rows) => rowSchema.array().parse([...rows]));
  const staleIds = (): Promise<Array<string>> =>
    tenantDb
      .runAsPublic((tx) =>
        tx.execute<{ chat_id: string }>(sql`
          SELECT chat_id FROM llame_search_stale_chats(${CHUNKER_VERSION}, 1000)`),
      )
      .then((rows) => [...rows].map((r) => r.chat_id));
  // chat-search-embeddings, design D10 — cross-tenant embedding-lag discovery.
  type CoverageRow = {
    chat_id: string;
    owner_user_id: string;
    outstanding_count: number;
    embedded_count: number;
    failed_count: number;
  };
  const embeddingCoverage = (
    modelKey: string,
    inputVersion: number,
  ): Promise<Array<CoverageRow>> =>
    tenantDb
      .runAsPublic((tx) =>
        tx.execute<CoverageRow>(sql`
          SELECT * FROM llame_search_embedding_coverage(${modelKey}, ${inputVersion}, 1000)`),
      )
      .then((rows) => [...rows]);

  async function seed(
    title: string,
    msgs: Array<{
      role: 'user' | 'assistant';
      text?: string;
      parts?: Array<unknown>;
      usage?: unknown;
    }>,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await tenantDb.runAs(u, async (tx) => {
      const chats = new ChatsRepository(tx);
      const messages = new MessagesRepository(tx);
      await chats.createIfAbsent({ id, ownerUserId: u, title });
      for (const m of msgs) {
        await messages.create({
          chatId: id,
          role: m.role,
          senderUserId: m.role === 'user' ? u : null,
          parts: m.parts ?? text(m.text ?? ''),
          usage: m.usage,
        });
      }
    });
    return id;
  }

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sqlClient = postgres(TEST_DB_URL!, { ssl, max: 3 });
    db = drizzle(sqlClient, { schema });
    tenantDb = new TenantDbService(db);
    indexService = new SearchIndexService(tenantDb);
    u = crypto.randomUUID();
    await sqlClient`INSERT INTO users (id, name, email) VALUES (${u}, 'P', ${`p-${u}@t.com`})`;
  });

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient`DELETE FROM users WHERE id = ${u}`;
      await sqlClient.end();
    }
  });

  it('populates the projection and records chat state', async () => {
    const id = await seed('Indexing', [{ role: 'user', text: 'hello world' }]);
    await indexService.reindexChat(id, u);
    expect(await docCount(id)).toBeGreaterThan(0);
    const state = await ownedRows(
      sql`SELECT chunker_version FROM search_chat_state WHERE chat_id = ${id}`,
      z.object({ chunker_version: z.number() }),
    );
    expect(state[0].chunker_version).toBe(CHUNKER_VERSION);
  });

  it('keeps role labels in snippet content but out of lexical projection data', async () => {
    const id = await seed('Roles', [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'answer-1' },
    ]);
    await indexService.reindexChat(id, u);
    const [row] = await ownedRows(
      sql`
      SELECT content, normalized_content, fts::text AS fts
      FROM search_chat_documents WHERE chat_id = ${id}`,
      z.object({
        content: z.string(),
        normalized_content: z.string(),
        fts: z.string(),
      }),
    );
    expect(row.content).toBe('[user] hello\n\n[assistant] answer-1');
    expect(row.normalized_content).toBe('hello answer-1');
    expect(row.fts).not.toContain('user');
    expect(row.fts).not.toContain('assistant');
  });

  it('persists current visible-text locator offsets on projection rows', async () => {
    const id = await seed('Locator offsets', [
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'alpha' },
          { type: 'reasoning', text: 'hidden' },
          { type: 'text', text: 'beta' },
        ],
      },
    ]);
    await indexService.reindexChat(id, u);
    const [row] = await ownedRows(
      sql`
      SELECT content, first_message_text_offset, last_message_text_offset_exclusive
      FROM search_chat_documents
      WHERE chat_id = ${id}
      ORDER BY chunk_ordinal
      LIMIT 1`,
      z.object({
        content: z.string(),
        first_message_text_offset: z.number(),
        last_message_text_offset_exclusive: z.number(),
      }),
    );
    expect(row).toEqual({
      content: '[user] alpha\n\nbeta',
      first_message_text_offset: 0,
      last_message_text_offset_exclusive: 'alpha\n\nbeta'.length,
    });
  });

  it('excludes retryable assistant bytes from live projection rows', async () => {
    const id = await seed('Retryable assistant excluded', [
      { role: 'user', text: 'stable prompt' },
      {
        role: 'assistant',
        text: 'unstable answer that must stay out of search',
        usage: { status: 'error' },
      },
    ]);
    await indexService.reindexChat(id, u);
    const rows = await ownedRows(
      sql`
      SELECT content, normalized_content
      FROM search_chat_documents
      WHERE chat_id = ${id}
      ORDER BY chunk_ordinal`,
      z.object({
        content: z.string(),
        normalized_content: z.string(),
      }),
    );
    expect(rows).toEqual([
      {
        content: '[user] stable prompt',
        normalized_content: 'stable prompt',
      },
    ]);
  });

  it('removes bytes from a row that becomes retryable on reindex', async () => {
    const id = await seed('Retryable assistant removed', [
      { role: 'user', text: 'stable prompt' },
      {
        role: 'assistant',
        text: 'temporary answer that was indexed before retry',
        usage: { status: 'completed' },
      },
    ]);
    await indexService.reindexChat(id, u);
    const [{ id: assistantId }] = await ownedRows(
      sql`SELECT id FROM messages WHERE chat_id = ${id} AND role = 'assistant'`,
      z.object({ id: z.string() }),
    );
    expect(
      (
        await ownedRows(
          sql`SELECT content FROM search_chat_documents WHERE chat_id = ${id}`,
          z.object({ content: z.string() }),
        )
      )[0].content,
    ).toContain('temporary answer');

    await tenantDb.runAs(u, (tx) =>
      tx.execute(sql`
        UPDATE messages
        SET usage = '{"status":"error"}'::jsonb
        WHERE id = ${assistantId}`),
    );
    await indexService.reindexChat(id, u);

    const rows = await ownedRows(
      sql`
      SELECT content, normalized_content
      FROM search_chat_documents
      WHERE chat_id = ${id}
      ORDER BY chunk_ordinal`,
      z.object({ content: z.string(), normalized_content: z.string() }),
    );
    expect(rows).toEqual([
      {
        content: '[user] stable prompt',
        normalized_content: 'stable prompt',
      },
    ]);
  });

  it('an unchanged reindex is a hash no-op (docs not rewritten)', async () => {
    const id = await seed('NoOp', [
      { role: 'user', text: 'stable content here' },
    ]);
    await indexService.reindexChat(id, u);
    const q = sql`SELECT id, updated_at::text AS updated_at FROM search_chat_documents WHERE chat_id = ${id} ORDER BY chunk_ordinal`;
    const rowSchema = z.object({ updated_at: z.string() });
    const before = await ownedRows(q, rowSchema);
    await new Promise((r) => setTimeout(r, 25));
    await indexService.reindexChat(id, u);
    const after = await ownedRows(q, rowSchema);
    // Unchanged (hash-matched) chunks are not rewritten → updated_at is identical.
    expect(after.map((r) => r.updated_at)).toEqual(
      before.map((r) => r.updated_at),
    );
  });

  it('repairs a changed locator and invalidates embeddings even when its hash is unchanged', async () => {
    const id = await seed('Locator repair', [
      { role: 'user', text: 'stable source coordinates' },
    ]);
    await indexService.reindexChat(id, u);
    const [before] = await ownedRows(
      sql`
      SELECT content_hash, first_message_text_offset,
             last_message_text_offset_exclusive
      FROM search_chat_documents
      WHERE chat_id = ${id}`,
      z.object({
        content_hash: z.string(),
        first_message_text_offset: z.number(),
        last_message_text_offset_exclusive: z.number(),
      }),
    );

    // A current-version row can be left with a stale locator by an interrupted
    // backfill or an operator repair. The writer must validate both hash and
    // locator state before treating a row as a no-op.
    await tenantDb.runAs(u, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents
        SET first_message_text_offset = ${before.first_message_text_offset + 1},
            embedding = '[0.7,0.8,0.9]'::vector,
            embedding_model_key = 'model-a',
            embedded_content_hash = ${before.content_hash},
            embed_input_version = 1,
            embedding_fail_reason = 'stale locator fixture'
        WHERE chat_id = ${id}`),
    );

    await indexService.reindexChat(id, u);

    const [after] = await ownedRows(
      sql`
      SELECT content_hash, first_message_text_offset,
             last_message_text_offset_exclusive, embedding::text AS embedding,
             embedding_model_key, embedded_content_hash, embed_input_version,
             embedding_fail_reason
      FROM search_chat_documents
      WHERE chat_id = ${id}`,
      z.object({
        content_hash: z.string(),
        first_message_text_offset: z.number(),
        last_message_text_offset_exclusive: z.number(),
        embedding: z.string().nullable(),
        embedding_model_key: z.string().nullable(),
        embedded_content_hash: z.string().nullable(),
        embed_input_version: z.number().nullable(),
        embedding_fail_reason: z.string().nullable(),
      }),
    );
    expect(after.content_hash).toBe(before.content_hash);
    expect(after.first_message_text_offset).toBe(
      before.first_message_text_offset,
    );
    expect(after.last_message_text_offset_exclusive).toBe(
      before.last_message_text_offset_exclusive,
    );
    expect(after.embedding).toBeNull();
    expect(after.embedding_model_key).toBeNull();
    expect(after.embedded_content_hash).toBeNull();
    expect(after.embed_input_version).toBeNull();
    expect(after.embedding_fail_reason).toBeNull();
  });

  it('repairs either corrupted boundary UUID and invalidates stale embeddings', async () => {
    const id = await seed('Boundary UUID repair', [
      { role: 'user', text: 'first source message' },
      {
        role: 'assistant',
        text: 'last source message',
        usage: { status: 'completed' },
      },
    ]);
    await indexService.reindexChat(id, u);

    const rowSchema = z.object({
      first_message_id: z.string(),
      last_message_id: z.string(),
      content_hash: z.string(),
      first_message_text_offset: z.number(),
      last_message_text_offset_exclusive: z.number(),
      embedding: z.string().nullable(),
      embedding_model_key: z.string().nullable(),
      embedded_content_hash: z.string().nullable(),
      embed_input_version: z.number().nullable(),
      embedding_fail_reason: z.string().nullable(),
    });
    const readRow = async () => {
      const [row] = await ownedRows(
        sql`
        SELECT first_message_id, last_message_id, content_hash,
               first_message_text_offset, last_message_text_offset_exclusive,
               embedding::text AS embedding, embedding_model_key,
               embedded_content_hash, embed_input_version, embedding_fail_reason
        FROM search_chat_documents
        WHERE chat_id = ${id}`,
        rowSchema,
      );
      return row;
    };
    const messageRows = await ownedRows(
      sql`
      SELECT id
      FROM messages
      WHERE chat_id = ${id}
      ORDER BY seq`,
      z.object({ id: z.string() }),
    );
    const before = await readRow();
    expect(messageRows).toHaveLength(2);
    expect(before.first_message_id).toBe(messageRows[0].id);
    expect(before.last_message_id).toBe(messageRows[1].id);

    const embedFixture = async () =>
      tenantDb.runAs(u, (tx) =>
        tx.execute(sql`
          UPDATE search_chat_documents
          SET embedding = '[0.11,0.22,0.33]'::vector,
              embedding_model_key = 'model-a',
              embedded_content_hash = ${before.content_hash},
              embed_input_version = 1,
              embedding_fail_reason = 'stale boundary fixture'
          WHERE chat_id = ${id}`),
      );
    const expectRepairedAndCleared = async () => {
      const after = await readRow();
      expect(after.first_message_id).toBe(before.first_message_id);
      expect(after.last_message_id).toBe(before.last_message_id);
      expect(after.content_hash).toBe(before.content_hash);
      expect(after.first_message_text_offset).toBe(
        before.first_message_text_offset,
      );
      expect(after.last_message_text_offset_exclusive).toBe(
        before.last_message_text_offset_exclusive,
      );
      expect(after.embedding).toBeNull();
      expect(after.embedding_model_key).toBeNull();
      expect(after.embedded_content_hash).toBeNull();
      expect(after.embed_input_version).toBeNull();
      expect(after.embedding_fail_reason).toBeNull();
    };

    await embedFixture();
    await tenantDb.runAs(u, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents
        SET first_message_id = ${crypto.randomUUID()}
        WHERE chat_id = ${id}`),
    );
    await indexService.reindexChat(id, u);
    await expectRepairedAndCleared();

    await embedFixture();
    await tenantDb.runAs(u, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents
        SET last_message_id = ${crypto.randomUUID()}
        WHERE chat_id = ${id}`),
    );
    await indexService.reindexChat(id, u);
    await expectRepairedAndCleared();
  });

  it('two sequential reindexes converge to the same projection (idempotent rebuild)', async () => {
    const id = await seed('Converge', [
      { role: 'user', text: 'alpha bravo charlie' },
      { role: 'assistant', text: 'delta echo foxtrot' },
    ]);
    await indexService.reindexChat(id, u);
    const q = sql`SELECT chunk_ordinal, content_hash, content FROM search_chat_documents WHERE chat_id = ${id} ORDER BY chunk_ordinal`;
    const rowSchema = z.object({
      chunk_ordinal: z.number(),
      content_hash: z.string(),
      content: z.string(),
    });
    const first = await ownedRows(q, rowSchema);
    // A genuine concurrent race isn't worth flaking a test over — concurrent
    // rebuilds of one chat run under REPEATABLE READ, and a loser that hits a
    // serialization failure is retried by reindexChat until it converges. What we
    // CAN assert directly: rebuilding twice from the same unchanged canonical
    // messages is idempotent and reproduces a byte-identical projection.
    await indexService.reindexChat(id, u);
    const second = await ownedRows(q, rowSchema);
    expect(second).toEqual(first);
  });

  it('indexed_at only ever advances (monotonic watermark)', async () => {
    const id = await seed('Monotonic', [{ role: 'user', text: 'first pass' }]);
    await indexService.reindexChat(id, u);
    const stateQuery = sql`SELECT indexed_at::text AS indexed_at FROM search_chat_state WHERE chat_id = ${id}`;
    const stateRowSchema = z.object({ indexed_at: z.string() });
    const before = await ownedRows(stateQuery, stateRowSchema);

    // Force the stored watermark artificially into the future — beyond
    // anything a reindex could compute from the chat's real message/chat
    // timestamps — to simulate a reordered/stale rebuild commit.
    await tenantDb.runAs(u, (tx) =>
      tx.execute(
        sql`UPDATE search_chat_state SET indexed_at = indexed_at + interval '1 day' WHERE chat_id = ${id}`,
      ),
    );
    const forced = await ownedRows(stateQuery, stateRowSchema);
    expect(new Date(forced[0].indexed_at).getTime()).toBeGreaterThan(
      new Date(before[0].indexed_at).getTime(),
    );

    // A reindex now necessarily computes a watermark from the real (older)
    // message/chat timestamps. GREATEST(existing, excluded) in the upsert
    // must keep the stored indexed_at from moving backward.
    await indexService.reindexChat(id, u);
    const after = await ownedRows(stateQuery, stateRowSchema);
    expect(after[0].indexed_at).toEqual(forced[0].indexed_at);
  });

  it('rebuilds the covering chunk when a message is edited', async () => {
    const id = await seed('Edit', [
      { role: 'user', text: 'original phrasing' },
    ]);
    await indexService.reindexChat(id, u);
    const [{ id: msgId }] = await ownedRows(
      sql`SELECT id FROM messages WHERE chat_id = ${id} LIMIT 1`,
      z.object({ id: z.string() }),
    );
    const before = await ownedRows(
      sql`SELECT content_hash FROM search_chat_documents WHERE chat_id = ${id} ORDER BY chunk_ordinal LIMIT 1`,
      z.object({ content_hash: z.string() }),
    );
    const newParts = JSON.stringify(text('rewritten distinctive wording'));
    await tenantDb.runAs(u, (tx) =>
      tx.execute(
        sql`UPDATE messages SET parts = ${newParts}::jsonb WHERE id = ${msgId}`,
      ),
    );
    await indexService.reindexChat(id, u);
    const after = await ownedRows(
      sql`SELECT content, content_hash FROM search_chat_documents WHERE chat_id = ${id} ORDER BY chunk_ordinal LIMIT 1`,
      z.object({ content: z.string(), content_hash: z.string() }),
    );
    expect(after[0].content_hash).not.toBe(before[0].content_hash);
    expect(after[0].content).toContain('rewritten distinctive wording');
  });

  // chat-search-embeddings design D7 "upsert trap" (trap 1) — the ONE silent-
  // wrong-answer path in the design: an ON CONFLICT DO UPDATE that rewrites
  // content_hash without also nulling the embedding columns would preserve a
  // STALE vector across a content change. Read the embedding columns DIRECTLY
  // — the existing `llame_search_embedding_coverage` tests above only prove
  // the coverage predicate re-flags the chat via `embedded_content_hash IS
  // DISTINCT FROM content_hash`, which stays true (and so still reports the
  // chat as outstanding) whether or not `embedding` itself was actually
  // nulled — they cannot detect this defect. This test can: it was run
  // against the code with the five nulled columns removed from the upsert's
  // `set:` block and failed (embedding, embedding_model_key,
  // embedded_content_hash, and embed_input_version were all still populated
  // with the pre-edit values after the rebuild) before the fix restored it
  // to green.
  it('nulls all five embedding columns when a rebuild changes content_hash (trap 1)', async () => {
    const id = await seed('Stale vector guard', [
      { role: 'user', text: 'original embeddable phrasing' },
    ]);
    await indexService.reindexChat(id, u);
    const [{ content_hash: originalHash }] = await ownedRows(
      sql`SELECT content_hash FROM search_chat_documents WHERE chat_id = ${id}`,
      z.object({ content_hash: z.string() }),
    );
    // Simulate a prior successful embed directly, as the coverage-predicate
    // tests above already do — nothing in this layer writes an embedding yet.
    await tenantDb.runAs(u, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents
        SET embedding = '[0.1,0.2,0.3]'::vector,
            embedding_model_key = 'model-a',
            embedded_content_hash = ${originalHash},
            embed_input_version = 1,
            embedding_fail_reason = 'stale reason should also clear'
        WHERE chat_id = ${id}`),
    );

    const [{ id: msgId }] = await ownedRows(
      sql`SELECT id FROM messages WHERE chat_id = ${id} LIMIT 1`,
      z.object({ id: z.string() }),
    );
    await tenantDb.runAs(u, (tx) =>
      tx.execute(
        sql`UPDATE messages SET parts = ${JSON.stringify(text('a completely different embeddable phrasing'))}::jsonb WHERE id = ${msgId}`,
      ),
    );
    await indexService.reindexChat(id, u);

    const rowSchema = z.object({
      content_hash: z.string(),
      embedding: z.string().nullable(),
      embedding_model_key: z.string().nullable(),
      embedded_content_hash: z.string().nullable(),
      embed_input_version: z.number().nullable(),
      embedding_fail_reason: z.string().nullable(),
    });
    const [after] = await ownedRows(
      sql`
      SELECT content_hash, embedding::text AS embedding, embedding_model_key,
             embedded_content_hash, embed_input_version, embedding_fail_reason
      FROM search_chat_documents WHERE chat_id = ${id}`,
      rowSchema,
    );
    expect(after.content_hash).not.toBe(originalHash);
    expect(after.embedding).toBeNull();
    expect(after.embedding_model_key).toBeNull();
    expect(after.embedded_content_hash).toBeNull();
    expect(after.embed_input_version).toBeNull();
    expect(after.embedding_fail_reason).toBeNull();
  });

  it('leaves the embedding columns untouched when a rebuild is a hash no-op', async () => {
    const id = await seed('Stable vector', [
      { role: 'user', text: 'content that will not change' },
    ]);
    await indexService.reindexChat(id, u);
    const [{ content_hash }] = await ownedRows(
      sql`SELECT content_hash FROM search_chat_documents WHERE chat_id = ${id}`,
      z.object({ content_hash: z.string() }),
    );
    await tenantDb.runAs(u, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents
        SET embedding = '[0.4,0.5,0.6]'::vector,
            embedding_model_key = 'model-a',
            embedded_content_hash = ${content_hash},
            embed_input_version = 1
        WHERE chat_id = ${id}`),
    );

    // No content change — the changed-chunk filter excludes this row from
    // the upsert entirely, so the vector must survive untouched.
    await indexService.reindexChat(id, u);

    const rowSchema = z.object({
      embedding: z.string().nullable(),
      embedding_model_key: z.string().nullable(),
    });
    const [after] = await ownedRows(
      sql`
      SELECT embedding::text AS embedding, embedding_model_key
      FROM search_chat_documents WHERE chat_id = ${id}`,
      rowSchema,
    );
    expect(after.embedding).not.toBeNull();
    expect(after.embedding_model_key).toBe('model-a');
  });

  it('cascades the projection away when the chat is deleted', async () => {
    const id = await seed('Doomed', [{ role: 'user', text: 'transient' }]);
    await indexService.reindexChat(id, u);
    expect(await docCount(id)).toBeGreaterThan(0);
    await tenantDb.runAs(u, (tx) =>
      tx.execute(sql`DELETE FROM chats WHERE id = ${id}`),
    );
    expect(await docCount(id)).toBe(0);
    const state = await ownedRows(
      sql`SELECT count(*)::int AS n FROM search_chat_state WHERE chat_id = ${id}`,
      z.object({ n: z.number() }),
    );
    expect(state[0].n).toBe(0);
  });

  it('discovery flags an un-indexed chat, then clears it after reindex', async () => {
    const id = await seed('Discover', [{ role: 'user', text: 'find me' }]);
    expect(await staleIds()).toContain(id);
    await indexService.reindexChat(id, u);
    expect(await staleIds()).not.toContain(id);
  });

  it('discovery re-flags a chat whose chunker version is stale', async () => {
    const id = await seed('Versioned', [{ role: 'user', text: 'rebuild me' }]);
    await indexService.reindexChat(id, u);
    expect(await staleIds()).not.toContain(id);
    await tenantDb.runAs(u, (tx) =>
      tx.execute(
        sql`UPDATE search_chat_state SET chunker_version = chunker_version + 1000 WHERE chat_id = ${id}`,
      ),
    );
    expect(await staleIds()).toContain(id);
  });

  it('replaces prior-version documents with the current role-free lexical projection', async () => {
    const id = await seed('Version rebuild', [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'answer-1' },
    ]);
    await indexService.reindexChat(id, u);
    await tenantDb.runAs(u, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents SET chunker_version = ${CHUNKER_VERSION - 1}
        WHERE chat_id = ${id}`),
    );
    await tenantDb.runAs(u, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_state SET chunker_version = ${CHUNKER_VERSION - 1}
        WHERE chat_id = ${id}`),
    );
    expect(await staleIds()).toContain(id);
    await indexService.reindexChat(id, u);
    const rows = await ownedRows(
      sql`
      SELECT chunker_version, normalized_content, fts::text AS fts
      FROM search_chat_documents WHERE chat_id = ${id}`,
      z.object({
        chunker_version: z.number(),
        normalized_content: z.string(),
        fts: z.string(),
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].chunker_version).toBe(CHUNKER_VERSION);
    expect(rows[0].normalized_content).toBe('hello answer-1');
    expect(rows[0].fts).not.toContain('assistant');
  });

  it('discovery returns only identifiers + timestamp (no content columns)', async () => {
    const rows = await tenantDb.runAsPublic((tx) =>
      tx.execute(
        sql`SELECT * FROM llame_search_stale_chats(${CHUNKER_VERSION}, 1)`,
      ),
    );
    const cols = new Set(Object.keys([...rows][0] ?? {}));
    // If there is a row, it must expose exactly the identifier/timestamp shape.
    if (cols.size > 0) {
      expect([...cols].sort()).toEqual(
        ['chat_id', 'owner_user_id', 'updated_at'].sort(),
      );
    }
  });

  // chat-search-embeddings, design D10 — llame_search_embedding_coverage.
  // Nothing in this layer writes an embedding; these tests stamp the
  // embedding columns directly to exercise the coverage predicate.
  describe('llame_search_embedding_coverage', () => {
    it('flags a fully-indexed, never-embedded chat — the null-comparison trap (IS DISTINCT FROM, not =)', async () => {
      const id = await seed('Never embedded', [
        { role: 'user', text: 'find this via embedding one day' },
      ]);
      await indexService.reindexChat(id, u);
      const rows = await embeddingCoverage('model-a', 1);
      const row = rows.find((r) => r.chat_id === id);
      expect(row).toBeDefined();
      expect(row!.outstanding_count).toBeGreaterThan(0);
      expect(row!.embedded_count).toBe(0);
      expect(row!.failed_count).toBe(0);
    });

    it('excludes a chat whose document already matches the model key, content hash, and input version', async () => {
      const id = await seed('Fully embedded', [
        { role: 'user', text: 'already covered content' },
      ]);
      await indexService.reindexChat(id, u);
      const [{ content_hash }] = await ownedRows(
        sql`SELECT content_hash FROM search_chat_documents WHERE chat_id = ${id}`,
        z.object({ content_hash: z.string() }),
      );
      await tenantDb.runAs(u, (tx) =>
        tx.execute(sql`
          UPDATE search_chat_documents
          SET embedding = '[0.1,0.2,0.3]',
              embedding_model_key = 'model-a',
              embedded_content_hash = ${content_hash},
              embed_input_version = 1
          WHERE chat_id = ${id}`),
      );
      const rows = await embeddingCoverage('model-a', 1);
      expect(rows.find((r) => r.chat_id === id)).toBeUndefined();
    });

    it('re-flags a document whose embedded_content_hash is stale after a rebuild', async () => {
      const id = await seed('Rebuilt after embed', [
        { role: 'user', text: 'original content' },
      ]);
      await indexService.reindexChat(id, u);
      const [{ content_hash }] = await ownedRows(
        sql`SELECT content_hash FROM search_chat_documents WHERE chat_id = ${id}`,
        z.object({ content_hash: z.string() }),
      );
      await tenantDb.runAs(u, (tx) =>
        tx.execute(sql`
          UPDATE search_chat_documents
          SET embedding = '[0.1,0.2,0.3]',
              embedding_model_key = 'model-a',
              embedded_content_hash = ${content_hash},
              embed_input_version = 1
          WHERE chat_id = ${id}`),
      );
      expect(
        (await embeddingCoverage('model-a', 1)).find((r) => r.chat_id === id),
      ).toBeUndefined();

      const [{ id: msgId }] = await ownedRows(
        sql`SELECT id FROM messages WHERE chat_id = ${id} LIMIT 1`,
        z.object({ id: z.string() }),
      );
      await tenantDb.runAs(u, (tx) =>
        tx.execute(
          sql`UPDATE messages SET parts = ${JSON.stringify(text('rewritten content'))}::jsonb WHERE id = ${msgId}`,
        ),
      );
      await indexService.reindexChat(id, u);

      const row = (await embeddingCoverage('model-a', 1)).find(
        (r) => r.chat_id === id,
      );
      expect(row).toBeDefined();
      expect(row!.outstanding_count).toBeGreaterThan(0);
    });

    it('returns only identifiers + counts (no content, no vectors)', async () => {
      // Seed an unambiguous never-embedded document so this row-shape
      // assertion is guaranteed at least one row to check, rather than
      // relying on ambient state from earlier tests in this file (which
      // would let the assertion below silently no-op if that state ever
      // changed).
      const id = await seed('Coverage shape check', [
        { role: 'user', text: 'row shape only' },
      ]);
      await indexService.reindexChat(id, u);
      const rows = await embeddingCoverage('coverage-shape-model', 1);
      expect(rows.length).toBeGreaterThan(0);
      const cols = new Set(Object.keys(rows[0] ?? {}));
      expect([...cols].sort()).toEqual(
        [
          'chat_id',
          'owner_user_id',
          'outstanding_count',
          'embedded_count',
          'failed_count',
        ].sort(),
      );
    });
  });
});
