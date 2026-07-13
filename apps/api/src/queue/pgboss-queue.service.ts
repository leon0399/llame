import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
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

/**
 * Failure policy applied when a definition carries no options.
 *
 * heartbeatSeconds is deliberately EXCLUDED (unlike the other QueueOptions
 * fields): its contract is "omitted = NULL = disabled", so a default
 * `Required<QueueOptions>` value would force every queue onto liveness
 * monitoring whether the definition asked for it or not.
 */
export const DEFAULT_QUEUE_OPTIONS: Required<
  Omit<QueueOptions, 'heartbeatSeconds'>
> = {
  retryLimit: 3,
  retryDelay: 2,
  retryBackoff: true,
  deadLetter: true,
  policy: 'standard',
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
export class PgBossQueueService implements Queue, OnModuleDestroy {
  private readonly logger = new Logger(PgBossQueueService.name);

  // Registered consumers (design D5/#6.1), keyed by the consumer id returned
  // from consume() — drained on shutdown so a deploy/rollout doesn't abandon
  // an in-flight job. Values keep the definition so onModuleDestroy can call
  // stopConsumer() the same way any caller would.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous
  // definitions across queues; each entry is only ever read back with the
  // definition it was stored with.
  private readonly consumers = new Map<string, QueueDefinition<any>>();

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
    // Mutable, per-boot-idempotent fields (updateQueue COALESCEs each).
    const updatable = {
      retryLimit: opts.retryLimit,
      retryDelay: opts.retryDelay,
      retryBackoff: opts.retryBackoff,
      // Native liveness (design D7): omitted unless the definition sets it —
      // DEFAULT_QUEUE_OPTIONS deliberately carries no value here, so an
      // unset field stays NULL/disabled instead of opting every queue in.
      ...(opts.heartbeatSeconds !== undefined
        ? { heartbeatSeconds: opts.heartbeatSeconds }
        : {}),
      // With deadLetter disabled the field is omitted, which leaves any
      // previously-configured dead-letter target in place — detaching a live
      // queue's DLQ is an explicit migration, not a boot-time default.
      ...(opts.deadLetter
        ? { deadLetter: deadLetterQueueName(queue.name) }
        : {}),
    };
    // The admission policy (dedup/throttle by state, default `standard`) is
    // IMMUTABLE in pg-boss v12 — updateQueue rejects a `policy` field ("queue
    // policy cannot be changed after creation"). So it is set ONLY at createQueue;
    // updateQueue re-applies the mutable retry/dead-letter fields (#195).
    await this.boss.createQueue(queue.name, {
      ...updatable,
      policy: opts.policy,
    });
    await this.boss.updateQueue(queue.name, updatable);
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
      // Coalescing key — meaningful only under a de-duplicating queue policy
      // (QueueOptions.policy); a no-op for dedup on a standard queue.
      ...(options?.singletonKey !== undefined
        ? { singletonKey: options.singletonKey }
        : {}),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see enqueue
  async consume<Q extends QueueDefinition<any>>(
    queue: Q,
    handler: JobHandler<PayloadOf<Q>>,
    options?: ConsumeOptions,
  ): Promise<string> {
    // batchSize 1: the Queue contract settles one job at a time PER WORKER.
    // Throwing from the handler fails only that job → pg-boss retries per the
    // queue policy, then routes to the dead-letter queue. Batch consumption is
    // a later, explicit interface extension if a workload ever needs it.
    //
    // localConcurrency (design D1): pg-boss spawns N independent per-process
    // workers under this ONE work() registration, each polling and settling
    // its own job — per-job settlement by construction, no manual ack. concurrency
    // omitted/1 is today's serial behavior.
    const consumerId = await this.boss.work<PayloadOf<Q>>(
      queue.name,
      {
        batchSize: 1,
        localConcurrency: options?.concurrency ?? 1,
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
    this.consumers.set(consumerId, queue);
    return consumerId;
  }

  async stopConsumer<T extends object>(
    queue: QueueDefinition<T>,
    consumerId: string,
  ): Promise<void> {
    // Drain by QUEUE NAME, not by consumerId (verified against pg-boss@12.25's
    // manager.js): work() with localConcurrency > 1 spawns N Worker instances
    // that each get their OWN `.id`; the id `work()` returns (our consumerId)
    // is only worker 0's. offWork(name, {id}) matches on that per-worker
    // `.id`, not the shared `.workId` the N workers actually carry — so
    // passing {id: consumerId} stops only worker 0 and silently leaves N-1
    // running. Matching by queue name instead stops every worker registered
    // under it, which is correct as long as a queue has at most one consume()
    // registration per process (true for every queue in this codebase — see
    // `consumers` above, keyed 1:1 per registration).
    await this.boss.offWork(queue.name, { wait: true });
    this.consumers.delete(consumerId);
  }

  /**
   * Graceful drain on shutdown (design D5/#6.1): stop every consumer this
   * service registered so an in-flight job finishes before the process exits,
   * instead of sitting abandoned until a liveness/expiry sweep reclaims it.
   * Requires `app.enableShutdownHooks()` in the entrypoint (main.ts already
   * calls it). Idempotent: draining twice is safe — the second pass iterates
   * an already-empty map.
   */
  async onModuleDestroy(): Promise<void> {
    const entries = [...this.consumers.entries()];
    if (entries.length === 0) return;
    this.logger.log(`Draining ${entries.length} consumer(s) before shutdown`);
    await Promise.all(
      entries.map(([consumerId, queue]) =>
        this.stopConsumer(queue, consumerId),
      ),
    );
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
