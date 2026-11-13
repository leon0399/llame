/**
 * The System One decision client: one request per call, bounded retries.
 *
 * Failure posture: `decide` never throws for a provider problem. A transport
 * failure after retries, a timeout, an unsafe response, a malformed envelope,
 * a missing answer, or an out-of-range probability makes the request
 * `unavailable`, and the caller keeps its canonical order for those cards. An
 * abort of the caller's signal is not a provider problem: `decide` rejects
 * with the signal's reason, so the tool runner can report its timeout or
 * cancellation. Unavailability is never evidence that a card is irrelevant.
 *
 * Failure reasons are an enum; no error text, response text, or key can leave
 * this module.
 */

import { setTimeout as delay } from 'node:timers/promises';

import type { SystemOneProviderConfig } from '../instance-config/llame-config';
import {
  type RequestHeaders,
  type RequestHeaderTemplates,
} from '../models/request-headers';
import { type AttemptSlots } from './attempt-slots';
import {
  DECISION_ATTEMPT_TIMEOUT_MS,
  DECISION_MAX_ATTEMPTS,
  DECISION_RESPONSE_MAX_BYTES,
  DecisionAnswerSchema,
  DecisionResponseSchema,
  type DecisionAnswer,
  type DecisionFailureReason,
  type DecisionOutcome,
  type DecisionRequest,
  type DecisionUsage,
} from './decision-protocol';

/** A body that failed mid-read: a transport failure, not a codec mismatch. */
export const READ_ERROR = Symbol('read_error');

const DECISION_BACKOFF_BASE_MS = 500;

/** Backoff and a provider's `retry-after` never wait longer than this. */
const DECISION_WAIT_CAP_MS = 5000;

export type DecisionClient = {
  decide(request: DecisionRequest): Promise<DecisionOutcome>;
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type DecisionClientDependencies = {
  /** Test seam; production uses the global fetch. */
  readonly fetch?: FetchLike;
  /** Test seam; production waits for real. Settles early when `signal` aborts. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Test seam for latency measurement. */
  readonly now?: () => number;
  readonly attemptTimeoutMs?: number;
  /**
   * The provider's shared attempt bound. Each attempt holds one slot from
   * before its request until its body is read; a retry wait holds none.
   */
  readonly slots?: AttemptSlots;
};

/**
 * Create the decision client for one configured `system-one` provider and one
 * model alias. The base URL is the operator's; the wire path is llame's.
 */
export function createDecisionClient(
  provider: SystemOneProviderConfig,
  modelId: string,
  dependencies: DecisionClientDependencies = {},
): DecisionClient {
  const wire: DecisionWire = {
    endpoint: `${provider.baseUrl.replace(/\/+$/u, '')}/systemone`,
    headers: requestHeaders(provider),
    key: provider.key,
    modelId,
    fetch: dependencies.fetch ?? ((input, init) => fetch(input, init)),
    sleep: dependencies.sleep ?? sleepFor,
    now: dependencies.now ?? Date.now,
    attemptTimeoutMs:
      dependencies.attemptTimeoutMs ?? DECISION_ATTEMPT_TIMEOUT_MS,
    slots: dependencies.slots,
  };

  return { decide: (request) => decide(wire, request) };
}

/** Everything one client needs, resolved once from config and dependencies. */
type DecisionWire = {
  readonly endpoint: string;
  readonly headers: RequestHeaders;
  /** The resolved credential; a served model id must not contain it. */
  readonly key: string;
  readonly modelId: string;
  readonly fetch: FetchLike;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly now: () => number;
  readonly attemptTimeoutMs: number;
  readonly slots: AttemptSlots | undefined;
};

type Accepted = {
  readonly model: string;
  readonly answers: Record<string, DecisionAnswer>;
  readonly usage: DecisionUsage;
};

export type Failed = {
  readonly kind: 'failed';
  readonly reason: DecisionFailureReason;
};

/** One attempt's verdict: accepted, worth another try after `delayMs`, or final. */
export type AttemptResult<T> =
  | { readonly kind: 'answered'; readonly accepted: T }
  | {
      readonly kind: 'retry';
      readonly reason: DecisionFailureReason;
      readonly delayMs: number;
    }
  | Failed;

async function decide(
  wire: DecisionWire,
  request: DecisionRequest,
): Promise<DecisionOutcome> {
  const startedAt = wire.now();
  const latencyMs = () => Math.max(0, Math.round(wire.now() - startedAt));

  const result = await runAttempts({
    signal: request.signal,
    sleep: wire.sleep,
    attempt: (number) => attempt(wire, request, number),
  });

  if (result.kind === 'failed') {
    return {
      status: 'unavailable',
      reason: result.reason,
      latencyMs: latencyMs(),
    };
  }

  return { status: 'answered', ...result.accepted, latencyMs: latencyMs() };
}

/**
 * Up to `DECISION_MAX_ATTEMPTS` attempts. The caller's signal is checked before every
 * request and after every wait, so nothing starts after an abort and an abort
 * surfaces as a rejection instead of ordinary unavailability.
 */
export async function runAttempts<T>(options: {
  readonly signal?: AbortSignal;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly attempt: (number: number) => Promise<AttemptResult<T>>;
}): Promise<{ readonly kind: 'answered'; readonly accepted: T } | Failed> {
  const { signal, sleep } = options;
  let lastReason: DecisionFailureReason = 'upstream_error';

  for (let number = 1; number <= DECISION_MAX_ATTEMPTS; number += 1) {
    signal?.throwIfAborted();
    const result = await options.attempt(number);
    signal?.throwIfAborted();

    if (result.kind !== 'retry') return result;
    lastReason = result.reason;

    if (number === DECISION_MAX_ATTEMPTS) break;
    await sleep(result.delayMs, signal);
  }

  return { kind: 'failed', reason: lastReason };
}

/**
 * One attempt under the provider's slot bound. The slot wait follows the
 * caller's signal and rejects with its reason, which `decide` surfaces as an
 * abort; the attempt timeout starts only once the slot is held.
 */
async function attempt(
  wire: DecisionWire,
  request: DecisionRequest,
  number: number,
): Promise<AttemptResult<Accepted>> {
  const release = await wire.slots?.acquire(request.signal);

  try {
    // A grant can land after the caller aborted; start nothing then.
    request.signal?.throwIfAborted();

    return await attemptHoldingSlot(wire, request, number);
  } finally {
    release?.();
  }
}

async function attemptHoldingSlot(
  wire: DecisionWire,
  request: DecisionRequest,
  number: number,
): Promise<AttemptResult<Accepted>> {
  const { timeout, signal } = attemptSignal(
    wire.attemptTimeoutMs,
    request.signal,
  );

  let response: Response;

  try {
    response = await wire.fetch(wire.endpoint, {
      method: 'POST',
      headers: wire.headers,
      // A redirect would carry the credential and body to another host.
      redirect: 'manual',
      body: JSON.stringify({
        model: wire.modelId,
        state: request.state,
        questions: request.questions,
      }),
      signal,
    });
  } catch {
    return transportFailure(timeout, number);
  }

  if (response.ok) {
    const accepted = await readAccepted(wire, response, request);

    if (accepted === READ_ERROR) return transportFailure(timeout, number);

    return accepted === undefined
      ? { kind: 'failed', reason: 'invalid_response' }
      : { kind: 'answered', accepted };
  }

  return statusFailure(wire, response, number);
}

async function statusFailure(
  wire: DecisionWire,
  response: Response,
  number: number,
): Promise<AttemptResult<Accepted>> {
  const retryAfter = retryAfterMs(
    response.headers.get('retry-after'),
    wire.now,
  );

  await response.body?.cancel().catch(() => undefined);
  const reason = classifyStatus(response.status);

  if (reason === 'rejected') return { kind: 'failed', reason };

  return { kind: 'retry', reason, delayMs: retryAfter ?? backoffMs(number) };
}

/**
 * Read one successful body strictly: bounded bytes, a valid envelope, a safe
 * served id, and a valid noul answer for every requested id. Anything else is
 * a codec mismatch, never a default. A body that cannot be read to its end
 * is a transport failure instead.
 */
async function readAccepted(
  wire: DecisionWire,
  response: Response,
  request: DecisionRequest,
): Promise<Accepted | typeof READ_ERROR | undefined> {
  const text = await readBoundedText(response);

  if (text === READ_ERROR) return READ_ERROR;

  if (text === undefined) return undefined;
  let body: unknown;

  try {
    // SAFETY: JSON.parse returns any; the Zod schema below validates it.
    body = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }

  const envelope = DecisionResponseSchema.safeParse(body);

  if (!envelope.success) return undefined;
  const { model, answers: wireAnswers, usage } = envelope.data;

  if (wire.key.length > 0 && model.includes(wire.key)) return undefined;

  const answers: Record<string, DecisionAnswer> = {};

  for (const id of Object.keys(request.questions)) {
    const answer = DecisionAnswerSchema.safeParse(wireAnswers[id]);

    if (!answer.success) return undefined;
    answers[id] = answer.data;
  }

  return { model, answers, usage };
}

/**
 * Stream the body and cancel the reader once it passes the byte bound, so an
 * oversized or unterminated body never lands in memory and needs no
 * `Content-Length`.
 */
export async function readBoundedText(
  response: Response,
): Promise<string | typeof READ_ERROR | undefined> {
  const reader = response.body?.getReader();

  if (reader === undefined) return undefined;
  const chunks: Array<Uint8Array> = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;
      total += value.byteLength;

      if (total > DECISION_RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);

        return undefined;
      }

      chunks.push(value);
    }
  } catch {
    return READ_ERROR;
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Render the provider's header templates without a Chat session id. An
 * operator header replaces a client-set one of the same name, matched with
 * ASCII case folding, as `withRequestHeaders` does.
 */
function requestHeaders(provider: SystemOneProviderConfig): RequestHeaders {
  const operator = operatorHeaderEntries(provider.headers);
  const overridden = new Set(operator.map(([name]) => name.toLowerCase()));

  const base: RequestHeaders = {
    'content-type': 'application/json',
    accept: 'application/json',
    authorization: `Bearer ${provider.key}`,
  };

  return Object.fromEntries([
    ...Object.entries(base).filter(([name]) => !overridden.has(name)),
    ...operator,
  ]);
}

/** The operator's header templates rendered without a Chat; an empty render omits the header. */
export function operatorHeaderEntries(
  headers: RequestHeaderTemplates,
): Array<readonly [string, string]> {
  return Object.entries(headers)
    .map(([name, parts]) => [name, parts.join('')] as const)
    .filter(([, value]) => value.length > 0);
}

/** One attempt's timeout, and the signal that also follows the caller's. */
export function attemptSignal(
  timeoutMs: number,
  caller: AbortSignal | undefined,
) {
  const timeout = AbortSignal.timeout(timeoutMs);

  return {
    timeout,
    signal: caller === undefined ? timeout : AbortSignal.any([caller, timeout]),
  };
}

export function transportFailure(
  timeout: AbortSignal,
  number: number,
): AttemptResult<never> {
  return {
    kind: 'retry',
    reason: timeout.aborted ? 'timeout' : 'upstream_error',
    delayMs: backoffMs(number),
  };
}

export function classifyStatus(status: number): DecisionFailureReason {
  if (status === 408) return 'timeout';

  if (status === 429) return 'rate_limited';

  if (status >= 500) return 'upstream_error';

  // 400/401/402/403/404/413/422: a bad key, no credit, or a bad request.
  return 'rejected';
}

export function backoffMs(number: number): number {
  return Math.min(
    DECISION_BACKOFF_BASE_MS * 2 ** (number - 1),
    DECISION_WAIT_CAP_MS,
  );
}

/** `retry-after` as seconds or an HTTP date, capped at five seconds. */
export function retryAfterMs(
  value: string | null,
  now: () => number,
): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, DECISION_WAIT_CAP_MS);
  }

  const date = Date.parse(value);

  if (Number.isNaN(date)) return undefined;

  return Math.min(Math.max(date - now(), 0), DECISION_WAIT_CAP_MS);
}

/** Waits `ms`; an abort ends the wait early and the caller rechecks its signal. */
export async function sleepFor(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  await delay(ms, undefined, { signal }).catch(() => undefined);
}
