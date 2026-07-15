# chat-search

## Purpose

**Chat search** is the user-facing (command palette) and agent-facing (`search_conversations` tool) retrieval over a user's own chats — the single `ChatsRepository.searchByOwner` path both surfaces share. It defines the matching semantics (title + user/assistant text content, case/typo tolerance, language-agnostic behavior for English/Russian/Spanish/mixed content), fused relevance ranking with a stable output contract and snippets, the requirement that clients not re-filter server results (the root of #171), tenant isolation of the search path, index freshness on turn completion, and a versioned relevance eval baseline that later retrieval phases (embeddings) are judged against. Retrieval reads the derived `search-projection`; this capability owns the query-side contract and quality bar.

## Requirements

### Requirement: Search matches titles and conversation text, case- and typo-tolerantly

Chat search SHALL match a user's chats by title and by the text content of user/assistant turns, combining full-text matching (`simple` configuration, `websearch_to_tsquery` semantics) with trigram matching (`word_similarity`) so that case differences, inflections partially, typos, and partial words still retrieve the chat. Synthetic structural role labels used to format snippets MUST NOT match or affect ranking; literal occurrences of those words in a title or user/assistant message body SHALL remain searchable. No language detection SHALL be performed; matching MUST behave consistently for English, Russian, Spanish, and mixed-language content.

#### Scenario: Exact title in different case

- **WHEN** a user searches the exact title of one of their chats in all-lowercase (including a Cyrillic title)
- **THEN** that chat is returned

#### Scenario: Typo'd content term

- **WHEN** a user searches a content word with a small typo or as an incomplete prefix
- **THEN** the chat containing the correct form is returned via the trigram leg

#### Scenario: Blank query

- **WHEN** the query is empty or whitespace-only
- **THEN** the result is an empty list and no table scan is performed

#### Scenario: Synthetic role label does not match

- **WHEN** a user searches `user` or `assistant` and those words occur only as synthetic chunk role labels
- **THEN** the chat is not returned and its labels do not influence relevance ranking

#### Scenario: Synthetic role-label prefix does not match

- **WHEN** a user searches a prefix such as `assis` that occurs only within a synthetic chunk role label
- **THEN** the chat is not returned and the trigram substring path does not contribute the label to ranking

#### Scenario: Synthetic role-label typo does not match

- **WHEN** a user searches a small typo such as `assistnt` that is similar only to a synthetic chunk role label
- **THEN** the chat is not returned and the trigram fuzzy path does not contribute the label to ranking

#### Scenario: Literal role word remains searchable

- **WHEN** a user searches `assistant` and that literal word occurs in a title or user/assistant message body
- **THEN** the chat is returned through the corresponding title or content match path

### Requirement: Results are ranked by fused relevance with stable output shape

Search SHALL rank candidates by Reciprocal Rank Fusion over the independent retrieval legs (never by mixing raw scores), aggregate document matches into chats with weighted top-N scoring, and produce a deterministic order (stable tie-breaking). The existing response contract (`id`, `title` nullable, `snippet` nullable, `updatedAt`) and the `search_conversations` tool input schema (`query`, `limit`) SHALL be preserved. A content match SHALL yield a snippet excerpting the best-matching region with its role attribution preserved; a title-only match SHALL yield a `null` snippet.

#### Scenario: Content match returns a highlighted snippet

- **WHEN** a query matches message content in a chat
- **THEN** the chat's result carries a snippet excerpting the best-matching region with the contributing user/assistant role labels retained

#### Scenario: Both surfaces upgrade together

- **WHEN** the web palette and the `search_conversations` tool run the same query for the same user
- **THEN** both are served by the same repository method and return the same ranked chats

### Requirement: The client does not re-filter server results

Search surfaces SHALL treat the server's ranked results as authoritative. The command palette MUST NOT re-filter or re-rank server search results client-side (the cmdk client filter is disabled for server-result items), so a server-matched chat can never be hidden by client-side string matching.

#### Scenario: Case-insensitive end-to-end (fixes #171)

- **WHEN** a user types the exact title of an existing chat in all-lowercase into the command palette
- **THEN** the chat appears in the results (both title-match and content-match paths, non-ASCII casing included)

### Requirement: Search never crosses the tenant boundary

The search path SHALL return only chats owned by the requesting user. Another user's content MUST NOT be reachable through search even when it matches the query exactly, and a `visibility = 'public'` chat of another user MUST NOT surface in search results. System prompts, tool payloads, and model reasoning MUST NOT be matched or surfaced in snippets. Isolation SHALL be enforced by RLS on the underlying tables (owner filters remain as defense-in-depth) and proven by negative tests in the RLS harness.

#### Scenario: Cross-tenant exclusion

- **WHEN** user B searches a term that exactly matches content existing only in user A's chats
- **THEN** user B receives no results from user A's chats (asserted in both directions)

#### Scenario: Public chats of others are not searchable

- **WHEN** user B searches a term matching only a public chat owned by user A
- **THEN** the chat does not appear in user B's search results

### Requirement: New content is searchable on turn completion

A chat's lexical projection SHALL be rebuilt synchronously when a turn completes — assistant finalization rebuilds the whole chat, including the user message that started the turn, after the user-facing write commits, with no manual reindexing. This is the only inline indexing site: a user message persisted before its turn finalizes is not indexed inline (finalize covers it moments later), and a fork's own content is indexed via the asynchronous reindex queue rather than inline. If the synchronous rebuild fails, the chat SHALL still become searchable via the asynchronous fallback enqueue. Index maintenance SHALL never fail the user-facing write and SHALL never regress search below the previous live-query behavior.

#### Scenario: Fresh turn is findable immediately

- **WHEN** a user's message is answered and the assistant's reply finalizes with a distinctive term
- **THEN** the chat is returned via search for that term without waiting for any background job

### Requirement: Retrieval quality is measured against a versioned eval baseline

The repository SHALL contain a small versioned relevance dataset (exact phrases, identifiers, typos, paraphrases, inflected-Russian forms, English/Spanish, mixed-language, code/filenames) and an opt-in harness that reports Recall@10, MRR, and zero-result rate, establishing the lexical baseline that later retrieval phases are evaluated against. The harness SHALL assert hard recall floors on the categories lexical search has no excuse to miss — exact-title, exact-content, and typo queries MUST place the expected chat in the top 10 — while paraphrase and inflected-morphology categories are recorded without assertion (they measure the later semantic lift).

#### Scenario: Baseline recorded

- **WHEN** the eval harness runs against the seeded dataset
- **THEN** it reports Recall@10, MRR, and zero-result rate for the lexical configuration, and the results are recorded in the repository

#### Scenario: Exact and typo floors are enforced

- **WHEN** a change causes an exact-title, exact-content, or typo query in the dataset to stop returning its expected chat in the top 10
- **THEN** the eval harness fails
