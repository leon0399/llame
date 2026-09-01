/**
 * The corpus-agnostic embedding provider boundary (chat-search-embeddings,
 * design D8). `search/core` imports nothing corpus-specific (see
 * `core/index.ts`'s header) — this file declares only the interface and its
 * DI token; construction (resolving a `providers[]` connection, building the
 * `@ai-sdk/openai` client) is a later layer's job, kept out of `SearchModule`
 * to preserve its leaf-module constraint.
 *
 * One `EmbeddingBackend` instance is bound to exactly one declared embedding
 * model (design D1) — the model key never travels through these calls,
 * because there is nothing to disambiguate: a caller holding a backend
 * already knows which model it embeds with.
 */

/** One document to embed, carrying its own identity for result correlation (design D7) — never joined back to its request by array position. */
export type EmbeddingDocumentInput = {
  documentId: string;
  contentHash: string;
  content: string;
};

/** One document's produced vector, still carrying the identity it was requested with. A document whose result could not be safely correlated, or whose vector failed validation, is simply absent — never returned with a wrong or guessed identity. */
export type EmbeddingResult = {
  documentId: string;
  contentHash: string;
  embedding: ReadonlyArray<number>;
};

export interface EmbeddingBackend {
  /** Embed a single search query, applying the model's query-side prefix (if configured). */
  embedQuery(text: string): Promise<ReadonlyArray<number>>;
  /** Embed a set of documents, applying the model's document-side prefix (if configured). Returns only the documents whose vector was produced and validated — see `EmbeddingResult`. */
  embedDocuments(
    documents: ReadonlyArray<EmbeddingDocumentInput>,
  ): Promise<Array<EmbeddingResult>>;
}

/**
 * @public — the DI token for embedding wiring that is not connected yet:
 * embeddings are populated but not read (SPEC's search section), so nothing
 * injects this today. Deleting it would delete the seam, not dead code.
 *
 * Nest DI token for `EmbeddingBackend` — a symbol, not the interface itself (TypeScript interfaces have no runtime value to key a provider on). */
export const EMBEDDING_BACKEND = Symbol('EMBEDDING_BACKEND');
