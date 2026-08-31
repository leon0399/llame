/**
 * chat-search-embeddings/operations (layer 7) — `backfill`, `prune`,
 * `retry-failed`, and the coverage readout (`llame_search_embedding_report`)
 * against a live DB (RLS). Covers:
 * - backfill enumerates outstanding chats via the EXISTING
 *   `llame_search_embedding_coverage` and enqueues one job per chat,
 *   structurally issuing no provider request (its own signature has no
 *   backend parameter to call one with) and writing no ledger row;
 * - a second backfill run against an already-covered corpus enqueues
 *   nothing;
 * - prune clears all five embedding columns for an undeclared model's
 *   documents, across owners, while a declared model's documents survive
 *   untouched;
 * - retry-failed clears the FOUR attempt-metadata columns (not just the
 *   reason) so `llame_search_embedding_coverage` reports the document
 *   outstanding again;
 * - the coverage readout reports a fully-failed chat (0 outstanding, N
 *   failed) that `llame_search_embedding_coverage`'s own `HAVING` omits —
 *   proving the gap the report function exists to close, and that it
 *   doesn't just look empty for the wrong reason;
 * - backfill reports only the chats that ACTUALLY enqueued when one of
 *   several real, coverage-discovered chats fails to enqueue (review
 *   finding — `enqueueChatEmbedStrict`, not the best-effort dispatcher);
 * - both `llame_search_embedding_coverage` and `llame_search_embedding_report`
 *   are BYPASSRLS-provisioned in this harness (globalSetup runs the
 *   provisioning script), so the fail-loud provisioning check does NOT
 *   false-positive on a correctly provisioned instance;
 * - PUBLIC remains unable to execute all three BYPASSRLS discovery functions
 *   after provisioning transfers their ownership to `app_rls`.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { z } from 'zod';

import * as schema from '../../db/schema';
import { TenantDbService, type Db } from '../../db/tenant-db.service';
import {
  ChatsRepository,
  MessagesRepository,
} from '../../chats/chats-repository';
import { type UnknownRecord } from '../../unknown-record';
import { assertDiscoveryFunctionProvisioned } from '../discovery-provisioning';
import { EMBED_INPUT_VERSION } from '../search-embed.worker';
import { SearchIndexService } from '../search-index.service';
import { runBackfill } from './backfill';
import { getEmbeddingCoverageReport } from './coverage-report';
import { pruneUndeclaredModelVectors } from './prune';
import { retryFailedDocuments } from './retry-failed';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const TEST_UNPRIVILEGED_DB_URL = process.env['TEST_UNPRIVILEGED_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = ReturnType<typeof postgres>;
const text = (t: string) => [{ type: 'text', text: t }];
const MODEL_KEY = 'ops-test-model';

describeIfDb('chat-search-embeddings/operations (layer 7)', () => {
  let sqlClient: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let indexService: SearchIndexService;
  let owner: string;
  let otherOwner: string;

  const ownedRows = <T extends UnknownRecord>(
    userId: string,
    frag: ReturnType<typeof sql>,
    rowSchema: z.ZodType<T>,
  ): Promise<Array<T>> =>
    tenantDb
      .runAs(userId, (tx) => tx.execute(frag))
      .then((rows) => rowSchema.array().parse([...rows]));

  async function seed(
    ownerId: string,
    title: string,
    msgs: Array<{ role: 'user' | 'assistant'; text: string }> = [
      { role: 'user', text: `content for ${title}` },
    ],
  ): Promise<string> {
    const id = crypto.randomUUID();
    await tenantDb.runAs(ownerId, async (tx) => {
      const chats = new ChatsRepository(tx);
      const messages = new MessagesRepository(tx);
      await chats.createIfAbsent({ id, ownerUserId: ownerId, title });
      for (const m of msgs) {
        await messages.create({
          chatId: id,
          role: m.role,
          senderUserId: m.role === 'user' ? ownerId : null,
          parts: text(m.text),
        });
      }
    });
    return id;
  }

  async function contentHashOf(
    ownerId: string,
    chatId: string,
  ): Promise<string> {
    const rows = await ownedRows(
      ownerId,
      sql`SELECT content_hash FROM search_chat_documents WHERE chat_id = ${chatId} LIMIT 1`,
      z.object({ content_hash: z.string() }),
    );
    return rows[0].content_hash;
  }

  /** Stamp a document as successfully embedded under `modelKey` — mirrors
   *  `persistEmbeddingSuccess`'s five columns without going through the
   *  worker (test setup only). */
  async function stampEmbedded(
    ownerId: string,
    chatId: string,
    modelKey: string,
    version: number,
  ): Promise<void> {
    const hash = await contentHashOf(ownerId, chatId);
    await tenantDb.runAs(ownerId, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents
        SET embedding = '[0.1,0.2,0.3]'::vector,
            embedding_model_key = ${modelKey},
            embedded_content_hash = ${hash},
            embed_input_version = ${version},
            embedding_fail_reason = NULL
        WHERE chat_id = ${chatId}`),
    );
  }

  /** Stamp a document as terminally failed under `modelKey` — mirrors
   *  `persistEmbeddingFailure`'s tombstone (all four attempt-metadata
   *  columns), matched against the document's OWN live content hash so the
   *  coverage predicate counts it as failed, not outstanding. No test needs a
   *  distinct reason string, only a non-null one. */
  async function stampFailed(
    ownerId: string,
    chatId: string,
    modelKey: string,
    version: number,
  ): Promise<void> {
    const hash = await contentHashOf(ownerId, chatId);
    await tenantDb.runAs(ownerId, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents
        SET embedding = NULL,
            embedding_model_key = ${modelKey},
            embedded_content_hash = ${hash},
            embed_input_version = ${version},
            embedding_fail_reason = 'terminal test failure'
        WHERE chat_id = ${chatId}`),
    );
  }

  async function coverageRows(
    ownerId: string,
    chatId: string,
  ): Promise<Array<{ needs_embedding_present: boolean }>> {
    return ownedRows(
      ownerId,
      sql`SELECT true AS needs_embedding_present
          FROM llame_search_embedding_coverage(${MODEL_KEY}, ${EMBED_INPUT_VERSION}, 1000)
          WHERE chat_id = ${chatId}`,
      z.object({ needs_embedding_present: z.boolean() }),
    );
  }

  async function ledgerRowExists(modelKey: string): Promise<boolean> {
    const rows = await ownedRows(
      owner,
      sql`SELECT model_key FROM embedding_model_bindings WHERE model_key = ${modelKey}`,
      z.object({ model_key: z.string() }),
    );
    return rows.length > 0;
  }

  /** Insert a ledger row directly — test setup only; the real ledger row is
   *  written by the embed worker's own persist (design D1), not by anything
   *  under test here. */
  async function insertLedgerRow(modelKey: string): Promise<void> {
    await sqlClient`
      INSERT INTO embedding_model_bindings
        (model_key, provider_id, provider_model_id, dimensions)
      VALUES (${modelKey}, 'openai', 'text-embedding-3-small', 1536)
    `;
  }

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sqlClient = postgres(TEST_DB_URL!, { ssl, max: 5 });
    db = drizzle(sqlClient, { schema });
    tenantDb = new TenantDbService(db);
    indexService = new SearchIndexService(tenantDb);
    owner = crypto.randomUUID();
    otherOwner = crypto.randomUUID();
    for (const id of [owner, otherOwner]) {
      await sqlClient`INSERT INTO users (id, name, email) VALUES (${id}, 'Ops', ${`ops-${id}@t.com`})`;
    }
  });

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient`DELETE FROM users WHERE id IN (${owner}, ${otherOwner})`;
      await sqlClient.end();
    }
  });

  describe('backfill', () => {
    it('enumerates outstanding chats via the coverage function, enqueues one job per chat, and writes no ledger row itself', async () => {
      const modelKey = `backfill-${crypto.randomUUID()}`;
      const id = await seed(owner, 'Outstanding for backfill');
      await indexService.reindexChat(id, owner);

      const enqueueChatEmbedStrict = vi.fn().mockResolvedValue(undefined);
      const { enqueued, failures } = await runBackfill(
        tenantDb,
        { enqueueChatEmbedStrict },
        modelKey,
        EMBED_INPUT_VERSION,
      );

      expect(enqueued).toBeGreaterThanOrEqual(1);
      expect(failures).toEqual([]);
      expect(enqueueChatEmbedStrict).toHaveBeenCalledWith(id, owner);
      // Structural proof of "no provider request": runBackfill's own
      // signature carries no backend, and it wrote no row of its own — only
      // a WORKER's real persist creates the binding ledger row (design D1).
      expect(await ledgerRowExists(modelKey)).toBe(false);
    });

    it('a second run does not re-enqueue an already-covered chat', async () => {
      // A fresh, per-test model key means coverage() legitimately reports
      // every OTHER chat in the shared integration database as outstanding
      // for it too (never embedded under this exact key) — this test only
      // asserts about the ONE chat it stamped as covered, not the corpus
      // total, so it stays correct regardless of what else is in the DB.
      const modelKey = `backfill-covered-${crypto.randomUUID()}`;
      const id = await seed(owner, 'Already covered');
      await indexService.reindexChat(id, owner);
      await stampEmbedded(owner, id, modelKey, EMBED_INPUT_VERSION);

      const enqueueChatEmbedStrict = vi.fn().mockResolvedValue(undefined);
      await runBackfill(
        tenantDb,
        { enqueueChatEmbedStrict },
        modelKey,
        EMBED_INPUT_VERSION,
      );

      expect(enqueueChatEmbedStrict).not.toHaveBeenCalledWith(id, owner);
    });

    it('reports only the chats that actually enqueued when one of several real, coverage-discovered chats fails (review finding)', async () => {
      // Confirmed to fail first: against the pre-fix `runBackfill` (counting
      // `list.length`, enqueuing via the best-effort `enqueueChatEmbed`
      // which swallows its own failures), this scenario returned
      // `enqueued: 2` with no failures reported at all — the exact
      // "prints a reassuring number for work that didn't happen" bug.
      const modelKey = `backfill-partial-fail-${crypto.randomUUID()}`;
      const okChat = await seed(owner, 'Enqueues fine');
      const failChat = await seed(owner, 'Enqueue fails');
      await indexService.reindexChat(okChat, owner);
      await indexService.reindexChat(failChat, owner);

      const enqueueChatEmbedStrict = vi.fn((chatId: string) =>
        chatId === failChat
          ? Promise.reject(new Error('queue unreachable'))
          : Promise.resolve(`job-${chatId}`),
      );

      const { enqueued, failures } = await runBackfill(
        tenantDb,
        { enqueueChatEmbedStrict },
        modelKey,
        EMBED_INPUT_VERSION,
      );

      expect(enqueueChatEmbedStrict).toHaveBeenCalledWith(okChat, owner);
      expect(enqueueChatEmbedStrict).toHaveBeenCalledWith(failChat, owner);
      // Both chats were among the enqueue ATTEMPTS, but only okChat actually
      // succeeded — `enqueued` must reflect that, not the attempt count (a
      // fresh model key may also legitimately pick up other pre-existing
      // chats in this shared database, so this asserts "at least the one
      // that really succeeded," not an exact corpus-wide total).
      expect(enqueued).toBeGreaterThanOrEqual(1);
      expect(
        failures.some(
          (f) => f.chatId === failChat && f.message === 'queue unreachable',
        ),
      ).toBe(true);
      expect(failures.some((f) => f.chatId === okChat)).toBe(false);
    });
  });

  describe('discovery provisioning (fail-loud read paths)', () => {
    it('does not throw for llame_search_embedding_coverage — this harness runs pnpm db:provision-rls in globalSetup', async () => {
      await expect(
        assertDiscoveryFunctionProvisioned(
          tenantDb,
          'llame_search_embedding_coverage',
        ),
      ).resolves.toBeUndefined();
    });

    it('does not throw for llame_search_embedding_report — same provisioning lifecycle as coverage()', async () => {
      await expect(
        assertDiscoveryFunctionProvisioned(
          tenantDb,
          'llame_search_embedding_report',
        ),
      ).resolves.toBeUndefined();
    });

    it('does not grant PUBLIC access to the BYPASSRLS embedding discovery functions', async () => {
      if (!TEST_UNPRIVILEGED_DB_URL) {
        const rows = await sqlClient`
          SELECT p.proname, has_function_privilege('pg_monitor', p.oid, 'EXECUTE') AS can_execute
          FROM pg_proc p
          WHERE p.proname IN (
            'llame_search_embedding_coverage',
            'llame_search_embedding_backlog',
            'llame_search_embedding_report'
          )
          ORDER BY p.proname
        `;
        expect(rows).toEqual([
          { proname: 'llame_search_embedding_backlog', can_execute: false },
          { proname: 'llame_search_embedding_coverage', can_execute: false },
          { proname: 'llame_search_embedding_report', can_execute: false },
        ]);
        return;
      }

      const ssl = /sslmode=require/.test(TEST_UNPRIVILEGED_DB_URL)
        ? 'require'
        : false;
      const unprivileged = postgres(TEST_UNPRIVILEGED_DB_URL, {
        ssl,
        max: 1,
      });
      try {
        for (const statement of [
          `SELECT * FROM llame_search_embedding_coverage('probe', 1, 1)`,
          `SELECT * FROM llame_search_embedding_backlog(1)`,
          `SELECT * FROM llame_search_embedding_report('probe', 1, 1)`,
        ]) {
          await expect(unprivileged.unsafe(statement)).rejects.toMatchObject({
            code: '42501',
          });
        }
      } finally {
        await unprivileged.end();
      }
    });
  });

  describe('prune', () => {
    it("clears an undeclared model's vectors across owners while a declared model's vectors survive", async () => {
      const declaredModel = `declared-${crypto.randomUUID()}`;
      const undeclaredModel = `undeclared-${crypto.randomUUID()}`;

      const keptChat = await seed(owner, 'Under a declared model');
      await indexService.reindexChat(keptChat, owner);
      await stampEmbedded(owner, keptChat, declaredModel, EMBED_INPUT_VERSION);

      const prunedChatOwner1 = await seed(
        owner,
        'Under an undeclared model, owner 1',
      );
      await indexService.reindexChat(prunedChatOwner1, owner);
      await stampEmbedded(
        owner,
        prunedChatOwner1,
        undeclaredModel,
        EMBED_INPUT_VERSION,
      );

      const prunedChatOwner2 = await seed(
        otherOwner,
        'Under an undeclared model, owner 2',
      );
      await indexService.reindexChat(prunedChatOwner2, otherOwner);
      await stampEmbedded(
        otherOwner,
        prunedChatOwner2,
        undeclaredModel,
        EMBED_INPUT_VERSION,
      );

      // Ledger rows for both models — a real worker persist writes these
      // (design D1), so prune must retire the undeclared one without
      // touching the declared one.
      await insertLedgerRow(declaredModel);
      await insertLedgerRow(undeclaredModel);

      const { prunedDocuments, affectedOwners, retiredBindings } =
        await pruneUndeclaredModelVectors(tenantDb, [declaredModel]);

      expect(prunedDocuments).toBeGreaterThanOrEqual(2);
      expect(affectedOwners).toBe(2);
      expect(retiredBindings).toBeGreaterThanOrEqual(1);
      expect(await ledgerRowExists(undeclaredModel)).toBe(false);
      expect(await ledgerRowExists(declaredModel)).toBe(true);

      const [keptRow] = await ownedRows(
        owner,
        sql`SELECT embedding_model_key, embedding IS NOT NULL AS has_embedding
            FROM search_chat_documents WHERE chat_id = ${keptChat}`,
        z.object({
          embedding_model_key: z.string().nullable(),
          has_embedding: z.boolean(),
        }),
      );
      expect(keptRow.embedding_model_key).toBe(declaredModel);
      expect(keptRow.has_embedding).toBe(true);

      for (const [ownerId, chatId] of [
        [owner, prunedChatOwner1],
        [otherOwner, prunedChatOwner2],
      ] as const) {
        const [prunedRow] = await ownedRows(
          ownerId,
          sql`SELECT embedding_model_key, embedded_content_hash, embed_input_version,
                     embedding_fail_reason, embedding IS NOT NULL AS has_embedding
              FROM search_chat_documents WHERE chat_id = ${chatId}`,
          z.object({
            embedding_model_key: z.string().nullable(),
            embedded_content_hash: z.string().nullable(),
            embed_input_version: z.number().nullable(),
            embedding_fail_reason: z.string().nullable(),
            has_embedding: z.boolean(),
          }),
        );
        expect(prunedRow.embedding_model_key).toBeNull();
        expect(prunedRow.embedded_content_hash).toBeNull();
        expect(prunedRow.embed_input_version).toBeNull();
        expect(prunedRow.embedding_fail_reason).toBeNull();
        expect(prunedRow.has_embedding).toBe(false);
      }

      // `embedding_model_bindings` is global with no owner/cascade — clean
      // up the row this test inserted directly so it doesn't linger in the
      // shared integration database.
      await sqlClient`DELETE FROM embedding_model_bindings WHERE model_key = ${declaredModel}`;
    });
  });

  describe('retry-failed', () => {
    it('clears attempt metadata so the coverage function reports the document outstanding again, not failed', async () => {
      const id = await seed(owner, 'Terminally failed then retried');
      await indexService.reindexChat(id, owner);
      await stampFailed(owner, id, MODEL_KEY, EMBED_INPUT_VERSION);

      // Before retry: NOT reported outstanding by coverage (it is failed).
      expect(await coverageRows(owner, id)).toEqual([]);

      const { clearedDocuments, affectedOwners } = await retryFailedDocuments(
        tenantDb,
        MODEL_KEY,
        EMBED_INPUT_VERSION,
      );
      expect(clearedDocuments).toBeGreaterThanOrEqual(1);
      expect(affectedOwners).toBeGreaterThanOrEqual(1);

      // After retry: reported outstanding again.
      expect(await coverageRows(owner, id)).toEqual([
        { needs_embedding_present: true },
      ]);

      const [row] = await ownedRows(
        owner,
        sql`SELECT embedding_model_key, embedded_content_hash, embed_input_version,
                   embedding_fail_reason
            FROM search_chat_documents WHERE chat_id = ${id}`,
        z.object({
          embedding_model_key: z.string().nullable(),
          embedded_content_hash: z.string().nullable(),
          embed_input_version: z.number().nullable(),
          embedding_fail_reason: z.string().nullable(),
        }),
      );
      expect(row.embedding_model_key).toBeNull();
      expect(row.embedded_content_hash).toBeNull();
      expect(row.embed_input_version).toBeNull();
      expect(row.embedding_fail_reason).toBeNull();
    });

    it("leaves a failure recorded under a different model untouched (it is already outstanding, not this call's concern)", async () => {
      const otherModel = `other-model-${crypto.randomUUID()}`;
      const id = await seed(owner, 'Failed under a different model');
      await indexService.reindexChat(id, owner);
      await stampFailed(owner, id, otherModel, EMBED_INPUT_VERSION);

      await retryFailedDocuments(tenantDb, MODEL_KEY, EMBED_INPUT_VERSION);

      const [row] = await ownedRows(
        owner,
        sql`SELECT embedding_fail_reason FROM search_chat_documents WHERE chat_id = ${id}`,
        z.object({ embedding_fail_reason: z.string().nullable() }),
      );
      expect(row.embedding_fail_reason).not.toBeNull();
    });
  });

  describe('coverage report (llame_search_embedding_report)', () => {
    it('reports a fully-failed chat (0 outstanding, N failed) that llame_search_embedding_coverage omits entirely', async () => {
      const id = await seed(owner, 'Every document failed');
      await indexService.reindexChat(id, owner);
      await stampFailed(owner, id, MODEL_KEY, EMBED_INPUT_VERSION);

      // The gap this layer closes: the untouched coverage() function returns
      // NOTHING for this chat — indistinguishable from "nothing outstanding,
      // all fine" without the report function.
      expect(await coverageRows(owner, id)).toEqual([]);

      const report = await getEmbeddingCoverageReport(
        tenantDb,
        MODEL_KEY,
        EMBED_INPUT_VERSION,
        1000,
      );
      const row = report.find((r) => r.chatId === id);
      expect(row).toBeDefined();
      expect(row).toMatchObject({ outstanding: 0, embedded: 0, failed: 1 });
    });

    it('reports ordinary outstanding lag identically to coverage()', async () => {
      const id = await seed(owner, 'Ordinary outstanding lag');
      await indexService.reindexChat(id, owner);

      const report = await getEmbeddingCoverageReport(
        tenantDb,
        MODEL_KEY,
        EMBED_INPUT_VERSION,
        1000,
      );
      const row = report.find((r) => r.chatId === id);
      expect(row).toBeDefined();
      expect(row!.outstanding).toBeGreaterThanOrEqual(1);
      expect(row!.failed).toBe(0);
    });
  });
});
