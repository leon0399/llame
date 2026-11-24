/**
 * The hybrid lexical+vector chat-search query of `ChatsRepository`: the
 * projection column sets it reads, the RRF-fused query builder, and the result
 * shaping (snippet clip plus timestamp parse). Split out of
 * `chats-repository.ts` so the repository keeps only owner-scoped row access.
 */

import {
  buildHybridSearchQuery,
  RRF_DEFAULT_K,
  type HybridSearchResult,
} from '../search/core';
import { EMBED_INPUT_VERSION } from '../search/embed-input-version';
import {
  resolveSearchScopes,
  type SearchByOwnerOptions,
} from './chats-search-scope';

const CHAT_DOCUMENT_COLUMNS = {
  table: 'search_chat_documents',
  groupId: 'chat_id',
  id: 'id',
  fts: 'fts',
  normalized: 'normalized_content',
  content: 'content',
} as const;

const CHAT_PARENT_COLUMNS = {
  table: 'chats',
  id: 'id',
  title: 'title',
  recency: 'updated_at',
} as const;

const CHAT_VECTOR_COLUMNS = {
  embedding: 'embedding',
  embeddingModelKey: 'embedding_model_key',
  embeddedContentHash: 'embedded_content_hash',
  embedInputVersion: 'embed_input_version',
  contentHash: 'content_hash',
} as const;

const SNIPPET_MAX = 160;

/** Collapse whitespace and clip a matching message to a short search snippet. */
function truncateSnippet(text: string): string {
  const clean = text.replaceAll(/\s+/g, ' ').trim();

  return clean.length > SNIPPET_MAX
    ? `${clean.slice(0, SNIPPET_MAX).trimEnd()}…`
    : clean;
}

/** Hybrid lexical+vector search query over the projection, scoped to an owner. */
export function buildChatSearchQuery(
  ownerUserId: string,
  normalizedQuery: string,
  likePattern: string,
  options: SearchByOwnerOptions,
) {
  const { scope, rangePreference } = resolveSearchScopes(
    ownerUserId,
    options.timeRange,
  );

  return buildHybridSearchQuery({
    query: normalizedQuery,
    likePattern,
    document: CHAT_DOCUMENT_COLUMNS,
    parent: CHAT_PARENT_COLUMNS,
    scope,
    vector: options.vector
      ? {
          queryVector: options.vector.queryVector,
          activeModelKey: options.vector.modelKey,
          currentInputVersion: EMBED_INPUT_VERSION,
          columns: CHAT_VECTOR_COLUMNS,
          weight: 1,
          limit: 100,
        }
      : undefined,
    rangePreference,
    weights: { fts: 1, trgm: 0.35, title: 1 },
    limits: { fts: 100, trgm: 40, title: 50 },
    rrfK: RRF_DEFAULT_K,
    groupTopNWeights: [1, 0.25, 0.1],
    limit: options.limit,
  });
}

/** Clip the row's snippet and parse its Postgres-text timestamp. */
export function toHybridSearchResult(
  row: HybridSearchResult,
): HybridSearchResult {
  return {
    id: row.id,
    title: row.title,
    snippet:
      row.snippet === null || row.snippet === undefined
        ? null
        : truncateSnippet(row.snippet),
    // `execute` returns timestamps as Postgres text despite the row type.
    updatedAt: new Date(row.updatedAt),
    bestDocumentId: row.bestDocumentId,
  };
}
