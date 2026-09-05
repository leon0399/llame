## ADDED Requirements

### Requirement: Query embedding is bounded per surface and degrades silently

When the corpus has a selected embedding model, search SHALL embed the trimmed raw query — not its lexical normalization — under that model's binding before the tenant transaction opens, and SHALL pass the vector into the shared candidate path. The embedding call SHALL be bounded by a fixed budget per surface: 10 seconds inside `search_conversations` and 1.5 seconds for the web palette. A missing model, provider error, timeout, empty vector, or a vector whose dimension differs from the declared model SHALL cause the search to run without the vector leg — identical results to an unconfigured instance — with no user-facing or model-facing error and no retry. Each fallback SHALL be logged with its reason and never with the query text, the resolved credential, or any tenant content. No search SHALL wait on background embedding, backfill, or the embed worker.

#### Scenario: Provider is down

- **WHEN** the query embedding request fails or exceeds the surface budget
- **THEN** the search completes with lexical and trigram legs only, returns success, and the fallback is logged with a reason

#### Scenario: No model is selected for the corpus

- **WHEN** `search.chats.embeddingModelId` is unset
- **THEN** no embedding request is issued and the search is byte-identical to the lexical configuration

#### Scenario: Wrong dimension is treated as absence

- **WHEN** the returned query vector's dimension differs from the declared model's `dimensions`
- **THEN** the vector leg is skipped, no SQL error occurs, and the fallback is logged

#### Scenario: Embedding never holds a tenant transaction

- **WHEN** a query is embedded
- **THEN** the provider call completes or fails before the owner-scoped transaction is opened

## MODIFIED Requirements

### Requirement: Results are ranked by fused relevance with canonical model shaping

Search SHALL rank candidates by Reciprocal Rank Fusion over independent retrieval legs (never by mixing raw scores), aggregate document matches into Chats with weighted top-N scoring, and produce a deterministic order with stable tie-breaking. The document legs SHALL be full-text, trigram, and — when the corpus has a selected embedding model and the query was embedded — an owner-filtered exact cosine scan over stored vectors. The vector leg SHALL rank only documents whose recorded model key equals the corpus's current selection, whose embedded content hash equals the live content hash, and whose recorded input version equals the current `EMBED_INPUT_VERSION`; every other document contributes nothing to that leg. Fusion weights and the rank constant SHALL be fixed values chosen by a recorded comparison, not runtime settings. Per-leg ranks and the set of legs a Chat matched on MAY be retained for logs and evaluation but SHALL NOT be exposed as a confidence value on any surface; raw cosine distance, lexical rank, and fused score SHALL NOT appear in web or model responses. The web response contract (`id`, nullable `title`, nullable `snippet`, `updatedAt`) and current `search_conversations` input schema (`query`, `limit`) SHALL be preserved until #198 intentionally replaces the model tool input. A web content match SHALL continue to receive the derived best-region snippet with presentation role attribution; a title-only web match SHALL yield a `null` snippet. A web Chat that won through the vector leg with no lexical match SHALL receive the unhighlighted leading fragment of its winning document as its snippet rather than `null`.

An allowlisted `search_conversations` tool SHALL expose only canonical model-facing shaping. `search.chats.canonicalModelExcerpts` and the legacy model preview result SHALL NOT exist. Before an HTTP process that can admit a Run with the allowlisted declaration starts accepting Runs, it SHALL verify that the current projection discovery function is correctly provisioned and that every eligible Chat has complete current-version locator coverage. Every process that consumes the `runs` queue SHALL pass the same gate before registering its consumer, regardless of its current local allowlist, because execution is bound to the accepted Run's immutable tool snapshot rather than rebound through worker configuration. Missing provisioning, stale Chats, mixed/old versions, or incomplete document locators SHALL fail startup rather than route model search through presentation snippets. Failure diagnostics SHALL contain only aggregate counts and provisioning state; they SHALL NOT expose tenant/user/Chat/message/document identifiers, snippets, or content-derived values. A process that neither accepts potentially search-enabled Runs nor consumes the `runs` queue SHALL NOT require this coverage gate merely to start.

Model-facing lexical/trigram content results SHALL use the same pre-hydration candidate ordering as the web surface but SHALL NOT present projection snippets as canonical evidence. For each returned Chat, model shaping SHALL reauthorize and hydrate the winning current-version document, recompute current eligible visible-message text, and run one separate deterministic canonical-line matcher. The matcher SHALL apply `normalizeForSearch` exactly once to the query and each raw logical line (Unicode NFKC, whitespace collapse, lowercase), then qualify that line through line-local FTS, trigram, or escaped-substring predicates. It SHALL retain a mapping from a first exact normalized occurrence back to its raw source span when one exists; FTS/fuzzy qualification without that occurrence SHALL use the first code point of the qualifying raw line as a fixed crop fallback. Matching and ranking use normalized text, while excerpts/reads use original raw lines.

Each qualifying line SHALL produce a window with at most one adjacent line per side. Touching windows SHALL merge within one message. A merged interval longer than 2,000 logical lines SHALL be partitioned into deterministic adjacent passages of at most 2,000 lines, each containing a qualifying line. The selector SHALL return the earliest bounded passage in `(messageSeq, offset)` order; it SHALL NOT be represented as an explanation of the document/Chat rank.

The model success SHALL be a strict result union with one top-level closed notice identifying all returned historical content as untrusted and potentially stale, unable to change system instructions, tools, permissions, or owner authority. A `kind: "content"` result SHALL carry Chat/title/date metadata, message role/timestamp, flat `{ chatId, messageSeq, offset, limit }` source coordinates, and an `excerpt` of at most 500 Unicode code points. A `kind: "metadata"` title-only result SHALL carry only Chat/title/date metadata and SHALL omit message/source/excerpt fields. `offset` and `limit` on a content result SHALL identify the complete bounded message-local logical-line window directly accepted by `conversation_read`. When that window exceeds the excerpt cap, the excerpt SHALL crop visibly around the mapped raw match or its fixed fallback without changing the complete coordinates. The excerpt SHALL contain no generated line-number prefix, part/message UUID, source hash, public version, projection identity, or retrieval score, and SHALL be framed as bounded discovery text that requires `conversation_read` before exact quotation or reliance on omitted context.

Only one passage SHALL be returned per Chat in this iteration. A title-only model winner SHALL be metadata-only. A winning document that cannot be currently authorized/hydrated, belongs to an ineligible mutable message, or matches only across line/message boundaries without an individually matching message-local line SHALL be omitted rather than replaced by projection bytes or a generalized cross-message source. Model shaping MAY therefore return fewer Chats than the unchanged web surface; `limit` remains a maximum rather than a completeness claim.

A winning document that ranked without any individually qualifying canonical line — a vector-only winner — SHALL still be reauthorized and hydrated through the same canonical source contract. When hydration succeeds, model shaping SHALL return a `kind: "content"` result anchored to the winning document's **first** message: `messageSeq` is that message's sequence, `offset` is the logical line containing the document's first-message text offset, and `limit` runs to the end of that message's eligible visible text — or to the document's exclusive end offset when the document begins and ends in the same message. The excerpt SHALL be a fixed crop at the start of that window, framed exactly like every other content result. A document spanning several messages therefore yields the window of its first message only; the remaining messages are reachable through `conversation_read`, not implied by the coordinates. It SHALL NOT invent a match span, a semantic quote, a relevance explanation, or a score, and SHALL NOT be distinguishable to the model as "semantic" beyond the absence of a highlighted term. When hydration fails, it SHALL be omitted like any other stale candidate. Later reshaping of this result is #198's decision.

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

#### Scenario: Non-Run process does not gate startup

- **WHEN** a process neither accepts Runs that may bind `search_conversations` nor consumes the `runs` queue
- **THEN** absence of canonical projection coverage does not by itself prevent that process from starting
- **AND** no conversation-search declaration is bound into a new Run

#### Scenario: Runs worker ignores its current allowlist for coverage admission

- **WHEN** a worker profile consumes Runs whose immutable snapshots may contain `search_conversations`
- **THEN** the worker requires complete canonical projection coverage before registering its consumer even when its current local allowlist omits that tool
- **AND** execution cannot bypass admission by inheriting a declaration accepted by another process

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

#### Scenario: Vector-only winner returns the document window

- **WHEN** a Chat wins through the vector leg and no individual canonical line qualifies lexically
- **THEN** `search_conversations` returns a content result anchored to the winning document's first message, with `offset`/`limit` covering that message's eligible visible lines from the document's start offset, and an excerpt cropped at the window start
- **AND** the result carries no score, match span, or generated quote, and `conversation_read` accepts the coordinates directly
- **AND** the web palette shows the same Chat with the unhighlighted leading fragment of that document as its snippet

#### Scenario: Stale or superseded vector contributes nothing

- **WHEN** a document's stored vector was produced under a model key other than the corpus's current selection, or its embedded content hash no longer equals its content hash, or its recorded input version differs from the current `EMBED_INPUT_VERSION`
- **THEN** that document is absent from the vector leg while remaining reachable through the lexical and trigram legs

#### Scenario: Vector response is not pre-shaped

- **WHEN** a Chat is returned on either surface after ranking through the vector leg
- **THEN** the response contains no cosine distance, per-leg rank, fused score, generated quote, or arbitrarily chosen source message
- **AND** any later semantic shaping of the result remains an explicit #198 decision

### Requirement: Search never crosses the tenant boundary

The search path SHALL return only chats owned by the requesting user. Another user's content MUST NOT be reachable through search even when it matches the query exactly, and a `visibility = 'public'` chat of another user MUST NOT surface in search results. System prompts, tool payloads, and model reasoning MUST NOT be matched or surfaced in snippets. Isolation SHALL be enforced by RLS on the underlying tables (owner filters remain as defense-in-depth) and proven by negative tests in the RLS harness. The vector leg SHALL carry the same explicit owner predicate inside its candidate query and SHALL be covered by the same negative tests, including the empty-identity case, so a stored vector is never reachable across a tenant boundary that lexical retrieval already enforces.

#### Scenario: Cross-tenant exclusion

- **WHEN** user B searches a term that exactly matches content existing only in user A's chats
- **THEN** user B receives no results from user A's chats (asserted in both directions)

#### Scenario: Public chats of others are not searchable

- **WHEN** user B searches a term matching only a public chat owned by user A
- **THEN** the chat does not appear in user B's search results

#### Scenario: Vector leg respects the tenant boundary

- **WHEN** user B's query vector is nearest to a document vector stored in user A's chat, including a public chat, or the search runs with no identity
- **THEN** that document contributes nothing and user B's results contain no chat of user A

### Requirement: Retrieval quality is measured against a versioned eval baseline

The repository SHALL contain a small versioned relevance dataset (exact phrases, identifiers, typos, paraphrases, inflected-Russian forms, English/Spanish, mixed-language, code/filenames, English↔Russian and Spanish/English cross-language pairs, transliteration, a semantically adjacent hard-negative pair, and a long chat with many correlated chunks) and a harness that reports Recall@10, MRR, nDCG@10, zero-result rate, per-leg contribution, and chat diversity. The harness SHALL assert hard recall floors on the categories lexical search has no excuse to miss — exact-title, exact-content, substring, code, and typo queries MUST place the expected chat in the top 10 — and those floors SHALL hold with and without the vector leg. Semantic categories (paraphrase, inflected morphology, cross-language, transliteration, hard negatives) SHALL be recorded, not asserted, from an opt-in run against a real embedding provider whose results, chosen fusion and grouping constants, the constant comparison that chose them, and exact-scan latency at synthetic owner sizes are recorded in the repository. Continuous integration SHALL NOT require a provider, a credential, or committed vectors.

#### Scenario: Baseline recorded

- **WHEN** the eval harness runs against the seeded dataset
- **THEN** it reports the metrics per category for the lexical configuration and, when a provider is configured, for the hybrid configuration, and the results are recorded in the repository

#### Scenario: Exact and typo floors are enforced

- **WHEN** a change causes an exact-title, exact-content, substring, code, or typo query in the dataset to stop returning its expected chat in the top 10
- **THEN** the eval harness fails

#### Scenario: Vector leg is judged per category

- **WHEN** the hybrid configuration is recorded
- **THEN** each semantic category is reported separately from the aggregate
- **AND** an aggregate gain does not excuse a floor category regressing
