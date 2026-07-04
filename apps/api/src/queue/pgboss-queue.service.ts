import { Injectable } from '@nestjs/common';
import { PgBossService } from '@wavezync/nestjs-pgboss';

// Structural subset of pg-boss's Job — a type-only import of pg-boss (ESM-only
// package) from this CommonJS build needs resolution-mode gymnastics; the two
// fields the adapter reads aren't worth it.
type PgBossJob<T> = { id: string; data: T };

import {
  deadLetterQueueName,
  type ConsumeOptions,
  type EnqueueOptions,
  type JobHandler,
  type PayloadOf,
  type Queue,
  type QueueDefinition,
  type QueueOptions,
} from './queue';

/** Failure policy applied when a definition carries no options. */
export const DEFAULT_QUEUE_OPTIONS: Required<QueueOptions> = {
  retryLimit: 3,
  retryDelay: 2,
  retryBackoff: true,
  deadLetter: true,
};

/**
 * pg-boss implementation of the Queue interface (#47) — SPEC §24.0.1.
 *
 * pg-boss is the `SKIP LOCKED` + `LISTEN/NOTIFY` pattern productized: it lives
 * in its own `pgboss` schema on the SAME Postgres instance as the Drizzle
 * tables (no Redis, no separate scheduler) and connects through its own `pg`
 * pool — two drivers to one database is expected (SPEC §24.0.1).
 *
 * v10+ requires queues to exist before use, so ensureQueue() must run before
 * enqueue/consume — callers own their queue declarations (a worker declares
 * what it consumes; a publisher declares what it publishes to).
 */
@Injectable()
export class PgBossQueueService implements Queue {
  constructor(private readonly pgBoss: PgBossService) {}

  private get boss() {
    return this.pgBoss.boss;
  }

  async ensureQueue<T extends object>(
    queue: QueueDefinition<T>,
  ): Promise<void> {
    const opts = { ...DEFAULT_QUEUE_OPTIONS, ...queue.options };

    // createQueue is INSERT ... ON CONFLICT DO NOTHING in pg-boss v12 — NOT an
    // upsert — so a changed policy would silently never apply to an existing
    // queue. Create-if-missing, then updateQueue (COALESCE per passed field),
    // making ensureQueue a real idempotent policy apply on every boot.
    if (opts.deadLetter) {
      const dead = deadLetterQueueName(queue.name);
      // Dead-lettered jobs must never evaporate: no retries, no further DLQ.
      const deadPolicy = { retryLimit: 0 };
      await this.boss.createQueue(dead, deadPolicy);
      await this.boss.updateQueue(dead, deadPolicy);
    }
    const policy = {
      retryLimit: opts.retryLimit,
      retryDelay: opts.retryDelay,
      retryBackoff: opts.retryBackoff,
      // With deadLetter disabled the field is omitted, which leaves any
      // previously-configured dead-letter target in place — detaching a live
      // queue's DLQ is an explicit migration, not a boot-time default.
      ...(opts.deadLetter
        ? { deadLetter: deadLetterQueueName(queue.name) }
        : {}),
    };
    await this.boss.createQueue(queue.name, policy);
    await this.boss.updateQueue(queue.name, policy);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors the
  // interface's variance-escape bound (see queue.ts).
  async enqueue<Q extends QueueDefinition<any>>(
    queue: Q,
    data: PayloadOf<Q>,
    options?: EnqueueOptions,
  ): Promise<string | null> {
    return this.boss.send(queue.name, data, {
      ...(options?.priority !== undefined
        ? { priority: options.priority }
        : {}),
      ...(options?.startAfter !== undefined
        ? { startAfter: options.startAfter }
        : {}),
      ...(options?.retryLimit !== undefined
        ? { retryLimit: options.retryLimit }
        : {}),
      ...(options?.retryDelay !== undefined
        ? { retryDelay: options.retryDelay }
        : {}),
      ...(options?.retryBackoff !== undefined
        ? { retryBackoff: options.retryBackoff }
        : {}),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see enqueue
  async consume<Q extends QueueDefinition<any>>(
    queue: Q,
    handler: JobHandler<PayloadOf<Q>>,
    options?: ConsumeOptions,
  ): Promise<string> {
    // batchSize 1: the Queue contract settles one job at a time. Throwing from
    // the handler fails the job → pg-boss retries per the queue policy, then
    // routes to the dead-letter queue. Batch consumption is a later, explicit
    // interface extension if a workload ever needs it.
    return this.boss.work<PayloadOf<Q>>(
      queue.name,
      {
        batchSize: 1,
        ...(options?.pollingIntervalSeconds !== undefined
          ? { pollingIntervalSeconds: options.pollingIntervalSeconds }
          : {}),
      },
      async (jobs: PgBossJob<PayloadOf<Q>>[]) => {
        for (const job of jobs) {
          // The definition's guard runs BEFORE domain code: a payload written
          // by an older deploy (or corrupted in flight) fails the job here —
          // retry policy, then dead letter — instead of surfacing as a
          // confusing TypeError deep inside the handler.
          const data: PayloadOf<Q> = queue.parse
            ? (queue.parse(job.data) as PayloadOf<Q>)
            : job.data;
          await handler(data, { id: job.id, queue: queue.name });
        }
      },
    );
  }

  async stopConsumer<T extends object>(
    queue: QueueDefinition<T>,
    consumerId: string,
  ): Promise<void> {
    // wait: true drains the in-flight job before resolving — stopping a
    // consumer must not abandon work mid-handler (it would sit invisible
    // until pg-boss's expiry sweep retried it).
    await this.boss.offWork(queue.name, { id: consumerId, wait: true });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see enqueue
  async schedule<Q extends QueueDefinition<any>>(
    queue: Q,
    cron: string,
    data?: PayloadOf<Q>,
  ): Promise<void> {
    await this.boss.schedule(queue.name, cron, data);
  }

  async unschedule<T extends object>(queue: QueueDefinition<T>): Promise<void> {
    await this.boss.unschedule(queue.name);
  }

  async cancel<T extends object>(
    queue: QueueDefinition<T>,
    jobId: string,
  ): Promise<void> {
    await this.boss.cancel(queue.name, jobId);
  }
}
