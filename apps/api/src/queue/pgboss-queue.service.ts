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
  type Queue,
  type QueueOptions,
} from './queue';

/** Failure policy applied when ensureQueue() is called without options. */
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

  async ensureQueue(queue: string, options?: QueueOptions): Promise<void> {
    const opts = { ...DEFAULT_QUEUE_OPTIONS, ...options };

    // createQueue is INSERT ... ON CONFLICT DO NOTHING in pg-boss v12 — NOT an
    // upsert — so a changed policy would silently never apply to an existing
    // queue. Create-if-missing, then updateQueue (COALESCE per passed field),
    // making ensureQueue a real idempotent policy apply on every boot.
    if (opts.deadLetter) {
      const dead = deadLetterQueueName(queue);
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
      ...(opts.deadLetter ? { deadLetter: deadLetterQueueName(queue) } : {}),
    };
    await this.boss.createQueue(queue, policy);
    await this.boss.updateQueue(queue, policy);
  }

  async enqueue<T extends object>(
    queue: string,
    data: T,
    options?: EnqueueOptions,
  ): Promise<string | null> {
    return this.boss.send(queue, data, {
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

  async consume<T extends object>(
    queue: string,
    handler: JobHandler<T>,
    options?: ConsumeOptions,
  ): Promise<string> {
    // batchSize 1: the Queue contract settles one job at a time. Throwing from
    // the handler fails the job → pg-boss retries per the queue policy, then
    // routes to the dead-letter queue. Batch consumption is a later, explicit
    // interface extension if a workload ever needs it.
    return this.boss.work<T>(
      queue,
      {
        batchSize: 1,
        ...(options?.pollingIntervalSeconds !== undefined
          ? { pollingIntervalSeconds: options.pollingIntervalSeconds }
          : {}),
      },
      async (jobs: PgBossJob<T>[]) => {
        for (const job of jobs) {
          await handler(job.data, { id: job.id, queue });
        }
      },
    );
  }

  async stopConsumer(queue: string, consumerId: string): Promise<void> {
    // wait: true drains the in-flight job before resolving — stopping a
    // consumer must not abandon work mid-handler (it would sit invisible
    // until pg-boss's expiry sweep retried it).
    await this.boss.offWork(queue, { id: consumerId, wait: true });
  }

  async schedule<T extends object>(
    queue: string,
    cron: string,
    data?: T,
  ): Promise<void> {
    await this.boss.schedule(queue, cron, data);
  }

  async unschedule(queue: string): Promise<void> {
    await this.boss.unschedule(queue);
  }

  async cancel(queue: string, jobId: string): Promise<void> {
    await this.boss.cancel(queue, jobId);
  }
}
