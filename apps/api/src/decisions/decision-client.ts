/**
 * The System One decision client (experimental decision lane): one fetch, one
 * codec, one request per call, bounded retries.
 *
 * Failure posture: `decide` NEVER throws for a provider problem. A transport
 * failure after retries, or a timeout, makes the call `unavailable`; the
 * service sends each group of cards as its own request, so only that group's
 * cards stay unjudged and the caller keeps its canonical order for them. A
 * malformed envelope, a missing answer, or an answer of the wrong type is a
 * contract violation and also makes the request `unavailable`, because a codec
 * mismatch means no answer can be trusted. A decision model's silence is never
 * evidence: callers must not read `unavailable` as "irrelevant".
 */

import type { SystemOneProviderConfig } from '../instance-config/llame-config';
import { type RequestHeaders } from '../models/request-headers';
import {
  DECISION_ATTEMPT_TIMEOUT_MS,
  DECISION_MAX_ATTEMPTS,
  DECISION_RESPONSE_MAX_CODE_UNITS,
  DecisionResponseSchema,
  type DecisionAnswer,
  type DecisionFailureReason,
  type DecisionOutcome,
  type DecisionQuestions,
  type DecisionRequest,
  encodeDecisionRequest,
  toUsage,
  type DecisionUsage,
} from './decision-protocol';

const DECISION_BACKOFF_BASE_MS = 500;
const DECISION_BACKOFF_CAP_MS = 5000;
/** A provider's `retry-after` is honoured, but never for longer than this. */
const DECISION_RETRY_AFTER_CAP_MS = 5000;

export type DecisionClient = {
  decide(request: DecisionRequest): Promise<DecisionOutcome>;
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type DecisionClientDependencies = {
  /** Test seam; production uses the global fetch. */
  readonly fetch?: FetchLike;
  /** Test seam; production sleeps for real. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Test seam for latency measurement. */
  readonly now?: () => number;
  readonly attemptTimeoutMs?: number;
  readonly maxAttempts?: number;
  /**
   * Fallback input price for a wire that reports no `usage.cost` (the native
   * TypeSafe wire). A reported cost always wins.
   */
  readonly pricingUsdPer1M?: { readonly input: number };
};

/**
 * Create the decision client for one configured `system-one` provider. The
 * base URL is the operator's; the wire path is llame's, exactly as the model
 * clients append their own paths.
 */
export function createDecisionClient(
  provider: SystemOneProviderConfig,
  modelId: string,
  dependencies: DecisionClientDependencies = {},
): DecisionClient {
  const wire = buildWire(provider, modelId, dependencies);
  return { decide: (request) => decide(wire, request) };
}

/** Everything one client needs, resolved once from config and dependencies. */
type DecisionWire = {
  readonly endpoint: string;
  readonly headers: RequestHeaders;
  readonly modelId: string;
  readonly fetch: FetchLike;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly attemptTimeoutMs: number;
  readonly maxAttempts: number;
  readonly pricingUsdPer1M?: { readonly input: number };
};

function buildWire(
  provider: SystemOneProviderConfig,
  modelId: string,
  dependencies: DecisionClientDependencies,
): DecisionWire {
  return {
    endpoint: `${provider.baseUrl.replace(/\/+$/u, '')}/systemone`,
    headers: requestHeaders(provider),
    modelId,
    fetch: dependencies.fetch ?? ((input, init) => fetch(input, init)),
    sleep: dependencies.sleep ?? sleepFor,
    now: dependencies.now ?? Date.now,
    attemptTimeoutMs:
      dependencies.attemptTimeoutMs ?? DECISION_ATTEMPT_TIMEOUT_MS,
    maxAttempts: dependencies.maxAttempts ?? DECISION_MAX_ATTEMPTS,
    ...(dependencies.pricingUsdPer1M !== undefined && {
      pricingUsdPer1M: dependencies.pricingUsdPer1M,
    }),
  };
}

async function decide(
  wire: DecisionWire,
  request: DecisionRequest,
): Promise<DecisionOutcome> {
  const startedAt = wire.now();
  const latencyMs = () => Math.max(0, Math.round(wire.now() - startedAt));
  const keys = Object.keys(request.questions);
  if (keys.length === 0) {
    return {
      status: 'answered',
      model: wire.modelId,
      answers: {},
      unanswered: [],
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      latencyMs: latencyMs(),
    };
  }

  try {
    return outcomeOf(await judgeChunk(wire, request), keys, latencyMs());
  } catch {
    // Defense in depth: a bug must not turn into a failed tool call.
    return {
      status: 'unavailable',
      reason: 'upstream_error',
      latencyMs: latencyMs(),
    };
  }
}

/** Project the one request's outcome onto the requested question keys. */
function outcomeOf(
  outcome: ChunkOutcome,
  keys: ReadonlyArray<string>,
  latencyMs: number,
): DecisionOutcome {
  if (outcome.kind === 'failed') {
    return { status: 'unavailable', reason: outcome.reason, latencyMs };
  }
  return {
    status: 'answered',
    model: outcome.model,
    answers: outcome.answers,
    unanswered: keys.filter((key) => !(key in outcome.answers)),
    usage: outcome.usage,
    latencyMs,
  };
}

async function judgeChunk(
  wire: DecisionWire,
  chunk: DecisionRequest,
): Promise<ChunkOutcome> {
  let lastReason: DecisionFailureReason = 'upstream_error';
  for (
    let attemptNumber = 1;
    attemptNumber <= wire.maxAttempts;
    attemptNumber += 1
  ) {
    const result = await attempt(wire, chunk, attemptNumber);
    if (result.kind === 'answered') {
      return { kind: 'answered', ...result.parsed };
    }
    if (result.kind === 'failed') return result;
    lastReason = result.reason;
    if (attemptNumber === wire.maxAttempts) break;
    await wire.sleep(result.delayMs);
  }
  return { kind: 'failed', reason: lastReason };
}

async function attempt(
  wire: DecisionWire,
  chunk: DecisionRequest,
  attemptNumber: number,
): Promise<AttemptResult> {
  if (chunk.signal?.aborted === true) {
    return { kind: 'failed', reason: 'aborted' };
  }
  const timeout = AbortSignal.timeout(wire.attemptTimeoutMs);
  const attemptSignal =
    chunk.signal === undefined
      ? timeout
      : AbortSignal.any([chunk.signal, timeout]);

  let response: Response;
  try {
    response = await wire.fetch(wire.endpoint, {
      method: 'POST',
      headers: wire.headers,
      body: JSON.stringify(
        encodeDecisionRequest(wire.modelId, chunk.state, chunk.questions),
      ),
      signal: attemptSignal,
    });
  } catch {
    if (chunk.signal?.aborted) {
      return { kind: 'failed', reason: 'aborted' };
    }
    return {
      kind: 'retry',
      reason: attemptSignal.aborted ? 'timeout' : 'upstream_error',
      delayMs: backoffMs(attemptNumber),
    };
  }
  return classifyResponse(wire, response, chunk, attemptNumber);
}

async function classifyResponse(
  wire: DecisionWire,
  response: Response,
  chunk: DecisionRequest,
  attemptNumber: number,
): Promise<AttemptResult> {
  if (response.ok) {
    const parsed = await readAnswers(
      response,
      chunk.questions,
      wire.pricingUsdPer1M,
    );
    return parsed === undefined
      ? { kind: 'failed', reason: 'invalid_response' }
      : { kind: 'answered', parsed };
  }

  const reason = classifyStatus(response.status);
  const retryAfter = retryAfterMs(response.headers.get('retry-after'));
  await response.body?.cancel().catch(() => undefined);
  const transient =
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500;
  if (!transient) return { kind: 'failed', reason };
  return {
    kind: 'retry',
    reason,
    delayMs: retryAfter ?? backoffMs(attemptNumber),
  };
}

/**
 * Read one successful body strictly: the envelope must match, and every
 * requested id must carry an answer of the requested type. Anything else is a
 * codec mismatch, never an absent field.
 */
async function readAnswers(
  response: Response,
  questions: DecisionQuestions,
  pricingUsdPer1M: { readonly input: number } | undefined,
): Promise<ParsedAnswers | undefined> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (text.length > DECISION_RESPONSE_MAX_CODE_UNITS) return undefined;
  let body: unknown;
  try {
    // SAFETY: JSON.parse returns any; the Zod schema below validates it.
    body = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  const parsed = DecisionResponseSchema.safeParse(body);
  if (!parsed.success) return undefined;

  const answers: Record<string, DecisionAnswer> = {};
  for (const [key, question] of Object.entries(questions)) {
    const answer = parsed.data.answers[key];
    if (answer === undefined || answer.type !== question.type) {
      return undefined;
    }
    answers[key] = answer;
  }
  return {
    model: parsed.data.model,
    answers,
    usage: toUsage(parsed.data.usage, pricingUsdPer1M),
  };
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

/** 408, 429 and every 5xx are worth another attempt; nothing else is. */
function classifyStatus(status: number): DecisionFailureReason {
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_error';
  // 400/401/402/403/404/413/422: a bad key, no credit, or a bad request.
  return 'rejected';
}

function backoffMs(attemptNumber: number): number {
  return Math.min(
    DECISION_BACKOFF_BASE_MS * 2 ** (attemptNumber - 1),
    DECISION_BACKOFF_CAP_MS,
  );
}

/** `retry-after` as seconds or an HTTP date, capped at five seconds. */
function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, DECISION_RETRY_AFTER_CAP_MS);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(date - Date.now(), 0), DECISION_RETRY_AFTER_CAP_MS);
}

function sleepFor(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

type ParsedAnswers = {
  readonly model: string;
  readonly answers: Record<string, DecisionAnswer>;
  readonly usage: DecisionUsage;
};

type AnsweredChunk = ParsedAnswers & { readonly kind: 'answered' };

type FailedChunk = {
  readonly kind: 'failed';
  readonly reason: DecisionFailureReason;
};

type ChunkOutcome = AnsweredChunk | FailedChunk;

type AttemptResult =
  | { readonly kind: 'answered'; readonly parsed: ParsedAnswers }
  | {
      readonly kind: 'retry';
      readonly reason: DecisionFailureReason;
      readonly delayMs: number;
    }
  | FailedChunk;
