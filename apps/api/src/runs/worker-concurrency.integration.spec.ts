/**
 * Durable run workers — concurrency, per-job settlement, single-flight, and
 * search-reindex composition (design D1/D3/D6; tasks 7.1, 7.2, 7.3, 7.6).
 *
 * Uses the composite worker harness (worker-harness.ts, task 7.0): a REAL
 * pg-boss `runs` queue + a live RunsWorkerService (+ its `runs.dead`
 * consumer) + RunExecutionService + TenantDbService, with a scripted fake
 * model client keyed per-run by modelId.
 *
 * TEST_DATABASE_URL-gated — skipped otherwise, like every other
 * *.integration.spec.ts in this package. worker-harness.ts self-provisions
 * POSTGRES_URL from TEST_DATABASE_URL for WorkerModule's own DB/queue
 * connections, so no ambient POSTGRES_URL is required in the caller's shell.
 */

import { eq } from 'drizzle-orm';

import { RunAbortRegistry } from './run-abort-registry';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { RunStreamBridgeService } from './run-stream-bridge';
import { ChatLoopService } from '../chats/chat-loop.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { type ModelsService } from '../models/models.service';
import { searchChatDocuments } from '../db/schema/search';
import { waitFor } from '../../test/support';
import {
  bootWorkerHarness,
  createUser,
  dispatchRun,
  seedRun,
  type WorkerHarness,
} from './worker-harness';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

jest.setTimeout(60_000);

/**
 * Postgres unique_violation on the per-chat single-flight partial index —
 * the SAME cause-chain walk as chat-loop.service.ts's own (unexported)
 * isInflightUniqueViolation: drizzle/postgres.js surface the driver error
 * wrapped ("Failed query: ..."), with the constraint name on the `.cause`.
 */
function isInflightUniqueViolation(error: unknown): boolean {
  for (
    let current = error;
    typeof current === 'object' && current !== null;
    current = (current as { cause?: unknown }).cause
  ) {
    const candidate = current as {
      code?: unknown;
      constraint_name?: unknown;
      message?: unknown;
    };
    const mentionsIndex =
      (typeof candidate.constraint_name === 'string' &&
        candidate.constraint_name.includes('runs_chat_inflight_unique')) ||
      (typeof candidate.message === 'string' &&
        candidate.message.includes('runs_chat_inflight_unique'));
    if (candidate.code === '23505' && mentionsIndex) {
      return true;
    }
  }
  return false;
}

describeIfDb(
  'Durable run workers — concurrency/settlement/single-flight/reindex (design D1/D3/D6)',
  () => {
    let harness: WorkerHarness;
    let userId: string;

    beforeAll(async () => {
      // concurrency 3: enough to prove overlap without straining the dev
      // Postgres pool (docs/scaling.md's concurrency x replicas sizing note).
      harness = await bootWorkerHarness({ runsConcurrency: 3 });
      userId = await createUser(harness.db, 'concurrency');
    });

    afterAll(async () => {
      await harness.close();
    });

    const runStatus = (runId: string) =>
      harness.tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findById(runId, userId),
      );

    const runEvents = (runId: string) =>
      harness.tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(runId, userId),
      );

    it('7.1 executes several different-chat runs in parallel — wall clock < serial sum (design D1, #47/#117)', async () => {
      // 1200ms: large enough that the sleep dominates the per-run DB
      // bookkeeping overhead (WorkerModule's DB_DEV connection pool is
      // max:1 — the actual model "call" here is a plain setTimeout that
      // holds no DB connection, so the sleeps still overlap freely, but the
      // fixed per-run finalize overhead needs headroom under the threshold
      // below rather than eating most of an 800ms margin).
      const delayMs = 1200;
      const runCount = 3;
      const tag = Date.now();

      const jobs = await Promise.all(
        Array.from({ length: runCount }, async (_, i) => {
          const modelId = `t71-${i}-${tag}`;
          harness.models.register(modelId, {
            kind: 'complete',
            text: `answer-${i}`,
            delayMs,
          });
          const seed = await seedRun({
            tenantDb: harness.tenantDb,
            userId,
            modelId,
          });
          return { modelId, ...seed };
        }),
      );

      const startedAt = Date.now();
      await Promise.all(
        jobs.map((job) =>
          dispatchRun({
            queue: harness.queue,
            chatId: job.chatId,
            runId: job.runId,
            userId,
            modelId: job.modelId,
            userMessage: job.userMessage,
          }),
        ),
      );

      await waitFor(
        async () => {
          const statuses = await Promise.all(
            jobs.map((job) => runStatus(job.runId)),
          );
          return statuses.every((r) => r?.status === 'completed')
            ? true
            : undefined;
        },
        15_000,
        'all runs to complete',
      );

      const wallClockMs = Date.now() - startedAt;
      // Serial (batchSize:1, concurrency 1) would take >= runCount * delayMs
      // (>= 2400ms here). At concurrency 3 they overlap — a clear margin
      // below serial, well above the ~800ms ideal to absorb polling/DB
      // scheduling jitter on a shared dev Postgres.
      expect(wallClockMs).toBeLessThan(runCount * delayMs - 400);
    });

    it('7.2 settles a failing run independently — siblings complete unaffected (design D1 per-job settlement, at the RUNS level)', async () => {
      const tag = Date.now();
      const modelA = `t72-a-${tag}`;
      const modelB = `t72-b-${tag}`;
      const modelFail = `t72-fail-${tag}`;
      harness.models.register(modelA, {
        kind: 'complete',
        text: 'a-done',
        delayMs: 500,
      });
      harness.models.register(modelB, {
        kind: 'complete',
        text: 'b-done',
        delayMs: 500,
      });
      harness.models.register(modelFail, {
        kind: 'infra-throw',
        message: 'simulated infra failure',
      });

      const seedA = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId: modelA,
      });
      const seedB = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId: modelB,
      });
      const seedFail = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId: modelFail,
      });

      await Promise.all([
        dispatchRun({
          queue: harness.queue,
          chatId: seedA.chatId,
          runId: seedA.runId,
          userId,
          modelId: modelA,
          userMessage: seedA.userMessage,
        }),
        dispatchRun({
          queue: harness.queue,
          chatId: seedB.chatId,
          runId: seedB.runId,
          userId,
          modelId: modelB,
          userMessage: seedB.userMessage,
        }),
        // A small, fast, non-backoff retry policy: enough to actually retry
        // (proving "throws/retries", not just an immediate dead-letter) while
        // keeping the test fast and deterministic.
        dispatchRun({
          queue: harness.queue,
          chatId: seedFail.chatId,
          runId: seedFail.runId,
          userId,
          modelId: modelFail,
          userMessage: seedFail.userMessage,
          enqueueOptions: { retryLimit: 1, retryDelay: 0, retryBackoff: false },
        }),
      ]);

      await waitFor(
        async () => {
          const [a, b] = await Promise.all([
            runStatus(seedA.runId),
            runStatus(seedB.runId),
          ]);
          return a?.status === 'completed' && b?.status === 'completed'
            ? true
            : undefined;
        },
        15_000,
        'both sibling runs to complete despite the concurrent failure',
      );

      // The failing run exhausts its (tiny) retry budget and dead-letters to
      // the runs.dead consumer, which settles it to terminal run.expired —
      // it never touches A/B's rows or events.
      const failed = await waitFor(
        async () => {
          const run = await runStatus(seedFail.runId);
          return run?.status === 'expired' ? run : undefined;
        },
        20_000,
        'the failing run to reach terminal expired via the dead-letter path',
      );
      expect(failed.status).toBe('expired');

      const [eventsA, eventsB] = await Promise.all([
        runEvents(seedA.runId),
        runEvents(seedB.runId),
      ]);
      // Clean, uncorrupted stream-ordered event logs for both siblings — no
      // event from the failing run's retries/dead-letter ever bled in.
      expect(eventsA.map((e) => e.eventType)).toEqual([
        'run.started',
        'model.requested',
        'model.delta',
        'model.completed',
        'run.completed',
      ]);
      expect(eventsB.map((e) => e.eventType)).toEqual([
        'run.started',
        'model.requested',
        'model.delta',
        'model.completed',
        'run.completed',
      ]);
    });

    it('7.3 single-flight holds under concurrency: the datastore refuses a second non-terminal run for the same chat, and a different message 409s via chat-loop while a real execution is in flight (design D3)', async () => {
      const tag = Date.now();
      const hangModel = `t73-hang-${tag}`;
      harness.models.register(hangModel, { kind: 'hang' });

      const seed = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId: hangModel,
      });
      await dispatchRun({
        queue: harness.queue,
        chatId: seed.chatId,
        runId: seed.runId,
        userId,
        modelId: hangModel,
        userMessage: seed.userMessage,
      });

      // Wait for the worker to actually CLAIM it (running_model) — a REAL
      // execution is in flight, not just a queued row.
      await waitFor(
        async () => {
          const run = await runStatus(seed.runId);
          return run?.status === 'running_model' ? run : undefined;
        },
        10_000,
        'the run to be claimed and start executing',
      );

      // The hang must be released no matter what happens below — a `hang`
      // model never settles on its own, and this harness's queue consumer is
      // shared with later tests (its concurrency slot must be freed).
      try {
        // (a) The datastore itself refuses a second non-terminal run for the
        // SAME chat — the queue never offers two claimable jobs for one
        // chat, independent of any application-level check, even at
        // concurrency 3. Drizzle surfaces the driver error as a generic
        // "Failed query" wrapper; the constraint name is on the postgres.js
        // cause, same as chat-loop.service.ts's own isInflightUniqueViolation.
        let violation: unknown;
        try {
          await harness.tenantDb.runAs(userId, (tx) =>
            new RunsRepository(tx).create({
              chatId: seed.chatId,
              // Reusing the existing message id is fine here: the
              // constraint under test is the partial unique index on
              // chatId, not message-level uniqueness (there is none).
              messageId: seed.userMessage.id,
              userId,
              modelId: hangModel,
            }),
          );
        } catch (error) {
          violation = error;
        }
        expect(violation).toBeDefined();
        expect(isInflightUniqueViolation(violation)).toBe(true);

        // (b) A DIFFERENT message for the same chat 409s via the real
        // ChatLoopService while the run is genuinely executing (not just
        // queued) — the API-level guarantee the design attributes to the
        // same datastore constraint.
        const aborts = harness.moduleRef.get(RunAbortRegistry, {
          strict: false,
        });
        const bridge = {
          createUiMessageStreamResponse: jest.fn(),
        } as unknown as RunStreamBridgeService;
        const instanceConfig = harness.moduleRef.get(InstanceConfigService, {
          strict: false,
        });
        const chatLoop = new ChatLoopService(
          harness.tenantDb,
          harness.models as unknown as ModelsService,
          instanceConfig,
          bridge,
          aborts,
          harness.dispatch,
        );

        await expect(
          chatLoop.createMessageStream({
            chatId: seed.chatId,
            userId,
            modelId: hangModel,
            message: {
              id: crypto.randomUUID(),
              parts: [{ type: 'text', text: 'blocked by the in-flight run' }],
            },
          }),
        ).rejects.toThrow(/already in flight/i);
      } finally {
        // Release the hang (a genuine cancel, like the real PATCH endpoint)
        // so the shared harness's concurrency slot frees up for later tests.
        const aborts = harness.moduleRef.get(RunAbortRegistry, {
          strict: false,
        });
        aborts.abort(seed.runId);
      }

      // Confirm the worker never ran two same-chat executions: exactly one
      // run.started was ever recorded for it.
      const finished = await waitFor(
        async () => {
          const run = await runStatus(seed.runId);
          return run &&
            ['completed', 'failed', 'cancelled', 'expired'].includes(run.status)
            ? run
            : undefined;
        },
        10_000,
        'the hung run to settle after the abort',
      );
      expect(finished.status).toBe('cancelled');

      const events = await runEvents(seed.runId);
      expect(events.filter((e) => e.eventType === 'run.started')).toHaveLength(
        1,
      );
    });

    it('7.6 concurrent finalizations across different chats each reindex without cross-run interference (design D6)', async () => {
      const tag = Date.now();
      const modelA = `t76-a-${tag}`;
      const modelB = `t76-b-${tag}`;
      harness.models.register(modelA, {
        kind: 'complete',
        text: 'alpha answer',
        delayMs: 300,
      });
      harness.models.register(modelB, {
        kind: 'complete',
        text: 'beta answer',
        delayMs: 300,
      });

      const seedA = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId: modelA,
        text: 'alpha question',
      });
      const seedB = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId: modelB,
        text: 'beta question',
      });

      await Promise.all([
        dispatchRun({
          queue: harness.queue,
          chatId: seedA.chatId,
          runId: seedA.runId,
          userId,
          modelId: modelA,
          userMessage: seedA.userMessage,
        }),
        dispatchRun({
          queue: harness.queue,
          chatId: seedB.chatId,
          runId: seedB.runId,
          userId,
          modelId: modelB,
          userMessage: seedB.userMessage,
        }),
      ]);

      await waitFor(
        async () => {
          const [a, b] = await Promise.all([
            runStatus(seedA.runId),
            runStatus(seedB.runId),
          ]);
          return a?.status === 'completed' && b?.status === 'completed'
            ? true
            : undefined;
        },
        15_000,
        'both concurrent runs to complete and finalize',
      );

      // search_chat_documents is FORCE RLS — read owner-scoped, like
      // search-index.integration.spec.ts's own docCount helper.
      const docCount = (chatId: string) =>
        harness.tenantDb
          .runAs(userId, (tx) =>
            tx
              .select({ id: searchChatDocuments.id })
              .from(searchChatDocuments)
              .where(eq(searchChatDocuments.chatId, chatId)),
          )
          .then((rows) => rows.length);

      // The inline reindex (recordAssistantTurn) commits in a SEPARATE
      // transaction AFTER the run's terminal status write (finishRun) — the
      // run reaching 'completed' does not itself guarantee the reindex has
      // committed yet, so poll rather than assert immediately.
      await waitFor(
        async () => ((await docCount(seedA.chatId)) > 0 ? true : undefined),
        10_000,
        "chat A's reindex to commit",
      );
      await waitFor(
        async () => ((await docCount(seedB.chatId)) > 0 ? true : undefined),
        10_000,
        "chat B's reindex to commit",
      );
    });
  },
);
