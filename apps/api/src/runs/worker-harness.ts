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
 *   module graph (worker.module.spec.ts already proves this composition boots
 *   headless and drains on shutdown; this harness reuses that proof).
 * - `waitFor`/`describeIfDb` conventions from `queue.integration.spec.ts` /
 *   `test/support.ts` (callers import waitFor themselves).
 * - The direct-instantiation-of-repos pattern from
 *   `active-runs.integration.spec.ts` for seeding chat/message/run rows.
 *
 * TEST_DATABASE_URL/POSTGRES_URL-gated by the CALLER (this module has no
 * `describe` of its own — it is imported by the actual spec files).
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import type { streamText } from 'ai';

import { WorkerModule } from '../worker.module';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import { ZERO_USAGE } from '../models/fake-model-client';
import { ModelsService } from '../models/models.service';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { type EnqueueOptions, QUEUE, type Queue } from '../queue/queue';
import {
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { type MessagePart } from '../chats/context-builder';
import { RunDispatchService } from './run-dispatch.service';
import { type RunUserMessage } from './run-execution.service';
import { RUNS_QUEUE, type RunJob } from './run-queues';
import { RunsRepository } from './runs-repository';

// ---- Scripted model client ------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The behavior a run's fake model client exhibits, keyed by modelId (each
 * seeded run picks its own modelId, so concurrently-executing runs can carry
 * different scripted behaviors without any call-order assumption).
 *
 * `infra-throw` simulates design D7/§9's "infrastructure failure" class
 * (credential resolution, a thrown handler): createOpenAIClient() itself
 * throws a PLAIN Error — NOT ModelNotAvailableError/ModelConfigurationError,
 * which RunsWorkerService.executeJob special-cases into an immediate terminal
 * 'failed' with no retry. A plain throw propagates out of executeJob's try
 * block, which is exactly the queue-retries-it contract under test.
 */
export type ScriptedBehavior =
  | { kind: 'complete'; text?: string; delayMs?: number }
  | { kind: 'infra-throw'; message?: string }
  | { kind: 'hang' };

class HarnessModelClient implements ModelClient {
  readonly provider = 'fake';
  readonly contextWindowTokens = 128_000;

  constructor(
    readonly model: string,
    private readonly behavior: Extract<
      ScriptedBehavior,
      { kind: 'complete' } | { kind: 'hang' }
    >,
  ) {}

  streamText(input: ModelStreamInput): ReturnType<typeof streamText> {
    const behavior = this.behavior;
    const text = behavior.kind === 'complete' ? (behavior.text ?? 'ok') : '';

    const done = (async () => {
      if (behavior.kind === 'complete') {
        if (behavior.delayMs) {
          await sleep(behavior.delayMs);
        }
        input.onTextDelta?.(text);
        await input.onFinish?.({
          text,
          usage: ZERO_USAGE,
          finishReason: 'stop',
        });
        return;
      }

      // 'hang': never finishes on its own — only reacts to the run's
      // AbortSignal (the in-process wall-clock timeout, or a genuine user
      // cancel), mirroring the real client's abort-produces-onError contract.
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          void (async () => {
            await input.onError?.({ error: new Error('aborted') });
            resolve();
          })();
        };
        if (input.abortSignal?.aborted) {
          onAbort();
          return;
        }
        input.abortSignal?.addEventListener('abort', onAbort, { once: true });
      });
    })();

    return {
      text: done.then(() => text),
      consumeStream: () => done,
    } as unknown as ReturnType<typeof streamText>;
  }
}

/**
 * ModelsService double whose behavior is scripted PER RUN via its modelId —
 * seed a run with a unique modelId, `register()` its behavior before
 * dispatching, and RunsWorkerService.executeJob's
 * `createOpenAIClient({modelId})` call resolves to it deterministically
 * regardless of which order concurrent jobs actually get claimed in.
 */
export class ScriptedModelsService {
  private readonly behaviors = new Map<string, ScriptedBehavior>();
  readonly createOpenAIClientCalls: Array<{ modelId: string }> = [];

  register(modelId: string, behavior: ScriptedBehavior): void {
    this.behaviors.set(modelId, behavior);
  }

  getOpenAIProviderCredential(): string {
    return 'sk-test';
  }

  validateModelSelection(modelId: string) {
    return {
      id: modelId,
      source: 'system' as const,
      provider: 'openai',
      providerModelId: modelId,
    };
  }

  resolveTitleModelConfig() {
    return {
      id: 'system:openai:gpt-5.4-nano',
      source: 'system' as const,
      provider: 'openai',
      providerModelId: 'gpt-5.4-nano',
    };
  }

  createOpenAIClient(input: { modelId: string }): ModelClient {
    const { modelId } = input;
    this.createOpenAIClientCalls.push({ modelId });
    const behavior = this.behaviors.get(modelId);
    if (!behavior) {
      throw new Error(
        `ScriptedModelsService: no behavior registered for modelId "${modelId}"`,
      );
    }
    if (behavior.kind === 'infra-throw') {
      throw new Error(
        behavior.message ?? `simulated infra failure for ${modelId}`,
      );
    }
    return new HarnessModelClient(modelId, behavior);
  }
}

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

/**
 * Boots WorkerModule as a headless Nest graph (moduleRef.init(), no HTTP —
 * same shape as `worker.module.spec.ts`) against a REAL Postgres, with:
 * - ModelsService replaced by a ScriptedModelsService the test scripts per run
 * - InstanceConfigService replaced by a plain config object so the test can
 *   set `runs.timeoutSeconds`/`heartbeatSeconds` and the `all` profile's
 *   `runs` concurrency without an on-disk llame.config.json
 *
 * A unique PGBOSS_SCHEMA per boot avoids cross-suite job-stealing on a shared
 * Postgres (same rationale as worker.module.spec.ts / queue.module.ts).
 */
export async function bootWorkerHarness(overrides?: {
  runsConcurrency?: number;
  timeoutSeconds?: number;
  heartbeatSeconds?: number;
}): Promise<WorkerHarness> {
  // WorkerModule's DrizzlePostgresModule/PgBossModule read POSTGRES_URL
  // directly (getOrThrow), not TEST_DATABASE_URL — mirror worker.module.spec.ts's
  // own setup rather than relying on POSTGRES_URL being ambient in the
  // caller's shell (it must not be a hard requirement for callers gated only
  // on TEST_DATABASE_URL, e.g. scripts/rls-test.sh's `.integration` run).
  if (!process.env.POSTGRES_URL && process.env.TEST_DATABASE_URL) {
    process.env.POSTGRES_URL = process.env.TEST_DATABASE_URL;
  }
  process.env.PGBOSS_SCHEMA = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const models = new ScriptedModelsService();
  const config: LlameConfig = {
    ...BUILT_IN_DEFAULTS,
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

  const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(ModelsService)
    .useValue(models)
    .overrideProvider(InstanceConfigService)
    .useValue({ config })
    .compile();

  await moduleRef.init();

  const tenantDb = moduleRef.get(TenantDbService, { strict: false });
  const db = moduleRef.get<Db>('DB_DEV', { strict: false });
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
      // Graceful drain (design D5): close() runs onApplicationShutdown, which
      // stops every registered consumer via offWork(wait: true).
      await moduleRef.close();
      await (
        db as unknown as { $client: { end: () => Promise<void> } }
      ).$client.end();
    },
  };
}

// ---- Fixtures --------------------------------------------------------------

/** Insert a bare `users` row (FK target for chats/messages/runs), like active-runs.integration.spec.ts. */
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
}): Promise<{ chatId: string; runId: string; userMessage: RunUserMessage }> {
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
    const message = await new MessagesRepository(tx).create({
      chatId,
      role: 'user',
      senderUserId: input.userId,
      parts: [{ type: 'text', text: input.text ?? 'hello' }],
    });
    const run = await new RunsRepository(tx).create({
      chatId,
      messageId: message.id,
      userId: input.userId,
      modelId: input.modelId,
    });
    return {
      chatId,
      runId: run.id,
      userMessage: {
        id: message.id,
        seq: message.seq,
        parts: message.parts as MessagePart[],
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
    enqueueOptions?: EnqueueOptions;
  },
): Promise<{ chatId: string; runId: string; userMessage: RunUserMessage }> {
  const seed = await seedRun({
    tenantDb: harness.tenantDb,
    userId: input.userId,
    modelId: input.modelId,
    text: input.text,
    chatId: input.chatId,
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
