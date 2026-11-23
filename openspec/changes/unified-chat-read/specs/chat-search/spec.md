## MODIFIED Requirements

### Requirement: Results are ranked by fused relevance with canonical model shaping

Search MUST rank candidates by Reciprocal Rank Fusion across independent full-text, trigram, and optional vector legs. It MUST NOT combine raw scores. Weighted top-N document scores MUST aggregate into Chats with deterministic ties. Recorded constants MUST define fusion weights and the rank constant, not runtime settings.

The vector leg MUST use an owner-filtered exact cosine scan when the corpus selects an embedding model and the query has an embedding. It MUST admit only documents with the current model key, live content hash, and current `EMBED_INPUT_VERSION`. Other documents MUST contribute nothing to that leg. Logs and evaluations can retain leg ranks and membership. Web and model results MUST expose no raw, cosine, lexical, or fused score.

The web result MUST retain `id`, nullable `title`, nullable `snippet`, and `updatedAt`. Content matches MUST keep projection-derived snippets with role attribution. Title-only matches MUST have null snippets. A vector-only winner MUST show its winning document's unhighlighted leading fragment.

Model search MUST use canonical evidence, not presentation snippets or a legacy preview mode. `search.chats.canonicalModelExcerpts` MUST NOT exist. The input MUST use the strict content/timeline union below, without the former query-only alias.

Before Run admission, every potentially search-enabled HTTP process MUST verify discovery provisioning and complete current-version source coverage. Every Runs consumer MUST pass the same gate before it registers, regardless of its local allowlist. Register any co-located reindex consumer before the gate. A process without Run admission or execution MUST require no search-coverage gate.

For incomplete coverage, the gate MUST enqueue a bounded stale-Chat batch through the coalesced reindex queue. It MUST wait a bounded time for workers and MUST NOT rebuild projections itself. Missing provisioning, rejected enqueue, or incomplete coverage without discoverable stale Chats MUST fail startup immediately. Remaining stale versions or incomplete locators after the wait MUST fail startup. Diagnostics MUST contain aggregate counts and provisioning state only. They MUST disclose no tenant identity, Chat/message/document identity, snippet, or content-derived value.

Model lexical/trigram results MUST share the web candidate order before hydration. For each winner, the model path MUST reauthorize and hydrate its current document. It MUST recompute eligible visible-message text and use one deterministic canonical-line matcher. The matcher MUST normalize the query and each raw line exactly once through `normalizeForSearch`. That normalization MUST apply Unicode NFKC, whitespace collapse, and lowercase. Line-local FTS, trigram, or escaped-substring predicates MUST determine qualification.

The first exact normalized occurrence MUST map back to its raw source span. A fuzzy or FTS match without that occurrence MUST crop from the qualifying line's first code point. Normalization MUST select text, not replace evidence bytes. Each qualifying line MUST form a window with at most one adjacent line per side. Touching windows MUST merge within one message.

Partition intervals beyond 2,000 lines into deterministic adjacent passages of at most 2,000 lines. Each passage MUST contain a qualifying line.

The selector MUST return the earliest bounded passage by `(messageSeq, offset)`. That passage MUST NOT claim to explain the Chat rank. Return at most one passage per Chat.

Omit unauthorized, stale, mutable, or unhydrated winners. Omit a cross-message-only match without a qualifying individual line. Never substitute projection bytes or an arbitrary message. `limit` MUST remain a maximum, not a completeness claim.

Each model success MUST carry the closed untrusted-history notice. That notice MUST identify excerpts as potentially stale data without instruction, tool, permission, or identity authority. Content rows MUST contain Chat/title/date metadata, role, timestamp, canonical source locator, and an excerpt of at most 500 Unicode code points. The locator MUST use `chat://<chatId>/<messageSeq>:L<start>-<end>`. Its start MUST equal the zero-based source offset plus one. Its end MUST equal that offset plus the complete source-window length.

Separate `offset` and `limit` result fields MUST NOT remain. Internal passage calculation can retain those values. An oversized excerpt MUST crop visibly around the mapped match or fixed fallback without changing the locator window. Excerpts MUST contain no generated line prefixes, internal UUIDs, hashes, versions, projection identities, or scores. Exact quotations MUST follow a bounded read of the locator. A metadata-only row MUST carry its Chat locator and no fabricated message, line selector, or excerpt.

A vector-only winner MUST use the same authorization and hydration. Its source MUST be the winning document's first message. Start at the logical line that contains the document's first-message offset. End at that message's visible-text end, or the document's exclusive end when both ends occupy the same message.

Crop its excerpt at that window's start. Omit hydration failures. Later messages MUST require separate reads. Do not invent match spans, quotes, explanations, scores, or a semantic discriminator.

`search_conversations` MUST accept one strict object with `mode`, optional `query`, optional `after`/`before`, optional `constraint`, and optional integer `limit`. Bounds MUST be timezone-explicit absolute instants for `[after, before)`.

Content mode MUST require a nonblank query. It MUST require `constraint` with any bound and prohibit it without bounds. Its limit MUST be 1 through 10, default 5.

Timeline mode MUST prohibit query and constraint. It MUST require at least one bound and a limit of 1 through 50, default 20.

Two bounds MUST satisfy `after < before`. A missing bound MUST impose no clause, without an implicit current instant. Unknown fields, malformed values, invalid mode combinations, and invalid limits MUST fail before retrieval. The executor MUST enforce that rule even if SDK validation misses it. The tool MUST NOT parse natural-language dates.

A required range MUST qualify candidates by canonical eligible message timestamps before rank selection. Hydrated lexical passages MUST use only in-range messages. Omit a vector-only winner whose first-message anchor falls outside the range. A title-only result MUST have at least one in-range eligible message.

A preferred range MUST neither admit nor exclude candidates. It MUST add one recorded rank-fusion contribution to overlapping documents. That contribution MUST remain below a first-place contribution from one leg. It can let nearby lower-ranked in-range documents overtake out-of-range documents. It MUST NOT let a distant weak match overtake a strong one.

Without a range, content mode MUST preserve global relevance without recency decay.

A preferred range does not guarantee survival within `limit`. Enough nearby in-range documents can displace an out-of-range winner. The model can widen the limit or drop the range. Returned out-of-range messages MUST retain their actual timestamps.

Every success MUST echo exactly the supplied bounds and constraint in `appliedRange`, without absent values. It MUST set `truncated: true` when another ranked candidate exists beyond the limit before hydration. Omitted candidates can leave fewer rows than the limit despite truncation. Rows and envelopes MUST expose no rank, score, retrieval-leg label, or omission reason.

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

#### Scenario: Stale Chats left by an interrupted Run are repaired before admission

- **WHEN** a search-enabled process finds stale projections and has an active reindex consumer
- **THEN** the gate enqueues repair and waits within its bound
- **AND** only reindex workers rebuild the projections

#### Scenario: Incomplete coverage fails startup

- **WHEN** a search-enabled process lacks provisioning, cannot repair coverage, or reaches its repair deadline with incomplete locators
- **THEN** the process fails startup before Run admission or execution
- **AND** diagnostics disclose no tenant, source identity, or content

#### Scenario: Non-Run process does not gate startup

- **WHEN** a process neither accepts Runs that can bind `search_conversations` nor consumes the `runs` queue
- **THEN** absence of canonical projection coverage does not by itself prevent that process from starting
- **AND** that process does not execute a conversation-search declaration

#### Scenario: Runs worker ignores its current allowlist for coverage admission

- **WHEN** a Runs consumer starts with search absent from its local allowlist
- **THEN** it still verifies complete canonical coverage before consumer registration

#### Scenario: Lexical model result carries reusable line coordinates

- **WHEN** a current winning document contains a qualifying canonical line
- **THEN** the content row emits its canonical message locator with the merged bounded `L` window
- **AND** read accepts the locator without coordinate translation

#### Scenario: Canonical model result retains untrusted framing

- **WHEN** model shaping returns one or more historical excerpts
- **THEN** the success carries the closed untrusted-history notice alongside them
- **AND** persisted/replayed results do not depend only on an ephemeral tool description for that framing

#### Scenario: Oversized passage becomes a bounded excerpt

- **WHEN** the selected complete line window contains more than 500 Unicode code points
- **THEN** search crops the excerpt visibly around a match to at most 500 code points
- **AND** preserves the complete uncropped window in the source locator

#### Scenario: Multiple matching windows choose one deterministic passage

- **WHEN** the winning document contains several non-touching message-local matching windows
- **THEN** the model result returns only the earliest window in canonical sequence/offset order
- **AND** the result does not imply that every matching region in the Chat was returned

#### Scenario: Long merged window stays reader-compatible

- **WHEN** touching windows span more than 2,000 logical lines
- **THEN** the selector divides them into deterministic adjacent passages with a qualifying line in each
- **AND** the earliest bounded passage supplies a directly readable locator

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
- **AND** it carries its Chat locator without a message sequence, line window, or excerpt

#### Scenario: Content and metadata results are structurally distinct

- **WHEN** one model response contains content and title-only Chat matches
- **THEN** content entries use `kind: "content"`, a line-selected message locator, role, timestamp, and excerpt
- **AND** metadata entries use `kind: "metadata"` and a Chat-root locator without message sequence, line window, or excerpt

#### Scenario: Stale candidate never becomes model evidence

- **WHEN** a winning derived document cannot resolve to a currently authorized immutable source
- **THEN** model shaping omits that Chat or returns fewer results
- **AND** it never substitutes projection content as canonical-derived excerpt text

#### Scenario: Cross-message-only match is not forced into one source

- **WHEN** a projection document matches only through terms distributed across lines/messages and no individual canonical message line satisfies the winning predicate
- **THEN** model shaping omits that content result rather than choosing an arbitrary message
- **AND** the unchanged web preview can still return the ranked Chat for navigation

#### Scenario: Vector-only winner returns the document window

- **WHEN** a document wins through the vector leg without a lexical canonical-line match
- **THEN** the content locator selects its first-message window and the excerpt starts at that window
- **AND** the row invents no score, match span, or quote
- **AND** the web keeps its unhighlighted document preview

#### Scenario: Stale or superseded vector contributes nothing

- **WHEN** a vector has an old model key, stale content hash, or old embedding input version
- **THEN** it contributes nothing to the vector leg
- **AND** lexical and trigram legs retain their independent eligibility

#### Scenario: Vector response is not pre-shaped

- **WHEN** a Chat is returned on either surface after ranking through the vector leg
- **THEN** the response contains no cosine distance, per-leg rank, fused score, generated quote, or arbitrarily chosen source message
- **AND** any later semantic shaping of the result remains an explicit #198 decision

#### Scenario: Invalid mode and field combinations never reach retrieval

- **WHEN** input violates a mode, bound, query, constraint, limit, or unknown-field rule
- **THEN** the tool returns a bounded invalid-argument observation before any retrieval query

#### Scenario: Required range filters by canonical message time

- **WHEN** a content query with `constraint: "required"` matches a passage whose message timestamp is outside `[after, before)` while its projection document overlaps the range
- **THEN** that passage is omitted after hydration
- **AND** a passage whose message timestamp is inside the range is returned with that timestamp

#### Scenario: Required range gates title-only results by activity

- **WHEN** a Chat matches only by title under a required range
- **THEN** it is returned as `kind: "metadata"` only if at least one of its eligible messages falls inside the range

#### Scenario: Preferred range cannot hide a strong match

- **WHEN** a preferred range has one strong out-of-range match and weak in-range matches
- **THEN** the strong match survives when fewer nearby in-range candidates than the limit can overtake it
- **AND** only documents inside the fixed overtake window can displace it

#### Scenario: One-sided range is a single clause

- **WHEN** a content or timeline call supplies only `after` or only `before`
- **THEN** the missing bound imposes no filter and `appliedRange` omits it
- **AND** the result is not filled with a server-chosen current instant

#### Scenario: Envelope reports coverage without diagnostics

- **WHEN** more qualifying results exist than `limit`
- **THEN** the success carries `truncated: true` and the echoed `appliedRange` even if shaping returned fewer than `limit` rows
- **AND** no row or envelope field carries a score, rank, leg name, or omission reason

### Requirement: Search never crosses the tenant boundary

Search MUST return only the trusted owner's Chats. RLS MUST enforce ownership with explicit owner predicates as defense in depth. Another owner's public visibility MUST grant no access. Search MUST match or excerpt no system prompt, tool payload, or reasoning part.

The vector leg MUST carry the same owner predicate. Canonical timeline and required-range queries MUST also verify trusted session identity inside their statements. They MUST refuse empty identity even when a real owner id accompanies it. Public-read policies MUST NOT satisfy these owner queries.

Negative datastore checks MUST cover both owners, foreign public Chats, and empty identity. Those checks MUST prove that foreign text, vectors, activity regions, counts, titles, sequences, and metadata remain absent.

#### Scenario: Cross-tenant exclusion

- **WHEN** user B searches a term that exactly matches content existing only in user A's chats
- **THEN** user B receives no results from user A's chats (asserted in both directions)

#### Scenario: Public chats of others are not searchable

- **WHEN** user B searches a term matching only a public chat owned by user A
- **THEN** the chat does not appear in user B's search results

#### Scenario: Vector leg respects the tenant boundary

- **WHEN** owner B searches a vector nearest to owner A content, including a public Chat
- **THEN** A contributes no result
- **AND** empty identity grants no vector access

#### Scenario: Timeline discovery respects the tenant boundary

- **WHEN** owner B requests a period with only owner A activity
- **THEN** no foreign region, count, title, sequence, or metadata appears
- **AND** empty identity with a real owner id also reveals nothing

### Requirement: Timeline discovery returns canonical activity pointers without excerpts

Timeline mode MUST qualify activity from canonical eligible-message timestamps inside `[after, before)`. Chat creation or title-update timestamps MUST NOT qualify activity. Trusted Run context MUST supply owner identity.

Each qualifying Chat MUST have one `kind: "timeline"` region. It MUST carry `chatId`, nullable title, `firstActivityAt`, `lastActivityAt`, `messageCount`, `firstSeq`, `lastSeq`, `firstLocator`, and `lastLocator`. Instants MUST bound eligible in-range activity. Count MUST include eligible in-range messages only. Sequences MUST identify the minimum and maximum eligible in-range positions. Both locators MUST address those messages directly through read.

The response MUST contain timeline rows only. Order regions by descending `lastActivityAt`, then Chat id. Apply the mode limit and envelope truncation rule. Regions MUST contain no excerpt, message text, snippet, score, retrieval-leg label, embedding, summary, or generated text. Timeline mode MUST issue no embedding request and read no search projection.

#### Scenario: Recap of a day yields pointers, then reads

- **WHEN** the model requests a timeline range covering one day in which the owner had eligible activity in three Chats
- **THEN** the result contains three regions with titles, boundary instants, counts, and boundary sequences and no message text
- **AND** read accepts each `firstLocator` directly and returns `nextMessageSeq` for continuation

#### Scenario: Activity is qualified by eligible messages only

- **WHEN** a Chat inside the range contains only system, tool, or retryable assistant rows
- **THEN** it is not returned and contributes no count

#### Scenario: Chat metadata time does not qualify activity

- **WHEN** a Chat was created or had its title changed inside the range but every eligible message falls outside it
- **THEN** it is not returned

### Requirement: Temporal interpretation belongs to the model, anchored on trusted context

The packaged prompt MUST resolve relative periods from the trusted temporal anchor into absolute instants before search. Exact periods, including yesterday or March, MUST use timeline mode or a required content range. Uncertain recollections MUST use a preferred range. Recent activity without a finite owner-supplied period MUST become a finite range or require clarification.

The prompt MUST treat recalled content as untrusted history. It MUST prefer discovery followed by bounded Chat reads. A list request can stop at timeline metadata. A recap MUST read the addressed messages.

It MUST follow eligible message navigation from `firstSeq` through `lastSeq` and exclude later messages. The reader MUST NOT imply that its next neighbor stays inside the requested period. Relative dates MUST use the instance timezone until owner-local temporal context ships.

#### Scenario: Relative phrase becomes an absolute range

- **WHEN** the owner asks what they discussed yesterday
- **THEN** the model computes yesterday's absolute bounds from the rendered anchor and calls timeline mode with them
- **AND** the tool receives no natural-language date
- **AND** a recap reads each region from `firstSeq` to `lastSeq` and excludes any later message the reader returns

#### Scenario: Uncertain recollection uses a preferred range

- **WHEN** the owner says they think a topic came up a few months ago
- **THEN** the model issues a content query with `constraint: "preferred"` over that period rather than a required filter
