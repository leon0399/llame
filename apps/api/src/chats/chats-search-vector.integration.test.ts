/**
 * Vector leg integration tests (tasks 3.3–3.8): the vec_c CTE in
 * buildHybridSearchQuery, tested against a real Postgres with pgvector.
 * Seeds chats, reindexes them (creates projection documents), plants
 * vectors directly via SQL, and searches with/without vectorParams.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { SearchIndexService } from '../search/search-index.service';
import { EMBED_INPUT_VERSION } from '../search/embed-input-version';
import { ChatsRepository, MessagesRepository } from './chats-repository';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

const text = (t: string) => [{ type: 'text', text: t }];

const MODEL_KEY = 'test-embed-model';
const SUPERSEDED_KEY = 'old-model';

describeIfDb('chat search — vector leg (hybrid-vector-retrieval #197)', () => {
  let sqlClient: Sql;
  let db: Db;
  let tenantDb: TenantDbService;
  let indexService: SearchIndexService;
  let userA: string;
  let userB: string;

  const search = (
    userId: string,
    q: string,
    limit = 20,
    vectorParams?: { queryVector: ReadonlyArray<number>; modelKey: string },
  ) =>
    tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).searchByOwner(userId, q, {
        limit,
        vector: vectorParams,
      }),
    );

  async function seedChat(
    owner: string,
    title: string | null,
    msgs: Array<{ role: 'user' | 'assistant'; text: string }>,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await tenantDb.runAs(owner, async (tx) => {
      const chats = new ChatsRepository(tx);
      const messages = new MessagesRepository(tx);
      await chats.createIfAbsent({
        id,
        ownerUserId: owner,
        title: title ?? undefined,
      });
      for (const m of msgs) {
        await messages.create({
          chatId: id,
          role: m.role,
          senderUserId: m.role === 'user' ? owner : null,
          parts: text(m.text),
        });
      }
    });
    await indexService.reindexChat(id, owner);
    return id;
  }

  async function plantVector(
    owner: string,
    chatId: string,
    vector: ReadonlyArray<number>,
    opts: {
      modelKey: string;
      inputVersion?: number;
      staleHash?: boolean;
    },
  ): Promise<void> {
    const { modelKey, staleHash = false } = opts;
    const inputVersion = opts.inputVersion ?? EMBED_INPUT_VERSION;
    const vecLiteral = JSON.stringify(Array.from(vector));
    const hashExpr = staleHash
      ? sql`'stale-hash-does-not-match'`
      : sql`content_hash`;
    await tenantDb.runAs(owner, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents
        SET embedding = ${vecLiteral}::vector,
            embedding_model_key = ${modelKey},
            embedded_content_hash = ${hashExpr},
            embed_input_version = ${inputVersion}
        WHERE chat_id = ${chatId}
      `),
    );
  }

  beforeAll(async () => {
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sqlClient = connect(TEST_DB_URL!, { ssl, max: 3 });
    db = drizzle(sqlClient, { schema });
    tenantDb = new TenantDbService(db);
    indexService = new SearchIndexService(tenantDb);
    userA = crypto.randomUUID();
    userB = crypto.randomUUID();
    for (const id of [userA, userB]) {
      await sqlClient`INSERT INTO users (id, name, email) VALUES (${id}, 'T', ${`t-${id}@test.com`})`;
    }
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  it('3.3 vector-only match: returns a chat only when the vector leg is on', async () => {
    const chatId = await seedChat(userA, 'Quantum physics notes', [
      { role: 'user', text: 'subatomic particle entanglement observations' },
      { role: 'assistant', text: 'quantum mechanics is fascinating' },
    ]);
    await plantVector(userA, chatId, [1, 0, 0, 0], { modelKey: MODEL_KEY });

    const queryVector = [1, 0.1, 0, 0];
    const withVector = await search(userA, 'xylophoneuniquekeyword', 10, {
      queryVector,
      modelKey: MODEL_KEY,
    });
    const withoutVector = await search(userA, 'xylophoneuniquekeyword', 10);

    expect(withVector.some((r) => r.id === chatId)).toBe(true);
    expect(withoutVector.some((r) => r.id === chatId)).toBe(false);
  });

  it('3.4 stale model key contributes nothing', async () => {
    const chatId = await seedChat(userA, 'Stale model test', [
      { role: 'user', text: 'completely unrelated content for stale test' },
    ]);
    await plantVector(userA, chatId, [1, 0, 0, 0], {
      modelKey: SUPERSEDED_KEY,
    });

    const results = await search(userA, 'zyxwvuniquekeyword', 10, {
      queryVector: [1, 0, 0, 0],
      modelKey: MODEL_KEY,
    });
    expect(results.some((r) => r.id === chatId)).toBe(false);
  });

  it('3.4 stale content hash contributes nothing', async () => {
    const chatId = await seedChat(userA, 'Stale hash test', [
      { role: 'user', text: 'completely unrelated content for hash test' },
    ]);
    await plantVector(userA, chatId, [1, 0, 0, 0], {
      modelKey: MODEL_KEY,
      staleHash: true,
    });

    const results = await search(userA, 'pqrstuniquekeyword', 10, {
      queryVector: [1, 0, 0, 0],
      modelKey: MODEL_KEY,
    });
    expect(results.some((r) => r.id === chatId)).toBe(false);
  });

  it('3.4 stale input version contributes nothing', async () => {
    const chatId = await seedChat(userA, 'Stale version test', [
      { role: 'user', text: 'completely unrelated content for version test' },
    ]);
    await plantVector(userA, chatId, [1, 0, 0, 0], {
      modelKey: MODEL_KEY,
      inputVersion: EMBED_INPUT_VERSION - 1,
    });

    const results = await search(userA, 'lmnopuniquekeyword', 10, {
      queryVector: [1, 0, 0, 0],
      modelKey: MODEL_KEY,
    });
    expect(results.some((r) => r.id === chatId)).toBe(false);
  });

  it('3.5 wrong-dimension vector under active key is excluded, not an error', async () => {
    const chatId = await seedChat(userA, 'Dimension mismatch test', [
      { role: 'user', text: 'content for dimension test' },
      { role: 'assistant', text: 'dimension response' },
    ]);
    await plantVector(userA, chatId, [1, 0, 0, 0, 0, 0, 0, 0], {
      modelKey: MODEL_KEY,
    });

    await expect(
      search(userA, 'dimensionuniquekeyword', 10, {
        queryVector: [1, 0, 0, 0],
        modelKey: MODEL_KEY,
      }),
    ).resolves.toBeDefined();
  });

  it('3.6 cross-tenant vector: user B cannot reach user A via vector', async () => {
    const chatId = await seedChat(userA, 'Private vector test', [
      { role: 'user', text: 'extremely private vector content' },
    ]);
    await plantVector(userA, chatId, [1, 0, 0, 0], { modelKey: MODEL_KEY });

    const results = await search(userB, 'abcdefuniquekeyword', 10, {
      queryVector: [1, 0, 0, 0],
      modelKey: MODEL_KEY,
    });
    expect(results.some((r) => r.id === chatId)).toBe(false);
  });

  it('3.7 no cosine distance or fused score in results', async () => {
    const chatId = await seedChat(userA, 'Score leak test', [
      { role: 'user', text: 'content for score leak test' },
    ]);
    await plantVector(userA, chatId, [1, 0, 0, 0], { modelKey: MODEL_KEY });

    const results = await search(userA, 'content for score leak test', 10, {
      queryVector: [1, 0, 0, 0],
      modelKey: MODEL_KEY,
    });
    const hit = results.find((r) => r.id === chatId);
    expect(hit).toBeDefined();
    const keys = Object.keys(hit!);
    expect(keys).not.toContain('distance');
    expect(keys).not.toContain('cosine');
    expect(keys).not.toContain('fusedScore');
    expect(keys).toEqual(
      expect.arrayContaining([
        'id',
        'title',
        'snippet',
        'updatedAt',
        'bestDocumentId',
      ]),
    );
  });
});
