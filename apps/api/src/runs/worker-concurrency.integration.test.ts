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
 * *.integration.test.ts in this package. worker-harness.ts self-provisions
 * POSTGRES_URL from TEST_DATABASE_URL for WorkerModule's own DB/queue
 * connections, so no ambient POSTGRES_URL is required in the caller's shell.
 */

import { eq } from 'drizzle-orm';
import postgres from 'postgres';

import { RunAbortRegistry } from './run-abort-registry';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { type RunStreamResponder } from './run-stream-bridge';
import {
  ChatLoopService,
  isInflightUniqueViolation,
} from '../chats/chat-loop.service';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import { MessagesRepository } from '../chats/chats-repository';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { PersonalizationService } from '../personalization/personalization.service';
import { MemoryService } from '../memory/memory.service';
import { RecencyDigestService } from '../chats/recency-digest.service';
import { type KnowledgeToolCandidateResolverPort } from '../knowledge/knowledge-tool-candidate-resolver';
import { TOOL_REGISTRY } from '../tools/registry';
import { searchChatDocuments } from '../db/schema/search';
import { waitFor } from '../testing/support';
import {
  bootWorkerHarness,
  createUser,
  dispatchRun,
  seedAndDispatchRun,
  seedRun,
  type WorkerHarness,
} from './worker-harness';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

vi.setConfig({ testTimeout: 60_000 });

/**
 * A client independent of the harness pool, for the lock-interleaving tests:
 * they hold a transaction open while the worker runs, which a pooled harness
 * connection cannot do. `ssl` is detected the same way every other integration
 * suite does it (chats-rls.integration.test.ts), so a remote TEST_DATABASE_URL
 * works here too.
 */
function requireTestDbUrl(): string {
  if (!TEST_DB_URL) {
    throw new Error('TEST_DATABASE_URL is required for this suite');
  }
  return TEST_DB_URL;
}

const testClient = (max: number) =>
  postgres(requireTestDbUrl(), {
    max,
    ssl: /sslmode=require/.test(TEST_DB_URL ?? '') ? 'require' : false,
  });

const knowledgeCandidates: KnowledgeToolCandidateResolverPort = {
  resolve: () =>
    Promise.resolve(
      [...TOOL_REGISTRY.values()].map((tool) => ({
        source: { type: 'code_owned' as const },
        state: 'available' as const,
        tool,
      })),
    ),
};

/**
 * Run `fn` in a transaction carrying the tenant identity — without it FORCE RLS
 * matches no rows, so a lock-taking statement would silently lock nothing and
 * the test would prove nothing. `sql.begin` commits on return and rolls back on
 * throw, so a failed assertion always frees whatever the worker is blocked on.
 */
const asUser = <T>(
  sql: ReturnType<typeof testClient>,
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
) =>
  sql.begin(async (tx) => {
    await tx`select set_config('app.current_user_id', ${userId}, true)`;
    return fn(tx);
  });

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

      const [seedA, seedB, seedFail] = await Promise.all([
        seedAndDispatchRun(harness, { userId, modelId: modelA }),
        seedAndDispatchRun(harness, { userId, modelId: modelB }),
        // A small, fast, non-backoff retry policy: enough to actually retry
        // (proving "throws/retries", not just an immediate dead-letter) while
        // keeping the test fast and deterministic.
        seedAndDispatchRun(harness, {
          userId,
          modelId: modelFail,
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

    it('does not invoke a fallback model when the newly selected target fails', async () => {
      const tag = Date.now();
      const sourceModel = `switch-source-${tag}`;
      const targetModel = `switch-target-${tag}`;
      harness.models.register(sourceModel, {
        kind: 'complete',
        text: 'source answer',
      });
      const source = await seedAndDispatchRun(harness, {
        userId,
        modelId: sourceModel,
      });
      await waitFor(
        async () =>
          (await runStatus(source.runId))?.status === 'completed'
            ? true
            : undefined,
        15_000,
        'the source-model turn to complete',
      );

      harness.models.createClientCalls.length = 0;
      harness.models.register(targetModel, {
        kind: 'provider-error',
        message: 'selected target provider failed',
      });
      const target = await seedAndDispatchRun(harness, {
        userId,
        chatId: source.chatId,
        modelId: targetModel,
      });

      await waitFor(
        async () =>
          (await runStatus(target.runId))?.status === 'failed'
            ? true
            : undefined,
        15_000,
        'the selected target-model provider failure to settle without failover',
      );

      expect(harness.models.createClientCalls).toEqual([
        { modelId: targetModel },
      ]);
    });

    it('7.3 single-flight holds under concurrency: the datastore refuses a second non-terminal run for the same chat, and a different message 409s via chat-loop while a real execution is in flight (design D3)', async () => {
      const tag = Date.now();
      const hangModel = `t73-hang-${tag}`;
      harness.models.register(hangModel, { kind: 'hang' });

      const seed = await seedAndDispatchRun(harness, {
        userId,
        modelId: hangModel,
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
              modelContextSnapshotId: seed.modelContextSnapshotId,
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
        const bridge: RunStreamResponder = {
          createUiMessageStreamResponse: vi.fn(),
        };
        const instanceConfig = harness.moduleRef.get(InstanceConfigService, {
          strict: false,
        });
        const chatLoop = new ChatLoopService(
          harness.tenantDb,
          harness.models,
          instanceConfig,
          bridge,
          aborts,
          harness.dispatch,
          new PersonalizationService(harness.tenantDb),
          new SystemPromptsService(),
          { snapshotCandidates: () => [] },
          new MemoryService(harness.tenantDb),
          new RecencyDigestService(harness.tenantDb),
          knowledgeCandidates,
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

    it('never publishes a terminal run whose assistant message is not yet readable (#261)', async () => {
      const modelId = `atomic-${Date.now()}`;
      harness.models.register(modelId, {
        kind: 'complete',
        text: 'atomic answer',
      });
      const seed = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId,
        text: 'atomic question',
      });

      const turnState = () =>
        harness.tenantDb.runAs(userId, (tx) =>
          new MessagesRepository(tx).findTurnState(
            seed.chatId,
            userId,
            seed.userMessage.id,
          ),
        );

      // Hold the chat row FOR UPDATE. Inserting the assistant message takes a
      // FOR KEY SHARE lock on it (the messages.chat_id foreign key), so that
      // insert blocks — while `markFinished` does not, since it never changes a
      // referencing column. The finalizer therefore freezes with its terminal
      // write done but uncommitted, which is precisely the interleaving #261
      // was about, and every reader outside sees whether it leaked. Its own
      // pool, not the harness's: this transaction stays open while the worker
      // runs, and the second connection answers the pg_blocking_pids poll while
      // it is held.
      const lockSql = testClient(2);
      try {
        await asUser(lockSql, userId, async (lock) => {
          const held =
            await lock`select id from chats where id = ${seed.chatId} for update`;
          expect(held).toHaveLength(1);
          const [{ pid }] = await lock<
            Array<{ pid: number }>
          >`select pg_backend_pid() as pid`;

          await dispatchRun({
            queue: harness.queue,
            chatId: seed.chatId,
            runId: seed.runId,
            userId,
            modelId,
            userMessage: seed.userMessage,
          });

          // Deterministic window: wait until a backend is actually blocked on
          // OUR lock — that is the finalizer, inside the terminal transaction,
          // after the model answered.
          await waitFor(
            async () => {
              const blocked =
                await lockSql`select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid)) limit 1`;
              return blocked.length > 0 ? true : undefined;
            },
            20_000,
            "the run finalizer to block writing this turn's assistant message",
          );

          // The invariant. Before #261 the terminal status was its own earlier
          // commit, so the run reached 'completed' right here — with the answer
          // still uncommitted behind this lock, and no later event to make a
          // client refetch it.
          const run = await runStatus(seed.runId);
          expect(run?.status).toBe('running_model');
          expect((await turnState()).assistantMessage).toBeUndefined();
        });

        await waitFor(
          async () =>
            (await runStatus(seed.runId))?.status === 'completed'
              ? true
              : undefined,
          20_000,
          'the released run to reach completed',
        );
        // Read ONCE, unpolled: observing the terminal status is the whole
        // guarantee — a reader that gets here must already see the answer.
        const { assistantMessage } = await turnState();
        expect(JSON.stringify(assistantMessage?.parts)).toContain(
          'atomic answer',
        );
      } finally {
        await lockSql.end();
      }
    });

    it("a concurrent chat touch does not block the finalizer's message write (the lock-order premise, #261)", async () => {
      // The finalizer holds the run row and then inserts the assistant message,
      // which takes FOR KEY SHARE on the chat row through messages.chat_id.
      // The send path holds that same chat row (its activity touch) while it
      // waits on the run row. Whether that is a deadlock or a non-event rests
      // entirely on one Postgres rule — FOR KEY SHARE is compatible with the
      // FOR NO KEY UPDATE an UPDATE of a non-key column takes — so pin the rule
      // rather than trusting a comment about it. If it ever stops holding, the
      // insert below waits for the open transaction and fails on lock_timeout
      // instead of deadlocking a user's send in production.
      const seed = await seedRun({
        tenantDb: harness.tenantDb,
        userId,
        modelId: `lock-order-${Date.now()}`,
        text: 'lock order question',
      });

      const sql = testClient(2);
      try {
        await asUser(sql, userId, async (toucher) => {
          // Exactly what chat-loop.service.ts does before inserting the run.
          // RETURNING + assert: under FORCE RLS an identity-less UPDATE matches
          // nothing and locks nothing, which would make this whole test pass
          // while proving nothing.
          const touched =
            await toucher`update chats set updated_at = now() where id = ${seed.chatId} returning id`;
          expect(touched).toHaveLength(1);

          await asUser(sql, userId, async (inserter) => {
            await inserter`set local lock_timeout = '5s'`;
            const inserted = await inserter`
              insert into messages (chat_id, seq, role, parts, in_reply_to)
              values (${seed.chatId}, 2, 'assistant', ${sql.json([{ type: 'text', text: 'lock order answer' }])}, ${seed.userMessage.id})
              returning id
            `;
            expect(inserted).toHaveLength(1);
          });
        });
      } finally {
        await sql.end();
      }
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

      const [seedA, seedB] = await Promise.all([
        seedAndDispatchRun(harness, {
          userId,
          modelId: modelA,
          text: 'alpha question',
        }),
        seedAndDispatchRun(harness, {
          userId,
          modelId: modelB,
          text: 'beta question',
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
      // search-index.integration.test.ts's own docCount helper.
      const docCount = (chatId: string) =>
        harness.tenantDb
          .runAs(userId, (tx) =>
            tx
              .select({ id: searchChatDocuments.id })
              .from(searchChatDocuments)
              .where(eq(searchChatDocuments.chatId, chatId)),
          )
          .then((rows) => rows.length);

      // The inline reindex (afterAssistantTurn) runs in a SEPARATE transaction
      // AFTER the terminal one — deliberately, so a chunker failure cannot roll
      // back a committed turn. Unlike the assistant message (#261), the run
      // reaching 'completed' does not guarantee the reindex has committed yet,
      // so poll rather than assert immediately.
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
