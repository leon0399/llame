/**
 * Chat-search relevance eval (#195, design D8) on a live DB. Seeds the versioned
 * dataset, indexes it through the real chunker/projection, runs `searchByOwner`
 * for every labeled query, and:
 * - ASSERTS hard recall floors on the categories lexical search must not miss
 *   (exact-title, exact-content, code, typo — expected chat in top 10);
 * - RECORDS overall + per-category Recall@10 / MRR / zero-result-rate (the
 *   phase-3 measuring stick). Set RUN_SEARCH_EVAL=1 to print the full summary.
 *
 * TEST_DATABASE_URL-gated; run by test:integration (floors enforced in CI).
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

import * as schema from '../../../db/schema';
import { TenantDbService, type Db } from '../../../db/tenant-db.service';
import {
  ChatsRepository,
  MessagesRepository,
} from '../../../chats/chats-repository';
import { summarizeEval, type EvalQueryResult } from '../../core';
import { resolveEvalEmbedBackend } from './resolve-eval-backend';
import { SearchIndexService } from '../../search-index.service';
import { CHUNK_MAX_CHARS } from '../conversation-chunker';
import {
  EVAL_FIXTURES,
  EVAL_QUERIES,
  FLOOR_CATEGORIES,
  OVERSIZED_TRANSCRIPT_TEXT,
} from './dataset';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = ReturnType<typeof postgres>;
const K = 10;

describeIfDb('chat search — relevance eval', () => {
  let sqlClient: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let u: string;
  const chatIdByKey = new Map<string, string>();
  const results: Array<EvalQueryResult> = [];

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sqlClient = postgres(TEST_DB_URL!, { ssl, max: 3 });
    db = drizzle(sqlClient, { schema });
    tenantDb = new TenantDbService(db);
    const indexService = new SearchIndexService(tenantDb);
    u = crypto.randomUUID();
    await sqlClient`INSERT INTO users (id, name, email) VALUES (${u}, 'E', ${`e-${u}@t.com`})`;

    for (const fx of EVAL_FIXTURES) {
      const id = crypto.randomUUID();
      chatIdByKey.set(fx.key, id);
      await tenantDb.runAs(u, async (tx) => {
        const chats = new ChatsRepository(tx);
        const messages = new MessagesRepository(tx);
        await chats.createIfAbsent({ id, ownerUserId: u, title: fx.title });
        for (const m of fx.messages) {
          await messages.create({
            chatId: id,
            role: m.role,
            senderUserId: m.role === 'user' ? u : null,
            parts: [{ type: 'text', text: m.text }],
          });
        }
      });
      await indexService.reindexChat(id, u);
    }

    for (const q of EVAL_QUERIES) {
      const rows = await tenantDb.runAs(u, (tx) =>
        new ChatsRepository(tx).searchByOwner(u, q.query, K),
      );
      results.push({
        category: q.category,
        rankedIds: rows.map((r) => r.id),
        relevant: new Set(q.expect.map((k) => chatIdByKey.get(k)!)),
      });
    }
  });

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient`DELETE FROM users WHERE id = ${u}`;
      await sqlClient.end();
    }
  });

  it('keeps the oversized fixture larger than the chunker cannot fit whole', () => {
    // The oversized-transcript fixture only exercises what it claims to
    // (a message the chunker cannot fit whole into a single budgeted chunk)
    // if it comfortably clears CHUNK_MAX_CHARS. Guard the property directly
    // rather than trusting the comment in dataset.ts.
    expect(OVERSIZED_TRANSCRIPT_TEXT.length).toBeGreaterThan(
      CHUNK_MAX_CHARS * 3,
    );
  });

  it('records the relevance baseline (Recall@10, MRR, zero-result-rate)', () => {
    const summary = summarizeEval(results, K);
    if (process.env['RUN_SEARCH_EVAL']) {
      console.log(
        '\n[search-eval] baseline\n' + JSON.stringify(summary, null, 2),
      );
    }
    expect(summary.count).toBe(EVAL_QUERIES.length);
    expect(summary.recallAtK).toBeGreaterThan(0);
  });

  it('meets hard recall floors on exact/typo/code categories', () => {
    const floors: ReadonlySet<string> = FLOOR_CATEGORIES;
    const floorResults = results.filter((r) => floors.has(r.category));
    const summary = summarizeEval(floorResults, K);
    // Lexical search has no excuse to miss exact/typo/identifier matches.
    expect(summary.recallAtK).toBe(1);
    expect(summary.zeroResultRate).toBe(0);
  });

  it('runs the hybrid eval when an embedding provider is configured', async () => {
    if (!process.env['RUN_SEARCH_EVAL']) return;

    const resolved = resolveEvalEmbedBackend();
    if (!resolved) return;
    const { backend, modelKey, dimensions: dims } = resolved;

    // Embed all fixture documents
    for (const [, chatId] of chatIdByKey) {
      const docs = await tenantDb.runAs(u, (tx) =>
        tx.execute(sql`
          SELECT id, content FROM search_chat_documents
          WHERE chat_id = ${chatId} AND embedding IS NULL
        `),
      );
      for (const doc of docs) {
        const results = await backend.embedDocuments([
          {
            documentId: String(doc.id),
            contentHash: 'eval',
            content: String(doc.content),
          },
        ]);
        const vector = results[0]?.embedding;
        if (vector && vector.length === dims) {
          const vecLiteral = JSON.stringify(Array.from(vector));
          await tenantDb.runAs(u, (tx) =>
            tx.execute(sql`
              UPDATE search_chat_documents
              SET embedding = ${vecLiteral}::vector,
                  embedding_model_key = ${modelKey},
                  embedded_content_hash = content_hash,
                  embed_input_version = 1
              WHERE id = ${String(doc.id)}
            `),
          );
        }
      }
    }

    // Run hybrid searches
    const hybridResults: Array<EvalQueryResult> = [];
    for (const q of EVAL_QUERIES) {
      let vectorParams:
        | { queryVector: ReadonlyArray<number>; modelKey: string }
        | undefined;
      try {
        const qv = await backend.embedQuery(q.query);
        if (qv.length === dims) {
          vectorParams = { queryVector: qv, modelKey };
        }
      } catch {
        // provider error on this query — skip vector leg
      }
      const rows = await tenantDb.runAs(u, (tx) =>
        new ChatsRepository(tx).searchByOwner(u, q.query, K, vectorParams),
      );
      hybridResults.push({
        category: q.category,
        rankedIds: rows.map((r) => r.id),
        relevant: new Set(q.expect.map((k) => chatIdByKey.get(k)!)),
      });
    }

    const hybridSummary = summarizeEval(hybridResults, K);
    console.log(
      '\n[search-eval] hybrid\n' + JSON.stringify(hybridSummary, null, 2),
    );

    // Floors must hold with the vector leg too
    const floors: ReadonlySet<string> = FLOOR_CATEGORIES;
    const floorResults = hybridResults.filter((r) => floors.has(r.category));
    const floorSummary = summarizeEval(floorResults, K);
    expect(floorSummary.recallAtK).toBe(1);
  }, 120_000);
});
