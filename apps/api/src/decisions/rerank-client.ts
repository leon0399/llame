/**
 * The conventional-reranker client for the rank seat (experimental): one
 * Cohere Rerank v2 request per call through the AI SDK's `rerank()`, bounded
 * retries, and the same failure vocabulary as the System One client so
 * the seat treats both alike.
 */

import {
  APICallError,
  InvalidResponseDataError,
  JSONParseError,
  RetryError,
  TypeValidationError,
  rerank,
} from 'ai';
import { createCohere } from '@ai-sdk/cohere';
import { z } from 'zod';

import type { CohereProviderConfig } from '../instance-config/llame-config';
import {
  DECISION_ATTEMPT_TIMEOUT_MS,
  DECISION_MAX_ATTEMPTS,
  type DecisionFailureReason,
  type DecisionUsage,
} from './decision-protocol';

export type RerankRequest = {
  readonly query: string;
  readonly documents: ReadonlyArray<string>;
  /** The enclosing call's cancellation and deadline. */
  readonly signal?: AbortSignal;
};

export type RerankOutcome =
  | {
      readonly status: 'answered';
      /** The served model id when the response names one, else the configured slug. */
      readonly model: string;
      /** Document index → relevance score. Unlisted documents are unscored. */
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

export type RerankClientDependencies = {
  readonly fetch?: FetchLike;
  readonly now?: () => number;
};

/**
 * Usage is read defensively from the raw body: OpenRouter reports
 * `usage.{prompt_tokens,total_tokens,cost}`, Cohere only billed search units.
 * Anything absent or malformed is unknown, never an error.
 */
const nonNegative = z.number().nonnegative().optional().catch(undefined);
const RerankBodySchema = z.object({
  model: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[\x21-\x7E]+$/u)
    .optional()
    .catch(undefined),
  usage: z
    .object({
      prompt_tokens: nonNegative,
      input_tokens: nonNegative,
      total_tokens: nonNegative,
      cost: nonNegative,
    })
    .optional()
    .catch(undefined),
});

function readBody(body: unknown): {
  model: string | undefined;
  usage: DecisionUsage;
} {
  const parsed = RerankBodySchema.safeParse(body);
  const model = parsed.success ? parsed.data.model : undefined;
  const usage = parsed.success ? parsed.data.usage : undefined;
  return {
    model,
    usage: {
      inputTokens: Math.round(
        usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.total_tokens ?? 0,
      ),
      outputTokens: 0,
      costUsd: usage?.cost ?? null,
    },
  };
}

/**
 * Each HTTP attempt gets its own timeout, as the System One client does.
 * OpenRouter's `/rerank` answers the Cohere v2 shape without Cohere's `meta`
 * field, which `@ai-sdk/cohere` requires (as `z.any()`, so any value passes);
 * an absent `meta` is filled with `null` before the SDK parses the body.
 */
function withAttemptTimeout(fetchImpl: FetchLike | undefined): FetchLike {
  return async (input, init) => {
    const timeout = AbortSignal.timeout(DECISION_ATTEMPT_TIMEOUT_MS);
    const signal =
      init?.signal === undefined || init.signal === null
        ? timeout
        : AbortSignal.any([init.signal, timeout]);
    const response = await (fetchImpl ?? fetch)(input, { ...init, signal });
    if (!response.ok) return response;
    const text = await response.text();
    return new Response(withMeta(text), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

function withMeta(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== 'object' || body === null || 'meta' in body) {
      return text;
    }
    return JSON.stringify({ ...body, meta: null });
  } catch {
    return text;
  }
}

function operatorHeaders(
  provider: CohereProviderConfig,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(provider.headers)
      .map(([name, parts]) => [name, parts.join('')] as const)
      // An empty render omits the header.
      .filter(([, value]) => value.length > 0),
  );
}

/**
 * Create the rerank client for one configured `cohere` provider and one model
 * slug. The base URL is the operator's (or Cohere's); the `/rerank` path is
 * the SDK's.
 */
export function createRerankClient(
  provider: CohereProviderConfig,
  modelId: string,
  dependencies: RerankClientDependencies = {},
): RerankClient {
  const now = dependencies.now ?? Date.now;
  const model = createCohere({
    apiKey: provider.key,
    baseURL: provider.baseUrl,
    headers: operatorHeaders(provider),
    fetch: withAttemptTimeout(dependencies.fetch),
  }).reranking(modelId);

  return {
    async rerank(request) {
      const startedAt = now();
      try {
        const result = await rerank({
          model,
          query: request.query,
          documents: [...request.documents],
          maxRetries: DECISION_MAX_ATTEMPTS - 1,
          ...(request.signal !== undefined && { abortSignal: request.signal }),
        });
        const body = readBody(result.response.body);
        const scores = new Map<number, number>();
        for (const { originalIndex, score } of result.ranking) {
          if (Number.isFinite(score)) scores.set(originalIndex, score);
        }
        return {
          status: 'answered',
          model: body.model ?? modelId,
          scores,
          usage: body.usage,
          latencyMs: now() - startedAt,
        };
      } catch (error) {
        return {
          status: 'unavailable',
          reason: failureReason(error),
          latencyMs: now() - startedAt,
        };
      }
    },
  };
}

function failureReason(error: unknown): DecisionFailureReason {
  if (RetryError.isInstance(error)) return failureReason(error.lastError);
  if (APICallError.isInstance(error)) return statusReason(error.statusCode);
  if (
    TypeValidationError.isInstance(error) ||
    JSONParseError.isInstance(error) ||
    InvalidResponseDataError.isInstance(error)
  ) {
    return 'invalid_response';
  }
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  return 'upstream_error';
}

function statusReason(status: number | undefined): DecisionFailureReason {
  if (status === undefined) return 'upstream_error';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_error';
  // 400/401/402/403/404/413/422: a bad key, no credit, or a bad request.
  return 'rejected';
}
