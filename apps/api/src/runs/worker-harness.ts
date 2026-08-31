/**
 * Composite worker harness (durable-run-workers, task 7.0) — the prerequisite
 * for tasks 7.1-7.3/7.6/7.7: wires a REAL pg-boss `runs` queue + a live
 * `RunsWorkerService` (+ its `runs.dead` consumer) + `RunExecutionService` +
 * `TenantDbService` in ONE Nest DI graph, with a scripted fake model client
 * the test controls per-run (immediate completion, a delay, an infra throw,
 * or an indefinite hang that only reacts to abort).
 *
 * Reuses rather than reinvents:
 * - `WorkerModule` (apps/api/src/worker.module.ts) IS the composed graph —
 *   `QueueModule` + `RunWorkerModule` (RunsWorkerService, RunExecutionService,
 *   RunDispatchService) + `SearchModule` (inline reindex, 7.6) + `AuthModule`
 *   + the `DB_DEV` Drizzle connection — exactly what 7.0 asks for, so this
 *   harness boots WorkerModule itself rather than hand-composing a parallel
 *   module graph (worker.module.integration.test.ts already proves this composition boots
 *   headless and drains on shutdown; this harness reuses that proof).
 * - `waitFor`/`describeIfDb` conventions from `queue.integration.test.ts` /
 *   `src/testing/support.ts` (callers import waitFor themselves).
 * - The direct-instantiation-of-repos pattern from
 *   `active-runs.integration.test.ts` for seeding chat/message/run rows.
 * - The scripted `ModelClient`/`ModelSelectionValidator` doubles live in
 *   `scripted-model-client.ts`.
 *
 * TEST_DATABASE_URL/POSTGRES_URL-gated by the CALLER (this module has no
 * `describe` of its own — it is imported by the actual spec files).
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { type Sql } from 'postgres';

import { WorkerModule } from '../worker.module';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import { ModelsService } from '../models/models.service';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { type EnqueueOptions, QUEUE, type Queue } from '../queue/queue';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { type TextPart } from '../chats/context-builder';
import { RunDispatchService } from './run-dispatch.service';
import { type RunUserMessage } from './run-execution.service';
import { RUNS_QUEUE, type RunJob } from './run-queues';
import { RunsRepository } from './runs-repository';
import { seedModelContextSnapshot } from './model-context-snapshot.test-fixture';
import { ScriptedModelsService } from './scripted-model-client';

// ---- Harness boot ----------------------------------------------------------

export type WorkerHarness = {
  moduleRef: TestingModule;
  tenantDb: TenantDbService;
  db: Db;
  models: ScriptedModelsService;
  queue: Queue;
  dispatch: RunDispatchService;
  close(): Promise<void>;
};

type DrizzleWithClient = Db & { $client: Sql };

type HarnessOverrides = {
  runsConcurrency?: number;
  timeoutSeconds?: number;
  heartbeatSeconds?: number;
  /** Explicit code-owned tool rules for snapshots seeded by this harness. */
  allowedTools?: ReadonlyArray<string>;
};

/** Merges one boot's `bootWorkerHarness` overrides onto the built-in defaults. */
function resolveHarnessConfig(overrides?: HarnessOverrides): LlameConfig {
  return {
    ...BUILT_IN_DEFAULTS,
    tools: {
      ...BUILT_IN_DEFAULTS.tools,
      allowed: [...(overrides?.allowedTools ?? [])],
    },
    runs: {
      ...BUILT_IN_DEFAULTS.runs,
      timeoutSeconds:
        overrides?.timeoutSeconds ?? BUILT_IN_DEFAULTS.runs.timeoutSeconds,
      heartbeatSeconds:
        overrides?.heartbeatSeconds ?? BUILT_IN_DEFAULTS.runs.heartbeatSeconds,
    },
    workers: {
      ...BUILT_IN_DEFAULTS.workers,
      all: {
        ...BUILT_IN_DEFAULTS.workers.all,
        runs: overrides?.runsConcurrency ?? BUILT_IN_DEFAULTS.workers.all.runs,
      },
    },
  };
}

/**
 * Boots WorkerModule as a headless Nest graph (moduleRef.init(), no HTTP —
 * same shape as `worker.module.integration.test.ts`) against a REAL Postgres, with:
 * - ModelsService replaced by a ScriptedModelsService the test scripts per run
 * - InstanceConfigService replaced by a plain config object so the test can
 *   set `runs.timeoutSeconds`/`heartbeatSeconds` and the `all` profile's
 *   `runs` concurrency without an on-disk llame.config.json
 *
 * A unique PGBOSS_SCHEMA per boot avoids cross-suite job-stealing on a shared
 * Postgres (same rationale as worker.module.integration.test.ts / queue.module.ts).
 */
export async function bootWorkerHarness(
  overrides?: HarnessOverrides,
): Promise<WorkerHarness> {
  // WorkerModule's DrizzlePostgresModule/PgBossModule read POSTGRES_URL
  // directly (getOrThrow), not TEST_DATABASE_URL — mirror worker.module.integration.test.ts's
  // own setup rather than relying on POSTGRES_URL being ambient in the
  // caller's shell (it must not be a hard requirement for callers gated only
  // on TEST_DATABASE_URL, e.g. a bare test:integration run).
  //
  // UNCONDITIONAL, like worker.module.integration.test.ts: ConfigModule.forRoot has
  // already leaked a developer's .env.local POSTGRES_URL (the DEV database)
  // into process.env by the time this runs, so a `!process.env.POSTGRES_URL`
  // guard would silently point the whole harness at the dev database instead
  // of the provisioned test one.
  if (process.env.TEST_DATABASE_URL) {
    process.env.POSTGRES_URL = process.env.TEST_DATABASE_URL;
  }
  process.env.PGBOSS_SCHEMA = `${process.env.LLAME_TEST_SCHEMA_PREFIX ?? 'llame_t'}_wh_${Math.random().toString(36).slice(2, 8)}`;

  const models = new ScriptedModelsService();
  const config = resolveHarnessConfig(overrides);

  const builder = Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(ModelsService)
    .useValue(models)
    .overrideProvider(InstanceConfigService)
    .useValue({ config })
    // Execution harnesses isolate the worker loop, not fleet-wide projection
    // admission; dedicated boot tests exercise the real coverage gate.
    .overrideProvider(CanonicalSearchCoverageService)
    .useValue({ assertReady: () => Promise.resolve() });
  const moduleRef = await builder.compile();

  await moduleRef.init();

  const tenantDb = moduleRef.get(TenantDbService, { strict: false });
  const db = moduleRef.get<DrizzleWithClient>('DB_DEV', { strict: false });
  const queue = moduleRef.get<Queue>(QUEUE, { strict: false });
  const dispatch = moduleRef.get(RunDispatchService, { strict: false });

  return {
    moduleRef,
    tenantDb,
    db,
    models,
    queue,
    dispatch,
    async close() {
      // Graceful drain (design D5): close() runs onModuleDestroy, which triggers
      // nestjs-pgboss's boss.stop({ graceful }) — stops fetching and awaits
      // in-flight handlers.
      await moduleRef.close();
      await db.$client.end();
    },
  };
}

// ---- Fixtures --------------------------------------------------------------

/** Insert a bare `users` row (FK target for chats/messages/runs), like active-runs.integration.test.ts. */
export async function createUser(db: Db, tag: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute(
    sql`INSERT INTO users (id, name, email) VALUES (${id}, ${'Harness User'}, ${`harness-${tag}-${id}@test.com`})`,
  );
  return id;
}

/**
 * Seed a chat + user message + run row in one transaction (mirrors
 * ChatLoopService.persistUserMessageAndRun's shape, minus the queue
 * dispatch/single-flight retry — callers that need to exercise the
 * unique-violation path do so explicitly). Pass `chatId` to add a second
 * message+run to an EXISTING chat (e.g. to attempt violating single-flight).
 */
export async function seedRun(input: {
  tenantDb: TenantDbService;
  userId: string;
  modelId: string;
  text?: string;
  chatId?: string;
  /** Persisted on the run exactly as the accepting API would have stored it. */
  effort?: string;
  /** Exact code-owned tool rules captured by the run's immutable snapshot. */
  allowedTools?: ReadonlyArray<string>;
}): Promise<{
  chatId: string;
  runId: string;
  modelContextSnapshotId: string;
  userMessage: RunUserMessage;
}> {
  const chatId = input.chatId ?? crypto.randomUUID();
  return input.tenantDb.runAs(input.userId, async (tx) => {
    if (!input.chatId) {
      await new ChatsRepository(tx).createIfAbsent({
        id: chatId,
        ownerUserId: input.userId,
        // Non-null title: sidesteps the post-completion title-generation
        // model call (untitled-gate in RunExecutionService.onFinish) so the
        // scripted model doesn't need a behavior registered for it.
        title: 'Harness chat',
      });
    }
    const parts: Array<TextPart> = [
      { type: 'text', text: input.text ?? 'hello' },
    ];
    const message = await new MessagesRepository(tx).create({
      chatId,
      role: 'user',
      senderUserId: input.userId,
      parts,
    });
    const snapshot = await seedModelContextSnapshot(
      tx,
      input.userId,
      input.modelId,
      input.allowedTools ?? [],
    );
    const run = await new RunsRepository(tx).create({
      chatId,
      messageId: message.id,
      userId: input.userId,
      modelId: input.modelId,
      ...(input.effort !== undefined && { effort: input.effort }),
      modelContextSnapshotId: snapshot.id,
    });
    return {
      chatId,
      runId: run.id,
      modelContextSnapshotId: snapshot.id,
      userMessage: {
        id: message.id,
        seq: message.seq,
        parts,
      },
    };
  });
}

/** Enqueue a seeded run onto the real `runs` queue, with optional per-job EnqueueOptions overrides (e.g. a fast retryLimit for the retry-exhaustion test). */
export async function dispatchRun(input: {
  queue: Queue;
  chatId: string;
  runId: string;
  userId: string;
  modelId: string;
  userMessage: RunUserMessage;
  enqueueOptions?: EnqueueOptions;
}): Promise<string | null> {
  const job: RunJob = {
    runId: input.runId,
    chatId: input.chatId,
    userId: input.userId,
    modelId: input.modelId,
    userMessage: input.userMessage,
  };
  return input.queue.enqueue(RUNS_QUEUE, job, input.enqueueOptions);
}

/**
 * `seedRun` immediately followed by `dispatchRun` for that same run — the
 * pattern most call sites want (seed one run, enqueue it, done). Callers that
 * need to seed several runs before dispatching any of them (e.g. to measure
 * wall-clock time starting only at dispatch) should keep calling `seedRun`/
 * `dispatchRun` directly instead.
 */
export async function seedAndDispatchRun(
  harness: Pick<WorkerHarness, 'tenantDb' | 'queue'>,
  input: {
    userId: string;
    modelId: string;
    text?: string;
    chatId?: string;
    /** Persisted on the run exactly as the accepting API would have stored it. */
    effort?: string;
    /** Exact code-owned tool rules captured by the run's immutable snapshot. */
    allowedTools?: ReadonlyArray<string>;
    enqueueOptions?: EnqueueOptions;
  },
): Promise<{
  chatId: string;
  runId: string;
  modelContextSnapshotId: string;
  userMessage: RunUserMessage;
}> {
  const seed = await seedRun({
    tenantDb: harness.tenantDb,
    userId: input.userId,
    modelId: input.modelId,
    text: input.text,
    chatId: input.chatId,
    ...(input.effort !== undefined && { effort: input.effort }),
    ...(input.allowedTools !== undefined && {
      allowedTools: input.allowedTools,
    }),
  });
  await dispatchRun({
    queue: harness.queue,
    chatId: seed.chatId,
    runId: seed.runId,
    userId: input.userId,
    modelId: input.modelId,
    userMessage: seed.userMessage,
    enqueueOptions: input.enqueueOptions,
  });
  return seed;
}
