/**
 * Queue integration tests (#47) — requires a real PostgreSQL connection.
 *
 * Set TEST_DATABASE_URL to run (same gate as chats-rls.integration.spec.ts);
 * skipped otherwise so offline `pnpm test` stays usable. pg-boss provisions its
 * own `pgboss` schema on first start — the connecting role owns the database in
 * both dev and the rls-test.sh throwaway, so no extra grants are needed.
 *
 * Acceptance criteria covered (#47):
 * - enqueue/consume roundtrip through the Queue interface (pg-boss wired via DI)
 * - retries: a failing handler is retried per policy and then succeeds
 * - dead-letter: a terminally failing job lands on `<queue>.dead` with its data
 * - cron scheduling via pg-boss itself (no pg_cron): schedule persisted +
 *   removable; time-based dispatch proven with a deferred job (a live cron fire
 *   needs a >=60s wait — pg-boss's own suite covers the firing)
 */

import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { PgBossService } from '@wavezync/nestjs-pgboss';

import { QueueModule } from './queue.module';
import { QUEUE, deadLetterQueueName, type Queue } from './queue';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

jest.setTimeout(60_000);

async function waitFor<T>(
  poll: () => T | undefined | Promise<T | undefined>,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await poll();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describeIfDb(
  'Queue over pg-boss — enqueue/consume/retry/dead-letter/cron',
  () => {
    let app: INestApplication;
    let queue: Queue;
    let pgBoss: PgBossService;

    // Unique queue names per run: pg-boss archives completed jobs rather than
    // deleting them, so re-running against the same database must not collide.
    const tag = `q${Date.now()}`;
    const consumers: Array<{ queue: string; id: string }> = [];

    const consume: Queue['consume'] = async (name, handler, options) => {
      const id = await queue.consume(name, handler, {
        pollingIntervalSeconds: 0.5,
        ...options,
      });
      consumers.push({ queue: name, id });
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
      for (const consumer of consumers) {
        await queue
          .stopConsumer(consumer.queue, consumer.id)
          .catch(() => undefined);
      }
      await app?.close();
    });

    it('enqueues and consumes a job through the Queue interface', async () => {
      const name = `${tag}-roundtrip`;
      await queue.ensureQueue(name);

      const received: Array<{ data: unknown; id: string }> = [];
      await consume<{ hello: string }>(name, (data, meta) => {
        received.push({ data, id: meta.id });
        return Promise.resolve();
      });

      const jobId = await queue.enqueue(name, { hello: 'world' });
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
      const name = `${tag}-retry`;
      await queue.ensureQueue(name);

      let attempts = 0;
      let succeededOnAttempt = 0;
      await consume(name, () => {
        attempts += 1;
        if (attempts < 3) {
          return Promise.reject(new Error(`transient failure #${attempts}`));
        }
        succeededOnAttempt = attempts;
        return Promise.resolve();
      });

      // Per-job override: immediate retries so the test doesn't sit out backoff.
      await queue.enqueue(
        name,
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
      const name = `${tag}-dlq`;
      await queue.ensureQueue(name);

      await consume(name, () => Promise.reject(new Error('permanent failure')));

      const dead: unknown[] = [];
      await consume(deadLetterQueueName(name), (data) => {
        dead.push(data);
        return Promise.resolve();
      });

      await queue.enqueue(
        name,
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

    it('persists and removes a cron schedule via pg-boss (no pg_cron)', async () => {
      const name = `${tag}-cron`;
      await queue.ensureQueue(name);

      await queue.schedule(name, '*/5 * * * *', { source: 'cron' });

      const schedules = await pgBoss.boss.getSchedules();
      const ours = schedules.find((s) => s.name === name);
      expect(ours).toBeDefined();
      expect(ours?.cron).toBe('*/5 * * * *');
      expect(ours?.data).toEqual({ source: 'cron' });

      await queue.unschedule(name);
      const after = await pgBoss.boss.getSchedules();
      expect(after.find((s) => s.name === name)).toBeUndefined();
    });

    it('delivers a deferred job only after its startAfter delay', async () => {
      const name = `${tag}-deferred`;
      await queue.ensureQueue(name);

      const received: number[] = [];
      await consume(name, () => {
        received.push(Date.now());
        return Promise.resolve();
      });

      const enqueuedAt = Date.now();
      await queue.enqueue(name, { deferred: true }, { startAfter: 2 });

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
