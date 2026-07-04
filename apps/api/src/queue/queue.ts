/**
 * Queue abstraction (#47) — the seam between llame and its job-queue engine.
 *
 * Callers depend on this interface (via the QUEUE token), never on pg-boss
 * directly — a dependency firewall and test seam first, an engine swap second:
 * queue-shaped engines (BullMQ/SQS) fit behind it; a workflow engine like
 * Temporal would be a rearchitecture, not a swap (docs/scaling.md). pg-boss is the only wired
 * implementation (SPEC §24.0.1): Postgres-first, no Redis, no separate
 * scheduler service.
 *
 * The interface is STRONGLY TYPED via QueueDefinition<T>: a queue's name, its
 * payload type, its failure policy, and (optionally) a runtime payload guard
 * are one branded value, declared once by the owning domain (e.g.
 * src/runs/run-queues.ts). Every method infers the payload type from the
 * definition — enqueueing the wrong job shape onto a queue, or consuming it
 * with a mismatched handler, is a compile error, not a runtime surprise.
 */

/** DI token for the Queue implementation (NestJS has no interface tokens). */
export const QUEUE = Symbol('QUEUE');

/**
 * Phantom key carrying the payload type. Declared (never created) — it exists
 * only so QueueDefinition<A> and QueueDefinition<B> are NOT mutually
 * assignable when A ≠ B (structural typing would otherwise erase the
 * distinction and with it the whole point of typed queues).
 */
declare const payloadType: unique symbol;

/**
 * The identity of a queue: name + payload type + policy in one value.
 * Create with defineQueue(); never build these by hand.
 */
export interface QueueDefinition<T extends object> {
  readonly name: string;
  /**
   * Failure policy, applied by ensureQueue(). Lives ON the definition so a
   * queue's identity and its policy are declared in one place; engine
   * defaults (DEFAULT_QUEUE_OPTIONS) fill anything unset.
   */
  readonly options?: QueueOptions;
  /**
   * Optional runtime guard applied to each consumed payload BEFORE the
   * handler runs. TypeScript cannot vouch for bytes that crossed a process
   * boundary (a redelivered job may have been written by an older deploy);
   * a parse that throws fails the job → queue retry policy → dead letter.
   */
  readonly parse?: (data: unknown) => T;
  /** Phantom — type-system only, makes definitions invariant in T. */
  readonly [payloadType]?: (payload: T) => T;
}

/** The payload type carried by a queue definition. */
export type PayloadOf<Q> = Q extends QueueDefinition<infer T> ? T : never;

/** Declare a queue: its name, payload type, policy, and optional guard. */
export function defineQueue<T extends object>(definition: {
  name: string;
  options?: QueueOptions;
  parse?: (data: unknown) => T;
}): QueueDefinition<T> {
  return definition;
}

/**
 * The dead-letter counterpart of a queue — same payload type (dead-lettered
 * jobs are just failed jobs), conventional `<name>.dead` naming.
 */
export function deadLetterQueue<T extends object>(
  queue: QueueDefinition<T>,
): QueueDefinition<T> {
  return { name: deadLetterQueueName(queue.name), parse: queue.parse };
}

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
   * Declare a queue and apply its definition's failure policy. Idempotent —
   * safe to call on every boot; also provisions the `<queue>.dead`
   * dead-letter queue unless the definition disables it.
   */
  ensureQueue<T extends object>(queue: QueueDefinition<T>): Promise<void>;

  /**
   * Enqueue a job. Returns the created job id. The payload type is EXTRACTED
   * from the definition (PayloadOf) rather than inferred across both
   * arguments, so the definition is the single source of truth — passing the
   * wrong job shape for the queue is a compile error, never a silent
   * widening.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `any` here is
  // the standard variance escape for a generic BOUND: definitions are
  // deliberately invariant in their payload, so no concrete QueueDefinition<T>
  // is assignable to QueueDefinition<object>. PayloadOf<Q> still extracts the
  // exact payload type; nothing is weakened at call sites.
  enqueue<Q extends QueueDefinition<any>>(
    queue: Q,
    data: PayloadOf<Q>,
    options?: EnqueueOptions,
  ): Promise<string | null>;

  /**
   * Start consuming a queue. The handler settles one job at a time: resolving
   * completes it, throwing fails it (retried per the queue policy, then
   * dead-lettered). If the definition carries a parse guard, it runs before
   * the handler — a malformed payload fails the job without invoking domain
   * code. Resolves to a consumer id usable with stopConsumer().
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see enqueue
  consume<Q extends QueueDefinition<any>>(
    queue: Q,
    handler: JobHandler<PayloadOf<Q>>,
    options?: ConsumeOptions,
  ): Promise<string>;

  /** Stop a consumer previously started with consume() on that queue. */
  stopConsumer<T extends object>(
    queue: QueueDefinition<T>,
    consumerId: string,
  ): Promise<void>;

  /**
   * Upsert a cron schedule that enqueues a job on the queue at each match.
   * pg-boss cron — application-level scheduling with no pg_cron extension
   * (pg_cron runs SQL, not app code — SPEC §24.0.1).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see enqueue
  schedule<Q extends QueueDefinition<any>>(
    queue: Q,
    cron: string,
    data?: PayloadOf<Q>,
  ): Promise<void>;

  /** Remove the cron schedule for a queue. */
  unschedule<T extends object>(queue: QueueDefinition<T>): Promise<void>;

  /** Cancel a queued (not yet completed) job. */
  cancel<T extends object>(
    queue: QueueDefinition<T>,
    jobId: string,
  ): Promise<void>;
}

/** Conventional dead-letter queue name (engine-level naming detail). */
export function deadLetterQueueName(queue: string): string {
  return `${queue}.dead`;
}
