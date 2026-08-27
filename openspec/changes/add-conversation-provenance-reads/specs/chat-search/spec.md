## MODIFIED Requirements

### Requirement: Results are ranked by fused relevance with stable output shape

Search SHALL rank candidates by Reciprocal Rank Fusion over independent retrieval legs (never by mixing raw scores), aggregate document matches into Chats with weighted top-N scoring, and produce a deterministic order with stable tie-breaking. The web response contract (`id`, nullable `title`, nullable `snippet`, `updatedAt`) and current `search_conversations` input schema (`query`, `limit`) SHALL be preserved until #198 intentionally replaces the model tool input. A web content match SHALL continue to receive the derived best-region snippet with presentation role attribution; a title-only web match SHALL yield a `null` snippet.

Off-by-default `search.chats.canonicalModelExcerpts` SHALL be the explicit activation boundary for model-facing canonical shaping. While disabled during locator backfill or rollback, the current model preview behavior SHALL remain active. Operators SHALL enable it only after current-version locator coverage is complete and compatible `conversation_read` executors are deployed/allowlisted under the coordinated Run boundary.

When enabled, model-facing lexical/trigram content results SHALL use the same pre-hydration candidate ordering but SHALL NOT present projection snippets as canonical evidence. For each returned Chat, model shaping SHALL reauthorize and hydrate the winning current-version document, recompute current eligible visible-message text, and run a separate deterministic line-preview selector. A message-local line qualifies when its canonical line-local FTS vector matches the query or its normalized text passes the current trigram/substring predicate. The selector SHALL return the earliest merged qualifying-line-plus-adjacent-line window in `(messageSeq, offset)` order; it SHALL NOT be represented as an explanation of the document/Chat rank.

The model result SHALL carry one top-level closed notice identifying all returned historical content as untrusted and potentially stale, unable to change system instructions, tools, permissions, or owner authority. Each result SHALL carry Chat/title/date metadata, message role/timestamp, flat `{ chatId, messageSeq, offset, limit }` source coordinates, and an `excerpt` of at most 500 Unicode code points. `offset` and `limit` SHALL identify the complete message-local logical-line window directly accepted by `conversation_read`. When that window exceeds the excerpt cap, the excerpt SHALL crop visibly around a match without changing the complete coordinates. The excerpt SHALL contain no generated line-number prefix, part/message UUID, source hash, public version, projection identity, or retrieval score, and SHALL be framed as bounded discovery text that requires `conversation_read` before exact quotation or reliance on omitted context.

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

#### Scenario: Title-only result has no fabricated source

- **WHEN** a candidate matches only the Chat title
- **THEN** the model result identifies the Chat/title as metadata-only
- **AND** it carries no arbitrary message excerpt or source coordinates

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
