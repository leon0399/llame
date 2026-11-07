/**
 * The conventional-reranker client for the rank seat: one Cohere v2 `/rerank`
 * request per call through the AI SDK's `rerank()`, with the decision
 * client's attempt loop, backoff, and `retry-after` cap, and the same failure
 * vocabulary, so the seat treats both backends alike.
 *
 * Failure posture matches `createDecisionClient`: `rerank` never throws for a
 * provider problem. Only an abort of the caller's signal rejects. The SDK
 * runs one attempt per try (`maxRetries: 0`) because its own loop honours
 * `retry-after` for 60 s, retries 409, and never retries a timeout.
 */

import { APICallError, rerank, type RerankResult } from 'ai';
import { createCohere } from '@ai-sdk/cohere';
import type { RerankingModelV3 } from '@ai-sdk/provider';
import { isRecord } from '@workspace/runtime-safety';
import { z } from 'zod';

import type { CohereRerankProviderConfig } from '../instance-config/rerank-config';
import {
  READ_ERROR,
  attemptSignal,
  backoffMs,
  classifyStatus,
  operatorHeaderEntries,
  readBoundedText,
  retryAfterMs,
  runAttempts,
  sleepFor,
  transportFailure,
  type AttemptResult,
  type DecisionClientDependencies,
} from './decision-client';
import {
  DECISION_ATTEMPT_TIMEOUT_MS,
  type DecisionFailureReason,
  type DecisionUsage,
} from './decision-protocol';

export type RerankRequest = {
  readonly query: string;
  readonly documents: Array<string>;
  /** The enclosing call's cancellation and deadline. */
  readonly signal?: AbortSignal;
};

export type RerankOutcome =
  | {
      readonly status: 'answered';
      /** The served model id when the response names one, else the catalog model. */
      readonly model: string;
      /** Document index to relevance score, one entry per document. */
      readonly scores: ReadonlyMap<number, number>;
      readonly usage: DecisionUsage;
      readonly latencyMs: number;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: DecisionFailureReason;
      readonly latencyMs: number;
    };

export type RerankClient = {
  rerank(request: RerankRequest): Promise<RerankOutcome>;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** The decision client's test seams, with the wider `fetch` the SDK calls. */
export type RerankClientDependencies = Omit<
  DecisionClientDependencies,
  'fetch'
> & {
  readonly fetch?: FetchLike;
};

type Accepted = {
  readonly model: string;
  readonly scores: ReadonlyMap<number, number>;
  readonly usage: DecisionUsage;
};

/** Everything one client needs, resolved once from config and dependencies. */
type RerankWire = {
  readonly model: RerankingModelV3;
  readonly modelId: string;
  /** The resolved credential; a served model id must not contain it. */
  readonly key: string | null;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly now: () => number;
  readonly attemptTimeoutMs: number;
};

/** A 2xx body the client refuses to parse: over the byte bound or absent. */
class UnreadableResponseError extends Error {}

/**
 * Create the rerank client for one configured `cohere-rerank` provider and one
 * model. The base URL is the operator's (or Cohere's); the `/rerank` path is
 * the SDK's.
 */
export function createRerankClient(
  provider: CohereRerankProviderConfig,
  modelId: string,
  dependencies: RerankClientDependencies = {},
): RerankClient {
  const wire: RerankWire = {
    model: createCohere({
      // Always explicit, so the SDK never reads COHERE_API_KEY.
      apiKey: provider.key ?? '',
      baseURL: provider.baseUrl,
      headers: requestHeaders(provider),
      fetch: boundedFetch(
        dependencies.fetch ?? ((input, init) => fetch(input, init)),
      ),
    }).reranking(modelId),
    modelId,
    key: provider.key,
    sleep: dependencies.sleep ?? sleepFor,
    now: dependencies.now ?? Date.now,
    attemptTimeoutMs:
      dependencies.attemptTimeoutMs ?? DECISION_ATTEMPT_TIMEOUT_MS,
  };
  return { rerank: (request) => rerankWith(wire, request) };
}

async function rerankWith(
  wire: RerankWire,
  request: RerankRequest,
): Promise<RerankOutcome> {
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

async function attempt(
  wire: RerankWire,
  request: RerankRequest,
  number: number,
): Promise<AttemptResult<Accepted>> {
  const { timeout, signal } = attemptSignal(
    wire.attemptTimeoutMs,
    request.signal,
  );
  try {
    const result = await rerank({
      model: wire.model,
      query: request.query,
      documents: request.documents,
      maxRetries: 0,
      abortSignal: signal,
      // Sentry's AI integration would otherwise record every card text
      // (`ai.documents`) on a span; `isEnabled: false` is honoured by both.
      experimental_telemetry: { isEnabled: false },
    });
    const accepted = accept(wire, request.documents.length, result);
    return accepted === undefined
      ? { kind: 'failed', reason: 'invalid_response' }
      : { kind: 'answered', accepted };
  } catch (error) {
    return attemptFailure(error, { wire, timeout, number });
  }
}

/**
 * Check what the SDK does not: every document scored once, by an integer
 * index in range, with a finite score; a served id that does not carry the
 * key; and the usage the wire reports.
 */
function accept(
  wire: RerankWire,
  count: number,
  result: RerankResult<string>,
): Accepted | undefined {
  const scores = new Map<number, number>();
  for (const { originalIndex, score } of result.ranking) {
    const valid =
      Number.isInteger(originalIndex) &&
      originalIndex >= 0 &&
      originalIndex < count &&
      !scores.has(originalIndex) &&
      Number.isFinite(score);
    if (!valid) return undefined;
    scores.set(originalIndex, score);
  }
  if (scores.size !== count) return undefined;

  const body = WireBodySchema.safeParse(result.response.body);
  const served = body.success ? body.data.model : undefined;
  if (served !== undefined && wire.key !== null && served.includes(wire.key)) {
    return undefined;
  }
  return {
    model:
      served !== undefined && PRINTABLE_ID.test(served) ? served : wire.modelId,
    scores,
    usage: usageOf(body.success ? body.data.usage : undefined),
  };
}

/** A served id that is printable ASCII and short enough to log and display. */
const PRINTABLE_ID = /^[\x21-\x7E]{1,256}$/u;

/** A field that is valid under `schema` or unknown, never an error. */
function lenient<T extends z.ZodType>(schema: T) {
  return z
    .unknown()
    .transform((value): z.output<T> | undefined => {
      const parsed = schema.safeParse(value);
      return parsed.success ? parsed.data : undefined;
    })
    .optional();
}

const COUNT = lenient(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER));

/**
 * The fields read from the raw body. OpenRouter reports
 * `usage.{prompt_tokens,total_tokens,cost}`; Cohere only billed search units.
 * A missing or malformed field is unknown, never zero, and never an error.
 */
const WireBodySchema = z.looseObject({
  model: lenient(z.string().min(1)),
  usage: lenient(
    z.looseObject({
      total_tokens: COUNT,
      prompt_tokens: COUNT,
      cost: lenient(z.number().nonnegative()),
    }),
  ),
});

function usageOf(
  usage: z.infer<typeof WireBodySchema>['usage'],
): DecisionUsage {
  return {
    inputTokens: usage?.total_tokens ?? usage?.prompt_tokens ?? null,
    outputTokens: 0,
    costUsd: usage?.cost ?? null,
  };
}

type FailedAttempt = {
  readonly wire: RerankWire;
  readonly timeout: AbortSignal;
  readonly number: number;
};

/**
 * Classify one failed attempt. The SDK reports a 2xx body it cannot parse as
 * an `APICallError` that keeps the 2xx status, so that is a codec mismatch,
 * not a rejection. Anything unrecognised is a transport failure.
 */
function attemptFailure(
  error: unknown,
  failed: FailedAttempt,
): AttemptResult<never> {
  const { timeout, number } = failed;
  if (timeout.aborted) return transportFailure(timeout, number);
  if (APICallError.isInstance(error)) return statusFailure(error, failed);
  if (error instanceof UnreadableResponseError) {
    return { kind: 'failed', reason: 'invalid_response' };
  }
  return transportFailure(timeout, number);
}

function statusFailure(
  error: APICallError,
  { wire, number }: FailedAttempt,
): AttemptResult<never> {
  const { statusCode } = error;
  if (statusCode === undefined) {
    return {
      kind: 'retry',
      reason: 'upstream_error',
      delayMs: backoffMs(number),
    };
  }
  if (statusCode >= 200 && statusCode < 300) {
    return { kind: 'failed', reason: 'invalid_response' };
  }
  const reason = classifyStatus(statusCode);
  if (reason === 'rejected') return { kind: 'failed', reason };
  return {
    kind: 'retry',
    reason,
    delayMs:
      retryAfterMs(error.responseHeaders?.['retry-after'] ?? null, wire.now) ??
      backoffMs(number),
  };
}

/**
 * Bound and repair what the SDK reads. A redirect would carry the credential
 * to another host, so it is not followed. A failed response keeps its status
 * and headers but not its body. A successful body streams under the decision
 * lane's byte bound. OpenRouter and Infinity omit Cohere's `meta`, which
 * `@ai-sdk/cohere` requires, so an absent `meta` is filled with `null` on a
 * successful JSON body (vercel/ai#24699).
 */
function boundedFetch(fetchImpl: FetchLike): FetchLike {
  return async (input, init) => {
    const response = await fetchImpl(input, { ...init, redirect: 'manual' });
    const headers = new Headers(response.headers);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return new Response(null, { status: response.status, headers });
    }
    const text = await readBoundedText(response);
    if (text === READ_ERROR) throw new Error('response body read failed');
    if (text === undefined) throw new UnreadableResponseError();
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(withMeta(text), { status: response.status, headers });
  };
}

function withMeta(text: string): string {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return text;
  }
  if (!isRecord(body) || 'meta' in body) return text;
  return JSON.stringify({ ...body, meta: null });
}

/**
 * The operator's header map rendered without a Chat session. A keyless entry
 * masks the SDK's empty `Bearer` default with `undefined`. The SDK spreads
 * the operator map over its defaults and normalises names to lower case, so an
 * operator `Authorization` of any letter case wins.
 */
function requestHeaders(
  provider: CohereRerankProviderConfig,
): Record<string, string> {
  return Object.assign(
    {},
    provider.key === null ? { Authorization: undefined } : {},
    Object.fromEntries(operatorHeaderEntries(provider.headers)),
  );
}
