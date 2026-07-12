/**
 * Chat-search relevance eval (#195, design D8) on a live DB. Seeds the versioned
 * dataset, indexes it through the real chunker/projection, runs `searchByOwner`
 * for every labeled query, and:
 * - ASSERTS hard recall floors on the categories lexical search must not miss
 *   (exact-title, exact-content, code, typo — expected chat in top 10);
 * - RECORDS overall + per-category Recall@10 / MRR / zero-result-rate (the
 *   phase-3 measuring stick). Set RUN_SEARCH_EVAL=1 to print the full summary.
 *
 * TEST_DATABASE_URL-gated; run by rls-test.sh (floors enforced in CI).
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../../db/schema';
import { TenantDbService, type Db } from '../../db/tenant-db.service';
import {
  ChatsRepository,
  MessagesRepository,
} from '../../chats/chats-repository';
import { summarizeEval, type EvalQueryResult } from '../core';
import { SearchIndexService } from '../search-index.service';
import { EVAL_FIXTURES, EVAL_QUERIES, FLOOR_CATEGORIES } from './dataset';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = any;
const K = 10;

describeIfDb('chat search — relevance eval', () => {
  let sqlClient: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let u: string;
  const chatIdByKey = new Map<string, string>();
  const results: EvalQueryResult[] = [];

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sqlClient = connect(TEST_DB_URL!, { ssl, max: 3 });
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

  it('records the relevance baseline (Recall@10, MRR, zero-result-rate)', () => {
    const summary = summarizeEval(results, K);
    if (process.env['RUN_SEARCH_EVAL']) {
      // eslint-disable-next-line no-console
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
});
