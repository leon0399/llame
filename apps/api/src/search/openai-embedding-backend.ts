import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { APICallError, embedMany } from 'ai';

import { KEYLESS_PLACEHOLDER_API_KEY } from '../models/openai-model-client';
import {
  type EmbeddingBackend,
  type EmbeddingDocumentInput,
  type EmbeddingResult,
} from './core';
import { DEFAULT_EMBEDDING_BATCH_SIZE } from '../instance-config/llame-config';

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

/** Terminal HTTP-status classification (design D16) — a small predicate over the error's status, not an error taxonomy. Written against `APICallError.statusCode` directly rather than the SDK's own `.isRetryable` (which treats other statuses, e.g. 409, as retryable — the design's terminal rule is 4xx-excluding-408/429, not the SDK's opinion). */
export function classifyEmbeddingFailure(
  error: unknown,
): EmbeddingBackendError {
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

/** A returned vector that fails this is a producer bug (dimensions misconfiguration, or a provider returning NaN/Infinity) — task 5.5: rejected, and never included in a result the caller could persist. Classified terminal: a retry cannot fix a systematic dimensions mismatch. */
function isValidVector(
  vector: readonly number[] | undefined,
  dimensions: number,
): vector is readonly number[] {
  return (
    vector !== undefined &&
    vector.length === dimensions &&
    vector.every((value) => Number.isFinite(value))
  );
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
 * `openai-model-client.tools.test.ts`). Production call sites never pass
 * this — the default is the real SDK.
 */
export type OpenAIEmbeddingBackendDependencies = {
  createOpenAI: (settings: {
    apiKey: string;
    baseURL?: string;
  }) => OpenAIEmbeddingProvider;
};

const DEFAULT_DEPENDENCIES: OpenAIEmbeddingBackendDependencies = {
  createOpenAI: (settings) => createOpenAI(settings),
};

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
  });
  const model = openai.textEmbeddingModel(config.providerModelId);
  const batchSize = config.batchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE;

  async function embed(
    documents: readonly EmbeddingDocumentInput[],
    prefix: string | undefined,
  ): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    // Chunk ourselves so the configured batchSize is what actually reaches
    // the provider and is observable, rather than relying on embedMany's own
    // internal splitting (design D5). In practice a caller already sizes its
    // input to one model's batchSize (the embed worker re-queries a batch at
    // a time); this loop is defense-in-depth for a caller that passes more.
    for (let start = 0; start < documents.length; start += batchSize) {
      const chunk = documents.slice(start, start + batchSize);
      const values = chunk.map((doc) =>
        prefix ? prefix + doc.content : doc.content,
      );

      let embeddings: readonly (readonly number[])[];
      try {
        // maxRetries: 0 — retry is the caller's job (a pg-boss queue policy,
        // design D5); the SDK's own internal retry would multiply attempts
        // on top of it.
        ({ embeddings } = await embedMany({
          model,
          values,
          maxRetries: 0,
        }));
      } catch (error) {
        throw classifyEmbeddingFailure(error);
      }

      // Fail this chunk closed on any length mismatch: the OpenAI-compatible
      // /embeddings endpoint carries no per-item id, so a response whose
      // count differs from what was sent cannot be safely paired at all —
      // guessing a partial alignment risks writing one document's vector
      // onto another's row (design D7). Every document in the chunk is
      // simply absent from the result (task 5.6's "unmatched results
      // discarded") rather than persisted incorrectly.
      if (embeddings.length !== chunk.length) continue;

      for (let i = 0; i < chunk.length; i++) {
        const vector = embeddings[i];
        if (!isValidVector(vector, config.dimensions)) continue;
        results.push({
          documentId: chunk[i].documentId,
          contentHash: chunk[i].contentHash,
          embedding: vector,
        });
      }
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
