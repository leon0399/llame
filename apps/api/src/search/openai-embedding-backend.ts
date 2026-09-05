import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { APICallError, embedMany } from 'ai';

import { KEYLESS_PLACEHOLDER_API_KEY } from '../models/openai-model-client';
import {
  type EmbeddingBackend,
  type EmbeddingDocumentInput,
  type EmbeddingResult,
} from './core';
import { DEFAULT_EMBEDDING_BATCH_SIZE } from '../instance-config/llame-config';
import { isNumber, isRecord, type UnknownRecord } from '@workspace/runtime-safety';

export type OpenAIEmbeddingBackendConfig = {
  credential?: string;
  baseUrl?: string;
  providerModelId: string;
  dimensions: number;
  batchSize?: number;
  documentPrefix?: string;
  queryPrefix?: string;
};

/**
 * Thrown by the backend for any provider-call failure (design D16).
 * `terminal` classifies it for the caller's retry policy: terminal ONLY on a
 * 4xx status excluding 408 (timeout) and 429 (rate limit) — those two, every
 * 5xx, and any non-HTTP failure (network error, abort, ...) are transient.
 *
 * Deliberately carries no `cause` and no field from the underlying
 * `APICallError` (`.url`, `.responseBody`, `.responseHeaders`,
 * `.requestBodyValues`) — any of those could echo a resolved credential
 * (e.g. an Authorization header) or request content into `.message`, which a
 * caller may persist verbatim as an operator-visible `embedding_fail_reason`
 * (design D16) or write to a log.
 */
export class EmbeddingBackendError extends Error {
  readonly terminal: boolean;

  constructor(message: string, terminal: boolean) {
    super(message);
    this.name = 'EmbeddingBackendError';
    this.terminal = terminal;
  }
}

/** Terminal HTTP-status classification (design D16) — a small predicate over the error's status, not an error taxonomy. Written against `APICallError.statusCode` directly rather than the SDK's own `.isRetryable` (which treats other statuses, e.g. 409, as retryable — the design's terminal rule is 4xx-excluding-408/429, not the SDK's opinion). Passes an already-classified `EmbeddingBackendError` straight through (rather than re-wrapping it into the generic fallback message below) — that's how `assertResponseOrderPreserved`'s verification failure, thrown from inside the custom `fetch`, reaches the caller with its own specific message intact. */
export function classifyEmbeddingFailure(
  error: unknown,
): EmbeddingBackendError {
  if (error instanceof EmbeddingBackendError) {
    return error;
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    const terminal =
      status !== undefined &&
      status >= 400 &&
      status < 500 &&
      status !== 408 &&
      status !== 429;
    return new EmbeddingBackendError(
      `embedding provider request failed${status !== undefined ? ` (HTTP ${status})` : ''}`,
      terminal,
    );
  }
  return new EmbeddingBackendError('embedding provider request failed', false);
}

/**
 * A returned vector that fails this is a producer bug (dimensions
 * misconfiguration, or a provider returning NaN/Infinity) — task 5.5.
 *
 * IS classified as a terminal `EmbeddingBackendError` at the call site below
 * (fixed from an earlier silent-`continue` version, found by review): this
 * is not a provider HTTP error class, but it shares D16's terminal
 * property — the model returns the same width on every call, so a retry
 * reproduces the exact same rejection forever, exactly like a terminal 4xx.
 * Left un-tombstoned, a SYSTEMATIC mismatch (`dimensions` configured
 * narrower or wider than the provider's actual output) fails this check for
 * EVERY document under that model, forever: the batch never persists a
 * vector, the ledger row (design D1) is never written, `runEmbedBacklogSweep`'s
 * D6 gate never turns on, and every write-hook enqueue burns one real
 * provider call with no operator-visible error — verbatim D16's "loops
 * forever ... spend producing no error anyone reads" failure. Throwing
 * reaches D16's tombstone path so the mismatch is recorded once, named
 * concretely, and never retried at the same content.
 */
function isValidVector(
  vector: ReadonlyArray<number> | undefined,
  dimensions: number,
): vector is ReadonlyArray<number> {
  return (
    vector !== undefined &&
    vector.length === dimensions &&
    vector.every((value) => Number.isFinite(value))
  );
}

/**
 * Names the concrete mismatch for an invalid vector — this message is the
 * operator's only signal (design D16's `embedding_fail_reason`), so it must
 * say expected-vs-received width rather than a generic "invalid vector".
 * Carries no request/response content, credential, or endpoint value — only
 * the declared `dimensions` and the vector's own shape, both already
 * non-sensitive local values.
 */
function describeInvalidVector(
  vector: ReadonlyArray<number> | undefined,
  dimensions: number,
): string {
  if (vector === undefined) {
    return 'embedding provider returned no vector for a requested document';
  }
  if (vector.length !== dimensions) {
    return `embedding provider returned a vector of length ${vector.length}, expected ${dimensions} — check the configured "dimensions" for this model`;
  }
  return 'embedding provider returned a non-finite value in the vector';
}

/**
 * Design D7's correlation guarantee, enforced at the one place it can still
 * be observed: the raw HTTP response body's `data[].index`. Verified against
 * the installed `@ai-sdk/openai@3.0.79` source that `embedMany`/`embed`
 * strip this field entirely before our code ever sees a result (its response
 * schema parses only `{embedding: number[]}[]`) — position-zipping
 * `embeddings[i]` against the request's `values[i]`, exactly what `embed()`
 * below does, is therefore the SDK's own contract, not our shortcut. This
 * function is what makes that position-zip provably safe rather than merely
 * assumed: an index sequence that is not exactly `0..n-1` in order — an
 * outright reorder, or any item simply missing its index — means the pairing
 * cannot be trusted, so it throws instead of silently writing one document's
 * vector onto another's row (design D7's stated failure mode).
 *
 * An absent `index` is treated as UNVERIFIABLE, not as "assume order held":
 * a compatible endpoint that never emits `index` gives no signal at all, and
 * trusting position anyway is exactly the corruption D7 exists to prevent.
 * Failing loud beats a silent, undetectable mispairing.
 *
 * A response whose shape isn't `{data: [...]}` at all is left alone — that's
 * the SDK's own schema validation's job to reject, not this function's.
 */
function assertResponseOrderPreserved(body: UnknownRecord): void {
  if (!Array.isArray(body.data)) return;
  const inOrder = body.data.every(
    (item, position) =>
      isRecord(item) && isNumber(item.index) && item.index === position,
  );
  if (!inOrder) {
    throw new EmbeddingBackendError(
      'embedding provider response order could not be verified',
      false,
    );
  }
}

/**
 * Wraps a fetch implementation so every response is checked by
 * `assertResponseOrderPreserved` before the SDK's own parsed result is
 * trusted. `response.clone()` is required: the SDK's own response handler
 * reads the SAME `Response`'s body afterward, and a Fetch API body stream
 * can only be consumed once. A non-2xx response, or a body that isn't valid
 * JSON or isn't record-shaped, is left untouched for the SDK's own
 * `failedResponseHandler`/schema validation to reject with its own error —
 * this wrapper only ever narrows an otherwise-successful response.
 */
function wrapFetchWithOrderVerification(
  underlyingFetch: typeof fetch,
): typeof fetch {
  return async (
    input: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
  ) => {
    const response = await underlyingFetch(input, init);
    if (!response.ok) return response;
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      return response;
    }
    if (isRecord(body)) {
      assertResponseOrderPreserved(body);
    }
    return response;
  };
}

/** Narrows `OpenAIProvider` to the one capability this adapter calls (#268 pattern) — a fake provider in a test needs to implement only this, not the whole languageModel/image/transcription/speech surface. */
export type OpenAIEmbeddingProvider = Pick<
  OpenAIProvider,
  'textEmbeddingModel'
>;

/**
 * Test seam (anti-slop/no-module-mocking), same pattern as
 * `models/openai-model-client.ts`: overrides the AI SDK's provider factory
 * instead of module-mocking `@ai-sdk/openai`. A test supplies a
 * `createOpenAI` whose `textEmbeddingModel` returns `ai/test`'s
 * `MockEmbeddingModelV3` (real `embed`/`embedMany` still runs against it —
 * only the provider boundary is replaced, same as
 * `openai-model-client.tools.test.ts`) to exercise application-level logic
 * (chunking, prefixes, vector validation, per-document failure), or overrides
 * `fetch` to exercise `assertResponseOrderPreserved` end to end through the
 * REAL `createOpenAI`/`textEmbeddingModel`/`embedMany` chain with a synthetic
 * HTTP response — `MockEmbeddingModelV3` bypasses the HTTP layer entirely, so
 * it cannot exercise the fetch-level guard. Production call sites never pass
 * either — the default is the real SDK and the real global `fetch`.
 */
export type OpenAIEmbeddingBackendDependencies = {
  createOpenAI: (settings: {
    apiKey: string;
    baseURL?: string;
    fetch?: typeof fetch;
  }) => OpenAIEmbeddingProvider;
  fetch?: typeof fetch;
};

const DEFAULT_DEPENDENCIES: OpenAIEmbeddingBackendDependencies = {
  createOpenAI: (settings) => createOpenAI(settings),
};

/**
 * Embeds one already-batchSize-bounded chunk and pairs each result back to
 * its document. Fails the WHOLE chunk closed (empty result, no throw) on any
 * length mismatch: the OpenAI-compatible /embeddings endpoint carries no
 * per-item id, so a response whose count differs from what was sent cannot be
 * safely paired at all — guessing a partial alignment risks writing one
 * document's vector onto another's row (design D7). Every document in the
 * chunk is simply absent from the result (task 5.6's "unmatched results
 * discarded") rather than persisted incorrectly. Throws instead — out of the
 * whole `embed()` call, not just this chunk — on an invalid vector: a
 * dimensions mismatch is a property of the whole call, so continuing to check
 * the rest of this chunk (or later chunks) would only reproduce the same
 * rejection. The caller's batch IS the persist unit (trap 6), so this reaches
 * processBatch's catch and tombstones every outstanding document in the batch
 * with this one concrete reason.
 */
async function embedChunk(
  model: ReturnType<OpenAIProvider['textEmbeddingModel']>,
  chunk: ReadonlyArray<EmbeddingDocumentInput>,
  prefix: string | undefined,
  config: Pick<OpenAIEmbeddingBackendConfig, 'dimensions'>,
): Promise<Array<EmbeddingResult>> {
  const values = chunk.map((doc) =>
    prefix ? prefix + doc.content : doc.content,
  );

  let embeddings: ReadonlyArray<ReadonlyArray<number>>;
  try {
    // maxRetries: 0 — retry is the caller's job (a pg-boss queue policy,
    // design D5); the SDK's own internal retry would multiply attempts on
    // top of it.
    ({ embeddings } = await embedMany({ model, values, maxRetries: 0 }));
  } catch (error) {
    throw classifyEmbeddingFailure(error);
  }
  if (embeddings.length !== chunk.length) return [];

  const results: Array<EmbeddingResult> = [];
  for (let i = 0; i < chunk.length; i++) {
    const vector = embeddings[i];
    if (!isValidVector(vector, config.dimensions)) {
      // Terminal: see isValidVector's doc comment.
      throw new EmbeddingBackendError(
        describeInvalidVector(vector, config.dimensions),
        true,
      );
    }
    results.push({
      documentId: chunk[i].documentId,
      contentHash: chunk[i].contentHash,
      embedding: vector,
    });
  }
  return results;
}

/**
 * Schema validation (embeddingModels[].batchSize: minimum 1) keeps a
 * non-positive `batchSize` out of reach through the normal config path, but
 * `createOpenAIEmbeddingBackend` is also callable directly (design D8/D15)
 * with no such guarantee — a non-positive batchSize would otherwise never
 * advance `start` in `embed()`'s chunk loop and hang forever instead of
 * failing.
 */
function resolveBatchSize(configuredBatchSize: number | undefined): number {
  const batchSize = configuredBatchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE;
  if (batchSize < 1) {
    throw new RangeError(
      `createOpenAIEmbeddingBackend: batchSize must be >= 1, got ${batchSize}`,
    );
  }
  return batchSize;
}

/**
 * Builds an `EmbeddingBackend` for OpenAI or any OpenAI-compatible endpoint
 * (Ollama, a local server, ...), reusing an existing `providers[]` connection
 * exactly as `models/openai-model-client.ts` builds its client — same
 * keyless-provider placeholder, same `baseUrl` threading, no Nest module
 * dependency (design D8/D15: the embed worker builds this directly, so
 * `SearchModule` never imports `ModelsModule`).
 */
export function createOpenAIEmbeddingBackend(
  config: OpenAIEmbeddingBackendConfig,
  dependencies: OpenAIEmbeddingBackendDependencies = DEFAULT_DEPENDENCIES,
): EmbeddingBackend {
  const openai = dependencies.createOpenAI({
    apiKey: config.credential || KEYLESS_PLACEHOLDER_API_KEY,
    ...(config.baseUrl && { baseURL: config.baseUrl }),
    fetch: wrapFetchWithOrderVerification(dependencies.fetch ?? fetch),
  });
  const model = openai.textEmbeddingModel(config.providerModelId);
  const batchSize = resolveBatchSize(config.batchSize);

  async function embed(
    documents: ReadonlyArray<EmbeddingDocumentInput>,
    prefix: string | undefined,
  ): Promise<Array<EmbeddingResult>> {
    const results: Array<EmbeddingResult> = [];
    // Chunk ourselves so the configured batchSize is what actually reaches
    // the provider and is observable, rather than relying on embedMany's own
    // internal splitting (design D5). In practice a caller already sizes its
    // input to one model's batchSize (the embed worker re-queries a batch at
    // a time); this loop is defense-in-depth for a caller that passes more.
    for (let start = 0; start < documents.length; start += batchSize) {
      const chunk = documents.slice(start, start + batchSize);
      results.push(...(await embedChunk(model, chunk, prefix, config)));
    }
    return results;
  }

  return {
    embedDocuments: (documents) => embed(documents, config.documentPrefix),
    async embedQuery(text) {
      const [result] = await embed(
        [{ documentId: '__query__', contentHash: '', content: text }],
        config.queryPrefix,
      );
      if (!result) {
        throw new EmbeddingBackendError(
          'embedding provider returned no vector for the query',
          false,
        );
      }
      return result.embedding;
    },
  };
}
