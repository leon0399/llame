/**
 * Worker-entrypoint smoke test (durable-run-workers D4, task 7.4) — requires
 * a real PostgreSQL connection (same TEST_DATABASE_URL gate as
 * queue.integration.test.ts; skipped otherwise so offline `pnpm test` stays
 * usable).
 *
 * Proves the composition worker.ts actually boots: WorkerModule's DI graph
 * resolves and its lifecycle hooks run with NO HTTP adapter ever created
 * (moduleRef.init(), never createNestApplication()/listen()) — the same
 * "headless" shape as NestFactory.createApplicationContext — and that the
 * active LLAME_WORKER_PROFILE gates exactly which consumer groups register,
 * per design D2/D3:
 * - default `all` -> every group's main queue gets a consumer registered
 * - `web` (empty profile) -> nothing registers at all
 *
 * `search-embed` (chat-search-embeddings design D14) is a FOURTH group in
 * `all`, but SearchEmbedWorker additionally gates on
 * `search.chats.embeddingModelId` being configured (off-by-default, design
 * D5/spec "off by default"). This suite overrides instance config with the
 * built-in defaults, so no embedding model is declared and `search-embed`
 * registers NOTHING even under `all`, proving the off-by-default contract.
 * The configured (model declared, consuming) state is covered by
 * SearchEmbedWorker's own tests, not here.
 *
 * The fail-closed-on-unknown-profile behavior (WorkerProfileService's
 * constructor throw) is deliberately NOT re-exercised here through a full
 * WorkerModule compile: a `.compile()` that rejects mid-DI-graph leaves
 * whatever already connected (pg-boss's pool, the Drizzle DB_DEV connection)
 * with no `moduleRef` to close — Nest gives back no reference to a container
 * that failed to build, so there is nothing to call `.close()` on, and the
 * open sockets hang the Jest process. worker-profile.service.test.ts (task
 * 7.5) already proves that exact throw as a plain unit test, with no queue or
 * DB in the graph at all — cleanly, with nothing left to leak.
 *
 * A unique PGBOSS_SCHEMA per run avoids the cross-suite job-stealing collision
 * queue.module.ts's own comment documents for a shared 'pgboss' schema.
 */
import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';

import { InstanceConfigService } from './instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from './instance-config/llame-config';
import { McpRuntimeService } from './mcp/mcp-runtime.service';
import { PgBossQueueService } from './queue/pgboss-queue.service';
import { DYNAMIC_TOOL_EXECUTOR_RESOLVER } from './runs/snapshot-tool-execution';
import { CanonicalSearchCoverageService } from './search/canonical-search-activation.service';
import { WorkerModule } from './worker.module';

/** The `drizzle()` factory's `$client` escape hatch (see drizzle-orm/postgres-js's driver.d.ts) is an intersection on its return value, not a member of PostgresJsDatabase itself. */
type DrizzleWithClient = PostgresJsDatabase & { $client: Sql };

/**
 * WorkerModule wires its own `DB_DEV` Drizzle connection (mirroring
 * AppModule, since @Global scoping doesn't cross application graphs) —
 * `@knaadh/nestjs-drizzle-postgres` does not register an OnModuleDestroy
 * hook to end the underlying postgres.js client, so `moduleRef.close()`
 * alone leaves an open socket that keeps the Jest worker process alive.
 * Ending it explicitly via Drizzle's `$client` escape hatch is the same
 * teardown discipline the other DB-integration specs use (see
 * search-index.integration.test.ts's `sqlClient.end()`).
 */
function getDbClient(moduleRef: INestApplicationContext): DrizzleWithClient {
  return moduleRef.get<DrizzleWithClient>('DB_DEV', { strict: false });
}

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

vi.setConfig({ testTimeout: 60_000 });

describeIfDb(
  'Worker entrypoint — headless boot + worker-profile gating (design D2-D4)',
  () => {
    const ENV_KEYS = [
      'POSTGRES_URL',
      'PGBOSS_SCHEMA',
      'LLAME_WORKER_PROFILE',
    ] as const;
    let originalEnv: Record<string, string | undefined>;

    beforeEach(() => {
      originalEnv = Object.fromEntries(
        ENV_KEYS.map((k) => [k, process.env[k]]),
      );
      process.env.POSTGRES_URL = TEST_DB_URL;
      process.env.PGBOSS_SCHEMA = `${process.env.LLAME_TEST_SCHEMA_PREFIX ?? 'llame_t'}_smoke_${Date.now().toString(36)}`;
    });

    afterEach(() => {
      for (const k of ENV_KEYS) {
        if (originalEnv[k] === undefined) delete process.env[k];
        else process.env[k] = originalEnv[k];
      }
    });

    it('boots headless (no HTTP) and registers all three groups under the default `all` profile', async () => {
      delete process.env.LLAME_WORKER_PROFILE;
      const consumeSpy = vi.spyOn(PgBossQueueService.prototype, 'consume');

      const moduleRef = await Test.createTestingModule({
        imports: [WorkerModule],
      })
        .overrideProvider(InstanceConfigService)
        .useValue({ config: BUILT_IN_DEFAULTS })
        .overrideProvider(CanonicalSearchCoverageService)
        .useValue({ assertReady: () => Promise.resolve() })
        .compile();
      // .init() runs onApplicationBootstrap (registers consumers) with NO
      // HTTP adapter ever created — createNestApplication()/listen() are
      // never called, matching NestFactory.createApplicationContext.
      await moduleRef.init();
      const db = getDbClient(moduleRef);
      try {
        const runtime = moduleRef.get(McpRuntimeService, { strict: false });
        expect(
          moduleRef.get(DYNAMIC_TOOL_EXECUTOR_RESOLVER, { strict: false }),
        ).toBe(runtime);
        expect(runtime.snapshotCandidates()).toEqual([]);

        // SAFETY: consume() is generic per queue definition, so vitest's spy
        // types `definition` broadly across the differently-typed queues this
        // test registers; every queue definition genuinely carries a `name`,
        // this just reads it for the assertion below.
        const registeredQueues = consumeSpy.mock.calls.map(
          ([definition]) => (definition as { name: string }).name,
        );
        expect(registeredQueues).toEqual(
          expect.arrayContaining([
            'runs',
            'runs.dead',
            'search-reindex',
            'search-sweep',
            'sessions.cleanup',
          ]),
        );
        // Off-by-default (design D5/D14): no embeddingModels declared at this
        // cwd, so SearchEmbedWorker registers nothing for 'search-embed' even
        // though the group IS present in the built-in `all` profile.
        expect(registeredQueues).not.toContain('search-embed');
      } finally {
        // Graceful drain (design D5): close() runs onModuleDestroy, which
        // triggers nestjs-pgboss's boss.stop({ graceful }).
        await moduleRef.close();
        await db.$client.end();
      }
      consumeSpy.mockRestore();
    });

    it('registers NOTHING under the empty `web` profile', async () => {
      process.env.LLAME_WORKER_PROFILE = 'web';
      const consumeSpy = vi.spyOn(PgBossQueueService.prototype, 'consume');

      const moduleRef = await Test.createTestingModule({
        imports: [WorkerModule],
      })
        .overrideProvider(InstanceConfigService)
        .useValue({ config: BUILT_IN_DEFAULTS })
        .overrideProvider(CanonicalSearchCoverageService)
        .useValue({ assertReady: () => Promise.resolve() })
        .compile();
      await moduleRef.init();
      const db = getDbClient(moduleRef);
      try {
        expect(consumeSpy).not.toHaveBeenCalled();
      } finally {
        await moduleRef.close();
        await db.$client.end();
      }
      consumeSpy.mockRestore();
    });
  },
);
