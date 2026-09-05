/**
 * Embedding input-shape version (chat-search-embeddings design D11): the
 * current version of what is embedded. A bump invalidates every vector
 * produced under the previous version (the coverage predicate and the
 * query-side filter both compare it).
 */
export const EMBED_INPUT_VERSION = 1;
