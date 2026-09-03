/**
 * RLS negatives for the embedding columns on `search_chat_documents`
 * (chat-search-embeddings, design D3/schema layer). The projection's existing
 * owner policy (`search_chat_documents_owner`, FOR ALL) already inherited the
 * new columns automatically — this file exists to prove that inheritance
 * holds for the embedding columns SPECIFICALLY, not just the pre-existing
 * lexical ones, per the spec: "Because a vector is a lossy but real encoding
 * of content, cross-tenant and public-chat negative tests SHALL cover the
 * embedding columns explicitly rather than relying on the lexical assertions
 * alone."
 *
 * Covers:
 * - the owning identity CAN read its own embedding columns;
 * - another user's identity gets ZERO rows, for both a private and a PUBLIC
 *   chat (there is deliberately no public-read policy on this table — see
 *   apps/api/src/db/schema/search.ts's header comment);
 * - the empty (public) identity gets ZERO rows, same two cases.
 *
 * Follows the RLS harness contract documented in
 * apps/api/src/chats/chats-rls.integration.test.ts's header: the connecting
 * role MUST be non-superuser, non-BYPASSRLS, and the OWNER of the table
 * (test:integration's globalSetup provisions exactly this) — RLS only
 * constrains a table owner when FORCE ROW LEVEL SECURITY is set, so a green
 * run here proves FORCE is doing its job for the new columns too.
 *
 * TEST_DATABASE_URL-gated; run by test:integration. A skipped RLS test looks
 * identical to a passing one in summary output — this file was verified by
 * temporarily running `ALTER TABLE search_chat_documents NO FORCE ROW LEVEL
 * SECURITY` against a throwaway database and confirming every negative here
 * failed (leaked the row), then restoring FORCE and confirming green again.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { SearchIndexService } from './search-index.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = ReturnType<typeof postgres>;
const text = (t: string) => [{ type: 'text', text: t }];

describeIfDb('search_chat_documents embedding columns — RLS negatives', () => {
  let sqlClient: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let indexService: SearchIndexService;
  let owner: string;
  let other: string;

  async function seedIndexedChat(
    ownerId: string,
    visibility: 'private' | 'public',
  ): Promise<string> {
    const id = crypto.randomUUID();
    await tenantDb.runAs(ownerId, async (tx) => {
      const chats = new ChatsRepository(tx);
      const messages = new MessagesRepository(tx);
      await chats.createIfAbsent({ id, ownerUserId: ownerId, title: 'Embed' });
      if (visibility === 'public') {
        await chats.update(id, ownerId, { visibility });
      }
      await messages.create({
        chatId: id,
        role: 'user',
        senderUserId: ownerId,
        parts: text('embed me'),
      });
    });
    await indexService.reindexChat(id, ownerId);
    // Stamp a sentinel embedding directly — nothing in this layer writes one.
    await tenantDb.runAs(ownerId, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents
        SET embedding = '[0.1,0.2,0.3]', embedding_model_key = 'rls-test-model'
        WHERE chat_id = ${id}`),
    );
    return id;
  }

  /** Count of rows a given caller identity can read with a non-null embedding. */
  const embeddingRowCountAs = (
    runner: (fn: (tx: Db) => Promise<number>) => Promise<number>,
    chatId: string,
  ): Promise<number> =>
    runner((tx) =>
      tx
        .execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM search_chat_documents
              WHERE chat_id = ${chatId} AND embedding IS NOT NULL`,
        )
        .then((rows) => [...rows][0].n),
    );

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sqlClient = postgres(TEST_DB_URL!, { ssl, max: 3 });
    db = drizzle(sqlClient, { schema });
    tenantDb = new TenantDbService(db);
    indexService = new SearchIndexService(tenantDb);
    owner = crypto.randomUUID();
    other = crypto.randomUUID();
    for (const id of [owner, other]) {
      await sqlClient`INSERT INTO users (id, name, email) VALUES (${id}, 'E', ${`e-${id}@t.com`})`;
    }
  });

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient`DELETE FROM users WHERE id IN (${owner}, ${other})`;
      await sqlClient.end();
    }
  });

  it('the harness is meaningful: non-superuser, non-BYPASSRLS role, FORCE RLS on search_chat_documents', async () => {
    const [role] =
      await sqlClient`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    const [rel] = await sqlClient`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname = 'search_chat_documents'`;
    expect(rel.relrowsecurity).toBe(true);
    expect(rel.relforcerowsecurity).toBe(true);
  });

  it('the owning identity reads its own embedding columns', async () => {
    const id = await seedIndexedChat(owner, 'private');
    expect(
      await embeddingRowCountAs((fn) => tenantDb.runAs(owner, fn), id),
    ).toBe(1);
  });

  it("another user's identity gets zero rows for a PRIVATE chat's embedding columns", async () => {
    const id = await seedIndexedChat(owner, 'private');
    expect(
      await embeddingRowCountAs((fn) => tenantDb.runAs(other, fn), id),
    ).toBe(0);
  });

  it("the empty (public) identity gets zero rows for a PRIVATE chat's embedding columns", async () => {
    const id = await seedIndexedChat(owner, 'private');
    expect(
      await embeddingRowCountAs((fn) => tenantDb.runAsPublic(fn), id),
    ).toBe(0);
  });

  it("another user's identity gets zero rows for a PUBLIC chat's embedding columns — vectors are content too", async () => {
    const id = await seedIndexedChat(owner, 'public');
    expect(
      await embeddingRowCountAs((fn) => tenantDb.runAs(other, fn), id),
    ).toBe(0);
  });

  it("the empty (public) identity gets zero rows for a PUBLIC chat's embedding columns — sharing is a `chats`-only relaxation, not search_chat_documents", async () => {
    const id = await seedIndexedChat(owner, 'public');
    expect(
      await embeddingRowCountAs((fn) => tenantDb.runAsPublic(fn), id),
    ).toBe(0);
  });
});
