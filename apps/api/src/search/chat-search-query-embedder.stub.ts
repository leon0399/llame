import { type QueryEmbedderPort } from './chat-search-query-embedder';

/**
 * A no-op query embedder for tests that construct services directly. Always
 * returns `{ fallback: 'no_model' }`, matching an instance with no embedding
 * model configured.
 */
export function noopQueryEmbedder(): QueryEmbedderPort {
  return {
    embedQueryForSearch: () =>
      Promise.resolve({ fallback: 'no_model' as const }),
  };
}
