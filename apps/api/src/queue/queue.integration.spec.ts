/**
 * Queue integration tests (#47) — requires a real PostgreSQL connection.
 *
 * Set TEST_DATABASE_URL to run (same gate as chats-rls.integration.spec.ts);
 * skipped otherwise so offline `pnpm test` stays usable. pg-boss provisions its
 * own `pgboss` schema on first start — the connecting role owns the database in
 * both dev and the rls-test.sh throwaway, so no extra grants are needed.
 *
 * Acceptance criteria covered (#47):
 * - enqueue/consume roundtrip through the typed Queue interface (pg-boss via DI)
 * - retries: a failing handler is retried per policy and then succeeds
 * - dead-letter: a terminally failing job lands on `<queue>.dead` with its data
 * - parse guard: a malformed payload (e.g. written by an older deploy) fails at
 *   the consume boundary and dead-letters without invoking the handler
 * - cron scheduling via pg-boss itself (no pg_cron): schedule persisted +
 *   removable; time-based dispatch proven with a deferred job (a live cron fire
 *   needs a >=60s wait — pg-boss's own suite covers the firing)
 * - cancel: a queued (deferred) job is cancelled before delivery
 */

import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { PgBossService } from '@wavezync/nestjs-pgboss';

import { QueueModule } from './queue.module';
import {
  QUEUE,
  deadLetterQueue,
  defineQueue,
  type JobHandler,
  type Queue,
  type QueueDefinition,
} from './queue';
import { waitFor } from '../../test/support';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

jest.setTimeout(60_000);

describeIfDb(
  'Queue over pg-boss — enqueue/consume/retry/dead-letter/cron',
  () => {
    let app: INestApplication;
    let queue: Queue;
    let pgBoss: PgBossService;

    // Unique queue names per run: pg-boss archives completed jobs rather than
    // deleting them, so re-running against the same database must not collide.
    const tag = `q${Date.now()}`;

    const consume = async <T extends object>(
      def: QueueDefinition<T>,
      handler: JobHandler<T>,
      options?: Parameters<Queue['consume']>[2],
    ) =>
      queue.consume(def, handler, {
        pollingIntervalSeconds: 0.5,
        ...options,
      });

    beforeAll(async () => {
      const mod = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            ignoreEnvFile: true,
            load: [() => ({ POSTGRES_URL: TEST_DB_URL })],
          }),
          QueueModule,
        ],
      }).compile();

      app = mod.createNestApplication();
      await app.init();
      queue = app.get<Queue>(QUEUE);
      pgBoss = app.get(PgBossService);
    });

    afterAll(async () => {
      // app.close() drains + stops every consumer natively (nestjs-pgboss's
      // onModuleDestroy → boss.stop({ graceful })) — no per-consumer teardown.
      await app?.close();
    });

    it('enqueues and consumes a job through the typed Queue interface', async () => {
      const roundtrip = defineQueue<{ hello: string }>({
        name: `${tag}-roundtrip`,
      });
      await queue.ensureQueue(roundtrip);

      const received: Array<{ data: unknown; id: string }> = [];
      await consume(roundtrip, (data, meta) => {
        received.push({ data, id: meta.id });
        return Promise.resolve();
      });

      const jobId = await queue.enqueue(roundtrip, { hello: 'world' });
      expect(typeof jobId).toBe('string');

      await waitFor(
        () => (received.length > 0 ? received[0] : undefined),
        10_000,
        'the job to be consumed',
      );
      expect(received[0].data).toEqual({ hello: 'world' });
      expect(received[0].id).toBe(jobId);
    });

    it('coalesces same-key enqueues on a stately queue + singletonKey (#195)', async () => {
      // The chat-search reindex queue relies on this: a burst of writes to one
      // chat must collapse into a single pending rebuild. Under policy `stately`
      // (one job per state), a second enqueue with the same singletonKey while one
      // is already queued is deduped (returns null); a different key is independent.
      const coalescing = defineQueue<{ chatId: string }>({
        name: `${tag}-stately`,
        options: { policy: 'stately' },
      });
      await queue.ensureQueue(coalescing);

      const first = await queue.enqueue(
        coalescing,
        { chatId: 'c1' },
        { singletonKey: 'c1' },
      );
      const second = await queue.enqueue(
        coalescing,
        { chatId: 'c1' },
        { singletonKey: 'c1' },
      );
      const third = await queue.enqueue(
        coalescing,
        { chatId: 'c1' },
        { singletonKey: 'c1' },
      );
      const otherKey = await queue.enqueue(
        coalescing,
        { chatId: 'c2' },
        { singletonKey: 'c2' },
      );

      expect(typeof first).toBe('string');
      expect(second).toBeNull();
      expect(third).toBeNull();
      expect(typeof otherKey).toBe('string');
    });

    it('retries a failing job per policy until it succeeds', async () => {
      const retryQueue = defineQueue<{ work: string }>({
        name: `${tag}-retry`,
      });
      await queue.ensureQueue(retryQueue);

      let attempts = 0;
      let succeededOnAttempt = 0;
      await consume(retryQueue, () => {
        attempts += 1;
        if (attempts < 3) {
          return Promise.reject(new Error(`transient failure #${attempts}`));
        }
        succeededOnAttempt = attempts;
        return Promise.resolve();
      });

      // Per-job override: immediate retries so the test doesn't sit out backoff.
      await queue.enqueue(
        retryQueue,
        { work: 'flaky' },
        { retryLimit: 3, retryDelay: 0, retryBackoff: false },
      );

      await waitFor(
        () => (succeededOnAttempt > 0 ? succeededOnAttempt : undefined),
        20_000,
        'the job to succeed after retries',
      );
      expect(succeededOnAttempt).toBe(3);
    });

    it('routes a terminally failing job to the dead-letter queue with its data', async () => {
      const dlqQueue = defineQueue<{ payload: string }>({
        name: `${tag}-dlq`,
      });
      await queue.ensureQueue(dlqQueue);

      await consume(dlqQueue, () =>
        Promise.reject(new Error('permanent failure')),
      );

      const dead: unknown[] = [];
      await consume(deadLetterQueue(dlqQueue), (data) => {
        dead.push(data);
        return Promise.resolve();
      });

      await queue.enqueue(
        dlqQueue,
        { payload: 'must-not-evaporate' },
        { retryLimit: 1, retryDelay: 0, retryBackoff: false },
      );

      await waitFor(
        () => (dead.length > 0 ? dead[0] : undefined),
        20_000,
        'the job to reach the dead-letter queue',
      );
      // The dead-letter job carries the original payload — failed work is
      // inspectable and replayable, never silently dropped.
      expect(dead[0]).toEqual({ payload: 'must-not-evaporate' });
    });

    it('fails a malformed payload at the parse guard without invoking the handler', async () => {
      const guarded = defineQueue<{ n: number }>({
        name: `${tag}-guarded`,
        parse: (data) => {
          const record = data as { n?: unknown };
          if (typeof record?.n !== 'number') {
            throw new TypeError('expected { n: number }');
          }
          return { n: record.n };
        },
      });
      await queue.ensureQueue(guarded);

      const handled: unknown[] = [];
      await consume(guarded, (data) => {
        handled.push(data);
        return Promise.resolve();
      });
      // The DLQ consumer sees the RAW payload — skip the guard by consuming
      // the derived definition without a parse.
      const dead: unknown[] = [];
      await consume(
        defineQueue<object>({ name: `${tag}-guarded.dead` }),
        (data) => {
          dead.push(data);
          return Promise.resolve();
        },
      );

      // Simulate an older deploy's payload shape: bypass the typed surface and
      // write through the engine directly.
      await pgBoss.boss.send(
        `${tag}-guarded`,
        { legacyField: true },
        { retryLimit: 1, retryDelay: 0, retryBackoff: false },
      );

      await waitFor(
        () => (dead.length > 0 ? dead[0] : undefined),
        20_000,
        'the malformed job to dead-letter',
      );
      expect(dead[0]).toEqual({ legacyField: true });
      expect(handled).toHaveLength(0);
    });

    it('persists and removes a cron schedule via pg-boss (no pg_cron)', async () => {
      const cronQueue = defineQueue<{ source: string }>({
        name: `${tag}-cron`,
      });
      await queue.ensureQueue(cronQueue);

      await queue.schedule(cronQueue, '*/5 * * * *', { source: 'cron' });

      const schedules = await pgBoss.boss.getSchedules();
      const ours = schedules.find((s) => s.name === cronQueue.name);
      expect(ours).toBeDefined();
      expect(ours?.cron).toBe('*/5 * * * *');
      expect(ours?.data).toEqual({ source: 'cron' });

      await queue.unschedule(cronQueue);
      const after = await pgBoss.boss.getSchedules();
      expect(after.find((s) => s.name === cronQueue.name)).toBeUndefined();
    });

    it('re-applies a changed queue policy on ensureQueue (createQueue alone is not an upsert)', async () => {
      const name = `${tag}-reensure`;
      await queue.ensureQueue(
        defineQueue<object>({ name, options: { retryLimit: 3 } }),
      );
      await queue.ensureQueue(
        defineQueue<object>({ name, options: { retryLimit: 10 } }),
      );

      const props = await pgBoss.boss.getQueue(name);
      expect(props?.retryLimit).toBe(10);
    });

    it('cancels a queued job before delivery', async () => {
      const cancelQueue = defineQueue<{ payload: string }>({
        name: `${tag}-cancel`,
      });
      await queue.ensureQueue(cancelQueue);

      // Deferred well past the test window so the consumer can't race the
      // cancellation; cancel() must win before delivery ever becomes possible.
      const jobId = await queue.enqueue(
        cancelQueue,
        { payload: 'never-delivered' },
        { startAfter: 120 },
      );
      expect(typeof jobId).toBe('string');

      await queue.cancel(cancelQueue, jobId!);

      const job = await pgBoss.boss.getJobById(cancelQueue.name, jobId!);
      expect(job?.state).toBe('cancelled');
    });

    it('delivers a deferred job only after its startAfter delay', async () => {
      const deferredQueue = defineQueue<{ deferred: boolean }>({
        name: `${tag}-deferred`,
      });
      await queue.ensureQueue(deferredQueue);

      const received: number[] = [];
      await consume(deferredQueue, () => {
        received.push(Date.now());
        return Promise.resolve();
      });

      const enqueuedAt = Date.now();
      await queue.enqueue(deferredQueue, { deferred: true }, { startAfter: 2 });

      await waitFor(
        () => (received.length > 0 ? received[0] : undefined),
        20_000,
        'the deferred job to be delivered',
      );
      // Allow modest clock/polling slack, but it must not arrive immediately.
      expect(received[0] - enqueuedAt).toBeGreaterThanOrEqual(1_500);
    });

    it('runs jobs in parallel under concurrency and settles each independently (design D1, #2.2)', async () => {
      const concurrencyQueue = defineQueue<{
        id: number;
        shouldFail?: boolean;
      }>({ name: `${tag}-concurrency` });
      await queue.ensureQueue(concurrencyQueue);

      let inFlight = 0;
      let maxInFlight = 0;
      const completed: number[] = [];
      const failed: number[] = [];

      await consume(
        concurrencyQueue,
        async (data) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          // Block on a latch (a fixed delay) long enough for sibling workers
          // to overlap, without any manual batching/ack.
          await new Promise((resolve) => setTimeout(resolve, 800));
          inFlight -= 1;
          if (data.shouldFail) {
            failed.push(data.id);
            throw new Error(`job ${data.id} fails on purpose`);
          }
          completed.push(data.id);
        },
        { concurrency: 3 },
      );

      const jobIds = await Promise.all([
        queue.enqueue(concurrencyQueue, { id: 1 }),
        queue.enqueue(concurrencyQueue, { id: 2 }),
        queue.enqueue(
          concurrencyQueue,
          { id: 3, shouldFail: true },
          { retryLimit: 0 },
        ),
      ]);
      expect(jobIds.every((id) => typeof id === 'string')).toBe(true);

      await waitFor(
        () => (completed.length >= 2 ? true : undefined),
        15_000,
        'both non-failing jobs to complete',
      );
      await waitFor(
        () => (failed.length >= 1 ? true : undefined),
        15_000,
        'the failing job to have run',
      );

      expect([...completed].sort((a, b) => a - b)).toEqual([1, 2]);
      // Proves parallelism, not serial batchSize:1 execution: a serial
      // consumer could never observe more than one job in flight.
      expect(maxInFlight).toBeGreaterThanOrEqual(2);
    });

    it('confines a job-class to its subscribers and shares a queue across replicas without double-processing (design D2, #2.3)', async () => {
      const queueA = defineQueue<{ tag: string }>({
        name: `${tag}-route-a`,
      });
      const queueB = defineQueue<{ tag: string }>({
        name: `${tag}-route-b`,
      });
      await queue.ensureQueue(queueA);
      await queue.ensureQueue(queueB);

      const seenByFirst: string[] = [];
      // Only ever subscribes to queue A.
      await consume(queueA, (data) => {
        seenByFirst.push(data.tag);
        return Promise.resolve();
      });

      await queue.enqueue(queueA, { tag: 'a-job' });
      await queue.enqueue(queueB, { tag: 'b-job' });

      await waitFor(
        () => (seenByFirst.length > 0 ? true : undefined),
        10_000,
        'queue A job to be consumed',
      );
      // Give the unsubscribed queue B job a chance to be wrongly picked up.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(seenByFirst).toEqual(['a-job']);

      // A second process subscribing to the SAME queue shares its jobs — no
      // job runs twice.
      const seenBySecond: string[] = [];
      await consume(queueA, (data) => {
        seenBySecond.push(data.tag);
        return Promise.resolve();
      });

      await queue.enqueue(queueA, { tag: 'shared-1' });
      await queue.enqueue(queueA, { tag: 'shared-2' });

      await waitFor(
        () =>
          seenByFirst.length + seenBySecond.length >= 3 ? true : undefined,
        10_000,
        'both shared jobs to be consumed exactly once total',
      );
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(seenByFirst.length + seenBySecond.length).toBe(3);
      expect([...seenByFirst, ...seenBySecond].sort()).toEqual(
        ['a-job', 'shared-1', 'shared-2'].sort(),
      );
    });

    // NOTE (design D7, #5.1): "a handler that outlives heartbeatSeconds is kept
    // alive by pg-boss's native auto-refresh (heartbeatRefreshSeconds, default
    // heartbeatSeconds/2), not failed+retried" is a property of pg-boss ITSELF,
    // not our wrapper. A direct test needs a real >heartbeatSeconds (floor 10s)
    // sleep whose auto-refresh depends on a JS timer firing on time — which is
    // unreliable under this suite's parallel, event-loop-saturated run (it
    // spuriously lapsed the beat, failing intermittently). It is deliberately
    // NOT an assertion here: the behavior is verified in pg-boss's source
    // (plans.js `fetchNextJob` excludes `active` jobs; `failJobsByHeartbeat`
    // only returns one after the beat lapses; `manager.js#processJobs`
    // auto-touches every heartbeatSeconds/2), and our USE of it is covered by
    // `runs/worker-liveness.integration.spec.ts` — matching the test slice's
    // rule of not committing flaky wall-clock-timing tests.
  },
);

describeIfDb(
  'Queue over pg-boss — graceful drain on shutdown (design D5, #6.1)',
  () => {
    it('drains an in-flight job before the module finishes shutting down', async () => {
      const mod = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            ignoreEnvFile: true,
            load: [() => ({ POSTGRES_URL: TEST_DB_URL })],
          }),
          QueueModule,
        ],
      }).compile();

      const app = mod.createNestApplication();
      await app.init();
      const queue = app.get<Queue>(QUEUE);

      const drainQueue = defineQueue<{ marker: string }>({
        name: `q${Date.now()}-drain`,
      });
      await queue.ensureQueue(drainQueue);

      let started = false;
      let finished = false;
      await queue.consume(drainQueue, async () => {
        started = true;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        finished = true;
      });

      await queue.enqueue(drainQueue, { marker: 'in-flight' });

      await waitFor(
        () => (started ? true : undefined),
        10_000,
        'the job to start',
      );

      // app.close() always runs onModuleDestroy hooks (enableShutdownHooks()
      // is only needed to wire OS signals to it, as main.ts does). It must not
      // resolve until the in-flight handler finishes: nestjs-pgboss's
      // onModuleDestroy calls boss.stop({ graceful }), which stops fetching and
      // awaits every running handler (worker.stop() → `await runPromise`)
      // before shutting down — the native drain this codebase relies on.
      await app.close();

      expect(finished).toBe(true);
    });
  },
);
