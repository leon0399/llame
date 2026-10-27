# search-projection

## Purpose

The **search projection** is a derived, fully rebuildable lexical index over a user's chats: contextual multi-message **chunks** (produced by a deterministic, versioned, content-hashed chunker over the text parts of user/assistant turns only) that back the `chat-search` retrieval path without scanning `messages` at query time. This capability covers the projection's shape and invariants — deterministic chunking, the exclusion of system/tool/reasoning content (the episodic-vs-knowledge corpus boundary), datastore-enforced tenant isolation (RLS `ENABLE`+`FORCE`, no public-read), synchronous-on-turn-completion indexing with an asynchronous fallback + coalescing, a producer/consumer reindex model with cross-tenant discovery backfill, fail-loud provisioning of that discovery path, deletion propagation, and the `pg_trgm` platform dependency. The canonical `chats`/`messages` tables remain the single source of truth; the projection is derived from them and rebuildable at any time.

## Requirements

### Requirement: Search reads from a derived, rebuildable projection

Search SHALL execute against a derived projection (`search_chat_documents`) of contextual multi-message chunks, not by scanning `messages` at query time. The canonical `chats`/`messages` tables SHALL remain the single source of truth and SHALL NOT be modified by this capability; the projection MUST be fully rebuildable from them at any time.

#### Scenario: Full rebuild reproduces the projection

- **WHEN** the projection is emptied and the backfill/discovery mechanism runs to completion
- **THEN** the projection is reconstructed from canonical tables and search results are equivalent to before

### Requirement: Chunking is deterministic, versioned, and content-hashed

Chunks SHALL be produced by a deterministic, versioned chunker over the stable visible-message text contract: contextual multi-message windows with a bounded character budget and adjacent-message overlap, carrying presentation role markers, covered first/last message UUIDs and timestamps, and the minimum internal boundary coordinates required to reconstruct the exact canonical source interval. Those coordinates SHALL be a zero-based UTF-16 start offset in the first message's visible-text view and a zero-based exclusive UTF-16 end offset in the last message's view. Intermediate covered messages are complete. The projection SHALL NOT persist a second whole-message visible-text copy, public message sequence locator, JSON part identity, model-facing line ranges, or a generic provenance map.

Windows SHALL split on message boundaries except where one message alone exceeds the budget, in which case that message SHALL be divided into budget-sized blocks at text boundaries so no message contributes more than the budget to one new block. A packed document MAY still exceed the budget because one overlap block from the preceding chunk accompanies a full new block; the document bound SHALL be asserted by test. Each oversized assistant continuation after the first SHALL retain the existing bounded preceding-user anchor in presentation content when available, but that synthetic anchor SHALL remain outside the lexical and canonical source intervals. A split user message and a message without a preceding user message carry no anchor. A fitting message SHALL retain the established representation for equivalent visible input.

Each chunk SHALL store role-labelled original-cased presentation `content` for web snippets and embedding input, plus a role-free normalized lexical representation for matching. The internal content hash SHALL cover both representations, chunker version, stable visible-text semantics, covered message UUIDs, and source boundary offsets. Re-running the chunker over unchanged eligible input MUST produce byte-identical chunks and a no-op upsert. Changing visible-text serialization, either representation algorithm, locator semantics, budget, splitting, or anchoring SHALL require a chunker-version bump; documents of different versions SHALL NOT mix within one Chat's live projection.

#### Scenario: Unchanged chat is a no-op

- **WHEN** a reindex runs for a Chat whose eligible visible messages and chunking contract have not changed
- **THEN** no projection rows are written because internal hashes and source locators match

#### Scenario: Edited assistant reply rebuilds affected chunks

- **WHEN** an assistant row indexed by the legacy contract changes before immutable-evidence enforcement removes or finalizes it
- **THEN** the next reindex replaces every covering chunk and removes obsolete chunks
- **AND** the current immutable-evidence predicate determines whether its bytes remain eligible

#### Scenario: Representation version change rebuilds existing chunks

- **WHEN** visible-message serialization or locator semantics change
- **THEN** the chunker version changes and every affected projection row is rebuilt
- **AND** prior offsets are not interpreted under the new chunker contract

#### Scenario: A single oversized message is split rather than emitted whole

- **WHEN** one eligible visible message is several times larger than the chunk budget
- **THEN** it is divided into multiple source-addressable documents whose internal source intervals together cover the message without discarding visible text

#### Scenario: A continuation part carries the question it answers

- **WHEN** an oversized assistant visible message is divided into continuation documents
- **THEN** every continuation after the first retains the bounded preceding-user anchor in presentation content when available
- **AND** that anchor remains outside lexical and canonical source bytes

#### Scenario: Messages within budget chunk exactly as before

- **WHEN** every eligible message fits the budget and the same chunker version runs again
- **THEN** it produces byte-identical chunks, hashes, and source locators for the same visible input

#### Scenario: Oversized message has precise internal boundaries

- **WHEN** one visible message is divided among several search documents
- **THEN** every document carries that message UUID plus its own internal start/exclusive-end visible-text offsets
- **AND** synthetic continuation anchors lie outside those offsets

#### Scenario: Multi-message document uses endpoint offsets

- **WHEN** one document covers a partial first message, complete intermediate messages, and a partial last message
- **THEN** its internal locator identifies only the first-message start and last-message exclusive-end offsets plus existing boundary UUIDs
- **AND** no per-part or per-line provenance array is stored

#### Scenario: Internal hash and UUID remain non-public

- **WHEN** the projection stores message UUIDs and a content hash for joins, rebuilds, and embedding validity
- **THEN** newly shaped model search/read results expose public Chat/sequence/line coordinates instead
- **AND** neither internal identity is represented as source authority

### Requirement: Only user-visible conversation text is indexed

The chunker MUST serialize only stable visible message text from human-authored `user` turns and
from immutable eligible `assistant` turns. It MUST exclude a retryable assistant row, whose
persisted content can still change in place. The exclusion stays until that row becomes immutable
under the completed or legacy-immutable classification of the application. It MUST also exclude a revised
assistant row, which a Regenerate from `turn-actions` replaced after it was `completed`, for good.
These items MUST NOT enter `search_chat_documents` in any form: system prompts, effective-context
receipts, model-context parts, and generated model-switch reminders. The same applies to
`checkpoint` rows, the persisted checkpoint text and its raw summary, and tool-role messages. It
also applies to tool invocation payloads and results, model reasoning parts, cap notices, and
attachments.

Original immutable user and assistant messages that a checkpoint superseded in model context MUST
stay canonical and searchable. Role labels and anchors of oversized messages that the system adds
only for presentation context MUST appear only in the original-cased projection content. They MUST
NOT enter normalized lexical content, internal canonical source intervals, or generated FTS
vectors. Normalization MUST keep accents, code, identifiers, and URLs. It applies the current
Unicode NFKC, whitespace-collapse, and lowercase rules to the lexical column only.

#### Scenario: Retryable assistant content is absent

- **WHEN** an assistant row has a recorded usage status other than `completed`
- **THEN** no live projection document contains its visible text
- **AND** the system cannot return it as stable episodic evidence

#### Scenario: Completed retry becomes searchable

- **WHEN** a retry finalizes the assistant row into the immutable `completed` state of the application, and reindex runs
- **THEN** its current visible text enters the projection with internal source-addressable boundaries
- **AND** no earlier retryable bytes stay indexed

#### Scenario: Tool and reasoning content is absent from the projection

- **WHEN** the system indexes a Chat that contains tool calls and reasoning parts
- **THEN** no projection row contains that content, and no search query can match or excerpt it

#### Scenario: Model context is absent from the projection

- **WHEN** a Chat contains a model-switch part and its effective-context receipt
- **THEN** no projection row contains model IDs, reminder prose, system prompt contents, prompt metadata, or advertised tool schemas from those parts

#### Scenario: Compaction checkpoint is absent from the projection

- **WHEN** a `checkpoint` row and its raw summary stand in model context for immutable original user and assistant messages
- **THEN** no projection row contains the persisted checkpoint text or that raw summary
- **AND** the immutable original visible text stays searchable and sequence-addressable

#### Scenario: Synthetic role labels are absent from lexical data

- **WHEN** projection content adds role labels or a continuation anchor
- **THEN** neither adds lexical terms or bytes to the canonical source interval
- **AND** canonical model shaping derives its excerpt from the current visible message source text

#### Scenario: A revised reply leaves the projection

- **WHEN** a Regenerate replaces a `completed` reply, the Regenerate Run completes, and reindex runs
- **THEN** no projection row contains the old text or the new text of that reply

### Requirement: Projection tables enforce tenant isolation at the datastore

`search_chat_documents` (and any projection state table) SHALL carry a denormalized `owner_user_id` (`text`, matching `users.id`), with RLS `ENABLE` and `FORCE` and an owner policy over `current_setting('app.current_user_id', true)`. There SHALL be **no** public-read policy on projection tables: `visibility = 'public'` chats are readable via the sharing path but their projection rows MUST NOT be readable by any other identity, including the empty (public) identity. Query-time candidate queries SHALL additionally carry the owner filter as defense-in-depth. Cross-tenant and public-chat negative tests SHALL run in the RLS harness.

#### Scenario: FORCE RLS holds against the table owner

- **WHEN** the RLS harness queries projection tables as the owning role with another user's identity set (and with the empty identity)
- **THEN** no cross-tenant row and no public chat's row is readable

### Requirement: Lexical indexing is synchronous on turn completion, with async fallback and coalescing

Turn completion is assistant finalization, also after any regenerate. It MUST rebuild the lexical
projection of the whole Chat **synchronously, after the user-facing write commits, inside the
tenant scope of the Chat owner**. Thus the content of the turn that the chunker keeps is
searchable as soon as finalization completes. This content is the user message and the assistant
reply together, except a revised reply that the chunker excludes. The rebuild needs no BYPASSRLS
and no background worker. This is the only inline indexing site. The system does not rebuild
inline for a user message persisted before its turn finalizes, because finalization covers it
soon after. A fork enqueues its own content asynchronously and does not rebuild inline. The
synchronous rebuild MUST NOT run inside the user-facing write transaction and MUST NOT fail the
user-facing write. On any failure it MUST fall back to an asynchronous per-Chat reindex job, so the
update is not lost. Each rebuild MUST be an idempotent reconstruction from canonical `messages`. It
MUST run under **REPEATABLE READ**, so the message read and the `indexed_at` watermark share one
snapshot. Thus a plain message write during a rebuild is fully indexed or fully excluded. It is
never chunked out but stamped into the watermark. An excluded write leaves `chats.updated_at` ahead
of `indexed_at`, so discovery flags the Chat again. A rebuild can lose a write race with a
concurrent rebuild of the same Chat, as a serialization failure under REPEATABLE READ. The system
MUST then retry it; the rebuild is idempotent, so the fresh snapshot of the retry converges.
`search_chat_state.indexed_at` MUST only advance (`GREATEST(existing, excluded)`). The asynchronous
paths are the Tier-1 fallback, fork, the discovery sweep, and phase-2 embedding work. The system
MUST coalesce them, so at most one job is pending and one runs for each Chat (pg-boss queue policy
`'stately'` and `singletonKey = chat_id`).

#### Scenario: Fresh turn is searchable synchronously

- **WHEN** a user's message gets an answer, and the assistant's reply finalizes with a distinctive term
- **THEN** the term is searchable directly when that request completes, before any background job runs

#### Scenario: Synchronous rebuild failure falls back to the queue

- **WHEN** the synchronous rebuild fails after the user-facing write committed
- **THEN** the user-facing write still succeeds, and the system enqueues an asynchronous reindex job for the Chat
- **AND** the Chat becomes searchable when that job runs

#### Scenario: Concurrent rebuilds of one chat converge

- **WHEN** two rebuilds for the same Chat run at the same time, for example a Tier-1 inline write and a queued reindex job
- **THEN** a rebuild that fails with a serialization error is retried and converges on the same projection
- **AND** `indexed_at` only advances

#### Scenario: A message written during a rebuild is never lost by a stale watermark

- **WHEN** a new message commits to a Chat while the rebuild of that Chat is in progress
- **THEN** the rebuild, under REPEATABLE READ, includes the message or excludes it fully
- **AND** when it excludes the message, `indexed_at` does not move past that message, so `chats.updated_at` stays ahead and discovery flags the Chat for reindex again

#### Scenario: Async paths coalesce per chat

- **WHEN** the fallback, fork, or sweep enqueues reindex jobs for one Chat while a rebuild runs
- **THEN** at most one additional rebuild is queued, and the final projection reflects all messages

#### Scenario: A regenerated reply is rebuilt out of the projection

- **WHEN** a Regenerate Run from `turn-actions` replaces a `completed` reply and then finalizes
- **THEN** the synchronous rebuild runs after that finalization
- **AND** the projection holds the user message of the turn and no text of the revised reply

### Requirement: Discovery is a producer, not a processor

There SHALL be one general per-chat reindex job type ("reindex chat C"), enqueued by several equal producers — the Tier-1 inline-finalize fallback, fork, a scheduled cross-tenant discovery mechanism, and the canonical search coverage gate at process startup — and drained by a pool of worker consumers; producers only enqueue, workers process. The discovery mechanism SHALL find chats whose canonical content is newer than their projection state (including chats never indexed) across all tenants, and enqueue their reindex jobs. Its role is **backfill** (pre-existing chats at deploy) and **re-enqueue on chunker-version bump** — NOT primary freshness, which the synchronous Tier-1 index carries, and NOT a named repair path: its stale predicate also happens to catch a rebuild whose own fallback enqueue was lost, but that is a last-resort backstop (defense-in-depth), not the mechanism's primary role. Because discovery must enumerate cross-tenant under FORCE RLS, it SHALL use a dedicated `SECURITY DEFINER` function owned by the `app_rls` (BYPASSRLS) role returning only `(chat_id, owner_user_id, updated_at)` tuples — never content; the reindex worker SHALL then process each chat strictly under `runAs(owner)`. Initial backfill of pre-existing chats SHALL be this same mechanism operating on empty projection state.

#### Scenario: Discovery backstops a lost fallback enqueue

- **WHEN** a synchronous rebuild fails, its fallback enqueue is also lost, and the discovery job later runs
- **THEN** the chat is identified as stale by the discovery predicate and reindexed without manual intervention, as a last-resort backstop rather than the mechanism's primary role

#### Scenario: Discovery leaks no content

- **WHEN** the discovery function executes
- **THEN** it returns only chat identifiers, owner ids, and timestamps; all message reads happen inside per-owner `runAs` scopes

### Requirement: Backfill provisioning is verified at startup, not silently assumed

The cross-tenant discovery function requires ownership by a BYPASSRLS role to enumerate stale chats under FORCE RLS; until that ownership is provisioned it returns zero rows **without error**, silently disabling backfill. The system SHALL detect this at startup by verifying the discovery function is owned by a `rolbypassrls` role — reading only catalog metadata (`pg_proc`/`pg_roles`), never tenant data — and SHALL surface a mis-provisioned state as a loud error-level log rather than under-serving search silently. The check MUST be non-fatal (it MUST NOT crash the process — backfill degradation must not take down the app or Tier-1). A machine-readable readiness surface is deferred (#203). Synchronous Tier-1 indexing SHALL NOT depend on this provisioning (it runs in-tenant), so a mis-provisioned instance still indexes active chats and only defers dormant-chat backfill.

#### Scenario: Mis-provisioned discovery is reported at boot

- **WHEN** the search worker starts and the discovery function is not owned by a BYPASSRLS role
- **THEN** a loud error-level log is emitted, the process does not crash, and synchronous indexing of new activity still functions

### Requirement: Deletions propagate to the projection

Deleting a chat SHALL remove its projection rows (FK cascade). A reindex of a chat SHALL delete projection rows for content that no longer exists. Projection rows MUST NOT outlive the canonical content they were derived from beyond the freshness/discovery window.

#### Scenario: Deleted chat leaves no searchable residue

- **WHEN** a chat is deleted
- **THEN** none of its former content is findable via search and no projection rows for it remain

### Requirement: pg_trgm is a declared platform dependency

The schema SHALL create the `pg_trgm` extension via a migration (trusted contrib extension — creatable by the non-superuser owning role, requiring no capability beyond a stock Postgres distribution). The lexical projection's own chunking, indexing, discovery, and matching behavior SHALL depend on no non-stock extension, and an instance with no embedding model configured SHALL index and search exactly as specified here. The `vector` extension is declared and required by the `search-embeddings` capability, which raises the database-image floor for the deployment as a whole: after that capability ships there is one migration chain, so a database lacking `vector` provisions nothing.

#### Scenario: Fresh database provisions cleanly

- **WHEN** migrations run against a fresh database as the non-superuser owner role
- **THEN** the `pg_trgm` extension and the projection schema are created without superuser intervention, `pg_trgm` being a trusted contrib extension that requires no elevated privilege

#### Scenario: Lexical behavior is unchanged with no embeddings configured

- **WHEN** an instance runs with no embedding model configured
- **THEN** every requirement in this capability holds unchanged, and search behaves exactly as it did before the embedding layer existed
