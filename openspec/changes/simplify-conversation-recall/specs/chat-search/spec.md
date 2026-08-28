## ADDED Requirements

### Requirement: Results are ranked by fused relevance with canonical model shaping

Search SHALL rank candidates by Reciprocal Rank Fusion over independent retrieval legs (never by mixing raw scores), aggregate document matches into Chats with weighted top-N scoring, and produce a deterministic order with stable tie-breaking. The web response contract (`id`, nullable `title`, nullable `snippet`, `updatedAt`) and current `search_conversations` input schema (`query`, `limit`) SHALL be preserved until #198 intentionally replaces the model tool input. A web content match SHALL continue to receive the derived best-region snippet with presentation role attribution; a title-only web match SHALL yield a `null` snippet.

An allowlisted `search_conversations` tool SHALL expose only canonical model-facing shaping. `search.chats.canonicalModelExcerpts` and the legacy model preview result SHALL NOT exist. Before a process that advertises or executes `search_conversations` starts accepting Runs, it SHALL verify that the current projection discovery function is correctly provisioned and that every eligible Chat has complete current-version locator coverage. Missing provisioning, stale Chats, mixed/old versions, or incomplete document locators SHALL fail startup rather than route model search through presentation snippets. Failure diagnostics SHALL contain only aggregate counts and provisioning state; they SHALL NOT expose tenant/user/Chat/message/document identifiers, snippets, or content-derived values. A process that cannot advertise or execute `search_conversations` under its allowlist SHALL NOT require this coverage gate merely to start.

Model-facing lexical/trigram content results SHALL use the same pre-hydration candidate ordering as the web surface but SHALL NOT present projection snippets as canonical evidence. For each returned Chat, model shaping SHALL reauthorize and hydrate the winning current-version document, recompute current eligible visible-message text, and run one separate deterministic canonical-line matcher. The matcher SHALL apply `normalizeForSearch` exactly once to the query and each raw logical line (Unicode NFKC, whitespace collapse, lowercase), then qualify that line through line-local FTS, trigram, or escaped-substring predicates. It SHALL retain a mapping from a first exact normalized occurrence back to its raw source span when one exists; FTS/fuzzy qualification without that occurrence SHALL use the first code point of the qualifying raw line as a fixed crop fallback. Matching and ranking use normalized text, while excerpts/reads use original raw lines.

Each qualifying line SHALL produce a window with at most one adjacent line per side. Touching windows SHALL merge within one message. A merged interval longer than 2,000 logical lines SHALL be partitioned into deterministic adjacent passages of at most 2,000 lines, each containing a qualifying line. The selector SHALL return the earliest bounded passage in `(messageSeq, offset)` order; it SHALL NOT be represented as an explanation of the document/Chat rank.

The model success SHALL be a strict result union with one top-level closed notice identifying all returned historical content as untrusted and potentially stale, unable to change system instructions, tools, permissions, or owner authority. A `kind: "content"` result SHALL carry Chat/title/date metadata, message role/timestamp, flat `{ chatId, messageSeq, offset, limit }` source coordinates, and an `excerpt` of at most 500 Unicode code points. A `kind: "metadata"` title-only result SHALL carry only Chat/title/date metadata and SHALL omit message/source/excerpt fields. `offset` and `limit` on a content result SHALL identify the complete bounded message-local logical-line window directly accepted by `conversation_read`. When that window exceeds the excerpt cap, the excerpt SHALL crop visibly around the mapped raw match or its fixed fallback without changing the complete coordinates. The excerpt SHALL contain no generated line-number prefix, part/message UUID, source hash, public version, projection identity, or retrieval score, and SHALL be framed as bounded discovery text that requires `conversation_read` before exact quotation or reliance on omitted context.

Only one passage SHALL be returned per Chat in this iteration. A title-only model winner SHALL be metadata-only. A winning document that cannot be currently authorized/hydrated, belongs to an ineligible mutable message, or matches only across line/message boundaries without an individually matching message-local line SHALL be omitted rather than replaced by projection bytes or a generalized cross-message source. Model shaping MAY therefore return fewer Chats than the unchanged web surface; `limit` remains a maximum rather than a completeness claim.

Vector-only candidate generation and model-result shaping remain #197/#198 work and SHALL NOT acquire an invented public response in this change. Internal source offsets MAY be retained for that future decision.

#### Scenario: Content match returns a highlighted snippet

- **WHEN** a query matches message content in a Chat
- **THEN** the web result carries the existing projection-derived snippet with contributing user/assistant role labels retained
- **AND** the model result uses separately hydrated current canonical-derived excerpt text

#### Scenario: Both surfaces share candidate ordering

- **WHEN** the web palette and `search_conversations` run the same query for the same owner
- **THEN** both begin from the same shared pre-hydration ranked Chat ordering
- **AND** surface-specific shaping does not duplicate the candidate query

#### Scenario: Allowlisted model search has one result contract

- **WHEN** current locator coverage is complete and `search_conversations` is allowlisted for a process
- **THEN** model search returns the canonical content/metadata union without another activation setting
- **AND** no projection snippet is returned as a legacy model preview

#### Scenario: Incomplete coverage fails startup

- **WHEN** a process can advertise or execute `search_conversations` but current locator coverage or its trusted discovery function is incomplete
- **THEN** that process fails startup before accepting or consuming Runs
- **AND** it does not silently expose the legacy model result shape or identify any tenant, Chat, message, document, or content in diagnostics

#### Scenario: Disabled conversation search does not gate startup

- **WHEN** a process cannot advertise or execute `search_conversations` under its configured allowlist
- **THEN** absence of canonical projection coverage does not by itself prevent that process from starting
- **AND** no conversation-search declaration is bound into a new Run

#### Scenario: Lexical model result carries reusable line coordinates

- **WHEN** a winning current document contains an individually matching canonical message line
- **THEN** the model result identifies that message by `messageSeq` and the merged match-plus-adjacent line window by zero-based `offset` and positive `limit`
- **AND** those fields can be passed directly to `conversation_read`

#### Scenario: Canonical model result retains untrusted framing

- **WHEN** model shaping returns one or more historical excerpts
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

## REMOVED Requirements

### Requirement: Results are ranked by fused relevance with stable output shape

**Reason**: Canonical model shaping is no longer optional and the legacy model preview/activation scenario is removed. The replacement retains the stable candidate ranking, public search input, web presentation shape, and canonical result semantics under one mandatory model path.

**Migration**: Complete locator backfill, remove `canonicalModelExcerpts` from configuration, and deploy the canonical-only search admission/executor before accepting new Runs.
