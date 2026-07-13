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
  /**
   * Dedup / coalescing key. Combined with a de-duplicating queue POLICY (see
   * `QueueOptions.policy`), at most one job per key is allowed in each governed
   * state. On a `standard`-policy queue it is a no-op for dedup — pg-boss v12
   * ties dedup to the queue policy, not the send call. The chat-search reindex
   * queue uses policy `'stately'` + `singletonKey = chatId` so a burst of writes
   * to one chat collapses into one pending rebuild (#195).
   */
  singletonKey?: string;
}

/**
 * How a queue admits jobs (engine-agnostic; pg-boss v12 vocabulary, but the
 * concept — throttle/dedup by state — is common to BullMQ/SQS too):
 * - `standard`  — no dedup (default).
 * - `short`     — at most one QUEUED job (unlimited active); with singletonKey, per key.
 * - `singleton` — at most one ACTIVE job (unlimited queued); with singletonKey, per key.
 * - `stately`   — at most one job PER STATE (one queued + one active); with singletonKey, per key.
 * - `exclusive` — at most one job queued OR active; with singletonKey, per key.
 */
export type QueuePolicy =
  | 'standard'
  | 'short'
  | 'singleton'
  | 'stately'
  | 'exclusive';

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
  /**
   * Admission policy (default `standard`). Set to `stately` (etc.) together with
   * a per-job `singletonKey` to coalesce redundant work — e.g. the reindex queue
   * keeps one pending + one running rebuild per chat (#195).
   */
  policy?: QueuePolicy;
  /**
   * Native worker liveness (design D7): while a job is in flight, the
   * consuming worker automatically signals it at this interval; if the signal
   * lapses, the queue's monitor fails and retries the job — no application
   * heartbeat code. Must be >= 10 (seconds) when set. Omitted (the default)
   * means NULL/disabled — no liveness monitoring, today's behavior.
   */
  heartbeatSeconds?: number;
}

export interface ConsumeOptions {
  /** Base poll interval in seconds (engine default when unset). */
  pollingIntervalSeconds?: number;
  /**
   * Number of jobs this consumer processes in parallel, each settling
   * independently (one job throwing fails only that job — the others keep
   * running). Default 1 preserves today's one-at-a-time behavior.
   */
  concurrency?: number;
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
   * code. Resolves to a consumer id. Consumers are drained on shutdown by the
   * substrate's native graceful stop (see PgBossQueueService) — there is no
   * per-consumer stop method, so nothing needs to hold the returned id.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see enqueue
  consume<Q extends QueueDefinition<any>>(
    queue: Q,
    handler: JobHandler<PayloadOf<Q>>,
    options?: ConsumeOptions,
  ): Promise<string>;

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

/**
 * Payload-guard helpers shared by queue definitions' `parse` functions: TypeScript
 * can't vouch for bytes that crossed a process boundary (a redelivered job may have
 * been written by an older deploy), so these validate at the consume boundary and
 * fail malformed payloads there (→ retry → dead letter) instead of deep in a handler.
 */
export function expectRecord(
  data: unknown,
  queue: string,
): Record<string, unknown> {
  if (typeof data !== 'object' || data === null) {
    throw new TypeError(`Malformed '${queue}' job: payload is not an object`);
  }
  return data as Record<string, unknown>;
}

export function expectString(
  value: Record<string, unknown>,
  field: string,
  queue: string,
): string {
  const raw = value[field];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new TypeError(
      `Malformed '${queue}' job: expected non-empty string '${field}'`,
    );
  }
  return raw;
}
