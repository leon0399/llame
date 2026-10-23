import * as Sentry from '@sentry/nestjs';
import { z } from 'zod';

/**
 * The payload key carrying the sender's trace (`sentry-trace` and `baggage`),
 * so a job continues the trace of the request that sent it. Consumers ignore
 * unknown payload fields (asyncapi.queues.yaml), and a definition's guard
 * strips it before domain code.
 */
const TRACE_FIELD = '_trace';

const tracedPayloadSchema = z.object({
  [TRACE_FIELD]: z.object({
    'sentry-trace': z.string().optional(),
    baggage: z.string().optional(),
  }),
});

/** The pg-boss job fields the consume span reports (`includeMetadata`). */
export type TracedJob = {
  readonly id: string;
  readonly data: unknown;
  readonly retryCount: number;
  readonly createdOn: Date;
  readonly startedOn: Date;
};

/*
 * Spans follow Sentry's Queues module (ops `queue.publish` and
 * `queue.process`, the attributes its insights read) and the messaging
 * semantic conventions: names are `{operation} {destination}`, attributes
 * are `messaging.*`.
 */
const MESSAGING_SYSTEM = 'pg-boss';

/**
 * Sends `data` with the active trace attached, inside a `queue.publish` span.
 * Without a Sentry client there is no trace, and the payload is unchanged.
 */
export function publishTraced<T extends object>(
  queue: string,
  data: T,
  send: (payload: T) => Promise<string | null>,
): Promise<string | null> {
  const span = {
    name: `send ${queue}`,
    op: 'queue.publish',
    attributes: {
      'messaging.system': MESSAGING_SYSTEM,
      'messaging.operation.name': 'send',
      'messaging.operation.type': 'send',
      'messaging.destination.name': queue,
    },
  };
  return Sentry.startSpan(span, async (active) => {
    const trace = Sentry.getTraceData();
    const payload =
      Object.keys(trace).length === 0
        ? data
        : { ...data, [TRACE_FIELD]: trace };
    active.setAttribute(
      'messaging.message.body.size',
      Buffer.byteLength(JSON.stringify(payload)),
    );
    const id = await send(payload);
    if (id !== null) active.setAttribute('messaging.message.id', id);
    return id;
  });
}

/** The `queue.process` span's `messaging.*` attributes for one job. */
function processAttributes(queue: string, job: TracedJob) {
  return {
    'messaging.system': MESSAGING_SYSTEM,
    'messaging.operation.name': 'process',
    'messaging.operation.type': 'process',
    'messaging.destination.name': queue,
    'messaging.message.id': job.id,
    'messaging.message.body.size': Buffer.byteLength(JSON.stringify(job.data)),
    'messaging.message.retry.count': job.retryCount,
    // Published to received, as the convention defines it; a delayed retry's
    // backoff counts.
    'messaging.message.receive.latency':
      job.startedOn.getTime() - job.createdOn.getTime(),
  };
}

/**
 * Runs one job in its own isolation scope, so its user, tags, and breadcrumbs
 * never leak into the next job, as a `queue.process` transaction continuing
 * the sender's trace. A failure is reported, then rethrown for pg-boss's retry
 * policy, so each failed attempt is one event.
 */
export function processTraced(
  queue: string,
  job: TracedJob,
  process: () => Promise<void>,
): Promise<void> {
  const parsed = tracedPayloadSchema.safeParse(job.data);
  const trace = parsed.success ? parsed.data[TRACE_FIELD] : undefined;
  const span = {
    name: `process ${queue}`,
    op: 'queue.process',
    forceTransaction: true,
    attributes: processAttributes(queue, job),
  };
  const runReported = () =>
    Sentry.startSpan(span, async () => {
      try {
        await process();
      } catch (error) {
        Sentry.captureException(error);
        throw error;
      }
    });
  return Sentry.withIsolationScope(() =>
    Sentry.continueTrace(
      { sentryTrace: trace?.['sentry-trace'], baggage: trace?.baggage },
      runReported,
    ),
  );
}
