/**
 * SearchEmbedWorker.embedChat on a live DB (RLS), chat-search-embeddings
 * design D5/D7/D15/D16, task 6.6-6.11:
 * - a batch of outstanding documents is embedded and persisted correctly;
 * - the persist writes EXACTLY the five embedding columns — never
 *   `chats.updated_at` or `search_chat_state` (trap 3/D15 "no feedback loop");
 * - a terminal failure tombstones ALL FOUR attempt-metadata columns in one
 *   statement, not just the reason (trap 4), and the tombstoned document is
 *   never re-attempted at the same content;
 * - the D7 conditional-update guards: an edit between select and persist, a
 *   delete between select and persist, and an input-version bump — nothing
 *   is written for superseded content in any case;
 * - the adapter is called with exactly one persist-batch, never the whole
 *   outstanding set (trap 6);
 * - a batch that makes zero progress (no throw, nothing written) stops the
 *   job without an unthrottled retry loop;
 * - a job bounded by EMBED_MAX_BATCHES_PER_JOB re-enqueues itself when work
 *   remains, and a chat far larger than one job's bound is fully embedded
 *   across several coalesced job runs.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { MockEmbeddingModelV3 } from 'ai/test';
import postgres from 'postgres';
import { z } from 'zod';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  BUILT_IN_DEFAULTS,
  type EmbeddingModelCatalogEntry,
} from '../instance-config/llame-config';
import { WorkerProfileService } from '../instance-config/worker-profile.service';
import { QUEUE } from '../queue/queue';
import { type UnknownRecord } from '@workspace/runtime-safety';
import {
  type EmbeddingBackend,
  type EmbeddingDocumentInput,
  type EmbeddingResult,
} from './core';
import {
  createOpenAIEmbeddingBackend,
  EmbeddingBackendError,
  type OpenAIEmbeddingProvider,
} from './openai-embedding-backend';
import {
  EMBED_INPUT_VERSION,
  EMBED_MAX_BATCHES_PER_JOB,
  SearchEmbedWorker,
} from './search-embed.worker';
import { SearchEmbedDispatchService } from './search-embed-dispatch.service';
import { SearchIndexService } from './search-index.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = ReturnType<typeof postgres>;
const text = (t: string) => [{ type: 'text', text: t }];
const MODEL_KEY = 'embed-model-a';

const MODEL: EmbeddingModelCatalogEntry = {
  id: MODEL_KEY,
  provider: 'provider-a',
  providerModelId: 'text-embedding-3-small',
  dimensions: 3,
  batchSize: 8,
  distanceMetric: 'cosine',
};

describeIfDb('SearchEmbedWorker.embedChat', () => {
  let sqlClient: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let indexService: SearchIndexService;
  let u: string;
  let openModules: Array<TestingModule>;

  const ownedRows = <T extends UnknownRecord>(
    frag: ReturnType<typeof sql>,
    rowSchema: z.ZodType<T>,
  ): Promise<Array<T>> =>
    tenantDb
      .runAs(u, (tx) => tx.execute(frag))
      .then((rows) => rowSchema.array().parse([...rows]));

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

  /** Builds a worker wired to the REAL TenantDbService (RLS-enforced) and a
   *  fake, spy-able dispatch/queue/config — matches
   *  search-reindex.worker.test.ts's DI pattern, adapted for a live DB. */
  async function buildWorker(overrides?: {
    enqueueChatEmbed?: (chatId: string, ownerUserId: string) => Promise<void>;
  }) {
    const enqueueChatEmbed =
      overrides?.enqueueChatEmbed ?? vi.fn().mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchEmbedWorker,
        { provide: QUEUE, useValue: {} },
        { provide: TenantDbService, useFactory: () => tenantDb },
        {
          provide: SearchEmbedDispatchService,
          useValue: { enqueueChatEmbed },
        },
        {
          provide: WorkerProfileService,
          useValue: { concurrencyFor: () => 1 },
        },
        {
          provide: InstanceConfigService,
          useValue: {
            config: {
              ...BUILT_IN_DEFAULTS,
              providers: [
                { id: 'provider-a', type: 'openai', key: 'k', baseUrl: null },
              ],
              embeddingModels: [MODEL],
              search: { chats: { embeddingModelId: MODEL_KEY } },
            },
          },
        },
      ],
    }).compile();
    openModules.push(moduleRef);
    return {
      worker: moduleRef.get(SearchEmbedWorker),
      enqueueChatEmbed,
    };
  }

  function fakeBackend(
    embedDocuments: (
      documents: ReadonlyArray<EmbeddingDocumentInput>,
    ) => Promise<Array<EmbeddingResult>>,
  ): EmbeddingBackend {
    return {
      embedDocuments,
      embedQuery: () => {
        throw new Error('embedQuery is not exercised by this suite');
      },
    };
  }

  function vector(seed: number): ReadonlyArray<number> {
    return [seed, seed + 1, seed + 2];
  }

  async function embeddingRow(id: string) {
    const [row] = await ownedRows(
      sql`
      SELECT content_hash, embedding::text AS embedding, embedding_model_key,
             embedded_content_hash, embed_input_version, embedding_fail_reason
      FROM search_chat_documents WHERE id = ${id}`,
      z.object({
        content_hash: z.string(),
        embedding: z.string().nullable(),
        embedding_model_key: z.string().nullable(),
        embedded_content_hash: z.string().nullable(),
        embed_input_version: z.number().nullable(),
        embedding_fail_reason: z.string().nullable(),
      }),
    );
    return row;
  }

  async function firstDocId(chatId: string): Promise<string> {
    const [{ id }] = await ownedRows(
      sql`SELECT id FROM search_chat_documents WHERE chat_id = ${chatId} ORDER BY chunk_ordinal LIMIT 1`,
      z.object({ id: z.string() }),
    );
    return id;
  }

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sqlClient = postgres(TEST_DB_URL!, { ssl, max: 5 });
    db = drizzle(sqlClient, { schema });
    tenantDb = new TenantDbService(db);
    indexService = new SearchIndexService(tenantDb);
    u = crypto.randomUUID();
    await sqlClient`INSERT INTO users (id, name, email) VALUES (${u}, 'E', ${`e-${u}@t.com`})`;
  });

  beforeEach(() => {
    openModules = [];
  });

  afterEach(async () => {
    await Promise.all(openModules.map((moduleRef) => moduleRef.close()));
  });

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient`DELETE FROM users WHERE id = ${u}`;
      await sqlClient.end();
    }
  });

  it('embeds outstanding documents and persists the vector, model key, hash, and input version', async () => {
    const id = await seed('Basic embed', [
      { role: 'user', text: 'find this with a vector one day' },
    ]);
    await indexService.reindexChat(id, u);
    const docId = await firstDocId(id);

    const { worker } = await buildWorker();
    const backend = fakeBackend((documents) =>
      Promise.resolve(
        documents.map((d) => ({
          documentId: d.documentId,
          contentHash: d.contentHash,
          embedding: vector(1),
        })),
      ),
    );
    await worker.embedChat(id, u, MODEL, backend);

    const row = await embeddingRow(docId);
    expect(row.embedding).toBe('[1,2,3]');
    expect(row.embedding_model_key).toBe(MODEL_KEY);
    expect(row.embedded_content_hash).toBe(row.content_hash);
    expect(row.embed_input_version).toBe(EMBED_INPUT_VERSION);
    expect(row.embedding_fail_reason).toBeNull();
  });

  // design D1: the binding ledger row is written on the FIRST PERSISTED
  // vector for a key — never on declaration. Its mere existence is also
  // the signal SearchReindexWorker's embed-backlog sweep gates on (design
  // D6, see search-reindex.worker.integration.test.ts), so this table's
  // correctness matters beyond the ledger's own boot-check use. A fresh,
  // per-test model key avoids collision with MODEL_KEY, which other tests
  // in this file also persist under.
  // Regression (review, PR #534): a short result array on a model's FIRST-EVER
  // batch used to return success. Nothing persisted, so no ledger row was
  // written; and `runEmbedBacklogSweep`'s D6 gate returns early while there is
  // no ledger row — so the sweep it deferred to could never run, and the chat
  // stayed outstanding and invisible until someone re-ran `search:backfill` by
  // hand. It must surface instead.
  it('throws when the first-ever batch persists nothing, since no sweep can recover it', async () => {
    const id = await seed('First batch short-changed', [
      { role: 'user', text: 'this one is never embedded' },
    ]);
    await indexService.reindexChat(id, u);

    const { worker } = await buildWorker();
    // A model key this suite has never persisted under, so there is genuinely
    // no ledger row — MODEL already has one from the tests above.
    const freshModel = { ...MODEL, id: `first-batch-${crypto.randomUUID()}` };
    // Fewer results than documents sent: the adapter discards the chunk.
    const shortBackend = fakeBackend(() => Promise.resolve([]));

    await expect(
      worker.embedChat(id, u, freshModel, shortBackend),
    ).rejects.toThrow(/no backlog sweep can recover/);

    // Once a ledger row exists the original behaviour is correct — the sweep
    // CAN re-discover the batch — so a later short batch must NOT throw.
    const goodBackend = fakeBackend((documents) =>
      Promise.resolve(
        documents.map((d) => ({
          documentId: d.documentId,
          contentHash: d.contentHash,
          embedding: vector(9),
        })),
      ),
    );
    await worker.embedChat(id, u, freshModel, goodBackend);

    const other = await seed('Later short batch', [
      { role: 'user', text: 'a second chat, embedded later' },
    ]);
    await indexService.reindexChat(other, u);
    await expect(
      worker.embedChat(other, u, freshModel, shortBackend),
    ).resolves.not.toThrow();
  });

  it('writes the binding ledger row on the first persisted vector, and is a no-op thereafter', async () => {
    const modelId = `ledger-model-${crypto.randomUUID()}`;
    const model = { ...MODEL, id: modelId };
    const ledgerRow = () =>
      ownedRows(
        sql`SELECT provider_id, provider_model_id, dimensions, distance_metric,
                   document_prefix, query_prefix, batch_size
            FROM embedding_model_bindings WHERE model_key = ${modelId}`,
        z.object({
          provider_id: z.string(),
          provider_model_id: z.string(),
          dimensions: z.number(),
          distance_metric: z.string(),
          document_prefix: z.string().nullable(),
          query_prefix: z.string().nullable(),
          batch_size: z.number().nullable(),
        }),
      );

    expect(await ledgerRow()).toEqual([]);

    const id = await seed('Bootstraps the ledger', [
      { role: 'user', text: 'first ever vector for this model key' },
    ]);
    await indexService.reindexChat(id, u);
    const { worker } = await buildWorker();
    const backend = fakeBackend((documents) =>
      Promise.resolve(
        documents.map((d) => ({
          documentId: d.documentId,
          contentHash: d.contentHash,
          embedding: vector(9),
        })),
      ),
    );
    await worker.embedChat(id, u, model, backend);

    const [row] = await ledgerRow();
    expect(row).toEqual({
      provider_id: model.provider,
      provider_model_id: model.providerModelId,
      dimensions: model.dimensions,
      distance_metric: model.distanceMetric,
      document_prefix: null,
      query_prefix: null,
      batch_size: model.batchSize,
    });

    // A second chat, second successful persist under the SAME key: the
    // ledger write is onConflictDoNothing, so this must not error and must
    // leave exactly one row.
    const secondId = await seed('Second document, same model', [
      { role: 'user', text: 'a second document embedded under the same key' },
    ]);
    await indexService.reindexChat(secondId, u);
    await worker.embedChat(secondId, u, model, backend);
    expect(await ledgerRow()).toHaveLength(1);
  });

  // trap 3 / D15 "no feedback loop": writing chats.updated_at or
  // search_chat_state from the embed path would let the lexical staleness
  // predicate re-flag the chat -> rebuild -> re-enqueue embed -> forever.
  // Verified by breaking persistEmbeddingSuccess to also write `updated_at`:
  // the assertion below FAILED (updated_at moved and the row diverged from
  // its pre-embed snapshot) before the fix, and passes now that the persist
  // touches exactly the five embedding columns.
  it('writes only the five embedding columns — never chats.updated_at or search_chat_state (trap 3)', async () => {
    const id = await seed('No feedback loop', [
      { role: 'user', text: 'must not retrigger the lexical sweep' },
    ]);
    await indexService.reindexChat(id, u);

    const snapshot = () =>
      ownedRows(
        sql`
        SELECT
          (SELECT updated_at::text FROM chats WHERE id = ${id}) AS chat_updated_at,
          (SELECT indexed_at::text FROM search_chat_state WHERE chat_id = ${id}) AS indexed_at,
          (SELECT updated_at::text FROM search_chat_state WHERE chat_id = ${id}) AS state_updated_at`,
        z.object({
          chat_updated_at: z.string(),
          indexed_at: z.string(),
          state_updated_at: z.string(),
        }),
      );
    const [before] = await snapshot();

    // Give the clock room to move so an accidental `now()` write would be
    // observable, not masked by same-millisecond timestamps.
    await new Promise((r) => setTimeout(r, 25));

    const { worker } = await buildWorker();
    const backend = fakeBackend((documents) =>
      Promise.resolve(
        documents.map((d) => ({
          documentId: d.documentId,
          contentHash: d.contentHash,
          embedding: vector(2),
        })),
      ),
    );
    await worker.embedChat(id, u, MODEL, backend);

    const [after] = await snapshot();
    expect(after).toEqual(before);
  });

  // trap 4: a reason-only failure write leaves the other three attempt-
  // metadata columns NULL, which the coverage predicate's IS DISTINCT FROM
  // checks would then read as "still needs embedding" forever — the exact
  // failure the tombstone exists to prevent. Verified by breaking
  // persistEmbeddingFailure to write only embedding_fail_reason: the
  // "not re-attempted" assertion below FAILED (the second embedChat call
  // re-invoked the backend for the same document) before the fix, and
  // passes now that all four columns are stamped together.
  it('a terminal failure stamps all four attempt-metadata columns and is never retried at the same content (trap 4)', async () => {
    const id = await seed('Terminal failure', [
      { role: 'user', text: 'this one will fail terminally' },
    ]);
    await indexService.reindexChat(id, u);
    const docId = await firstDocId(id);

    const { worker } = await buildWorker();
    const terminalError = new EmbeddingBackendError(
      'embedding provider request failed (HTTP 401)',
      true,
    );
    const failingBackend = fakeBackend(() => Promise.reject(terminalError));
    await worker.embedChat(id, u, MODEL, failingBackend);

    const row = await embeddingRow(docId);
    expect(row.embedding).toBeNull();
    expect(row.embedding_model_key).toBe(MODEL_KEY);
    expect(row.embedded_content_hash).toBe(row.content_hash);
    expect(row.embed_input_version).toBe(EMBED_INPUT_VERSION);
    expect(row.embedding_fail_reason).toBe(terminalError.message);

    // Not re-attempted: a second pass at the SAME content must not call the
    // backend again for this document.
    const secondCallDocumentIds: Array<string> = [];
    const trackingBackend = fakeBackend((documents) => {
      secondCallDocumentIds.push(...documents.map((d) => d.documentId));
      return Promise.resolve([]);
    });
    await worker.embedChat(id, u, MODEL, trackingBackend);
    expect(secondCallDocumentIds).not.toContain(docId);
  });

  it('a transient failure is NOT tombstoned and is retried (rethrown for the queue policy)', async () => {
    const id = await seed('Transient failure', [
      { role: 'user', text: 'this one fails transiently' },
    ]);
    await indexService.reindexChat(id, u);
    const docId = await firstDocId(id);

    const { worker } = await buildWorker();
    const transientError = new EmbeddingBackendError(
      'embedding provider request failed (HTTP 429)',
      false,
    );
    const backend = fakeBackend(() => Promise.reject(transientError));
    await expect(worker.embedChat(id, u, MODEL, backend)).rejects.toThrow(
      transientError,
    );

    const row = await embeddingRow(docId);
    expect(row.embedding_fail_reason).toBeNull();
    expect(row.embedding_model_key).toBeNull();
  });

  // End-to-end proof of the High-severity gap a later code review found: a
  // vector failing the REAL adapter's own dimension validation (systematic —
  // every call to this misconfigured model returns the wrong width) must
  // reach the SAME tombstone path a terminal provider error does, not the
  // silent-continue path. Goes through the real `createOpenAIEmbeddingBackend`
  // (a fake provider swaps only the HTTP boundary, same pattern as
  // `openai-embedding-backend.test.ts`'s `withModel`), not the `fakeBackend`
  // test double the rest of this file uses, because the bug lived in the
  // adapter itself.
  it('a systematic dimensions mismatch tombstones every document with a reason naming both widths, is reported failed (not outstanding) by coverage, and is never re-swept', async () => {
    const id = await seed('Systematic dimension mismatch', [
      { role: 'user', text: 'this model is misconfigured for its provider' },
    ]);
    await indexService.reindexChat(id, u);
    const docId = await firstDocId(id);

    // Configured for 3 dimensions; the "provider" always returns 5-wide
    // vectors — a stand-in for `dimensions` configured narrower/wider than
    // the provider's actual output.
    const wrongWidthModel = new MockEmbeddingModelV3({
      maxEmbeddingsPerCall: null,
      doEmbed: (options) =>
        Promise.resolve({
          embeddings: options.values.map(() => [1, 2, 3, 4, 5]),
          warnings: [],
        }),
    });
    const realBackend = createOpenAIEmbeddingBackend(
      { providerModelId: 'm', dimensions: 3 },
      {
        createOpenAI: () => {
          const provider: OpenAIEmbeddingProvider = {
            textEmbeddingModel: () => wrongWidthModel,
          };
          return provider;
        },
      },
    );

    const { worker } = await buildWorker();
    await worker.embedChat(id, u, MODEL, realBackend);

    const row = await embeddingRow(docId);
    expect(row.embedding).toBeNull();
    expect(row.embedding_model_key).toBe(MODEL_KEY);
    expect(row.embedded_content_hash).toBe(row.content_hash);
    expect(row.embed_input_version).toBe(EMBED_INPUT_VERSION);
    // The operator's only signal: names both the expected and received width.
    expect(row.embedding_fail_reason).toContain('3');
    expect(row.embedding_fail_reason).toContain('5');

    // Reported FAILED, not outstanding. llame_search_embedding_coverage
    // (design D10) HAVING-filters to chats with STILL-outstanding work only
    // (a reporting concern — don't list chats with nothing left to do), so a
    // chat with zero outstanding rows is correctly ABSENT from its result
    // set even though one of its documents failed; that absence is itself
    // part of the proof (an un-tombstoned/still-outstanding row would keep
    // the chat listed). The classification itself — the thing "failed, not
    // outstanding" actually means — is verified directly against the exact
    // predicate the function's CTE uses.
    const coverageRow = await ownedRows(
      sql`SELECT chat_id FROM llame_search_embedding_coverage(${MODEL_KEY}, ${EMBED_INPUT_VERSION}, 1000) WHERE chat_id = ${id}`,
      z.object({ chat_id: z.string() }),
    );
    expect(coverageRow).toEqual([]);

    const classification = await ownedRows(
      sql`
        SELECT
          (embedding_model_key      IS DISTINCT FROM ${MODEL_KEY}
           OR embedded_content_hash IS DISTINCT FROM content_hash
           OR embed_input_version   IS DISTINCT FROM ${EMBED_INPUT_VERSION}
           OR (embedding IS NULL AND embedding_fail_reason IS NULL)) AS needs_embedding,
          (embedding_fail_reason IS NOT NULL) AS has_failure
        FROM search_chat_documents WHERE id = ${docId}`,
      z.object({ needs_embedding: z.boolean(), has_failure: z.boolean() }),
    );
    expect(classification).toEqual([
      { needs_embedding: false, has_failure: true },
    ]);

    // Never re-swept: the tombstoned chat does not appear in the sweep's own
    // discovery function (the static never-attempted branch it reads no
    // longer matches this row), and a second embedChat pass calls the
    // backend for nothing.
    const backlog = await ownedRows(
      sql`SELECT chat_id FROM llame_search_embedding_backlog(1000) WHERE chat_id = ${id}`,
      z.object({ chat_id: z.string() }),
    );
    expect(backlog).toEqual([]);

    const secondPassDocumentIds: Array<string> = [];
    const trackingBackend = fakeBackend((documents) => {
      secondPassDocumentIds.push(...documents.map((d) => d.documentId));
      return Promise.resolve([]);
    });
    await worker.embedChat(id, u, MODEL, trackingBackend);
    expect(secondPassDocumentIds).not.toContain(docId);
  });

  // D7 guard #1: content edited between the outstanding-batch read and the
  // provider call returning.
  it('discards the result and writes nothing when the document is edited mid-flight (D7 guard)', async () => {
    const id = await seed('Edited mid-flight', [
      { role: 'user', text: 'original phrasing before the race' },
    ]);
    await indexService.reindexChat(id, u);
    const docId = await firstDocId(id);
    const [{ id: msgId }] = await ownedRows(
      sql`SELECT id FROM messages WHERE chat_id = ${id} LIMIT 1`,
      z.object({ id: z.string() }),
    );

    const { worker } = await buildWorker();
    const backend = fakeBackend(async (documents) => {
      // Simulate a concurrent turn landing while the provider call for THIS
      // batch is still in flight.
      await tenantDb.runAs(u, (tx) =>
        tx.execute(
          sql`UPDATE messages SET parts = ${JSON.stringify(text('a completely different phrasing'))}::jsonb WHERE id = ${msgId}`,
        ),
      );
      await indexService.reindexChat(id, u);
      return documents.map((d) => ({
        documentId: d.documentId,
        contentHash: d.contentHash, // the STALE hash the batch was read with
        embedding: vector(3),
      }));
    });
    await worker.embedChat(id, u, MODEL, backend);

    const row = await embeddingRow(docId);
    expect(row.embedding).toBeNull(); // discarded — never written for superseded content
  });

  // D7 guard #2: the chat (and cascade-deleted document row) disappears
  // between the outstanding-batch read and the provider call returning.
  it('writes nothing (silent no-op, no crash) when the chat is deleted mid-flight (D7 guard)', async () => {
    const id = await seed('Deleted mid-flight', [
      { role: 'user', text: 'will be deleted before the write' },
    ]);
    await indexService.reindexChat(id, u);

    const { worker } = await buildWorker();
    const backend = fakeBackend(async (documents) => {
      await tenantDb.runAs(u, (tx) =>
        tx.execute(sql`DELETE FROM chats WHERE id = ${id}`),
      );
      return documents.map((d) => ({
        documentId: d.documentId,
        contentHash: d.contentHash,
        embedding: vector(4),
      }));
    });
    await expect(
      worker.embedChat(id, u, MODEL, backend),
    ).resolves.toBeUndefined();

    const remaining = await ownedRows(
      sql`SELECT count(*)::int AS n FROM search_chat_documents WHERE chat_id = ${id}`,
      z.object({ n: z.number() }),
    );
    expect(remaining[0].n).toBe(0);
  });

  // D7 guard #3: an input-version bump invalidates an existing vector with
  // NO content change — re-embedding, not a race.
  it('re-embeds a document whose recorded embed_input_version is stale, with no content change', async () => {
    const id = await seed('Stale input version', [
      { role: 'user', text: 'unchanged content across a version bump' },
    ]);
    await indexService.reindexChat(id, u);
    const docId = await firstDocId(id);
    const [{ content_hash }] = await ownedRows(
      sql`SELECT content_hash FROM search_chat_documents WHERE id = ${docId}`,
      z.object({ content_hash: z.string() }),
    );
    // Simulate a vector already embedded under an OLDER input version, same
    // model key and content hash (no content change).
    await tenantDb.runAs(u, (tx) =>
      tx.execute(sql`
        UPDATE search_chat_documents
        SET embedding = '[9,9,9]'::vector,
            embedding_model_key = ${MODEL_KEY},
            embedded_content_hash = ${content_hash},
            embed_input_version = ${EMBED_INPUT_VERSION - 1}
        WHERE id = ${docId}`),
    );

    const { worker } = await buildWorker();
    const backend = fakeBackend((documents) =>
      Promise.resolve(
        documents.map((d) => ({
          documentId: d.documentId,
          contentHash: d.contentHash,
          embedding: vector(5),
        })),
      ),
    );
    await worker.embedChat(id, u, MODEL, backend);

    const row = await embeddingRow(docId);
    expect(row.embedding).toBe('[5,6,7]');
    expect(row.embed_input_version).toBe(EMBED_INPUT_VERSION);
  });

  // trap 6: passing the whole outstanding set to embedDocuments in one call
  // would lose already-succeeded work on a mid-call chunk failure (design
  // D5's persist-per-batch rule). Verify the adapter is called with AT MOST
  // batchSize documents per call.
  it('calls the backend with exactly one persist-batch (<= batchSize documents per call)', async () => {
    const batchSize = 2;
    const id = await seed(
      'Multiple documents',
      Array.from({ length: 5 }, (_, i) => ({
        role: 'user' as const,
        // Distinct, near-budget text so each message becomes its own chunk
        // rather than merging with neighbors.
        // Each message alone exceeds CHUNK_MAX_CHARS (3000) so the chunker's
        // oversized-message split (#517/D13) guarantees it becomes its own
        // chunk(s) rather than merging with a neighbor under the budget.
        text: `distinct message number ${i} ${'x'.repeat(3200)}`,
      })),
    );
    await indexService.reindexChat(id, u);
    const docCount = await ownedRows(
      sql`SELECT count(*)::int AS n FROM search_chat_documents WHERE chat_id = ${id}`,
      z.object({ n: z.number() }),
    );
    expect(docCount[0].n).toBeGreaterThan(batchSize);

    const { worker } = await buildWorker();
    const callSizes: Array<number> = [];
    const backend = fakeBackend((documents) => {
      callSizes.push(documents.length);
      return Promise.resolve(
        documents.map((d) => ({
          documentId: d.documentId,
          contentHash: d.contentHash,
          embedding: vector(6),
        })),
      );
    });
    await worker.embedChat(id, u, { ...MODEL, batchSize }, backend);

    expect(callSizes.length).toBeGreaterThan(0);
    for (const size of callSizes) {
      expect(size).toBeLessThanOrEqual(batchSize);
    }
  });

  it('stops without re-enqueueing when a batch makes zero progress (all results filtered, no throw)', async () => {
    const id = await seed('Zero progress', [
      { role: 'user', text: 'the backend will silently reject this vector' },
    ]);
    await indexService.reindexChat(id, u);
    const docId = await firstDocId(id);

    const { worker, enqueueChatEmbed } = await buildWorker();
    // A backend that returns fewer results than requested with NO throw
    // (e.g. the real adapter's own response-count mismatch guard, or any
    // non-compliant EmbeddingBackend implementation) — nothing to persist,
    // and nothing to tombstone either, since no error was raised. A per-item
    // invalid-vector rejection is a DIFFERENT case: the real adapter now
    // throws for that (openai-embedding-backend.ts's isValidVector), which
    // routes through handleBatchFailure/the terminal-failure test above
    // instead of this branch.
    const backend = fakeBackend(() => Promise.resolve([]));
    await expect(
      worker.embedChat(id, u, MODEL, backend),
    ).resolves.toBeUndefined();

    const row = await embeddingRow(docId);
    expect(row.embedding).toBeNull();
    expect(row.embedding_fail_reason).toBeNull();
    expect(enqueueChatEmbed).not.toHaveBeenCalled();
  });

  it('bounds a job to EMBED_MAX_BATCHES_PER_JOB batches and re-enqueues itself, fully draining across coalesced job runs', async () => {
    // One oversized message splits (chunker #517/D13) into far more than
    // EMBED_MAX_BATCHES_PER_JOB documents at batchSize 1 — cheaper to seed
    // than that many separate messages.
    const bigText = Array.from(
      { length: 9000 },
      (_, i) => `word${i % 997}`,
    ).join(' ');
    const id = await seed('Oversized for bounding', [
      { role: 'user', text: bigText },
    ]);
    await indexService.reindexChat(id, u);
    const totalDocs = await ownedRows(
      sql`SELECT count(*)::int AS n FROM search_chat_documents WHERE chat_id = ${id}`,
      z.object({ n: z.number() }),
    );
    expect(totalDocs[0].n).toBeGreaterThan(EMBED_MAX_BATCHES_PER_JOB);

    let counter = 0;
    const backend = fakeBackend((documents) =>
      Promise.resolve(
        documents.map((d) => {
          counter += 1;
          return {
            documentId: d.documentId,
            contentHash: d.contentHash,
            embedding: vector(counter),
          };
        }),
      ),
    );

    const { worker: worker1, enqueueChatEmbed: reenqueue1 } =
      await buildWorker();
    await worker1.embedChat(id, u, { ...MODEL, batchSize: 1 }, backend);
    expect(reenqueue1).toHaveBeenCalledTimes(1);
    expect(reenqueue1).toHaveBeenCalledWith(id, u);

    const embeddedAfterFirst = await ownedRows(
      sql`SELECT count(*)::int AS n FROM search_chat_documents WHERE chat_id = ${id} AND embedding IS NOT NULL`,
      z.object({ n: z.number() }),
    );
    expect(embeddedAfterFirst[0].n).toBe(EMBED_MAX_BATCHES_PER_JOB);
    expect(embeddedAfterFirst[0].n).toBeLessThan(totalDocs[0].n);

    // The coalesced follow-up job run: fully drains the remainder and does
    // NOT re-enqueue again.
    const { worker: worker2, enqueueChatEmbed: reenqueue2 } =
      await buildWorker();
    await worker2.embedChat(id, u, { ...MODEL, batchSize: 1 }, backend);
    expect(reenqueue2).not.toHaveBeenCalled();

    const embeddedAfterSecond = await ownedRows(
      sql`SELECT count(*)::int AS n FROM search_chat_documents WHERE chat_id = ${id} AND embedding IS NOT NULL`,
      z.object({ n: z.number() }),
    );
    expect(embeddedAfterSecond[0].n).toBe(totalDocs[0].n);
  });
});
