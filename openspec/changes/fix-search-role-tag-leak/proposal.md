## Why

The chat-search projection currently serializes role labels such as `[user]` and `[assistant]` into the same text used for lexical matching. Those structural labels become FTS and trigram terms, so generic queries for `user` or `assistant` retrieve unrelated conversations and degrade ranking.

Role attribution is still necessary when episodic conversation results are surfaced to the model or user. The projection must therefore keep presentation context separate from lexical match text.

## What Changes

- Derive the lexical match representation from user/assistant message text without synthetic role labels, so role labels do not enter `normalized_content` or the generated FTS vector.
- Preserve role-labelled presentation content for result snippets, including agent-facing `search_conversations` results.
- Bump the deterministic chunker version so existing projections are discovered as stale and rebuilt with the role-free lexical representation.
- Add regression coverage for exact, prefix, and typo false-positive role-label queries; literal role words in conversation text; role-labelled snippets; and rebuilt projection data.
- Do not add an embeddings schema or embedding input representation, recall-time untrusted-data framing, or span-aware headline rendering in this change; those concerns require separate semantic-retrieval or security work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `search-projection`: Separate role-labelled presentation content from role-free lexical indexing content in the derived chat projection.
- `chat-search`: Prevent synthetic role labels from matching or influencing ranking while retaining role attribution in content snippets.

## Impact

- Affected code: chat conversation chunker, search projection schema/documentation, index rebuild service, hybrid search behavior, and search tests/evaluation fixtures as needed.
- Existing projection rows are asynchronously rebuilt through the versioned stale-chat discovery path; no canonical chat/message data or public API response shape changes.
- Tenant isolation, corpus exclusions, and the shared web/tool search path remain unchanged.
