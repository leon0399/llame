## Context

`search_chat_documents` is a rebuildable projection over user and assistant text. Today the conversation chunker emits a single role-labelled `content` string, derives `normalized_content` from that same string, and the database generates `fts` from `normalized_content`. The labels are useful in a returned snippet because they preserve who said each recalled passage, but they are synthetic structure rather than conversation text. Indexing them makes `user` and `assistant` false-positive search terms in both lexical candidate legs.

The projection already has a versioned chunker, content hashes, synchronous owner-scoped maintenance, and cross-tenant stale-chat discovery. A version bump is therefore the established mechanism for replacing existing derived rows without mutating canonical messages.

## Goals / Non-Goals

**Goals:**

- Keep role attribution in result snippets for the web search and `search_conversations` tool.
- Exclude synthetic role labels from all lexical matching and ranking inputs.
- Rebuild existing projection rows automatically and safely through the current version-staleness path.
- Preserve deterministic chunking, no-op upserts for unchanged current-version chunks, RLS, corpus exclusions, and the public result contract.

**Non-Goals:**

- Adding embeddings, pgvector, an embedding queue, or an `embedding_content` database column.
- Changing canonical `messages`, title matching, ranking weights, chunk sizing, or the web/tool API shapes.
- Changing whether literal occurrences of `user` or `assistant` in a message body are searchable.
- Reconstructing role labels after `ts_headline` so a literal role-word query can never select a synthetic label in its display excerpt.
- Recall-time framing of retrieved transcript as untrusted historical data; that is a security change for broader episodic retrieval.

## Decisions

### Store presentation content separately from lexical normalization

Each chunk will continue to produce role-labelled original-cased `content`, used only as the snippet source. It will separately assemble role-free user/assistant text and derive `normalized_content` from that representation. `fts` remains a generated vector over `normalized_content`, and the trigram leg continues to use that same column.

This is the smallest durable separation: presentation retains conversational provenance, while matching contains only user-visible message text. It requires no schema migration because the existing two columns already encode the two required representations.

**Alternative: strip labels only in the SQL query.** Rejected. The stored FTS vector and trigram index would still be poisoned, query expressions would diverge from the indexed representation, and existing rows would remain wrong.

**Alternative: remove labels from `content`.** Rejected. `ts_headline` currently uses `content`, so result snippets sent to the model and UI would lose role attribution.

**Alternative: add an `embedding_content` column now.** Rejected. No embedding backend or evaluation exists yet, so its contract would be speculative. Phase 3 can choose role-aware `content`, role-free source text regenerated from canonical messages, or a new explicit representation based on measured retrieval quality.

### Hash both representations and version the chunker

The chunk content hash will continue to include the presentation content and lexical normalization, alongside range and version. The chunker version will increase. This ensures display-only role changes and retrieval-input changes both refresh the projection, while the version bump makes every existing version-1 row stale and prevents mixed representations in a live chat.

**Alternative: leave the version unchanged and force a one-off update.** Rejected. It bypasses the established stale-discovery protocol, creates deployment-only repair logic, and risks a mix of pre- and post-fix rows.

### Preserve the shared retrieval and snippet path

`ChatsRepository.searchByOwner` remains the sole path for web search and `search_conversations`. The hybrid SQL continues to rank against `fts` and `normalized_content` but headlines role-labelled `content`. No client-side filtering, tool formatting, or tenant scoping changes.

### Keep contextual cross-turn matching and the existing display budget

The role-free lexical representation will join adjacent messages without a synthetic lexical boundary. Phrase-like matching across adjacent user/assistant turns is acceptable because chunks intentionally represent contextual multi-message passages. Chunk grouping continues to measure the role-labelled presentation blocks against the existing character budget, preserving the bounded snippet delivered to callers.

**Alternative: retain strict lexical phrase boundaries between turns.** Rejected. PostgreSQL FTS positions cannot preserve that boundary without another indexed representation or a query-semantics change; neither has demonstrated value for chat search.

**Alternative: measure the budget only against role-free text.** Rejected. The marginal reclaimed capacity does not justify changing deterministic chunk boundaries, while the role-labelled presentation output remains the bounded caller-facing payload.

## Risks / Trade-offs

- [Existing rows remain false-positive candidates until reindexed] → Increment the chunker version so the existing five-minute discovery sweep enqueues version-stale chats in its bounded batches; active chats also rebuild on their next finalization. No eager or blocking backfill is added because this is a relevance defect within the owner boundary.
- [A query for `user` or `assistant` could be overcorrected] → Regression tests distinguish synthetic labels from those literal words in message bodies; literal body text remains searchable.
- [Role labels might accidentally return to the match representation later] → Unit tests assert their absence from normalized text and integration tests inspect stored `fts`/`normalized_content` plus query behavior.
- [A literal role-word query can select a synthetic label in `ts_headline`] → Accept the display-only edge case for now: candidate matching and ranking stay role-free, while a span-aware presentation layer is deferred.
- [Embedding work later needs a different representation] → Keep embedding input deliberately undecided and evaluate it against the versioned relevance dataset before adding persistent data.

## Migration Plan

1. Deploy the chunker version bump with the role-free normalization change.
2. Existing projection rows are detected as version-stale and reindexed by the normal discovery worker under each owner tenant scope; newly finalized chats rebuild synchronously under the new version.
3. Verify stored `normalized_content` and `fts` contain no synthetic role labels, while returned snippets retain them and exact, prefix, and typo label queries do not return synthetic-label-only chats.
4. Roll back by restoring the prior application version. Canonical messages are untouched; the older version's stale-version logic will rebuild its projection representation if rollback is required.

## Open Questions

None for this lexical fix. Embedding input representation is intentionally deferred to the semantic-retrieval design and evaluation phase.
