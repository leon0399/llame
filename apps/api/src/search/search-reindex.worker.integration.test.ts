/**
 * SearchReindexWorker.runEmbedBacklogSweep on a live DB (RLS), chat-search-
 * embeddings design D1/D6/D14: the sweep's embed-discovery branch must gate
 * on the binding ledger row (`embedding_model_bindings`) — a freshly
 * declared model, or a corpus newly pointed at one, has NO ledger row until
 * its first real vector persists, and outstanding documents under it are
 * therefore BULK work (D6: "bulk work is never automatic"). Enqueueing for
 * such a model would auto-drain an entire corpus off a one-line config edit,
 * exactly what the explicit `backfill` command exists to gate.
 *
 * TEST_DATABASE_URL-gated; run by test:integration.
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
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
import { type UnknownRecord } from '../unknown-record';
import { type EmbeddingBackend } from './core';
import { SearchEmbedDispatchService } from './search-embed-dispatch.service';
import { SearchEmbedWorker } from './search-embed.worker';
import { SearchIndexService } from './search-index.service';
import { SearchReindexDispatchService } from './search-reindex-dispatch.service';
import { SearchReindexWorker } from './search-reindex.worker';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = ReturnType<typeof postgres>;
const text = (t: string) => [{ type: 'text', text: t }];

describeIfDb(
  'SearchReindexWorker.runEmbedBacklogSweep — D1/D6 ledger gate',
  () => {
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

    function fakeModel(modelId: string): EmbeddingModelCatalogEntry {
      return {
        id: modelId,
        provider: 'provider-a',
        providerModelId: 'text-embedding-3-small',
        dimensions: 3,
        batchSize: 8,
        distanceMetric: 'cosine',
      };
    }

    function fakeInstanceConfig(modelId: string) {
      return {
        config: {
          ...BUILT_IN_DEFAULTS,
          providers: [
            {
              id: 'provider-a',
              type: 'openai' as const,
              key: 'k',
              baseUrl: null,
            },
          ],
          embeddingModels: [fakeModel(modelId)],
          search: { chats: { embeddingModelId: modelId } },
        },
      };
    }

    /** SearchReindexWorker wired to the REAL TenantDbService and a fake,
     *  spy-able embed dispatch — same DI pattern as search-embed.worker's own
     *  integration suite. */
    async function buildReindexWorker(modelId: string) {
      const enqueueChatEmbed = vi.fn().mockResolvedValue(undefined);
      const moduleRef = await Test.createTestingModule({
        providers: [
          SearchReindexWorker,
          { provide: QUEUE, useValue: {} },
          { provide: TenantDbService, useFactory: () => tenantDb },
          { provide: SearchIndexService, useValue: {} },
          { provide: SearchReindexDispatchService, useValue: {} },
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
            useValue: fakeInstanceConfig(modelId),
          },
        ],
      }).compile();
      openModules.push(moduleRef);
      return { worker: moduleRef.get(SearchReindexWorker), enqueueChatEmbed };
    }

    /** SearchEmbedWorker wired the same way, used only to actually PERSIST a
     *  vector (the real way a ledger row is created — design D1). */
    async function buildEmbedWorker(modelId: string) {
      const moduleRef = await Test.createTestingModule({
        providers: [
          SearchEmbedWorker,
          { provide: QUEUE, useValue: {} },
          { provide: TenantDbService, useFactory: () => tenantDb },
          { provide: SearchEmbedDispatchService, useValue: {} },
          {
            provide: WorkerProfileService,
            useValue: { concurrencyFor: () => 1 },
          },
          {
            provide: InstanceConfigService,
            useValue: fakeInstanceConfig(modelId),
          },
        ],
      }).compile();
      openModules.push(moduleRef);
      return moduleRef.get(SearchEmbedWorker);
    }

    function fakeBackend(vector: ReadonlyArray<number>): EmbeddingBackend {
      return {
        embedDocuments: (documents) =>
          Promise.resolve(
            documents.map((d) => ({
              documentId: d.documentId,
              contentHash: d.contentHash,
              embedding: vector,
            })),
          ),
        embedQuery: () => {
          throw new Error('embedQuery is not exercised by this suite');
        },
      };
    }

    async function ledgerRowExists(modelId: string): Promise<boolean> {
      const rows = await ownedRows(
        sql`SELECT model_key FROM embedding_model_bindings WHERE model_key = ${modelId}`,
        z.object({ model_key: z.string() }),
      );
      return rows.length > 0;
    }

    beforeAll(async () => {
      const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
      sqlClient = postgres(TEST_DB_URL!, { ssl, max: 5 });
      db = drizzle(sqlClient, { schema });
      tenantDb = new TenantDbService(db);
      indexService = new SearchIndexService(tenantDb);
      u = crypto.randomUUID();
      await sqlClient`INSERT INTO users (id, name, email) VALUES (${u}, 'G', ${`g-${u}@t.com`})`;
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

    it('a freshly declared model (no ledger row) — the sweep enqueues NOTHING, even with outstanding documents', async () => {
      const modelId = `fresh-model-${crypto.randomUUID()}`;
      expect(await ledgerRowExists(modelId)).toBe(false);

      const id = await seed('Never-used model backlog', [
        { role: 'user', text: 'outstanding under a brand-new model' },
      ]);
      await indexService.reindexChat(id, u);

      const { worker, enqueueChatEmbed } = await buildReindexWorker(modelId);
      await worker.runEmbedBacklogSweep();

      // No provider request either: the whole point of the gate is that this
      // model's backend is never even reached — verified structurally, since
      // enqueueChatEmbed (the only path to a job that would eventually call
      // the backend) was never called at all.
      expect(enqueueChatEmbed).not.toHaveBeenCalled();
    });

    it('once the model has persisted one real vector (ledger row exists) — the sweep enqueues outstanding documents normally', async () => {
      const modelId = `in-service-model-${crypto.randomUUID()}`;
      expect(await ledgerRowExists(modelId)).toBe(false);

      // The chat whose vector we persist for real, to create the ledger row.
      const seededChat = await seed('Bootstraps the ledger row', [
        { role: 'user', text: 'first ever embed for this model' },
      ]);
      await indexService.reindexChat(seededChat, u);
      const embedWorker = await buildEmbedWorker(modelId);
      await embedWorker.embedChat(
        seededChat,
        u,
        fakeModel(modelId),
        fakeBackend([0.1, 0.2, 0.3]),
      );
      expect(await ledgerRowExists(modelId)).toBe(true);

      // A SEPARATE, still-outstanding chat under the same (now in-service)
      // model — this is the one the sweep must discover and enqueue.
      const outstandingChat = await seed('Ordinary incremental lag', [
        { role: 'user', text: 'new content under an already-in-service model' },
      ]);
      await indexService.reindexChat(outstandingChat, u);

      const { worker, enqueueChatEmbed } = await buildReindexWorker(modelId);
      await worker.runEmbedBacklogSweep();

      expect(enqueueChatEmbed).toHaveBeenCalledWith(outstandingChat, u);
    });
  },
);
