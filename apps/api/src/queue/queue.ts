/**
 * Queue abstraction (#47) — the seam between llame and its job-queue engine.
 *
 * Callers depend on this interface (via the QUEUE token), never on pg-boss
 * directly — a dependency firewall and test seam first, an engine swap second:
 * queue-shaped engines (BullMQ/SQS) fit behind it; a workflow engine like
 * Temporal would be a rearchitecture, not a swap (docs/scaling.md). pg-boss is the only wired
 * implementation (SPEC §24.0.1): Postgres-first, no Redis, no separate
 * scheduler service.
 */

/** DI token for the Queue implementation (NestJS has no interface tokens). */
export const QUEUE = Symbol('QUEUE');

export interface EnqueueOptions {
  /** Higher numbers are picked up first within a queue. */
  priority?: number;
  /** Delay the job: seconds from now, or an absolute Date. */
  startAfter?: number | Date;
  /** Retries before the job fails terminally (queue default applies if unset). */
  retryLimit?: number;
  /** Seconds between retries (queue default applies if unset). */
  retryDelay?: number;
  /** Exponential backoff on retryDelay (queue default applies if unset). */
  retryBackoff?: boolean;
  // NOTE deliberately no dedup/singleton option yet: pg-boss v12 ties dedup to
  // the queue *policy*, not the send call — expose it with verified semantics
  // when the run pipeline (#48) actually needs idempotent enqueueing.
}

export interface QueueOptions {
  /** Retries before a job fails terminally. */
  retryLimit?: number;
  /** Seconds between retries. */
  retryDelay?: number;
  /** Exponential backoff on retryDelay. */
  retryBackoff?: boolean;
  /**
   * Route terminally-failed jobs to `<queue>.dead` instead of dropping them.
   * Defaults to true — losing failed work silently is never the right default.
   */
  deadLetter?: boolean;
}

export interface ConsumeOptions {
  /** Base poll interval in seconds (engine default when unset). */
  pollingIntervalSeconds?: number;
}

export interface JobMeta {
  id: string;
  queue: string;
}

export type JobHandler<T> = (data: T, meta: JobMeta) => Promise<void>;

export interface Queue {
  /**
   * Declare a queue and its failure policy. Idempotent — safe to call on every
   * boot; also provisions the `<queue>.dead` dead-letter queue unless disabled.
   */
  ensureQueue(queue: string, options?: QueueOptions): Promise<void>;

  /** Enqueue a job. Returns the created job id. */
  enqueue<T extends object>(
    queue: string,
    data: T,
    options?: EnqueueOptions,
  ): Promise<string | null>;

  /**
   * Start consuming a queue. The handler settles one job at a time: resolving
   * completes it, throwing fails it (retried per the queue policy, then
   * dead-lettered). Resolves to a consumer id usable with stopConsumer().
   */
  consume<T extends object>(
    queue: string,
    handler: JobHandler<T>,
    options?: ConsumeOptions,
  ): Promise<string>;

  /** Stop a consumer previously started with consume() on that queue. */
  stopConsumer(queue: string, consumerId: string): Promise<void>;

  /**
   * Upsert a cron schedule that enqueues a job on the queue at each match.
   * pg-boss cron — application-level scheduling with no pg_cron extension
   * (pg_cron runs SQL, not app code — SPEC §24.0.1).
   */
  schedule<T extends object>(
    queue: string,
    cron: string,
    data?: T,
  ): Promise<void>;

  /** Remove the cron schedule for a queue. */
  unschedule(queue: string): Promise<void>;

  /** Cancel a queued (not yet completed) job. */
  cancel(queue: string, jobId: string): Promise<void>;
}

/** Conventional dead-letter queue name for a queue. */
export function deadLetterQueueName(queue: string): string {
  return `${queue}.dead`;
}
