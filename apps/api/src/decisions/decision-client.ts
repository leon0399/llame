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

import type { SystemOneProviderConfig } from '../instance-config/llame-config';
import { type RequestHeaders } from '../models/request-headers';
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
  encodeDecisionRequest,
  toUsage,
} from './decision-protocol';

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
  readonly maxAttempts?: number;
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
    maxAttempts: dependencies.maxAttempts ?? DECISION_MAX_ATTEMPTS,
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
  readonly maxAttempts: number;
};

type Accepted = {
  readonly model: string;
  readonly answers: Record<string, DecisionAnswer>;
  readonly usage: DecisionUsage;
};

type Failed = {
  readonly kind: 'failed';
  readonly reason: DecisionFailureReason;
};

type AttemptResult =
  | { readonly kind: 'answered'; readonly accepted: Accepted }
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
  const result = await runAttempts(wire, request);
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
 * Up to `maxAttempts` attempts. The caller's signal is checked before every
 * request and after every wait, so nothing starts after an abort and an abort
 * surfaces as a rejection instead of ordinary unavailability.
 */
async function runAttempts(
  wire: DecisionWire,
  request: DecisionRequest,
): Promise<
  { readonly kind: 'answered'; readonly accepted: Accepted } | Failed
> {
  let lastReason: DecisionFailureReason = 'upstream_error';
  for (let number = 1; number <= wire.maxAttempts; number += 1) {
    request.signal?.throwIfAborted();
    const result = await attempt(wire, request, number);
    request.signal?.throwIfAborted();
    if (result.kind !== 'retry') return result;
    lastReason = result.reason;
    if (number === wire.maxAttempts) break;
    await wire.sleep(result.delayMs, request.signal);
  }
  request.signal?.throwIfAborted();
  return { kind: 'failed', reason: lastReason };
}

async function attempt(
  wire: DecisionWire,
  request: DecisionRequest,
  number: number,
): Promise<AttemptResult> {
  const timeout = AbortSignal.timeout(wire.attemptTimeoutMs);
  const signal =
    request.signal === undefined
      ? timeout
      : AbortSignal.any([request.signal, timeout]);

  let response: Response;
  try {
    response = await send(wire, request, signal);
  } catch {
    return {
      kind: 'retry',
      reason: timeout.aborted ? 'timeout' : 'upstream_error',
      delayMs: backoffMs(number),
    };
  }

  if (response.ok) {
    const accepted = await readAccepted(wire, response, request);
    return accepted === undefined
      ? { kind: 'failed', reason: 'invalid_response' }
      : { kind: 'answered', accepted };
  }

  const retryAfter = retryAfterMs(response.headers.get('retry-after'));
  await response.body?.cancel().catch(() => undefined);
  const reason = classifyStatus(response.status);
  const transient =
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500;
  if (!transient) return { kind: 'failed', reason };
  return { kind: 'retry', reason, delayMs: retryAfter ?? backoffMs(number) };
}

function send(
  wire: DecisionWire,
  request: DecisionRequest,
  signal: AbortSignal,
): Promise<Response> {
  return wire.fetch(wire.endpoint, {
    method: 'POST',
    headers: wire.headers,
    body: JSON.stringify(
      encodeDecisionRequest(wire.modelId, request.state, request.questions),
    ),
    signal,
  });
}

/**
 * Read one successful body strictly: bounded bytes, a valid envelope, a safe
 * served id, and a valid noul answer for every requested id. Anything else is
 * a codec mismatch, never a default.
 */
async function readAccepted(
  wire: DecisionWire,
  response: Response,
  request: DecisionRequest,
): Promise<Accepted | undefined> {
  const text = await readBoundedText(response);
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
  return { model, answers, usage: toUsage(usage) };
}

/**
 * Stream the body and cancel the reader once it passes the byte bound, so an
 * oversized or unterminated body never lands in memory and needs no
 * `Content-Length`.
 */
async function readBoundedText(
  response: Response,
): Promise<string | undefined> {
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
    return undefined;
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Render the provider's header templates without a Chat session id. */
function requestHeaders(provider: SystemOneProviderConfig): RequestHeaders {
  const headers: RequestHeaders = {
    'content-type': 'application/json',
    accept: 'application/json',
    authorization: `Bearer ${provider.key}`,
  };
  for (const [name, parts] of Object.entries(provider.headers)) {
    const value = parts.join('');
    // An empty render omits the header, exactly as `withRequestHeaders` does.
    if (value.length > 0) headers[name] = value;
  }
  return headers;
}

function classifyStatus(status: number): DecisionFailureReason {
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_error';
  // 400/401/402/403/404/413/422: a bad key, no credit, or a bad request.
  return 'rejected';
}

function backoffMs(number: number): number {
  return Math.min(
    DECISION_BACKOFF_BASE_MS * 2 ** (number - 1),
    DECISION_WAIT_CAP_MS,
  );
}

/** `retry-after` as seconds or an HTTP date, capped at five seconds. */
function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, DECISION_WAIT_CAP_MS);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(date - Date.now(), 0), DECISION_WAIT_CAP_MS);
}

function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
      resolve();
    },
    { once: true },
  );
  return promise;
}
