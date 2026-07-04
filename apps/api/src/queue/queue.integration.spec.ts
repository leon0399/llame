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
    // Stop thunks capture their correctly-typed definition — definitions are
    // invariant in their payload type, so a heterogeneous list can't hold
    // them directly (that invariance IS the typed-queue guarantee).
    const consumerStops: Array<() => Promise<void>> = [];

    const consume = async <T extends object>(
      def: QueueDefinition<T>,
      handler: JobHandler<T>,
    ) => {
      const id = await queue.consume(def, handler, {
        pollingIntervalSeconds: 0.5,
      });
      consumerStops.push(() => queue.stopConsumer(def, id));
      return id;
    };

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
      for (const stop of consumerStops) {
        await stop().catch(() => undefined);
      }
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
  },
);
