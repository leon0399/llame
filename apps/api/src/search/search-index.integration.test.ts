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

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { CHUNKER_VERSION } from './chat/conversation-chunker';
import { SearchIndexService } from './search-index.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;
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
  const ownedRows = <T extends Record<string, unknown>>(
    frag: ReturnType<typeof sql>,
    rowSchema: z.ZodType<T>,
  ): Promise<T[]> =>
    tenantDb
      .runAs(u, (tx) => tx.execute(frag))
      .then((rows) => rowSchema.array().parse([...rows]));
  const staleIds = (): Promise<string[]> =>
    tenantDb
      .runAsPublic((tx) =>
        tx.execute<{ chat_id: string }>(sql`
          SELECT chat_id FROM llame_search_stale_chats(${CHUNKER_VERSION}, 1000)`),
      )
      .then((rows) => [...rows].map((r) => r.chat_id));

  async function seed(
    title: string,
    msgs: Array<{ role: 'user' | 'assistant'; text: string }>,
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
          parts: text(m.text),
        });
      }
    });
    return id;
  }

  beforeAll(async () => {
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sqlClient = connect(TEST_DB_URL!, { ssl, max: 3 });
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
});
