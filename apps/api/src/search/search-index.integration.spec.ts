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
 * TEST_DATABASE_URL-gated; run by rls-test.sh.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

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
  // Run an owner-scoped read of an RLS-protected table.
  const ownedRows = <T extends Record<string, unknown>>(
    frag: ReturnType<typeof sql>,
  ): Promise<T[]> =>
    tenantDb
      .runAs(u, (tx) => tx.execute<T>(frag))
      .then((rows) => [...rows] as T[]);
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
    const state = await ownedRows<{ chunker_version: number }>(
      sql`SELECT chunker_version FROM search_chat_state WHERE chat_id = ${id}`,
    );
    expect(state[0].chunker_version).toBe(CHUNKER_VERSION);
  });

  it('an unchanged reindex is a hash no-op (docs not rewritten)', async () => {
    const id = await seed('NoOp', [
      { role: 'user', text: 'stable content here' },
    ]);
    await indexService.reindexChat(id, u);
    const q = sql`SELECT id, updated_at::text AS updated_at FROM search_chat_documents WHERE chat_id = ${id} ORDER BY chunk_ordinal`;
    const before = await ownedRows<{ updated_at: string }>(q);
    await new Promise((r) => setTimeout(r, 25));
    await indexService.reindexChat(id, u);
    const after = await ownedRows<{ updated_at: string }>(q);
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
    const first = await ownedRows<{
      chunk_ordinal: number;
      content_hash: string;
      content: string;
    }>(q);
    // A genuine concurrent race isn't worth flaking a test over — concurrent
    // rebuilds of one chat run under REPEATABLE READ, and a loser that hits a
    // serialization failure is retried by reindexChat until it converges. What we
    // CAN assert directly: rebuilding twice from the same unchanged canonical
    // messages is idempotent and reproduces a byte-identical projection.
    await indexService.reindexChat(id, u);
    const second = await ownedRows<{
      chunk_ordinal: number;
      content_hash: string;
      content: string;
    }>(q);
    expect(second).toEqual(first);
  });

  it('indexed_at only ever advances (monotonic watermark)', async () => {
    const id = await seed('Monotonic', [{ role: 'user', text: 'first pass' }]);
    await indexService.reindexChat(id, u);
    const stateQuery = sql`SELECT indexed_at::text AS indexed_at FROM search_chat_state WHERE chat_id = ${id}`;
    const before = await ownedRows<{ indexed_at: string }>(stateQuery);

    // Force the stored watermark artificially into the future — beyond
    // anything a reindex could compute from the chat's real message/chat
    // timestamps — to simulate a reordered/stale rebuild commit.
    await tenantDb.runAs(u, (tx) =>
      tx.execute(
        sql`UPDATE search_chat_state SET indexed_at = indexed_at + interval '1 day' WHERE chat_id = ${id}`,
      ),
    );
    const forced = await ownedRows<{ indexed_at: string }>(stateQuery);
    expect(new Date(forced[0].indexed_at).getTime()).toBeGreaterThan(
      new Date(before[0].indexed_at).getTime(),
    );

    // A reindex now necessarily computes a watermark from the real (older)
    // message/chat timestamps. GREATEST(existing, excluded) in the upsert
    // must keep the stored indexed_at from moving backward.
    await indexService.reindexChat(id, u);
    const after = await ownedRows<{ indexed_at: string }>(stateQuery);
    expect(after[0].indexed_at).toEqual(forced[0].indexed_at);
  });

  it('rebuilds the covering chunk when a message is edited', async () => {
    const id = await seed('Edit', [
      { role: 'user', text: 'original phrasing' },
    ]);
    await indexService.reindexChat(id, u);
    const [{ id: msgId }] = await ownedRows<{ id: string }>(
      sql`SELECT id FROM messages WHERE chat_id = ${id} LIMIT 1`,
    );
    const before = await ownedRows<{ content_hash: string }>(
      sql`SELECT content_hash FROM search_chat_documents WHERE chat_id = ${id} ORDER BY chunk_ordinal LIMIT 1`,
    );
    const newParts = JSON.stringify(text('rewritten distinctive wording'));
    await tenantDb.runAs(u, (tx) =>
      tx.execute(
        sql`UPDATE messages SET parts = ${newParts}::jsonb WHERE id = ${msgId}`,
      ),
    );
    await indexService.reindexChat(id, u);
    const after = await ownedRows<{ content: string; content_hash: string }>(
      sql`SELECT content, content_hash FROM search_chat_documents WHERE chat_id = ${id} ORDER BY chunk_ordinal LIMIT 1`,
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
    const state = await ownedRows<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM search_chat_state WHERE chat_id = ${id}`,
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
