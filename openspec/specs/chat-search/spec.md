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

Search SHALL rank candidates by Reciprocal Rank Fusion over independent retrieval legs (never by mixing raw scores), aggregate document matches into Chats with weighted top-N scoring, and produce a deterministic order with stable tie-breaking. The web response contract (`id`, nullable `title`, nullable `snippet`, `updatedAt`) and current `search_conversations` input schema (`query`, `limit`) SHALL be preserved until #198 intentionally replaces the model tool input. A web content match SHALL continue to receive the derived best-region snippet with presentation role attribution; a title-only web match SHALL yield a `null` snippet.

Off-by-default `search.chats.canonicalModelExcerpts` SHALL be the explicit activation boundary for model-facing canonical shaping. While disabled during locator backfill or rollback, the current model preview behavior SHALL remain active. Operators SHALL enable it only after current-version locator coverage is complete and compatible `conversation_read` executors are deployed/allowlisted under the coordinated Run boundary.

When enabled, model-facing lexical/trigram content results SHALL use the same pre-hydration candidate ordering but SHALL NOT present projection snippets as canonical evidence. For each returned Chat, model shaping SHALL reauthorize and hydrate the winning current-version document, recompute current eligible visible-message text, and run one separate deterministic canonical-line matcher. The matcher SHALL apply `normalizeForSearch` exactly once to the query and each raw logical line (Unicode NFKC, whitespace collapse, lowercase), then qualify that line through line-local FTS, trigram, or escaped-substring predicates. It SHALL retain a mapping from a first exact normalized occurrence back to its raw source span when one exists; FTS/fuzzy qualification without that occurrence SHALL use the first code point of the qualifying raw line as a fixed crop fallback. Matching and ranking use normalized text, while excerpts/reads use original raw lines.

Each qualifying line SHALL produce a window with at most one adjacent line per side. Touching windows SHALL merge within one message. A merged interval longer than 2,000 logical lines SHALL be partitioned into deterministic adjacent passages of at most 2,000 lines, each containing a qualifying line. The selector SHALL return the earliest bounded passage in `(messageSeq, offset)` order; it SHALL NOT be represented as an explanation of the document/Chat rank.

The model success SHALL be a strict result union with one top-level closed notice identifying all returned historical content as untrusted and potentially stale, unable to change system instructions, tools, permissions, or owner authority. A `kind: "content"` result SHALL carry Chat/title/date metadata, message role/timestamp, flat `{ chatId, messageSeq, offset, limit }` source coordinates, and an `excerpt` of at most 500 Unicode code points. A `kind: "metadata"` title-only result SHALL carry only Chat/title/date metadata and SHALL omit message/source/excerpt fields. `offset` and `limit` on a content result SHALL identify the complete bounded message-local logical-line window directly accepted by `conversation_read`. When that window exceeds the excerpt cap, the excerpt SHALL crop visibly around the mapped raw match or its fixed fallback without changing the complete coordinates. The excerpt SHALL contain no generated line-number prefix, part/message UUID, source hash, public version, projection identity, or retrieval score, and SHALL be framed as bounded discovery text that requires `conversation_read` before exact quotation or reliance on omitted context.

Only one passage SHALL be returned per Chat in this iteration. A title-only model winner SHALL be metadata-only. A winning document that cannot be currently authorized/hydrated, belongs to an ineligible mutable message, or matches only across line/message boundaries without an individually matching message-local line SHALL be omitted rather than replaced by projection bytes or a generalized cross-message source. Model shaping MAY therefore return fewer Chats than the unchanged web surface; `limit` remains a maximum rather than a completeness claim.

Vector-only candidate generation and model-result shaping remain #197/#198 work and SHALL NOT acquire an invented public response in this change. Internal source offsets MAY be retained for that future decision.

#### Scenario: Content match returns a highlighted snippet

- **WHEN** a query matches message content in a Chat
- **THEN** the web result carries the existing projection-derived snippet with contributing user/assistant role labels retained
- **AND** the model result uses separately hydrated current canonical-derived excerpt text

#### Scenario: Both surfaces upgrade together

- **WHEN** the web palette and `search_conversations` run the same query for the same owner
- **THEN** both begin from the same shared pre-hydration ranked Chat ordering
- **AND** surface-specific shaping does not duplicate the candidate query

#### Scenario: Canonical model shaping stays disabled during backfill

- **WHEN** current locator coverage is incomplete or `search.chats.canonicalModelExcerpts` is false
- **THEN** web and model search retain their presentation-compatible preview behavior
- **AND** no offsetless/legacy row enters canonical hydration

#### Scenario: Lexical model result carries reusable line coordinates

- **WHEN** a winning current document contains an individually matching canonical message line
- **THEN** the model result identifies that message by `messageSeq` and the merged match-plus-adjacent line window by zero-based `offset` and positive `limit`
- **AND** those fields can be passed directly to `conversation_read`

#### Scenario: Canonical model result retains untrusted framing

- **WHEN** enabled model shaping returns one or more historical excerpts
- **THEN** the success carries the closed untrusted-history notice alongside them
- **AND** persisted/replayed results do not depend only on an ephemeral tool description for that framing

#### Scenario: Oversized passage becomes a bounded excerpt

- **WHEN** the selected complete line window contains more than 500 Unicode code points
- **THEN** search crops the excerpt visibly around a match to at most 500 code points
- **AND** preserves the uncropped window's `offset` and `limit` for exact follow-up reading

#### Scenario: Multiple matching windows choose one deterministic passage

- **WHEN** the winning document contains several non-touching message-local matching windows
- **THEN** the model result returns only the earliest window in canonical sequence/offset order
- **AND** the result does not imply that every matching region in the Chat was returned

#### Scenario: Long merged window stays reader-compatible

- **WHEN** touching matching windows merge into more than 2,000 logical lines
- **THEN** the selector partitions them into deterministic adjacent passages of at most 2,000 lines that each retain a qualifying line
- **AND** returns only the earliest bounded passage with coordinates accepted by `conversation_read`

#### Scenario: Normalized match returns raw source

- **WHEN** NFKC-equivalent, whitespace-collapsed, or case-only text qualifies a canonical line
- **THEN** the matcher uses normalized text and deterministic raw-span mapping only to select/crop the passage
- **AND** the excerpt and later read contain original raw source text rather than normalized replacement text

#### Scenario: Fuzzy match has a fixed crop fallback

- **WHEN** FTS or trigram qualifies a line without an exact normalized query occurrence
- **THEN** excerpt cropping begins at the first code point of the qualifying raw line
- **AND** repeated execution over unchanged input produces identical excerpt bytes and coordinates

#### Scenario: Title-only result has no fabricated source

- **WHEN** a candidate matches only the Chat title
- **THEN** the model result uses `kind: "metadata"` and identifies the Chat/title as metadata-only
- **AND** it carries no arbitrary message excerpt or source coordinates

#### Scenario: Content and metadata results are structurally distinct

- **WHEN** one model response contains content and title-only Chat matches
- **THEN** content entries use `kind: "content"` with all required message/source/excerpt fields
- **AND** metadata entries use `kind: "metadata"` and reject those content-only fields

#### Scenario: Stale candidate never becomes model evidence

- **WHEN** a winning derived document cannot resolve to a currently authorized immutable source
- **THEN** model shaping omits that Chat or returns fewer results
- **AND** it never substitutes projection content as canonical-derived excerpt text

#### Scenario: Cross-message-only match is not forced into one source

- **WHEN** a projection document matches only through terms distributed across lines/messages and no individual canonical message line satisfies the winning predicate
- **THEN** model shaping omits that content result rather than choosing an arbitrary message
- **AND** the unchanged web preview may still return the ranked Chat for navigation

#### Scenario: Vector response is not pre-shaped

- **WHEN** this change runs without #197's future vector candidate path
- **THEN** `search_conversations` exposes no vector-only excerpt, score, or arbitrary source message
- **AND** later vector shaping remains an explicit #197/#198 decision

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
