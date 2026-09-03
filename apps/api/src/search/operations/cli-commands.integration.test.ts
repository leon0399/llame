/**
 * cli-commands integration tests (chat-search-embeddings/operations,
 * layer 7) — the `search:*` command wrappers (`runBackfillCommand`,
 * `runPruneCommand`, `runRetryFailedCommand`, `runCoverageCommand`,
 * `runProjectionCoverageCommand`) plus `runCommand`'s dispatch, against a
 * real Postgres. `operations.integration.test.ts` already proves the SQL
 * predicates each underlying function (`runBackfill`,
 * `pruneUndeclaredModelVectors`, …) issues; these tests instead prove the
 * CLI's own wiring — argument threading, console formatting, and the
 * fail-loud-on-failure contract `apps/api/AGENTS.md` describes for these
 * commands ("fail loudly rather than succeeding having silently done less
 * than reported").
 *
 * A real Postgres is required because `runPruneCommand`/`runRetryFailedCommand`
 * go through `forEachOwner` (`owner-write.ts`), which issues a genuine
 * `tx.select({id: users.id}).from(users)` — the full Drizzle query builder,
 * not just `.execute()` — so no lightweight literal fake can satisfy it
 * without an unsafe cast (see `owner-write.test.ts`'s header).
 *
 * Requires TEST_DATABASE_URL; run by test:integration.
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
import { type InstanceConfigReader } from '../../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../../instance-config/llame-config';
import { CHUNKER_VERSION } from '../chat/conversation-chunker';
import { EMBED_INPUT_VERSION } from '../search-embed.worker';
import { SearchIndexService } from '../search-index.service';
import {
  runBackfillCommand,
  runCommand,
  runCoverageCommand,
  runPruneCommand,
  runProjectionCoverageCommand,
  runRetryFailedCommand,
} from './cli-commands';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
if (!TEST_DB_URL) {
  throw new Error(
    'cli-commands.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}
const describeWithDb = describe;
type SqlClient = ReturnType<typeof postgres>;
const text = (t: string) => [{ type: 'text' as const, text: t }];

describeWithDb(
  'cli-commands (chat-search-embeddings/operations, layer 7)',
  () => {
    let sqlClient: SqlClient;
    let db: Db;
    let tenantDb: TenantDbService;
    let owner: string;

    function fakeInstanceConfig(
      embeddingModelId: string | null,
      embeddingModels: InstanceConfigReader['config']['embeddingModels'] = [],
    ) {
      const config = {
        ...BUILT_IN_DEFAULTS,
        embeddingModels,
        search: {
          chats: { ...BUILT_IN_DEFAULTS.search.chats, embeddingModelId },
        },
      };
      return { config } satisfies InstanceConfigReader;
    }

    async function seed(title: string): Promise<string> {
      const id = crypto.randomUUID();
      await tenantDb.runAs(owner, async (tx) => {
        await new ChatsRepository(tx).createIfAbsent({
          id,
          ownerUserId: owner,
          title,
        });
        await new MessagesRepository(tx).create({
          chatId: id,
          role: 'user',
          senderUserId: owner,
          parts: text(`content for ${title}`),
        });
      });
      return id;
    }

    async function contentHashOf(chatId: string): Promise<string> {
      const rows = await tenantDb.runAs(owner, (tx) =>
        tx.execute(
          sql`SELECT content_hash FROM search_chat_documents WHERE chat_id = ${chatId} LIMIT 1`,
        ),
      );
      const [row] = z
        .object({ content_hash: z.string() })
        .array()
        .parse([...rows]);
      return row.content_hash;
    }

    async function stampFailed(
      chatId: string,
      modelKey: string,
      version: number,
    ): Promise<void> {
      const hash = await contentHashOf(chatId);
      await tenantDb.runAs(owner, (tx) =>
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

    async function stampEmbedded(
      chatId: string,
      modelKey: string,
      version: number,
    ): Promise<void> {
      const hash = await contentHashOf(chatId);
      await tenantDb.runAs(owner, (tx) =>
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

    beforeAll(async () => {
      const ssl = /sslmode=require/.test(TEST_DB_URL) ? 'require' : false;
      sqlClient = postgres(TEST_DB_URL, { ssl, max: 5 });
      db = drizzle(sqlClient, { schema });
      tenantDb = new TenantDbService(db);
      owner = crypto.randomUUID();
      await sqlClient`INSERT INTO users (id, name, email) VALUES (${owner}, 'Ops CLI', ${`ops-cli-${owner}@t.com`})`;
    });

    afterAll(async () => {
      if (sqlClient) {
        await sqlClient`DELETE FROM users WHERE id = ${owner}`;
        await sqlClient.end();
      }
    });

    describe('runBackfillCommand', () => {
      it('enqueues outstanding chats and logs the count', async () => {
        const modelKey = `cli-backfill-${crypto.randomUUID()}`;
        const id = await seed('CLI backfill happy path');
        await new SearchIndexService(tenantDb).reindexChat(id, owner);

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const enqueueChatEmbedStrict = vi.fn().mockResolvedValue('job-1');
        try {
          await runBackfillCommand(
            { enqueueChatEmbedStrict },
            tenantDb,
            fakeInstanceConfig(modelKey),
          );

          expect(enqueueChatEmbedStrict).toHaveBeenCalledWith(id, owner);
          expect(logSpy).toHaveBeenCalledWith(
            expect.stringMatching(/^backfill: enqueued \d+ chat\(s\)/),
          );
        } finally {
          logSpy.mockRestore();
        }
      });

      it('throws and reports the failing chat when an enqueue rejects — never silently under-reports', async () => {
        const modelKey = `cli-backfill-fail-${crypto.randomUUID()}`;
        const id = await seed('CLI backfill enqueue failure');
        await new SearchIndexService(tenantDb).reindexChat(id, owner);

        const errorSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {});
        const enqueueChatEmbedStrict = vi
          .fn()
          .mockRejectedValue(new Error('queue unreachable'));
        try {
          await expect(
            runBackfillCommand(
              { enqueueChatEmbedStrict },
              tenantDb,
              fakeInstanceConfig(modelKey),
            ),
          ).rejects.toThrow(
            /backfill: enqueued 0 chat\(s\), FAILED to enqueue/,
          );
          expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(id));
        } finally {
          errorSpy.mockRestore();
        }
      });

      it('rejects before enqueuing anything when no embedding model is configured', async () => {
        const enqueueChatEmbedStrict = vi.fn();
        await expect(
          runBackfillCommand(
            { enqueueChatEmbedStrict },
            tenantDb,
            fakeInstanceConfig(null),
          ),
        ).rejects.toThrow(/embeddingModelId is not configured/);
        expect(enqueueChatEmbedStrict).not.toHaveBeenCalled();
      });
    });

    describe('runPruneCommand', () => {
      it('clears an undeclared model and retires its ledger row, logging the summary', async () => {
        const declaredModel = `cli-prune-declared-${crypto.randomUUID()}`;
        const undeclaredModel = `cli-prune-undeclared-${crypto.randomUUID()}`;
        const id = await seed('CLI prune target');
        await new SearchIndexService(tenantDb).reindexChat(id, owner);
        await stampEmbedded(id, undeclaredModel, EMBED_INPUT_VERSION);
        await sqlClient`
        INSERT INTO embedding_model_bindings (model_key, provider_id, provider_model_id, dimensions)
        VALUES (${undeclaredModel}, 'openai', 'text-embedding-3-small', 1536)
      `;

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
          await runPruneCommand(
            tenantDb,
            fakeInstanceConfig(null, [
              {
                id: declaredModel,
                provider: 'openai',
                providerModelId: 'text-embedding-3-small',
                dimensions: 1536,
                batchSize: 32,
                distanceMetric: 'cosine',
              },
            ]),
          );

          expect(logSpy).toHaveBeenCalledWith(
            expect.stringMatching(/^prune: cleared \d+ document\(s\)/),
          );
        } finally {
          logSpy.mockRestore();
        }
        const rows = await tenantDb.runAs(owner, (tx) =>
          tx.execute(
            sql`SELECT embedding_model_key FROM search_chat_documents WHERE chat_id = ${id}`,
          ),
        );
        const [row] = z
          .object({ embedding_model_key: z.string().nullable() })
          .array()
          .parse([...rows]);
        expect(row.embedding_model_key).toBeNull();
        const [ledger] = await sqlClient`
        SELECT model_key FROM embedding_model_bindings WHERE model_key = ${undeclaredModel}
      `;
        expect(ledger).toBeUndefined();
      });
    });

    describe('runRetryFailedCommand', () => {
      it('resets a terminally failed document and logs the cleared count', async () => {
        const modelKey = `cli-retry-${crypto.randomUUID()}`;
        const id = await seed('CLI retry-failed target');
        await new SearchIndexService(tenantDb).reindexChat(id, owner);
        await stampFailed(id, modelKey, EMBED_INPUT_VERSION);

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
          await runRetryFailedCommand(tenantDb, fakeInstanceConfig(modelKey));

          expect(logSpy).toHaveBeenCalledWith(
            expect.stringMatching(/^retry-failed: reset \d+ document\(s\)/),
          );
        } finally {
          logSpy.mockRestore();
        }
        const rows = await tenantDb.runAs(owner, (tx) =>
          tx.execute(
            sql`SELECT embedding_fail_reason FROM search_chat_documents WHERE chat_id = ${id}`,
          ),
        );
        const [row] = z
          .object({ embedding_fail_reason: z.string().nullable() })
          .array()
          .parse([...rows]);
        expect(row.embedding_fail_reason).toBeNull();
      });
    });

    describe('runCoverageCommand', () => {
      it('prints a row for a chat with outstanding/failed work', async () => {
        const modelKey = `cli-coverage-${crypto.randomUUID()}`;
        const id = await seed('CLI coverage target');
        await new SearchIndexService(tenantDb).reindexChat(id, owner);
        await stampFailed(id, modelKey, EMBED_INPUT_VERSION);

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
          await runCoverageCommand(tenantDb, fakeInstanceConfig(modelKey));

          const printed = logSpy.mock.calls.map((call) => String(call[0]));
          expect(printed.some((line) => line.includes(id))).toBe(true);
          expect(printed.some((line) => line.includes(owner))).toBe(true);
        } finally {
          logSpy.mockRestore();
        }
      });
    });

    describe('runProjectionCoverageCommand', () => {
      it('logs a summary line derived from the real aggregate', async () => {
        const id = await seed('CLI projection coverage target');
        await new SearchIndexService(tenantDb).reindexChat(id, owner);

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
          await runProjectionCoverageCommand(tenantDb);

          const line = String(logSpy.mock.calls[0]?.[0]);
          expect(line).toContain(`chunker_version=${CHUNKER_VERSION}`);
          const chatsMatch = /chats=(\d+)/.exec(line);
          expect(chatsMatch).not.toBeNull();
          expect(Number(chatsMatch?.[1])).toBeGreaterThanOrEqual(1);
        } finally {
          logSpy.mockRestore();
        }
      });
    });

    describe('runCommand dispatch', () => {
      it('routes "projection-coverage" to the real command through the switch', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
          await runCommand('projection-coverage', {
            tenantDb,
            instanceConfig: fakeInstanceConfig(null),
            dispatch: { enqueueChatEmbedStrict: vi.fn() },
          });

          expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('projection-coverage: chunker_version='),
          );
        } finally {
          logSpy.mockRestore();
        }
      });
    });
  },
);
