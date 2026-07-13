/**
 * Durable run workers — liveness (design D7; task 7.7).
 *
 * Uses the composite worker harness (worker-harness.ts, task 7.0). Covers the
 * two mechanisms that are fast and deterministic to exercise:
 *
 *   1. the in-process wall-clock budget (mechanism 1): an overrunning run is
 *      aborted in-process and recorded as terminal run.expired, distinct from
 *      a genuine user run.cancelled on the SAME abort plumbing
 *      (classifyAbortedRun's tagging) — no queue involved, no heartbeat wait.
 *   2. retry exhaustion (mechanism 3): a run whose job keeps throwing an
 *      infra error exhausts its retry budget, dead-letters, and the
 *      `runs.dead` consumer settles it to terminal run.expired in the run
 *      owner's tenant scope.
 *
 * Two SEPARATE harness boots are used (not one shared instance): the timeout
 * scenario needs `runs.timeoutSeconds` tuned down to 1s, which would race a
 * genuine cancel issued against a DIFFERENT run in the SAME process (that
 * run's own in-process budget would also be ticking down from 1s) — keeping
 * the cancel-distinctness and retry-exhaustion scenarios on a harness with
 * the default (300s) budget removes that race entirely rather than trying to
 * out-race it with tighter timing assertions.
 *
 * Worker-death -> retry -> re-execute, and a paused-but-not-dead worker's
 * transient double-run settling to a single terminal outcome, are NOT
 * exercised here — see the comment at the end of this file for why, and what
 * already covers the properties that matter.
 *
 * TEST_DATABASE_URL-gated — skipped otherwise. worker-harness.ts
 * self-provisions POSTGRES_URL from TEST_DATABASE_URL for WorkerModule's own
 * DB/queue connections, so no ambient POSTGRES_URL is required in the
 * caller's shell.
 */

import { RunAbortRegistry } from './run-abort-registry';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { waitFor } from '../../test/support';
import {
  bootWorkerHarness,
  createUser,
  seedAndDispatchRun,
  type WorkerHarness,
} from './worker-harness';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

jest.setTimeout(60_000);

describeIfDb(
  'Durable run workers — in-process timeout budget (design D7 mechanism 1)',
  () => {
    let harness: WorkerHarness;
    let userId: string;

    beforeAll(async () => {
      // A 1s budget makes the timeout deterministic and fast — no heartbeat
      // wait involved, this is purely RunsWorkerService's own setTimeout.
      harness = await bootWorkerHarness({
        runsConcurrency: 1,
        timeoutSeconds: 1,
        heartbeatSeconds: 10,
      });
      userId = await createUser(harness.db, 'liveness-timeout');
    });

    afterAll(async () => {
      await harness.close();
    });

    it('an overrunning run is aborted in-process and recorded as terminal run.expired (timeout), not run.cancelled', async () => {
      const modelId = `t77-timeout-${Date.now()}`;
      harness.models.register(modelId, { kind: 'hang' });

      const seed = await seedAndDispatchRun(harness, { userId, modelId });

      const expired = await waitFor(
        async () => {
          const run = await harness.tenantDb.runAs(userId, (tx) =>
            new RunsRepository(tx).findById(seed.runId, userId),
          );
          return run?.status === 'expired' ? run : undefined;
        },
        15_000,
        'the overrunning run to be aborted on its in-process budget and reach expired',
      );
      expect(expired.status).toBe('expired');

      const events = await harness.tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seed.runId, userId),
      );
      const expiredEvent = events.find((e) => e.eventType === 'run.expired');
      expect(expiredEvent).toBeDefined();
      expect((expiredEvent?.payload as { message?: string })?.message).toMatch(
        /timed out/i,
      );
      expect(events.map((e) => e.eventType)).not.toContain('run.cancelled');
    });
  },
);

describeIfDb(
  'Durable run workers — genuine cancel vs. timeout tagging, and retry exhaustion (design D7 mechanisms 1 and 3)',
  () => {
    let harness: WorkerHarness;
    let userId: string;

    beforeAll(async () => {
      // Default (built-in) timeoutSeconds — generous, so a genuine cancel here
      // never races the in-process budget the way a 1s budget would.
      harness = await bootWorkerHarness({ runsConcurrency: 2 });
      userId = await createUser(harness.db, 'liveness-cancel');
    });

    afterAll(async () => {
      await harness.close();
    });

    it('a genuine user cancel on an executing run ends run.cancelled — classifyAbortedRun tags it distinctly from a timeout', async () => {
      const modelId = `t77-cancel-${Date.now()}`;
      harness.models.register(modelId, { kind: 'hang' });

      const seed = await seedAndDispatchRun(harness, { userId, modelId });

      await waitFor(
        async () => {
          const run = await harness.tenantDb.runAs(userId, (tx) =>
            new RunsRepository(tx).findById(seed.runId, userId),
          );
          return run?.status === 'running_model' ? run : undefined;
        },
        10_000,
        'the run to start executing',
      );

      // Mirrors RunsController.updateRun's cancel path exactly: stamp
      // cancel_requested_at, then abort the in-process controller.
      await harness.tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).requestCancel(seed.runId, userId),
      );
      const aborts = harness.moduleRef.get(RunAbortRegistry, { strict: false });
      aborts.abort(seed.runId);

      const cancelled = await waitFor(
        async () => {
          const run = await harness.tenantDb.runAs(userId, (tx) =>
            new RunsRepository(tx).findById(seed.runId, userId),
          );
          return run?.status === 'cancelled' ? run : undefined;
        },
        15_000,
        'the genuinely-cancelled run to reach cancelled',
      );
      expect(cancelled.status).toBe('cancelled');

      const events = await harness.tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seed.runId, userId),
      );
      expect(events.map((e) => e.eventType)).toContain('run.cancelled');
      expect(events.map((e) => e.eventType)).not.toContain('run.expired');
    });

    it('retry exhaustion settles the run to terminal run.expired via the runs.dead consumer, in the owner tenant scope (design D7 mechanism 3)', async () => {
      const modelId = `t77-fail-${Date.now()}`;
      harness.models.register(modelId, {
        kind: 'infra-throw',
        message: 'simulated infra failure',
      });

      const seed = await seedAndDispatchRun(harness, {
        userId,
        modelId,
        // A small, fast, non-backoff retry budget so exhaustion is reached
        // quickly and deterministically.
        enqueueOptions: { retryLimit: 1, retryDelay: 0, retryBackoff: false },
      });

      const expired = await waitFor(
        async () => {
          // An owner-scoped read (RLS via tenantDb.runAs(userId, ...)) — if
          // expireDeadLetteredRun had written under the wrong tenant, this
          // read would never observe it.
          const run = await harness.tenantDb.runAs(userId, (tx) =>
            new RunsRepository(tx).findById(seed.runId, userId),
          );
          return run?.status === 'expired' ? run : undefined;
        },
        20_000,
        'the run to reach terminal expired via retry exhaustion',
      );
      expect(expired.status).toBe('expired');

      const events = await harness.tenantDb.runAs(userId, (tx) =>
        new RunEventsRepository(tx).listByRunId(seed.runId, userId),
      );
      const expiredEvent = events.find((e) => e.eventType === 'run.expired');
      expect(expiredEvent).toBeDefined();
      expect((expiredEvent?.payload as { message?: string })?.message).toMatch(
        /retries exhausted/i,
      );
    });
  },
);

// DEFERRED (per design D7's own risk section + tasks.md 7.7's explicit
// allowance): "worker-death -> job retried -> a healthy worker re-executes"
// and "a paused-but-not-dead worker's transient double-run settles to a
// SINGLE terminal outcome" both need REAL pg-boss heartbeat-timeout timing
// (>= 10s, the engine's own floor) to trigger truthfully. There is no seam to
// force a live job's heartbeat to lapse without either (a) literally killing
// a worker process mid-job, or (b) reaching into pg-boss's internal schema to
// fake a stale heartbeat — both trade a slow, borderline-flaky integration
// test for marginal extra confidence over what is ALREADY proven elsewhere:
//
//   - the "single terminal outcome" half of the paused-double-run risk is
//     markFinished's first-writer-wins guard, proven at the repository unit
//     level (chats-repository.spec.ts's markStarted/markFinished specs —
//     "refuses terminal runs" / "scopes by runId AND userId and stamps
//     finishedAt + status") and exercised again by RunsWorkerService's own
//     dead-letter unit test (runs-worker.service.spec.ts — "is a no-op when
//     the run already reached a terminal state (first-writer-wins)"). A real
//     paused-worker overlap cannot produce two terminal writes no matter how
//     it is triggered — the guard is unconditional on the WHERE clause, not
//     on how the race came about.
//   - the native heartbeat primitive itself (auto-refresh keeping a
//     long-pending handler alive past heartbeatSeconds, and the >= 10s floor)
//     is verified end-to-end in queue.integration.spec.ts's dedicated D7 test
//     (#5.1, "keeps a long-running handler alive past heartbeatSeconds via
//     native auto-refresh") — that IS the primitive worker-death detection
//     depends on; what would remain untested here is purely the
//     timing-dependent "kill it and watch it recover" choreography on top of
//     an already-verified primitive.
//
// A manual/soak test (kill -9 a dedicated `worker.ts` process mid-run,
// confirm the job redelivers and a healthy worker completes it) is the right
// way to validate this further — not a >=20s in-process jest timer race that
// would be the first flaky test in this suite.
