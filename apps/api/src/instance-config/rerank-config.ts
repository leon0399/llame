/**
 * Types of the `cohere-rerank` provider and the `rerankModels[]` catalogue, the
 * conventional-reranker sibling of the System One decision lane. Both feed the
 * same rank seat; a tool's `rerank.model` names an id of either catalogue.
 */

import type { BillingMode } from '../models/model-client';
import type { RequestHeaderTemplates } from '../models/request-headers';

/**
 * A Cohere v2 rerank endpoint: `POST {baseUrl}/rerank` through
 * `@ai-sdk/cohere`. OpenRouter serves the same wire at
 * `https://openrouter.ai/api/v1`, and Jina or Infinity answer it too. The
 * operator may omit `baseUrl`, which selects Cohere's own API. `key` may be
 * absent or resolve blank (`null`, keyless), which needs an explicit
 * `baseUrl`. An entry of this type never serves a `models[]` or
 * `embeddingModels[]` entry: a reranker is not a chat or embedding client.
 */
export type CohereRerankProviderConfig = {
  id: string;
  billing?: BillingMode;
  type: 'cohere-rerank';
  key: string | null;
  baseUrl: string;
  headers: RequestHeaderTemplates;
};

/** The still-uninterpolated provider entry once the schema has validated it. */
export type RawCohereRerankProviderEntry = {
  id: string;
  type: 'cohere-rerank';
  billing?: BillingMode;
  /** Optional: absent, `null`, or blank after interpolation means keyless. */
  key?: string | null;
  /** Optional: omission or `null` selects the Cohere API. */
  baseUrl?: string | null;
  headers?: Record<string, string | null>;
};

/** The Cohere API's own base URL, used when a `cohere-rerank` entry omits `baseUrl`. */
export const COHERE_DEFAULT_BASE_URL = 'https://api.cohere.com/v2';

/**
 * One entry of the rerank-model catalogue. `provider` must be a `providers[]`
 * entry of `type: 'cohere-rerank'` and `model` is sent verbatim on the wire
 * (e.g. `rerank-v3.5`, or `cohere/rerank-5-fast` via OpenRouter). Ids are
 * unique across `decisionModels[]` and `rerankModels[]` together. The raw
 * entry, before interpolation, has the same shape.
 */
export type RerankModelConfig = {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
};
