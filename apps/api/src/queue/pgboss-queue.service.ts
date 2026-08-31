import { Inject, Injectable } from '@nestjs/common';
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
 *
 * Graceful shutdown drain is NATIVE (design D5): @wavezync/nestjs-pgboss's
 * onModuleDestroy calls `boss.stop({ graceful: true })`, which stops fetching
 * and awaits every in-flight handler to finish (bounded by pg-boss's timeout,
 * default 30s, after which any still-running job is failed → retried, i.e.
 * recovered by the native worker-liveness path). No per-consumer tracking or
 * manual drain is needed here — just `app.enableShutdownHooks()` in the
 * entrypoint (main.ts / worker.ts) so that onModuleDestroy fires on SIGTERM.
 */
@Injectable()
export class PgBossQueueService implements Queue {
  // Explicit @Inject, not type-based injection: the `search:*` operator CLI
  // boots this graph under `tsx` (esbuild), which does NOT implement
  // `emitDecoratorMetadata`. Without the token, `design:paramtypes` is
  // undefined there and Nest injects `undefined` SILENTLY — no resolution
  // error, just `this.pgBoss.boss` throwing on the first enqueue. Every other
  // provider in that graph already injects by token; this was the one class
  // relying on metadata.
  constructor(
    @Inject(PgBossService)
    private readonly pgBoss: PgBossService,
  ) {}

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
    const updatable: NonNullable<Parameters<typeof this.boss.updateQueue>[1]> =
      {
        retryLimit: opts.retryLimit,
        retryDelay: opts.retryDelay,
        retryBackoff: opts.retryBackoff,
      };
    // Native liveness (design D7): omitted unless the definition sets it —
    // DEFAULT_QUEUE_OPTIONS deliberately carries no value here, so an
    // unset field stays NULL/disabled instead of opting every queue in.
    if (opts.heartbeatSeconds !== undefined) {
      updatable.heartbeatSeconds = opts.heartbeatSeconds;
    }
    // With deadLetter disabled the field is omitted, which leaves any
    // previously-configured dead-letter target in place — detaching a live
    // queue's DLQ is an explicit migration, not a boot-time default.
    if (opts.deadLetter) {
      updatable.deadLetter = deadLetterQueueName(queue.name);
    }
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

  async enqueue<T extends object>(
    queue: QueueDefinition<T>,
    data: T,
    options?: EnqueueOptions,
  ): Promise<string | null> {
    const sendOptions: EnqueueOptions = {};
    if (options?.priority !== undefined)
      sendOptions.priority = options.priority;
    if (options?.startAfter !== undefined) {
      sendOptions.startAfter = options.startAfter;
    }
    if (options?.retryLimit !== undefined) {
      sendOptions.retryLimit = options.retryLimit;
    }
    if (options?.retryDelay !== undefined) {
      sendOptions.retryDelay = options.retryDelay;
    }
    if (options?.retryBackoff !== undefined) {
      sendOptions.retryBackoff = options.retryBackoff;
    }
    // Coalescing key — meaningful only under a de-duplicating queue policy
    // (QueueOptions.policy); a no-op for dedup on a standard queue.
    if (options?.singletonKey !== undefined) {
      sendOptions.singletonKey = options.singletonKey;
    }
    return this.boss.send(queue.name, data, sendOptions);
  }

  // Mirrors the interface's variance-escape bound (see queue.ts).
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
    return this.boss.work<PayloadOf<Q>>(
      queue.name,
      {
        batchSize: 1,
        localConcurrency: options?.concurrency ?? 1,
        ...(options?.pollingIntervalSeconds !== undefined && {
          pollingIntervalSeconds: options.pollingIntervalSeconds,
        }),
      },
      async (jobs: Array<PgBossJob<PayloadOf<Q>>>) => {
        const definition: QueueDefinition<PayloadOf<Q>> = queue;
        for (const job of jobs) {
          // The definition's guard runs BEFORE domain code: a payload written
          // by an older deploy (or corrupted in flight) fails the job here —
          // retry policy, then dead letter — instead of surfacing as a
          // confusing TypeError deep inside the handler.
          const data: PayloadOf<Q> = definition.parse
            ? definition.parse(job.data)
            : job.data;
          await handler(data, { id: job.id, queue: queue.name });
        }
      },
    );
  }

  async schedule<T extends object>(
    queue: QueueDefinition<T>,
    cron: string,
    data?: T,
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
