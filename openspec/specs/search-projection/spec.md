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

Chunks SHALL be produced by a deterministic, versioned chunker: multi-message windows split on message boundaries with a bounded character budget and adjacent-message overlap, carrying role markers and the covered message range (`first/last message id` and timestamps). Each chunk SHALL store role-labelled original-cased presentation `content` for snippets and a role-free normalized lexical representation for matching. The content hash SHALL cover both representations, the chunker version, and the covered message range; re-running the chunker over unchanged input MUST produce byte-identical chunks (idempotent, no-op upserts). Changing either representation algorithm SHALL require a version bump, and documents of different `chunker_version` SHALL NOT mix within one chat's live projection.

#### Scenario: Unchanged chat is a no-op

- **WHEN** a reindex runs for a chat whose messages have not changed
- **THEN** no projection rows are written (hashes match)

#### Scenario: Edited assistant reply rebuilds affected chunks

- **WHEN** an assistant message's parts are updated after initial persistence
- **THEN** the next reindex replaces the chunks covering that message and removes any obsolete chunks

#### Scenario: Representation version change rebuilds existing chunks

- **WHEN** the chunker version changes
- **THEN** discovery identifies prior-version projection rows as stale and rebuilds them without mixing versions in the chat's live projection

### Requirement: Only user-visible conversation text is indexed

The chunker SHALL serialize only the text parts of `user` and `assistant` turns. System prompts, tool-role messages, tool invocation payloads/results, model reasoning parts, and attachments MUST NOT enter `search_chat_documents` in any form. Role labels added solely to preserve presentation context MUST appear only in original-cased snippet content and MUST NOT enter the normalized lexical match column or generated FTS vector. Normalization (Unicode NFKC, whitespace collapse, lowercasing for the match column) MUST preserve accents, code, identifiers, and URLs.

#### Scenario: Tool and reasoning content is absent from the projection

- **WHEN** a chat containing tool calls and reasoning parts is indexed
- **THEN** no projection row contains that content, and no search query can match or excerpt it

#### Scenario: Synthetic role labels are absent from lexical data

- **WHEN** a user turn and assistant turn are indexed with no literal `user` or `assistant` text in their bodies
- **THEN** the projection's normalized lexical content and generated FTS vector contain neither synthetic role label, while its snippet content retains role attribution

### Requirement: Projection tables enforce tenant isolation at the datastore

`search_chat_documents` (and any projection state table) SHALL carry a denormalized `owner_user_id` (`text`, matching `users.id`), with RLS `ENABLE` and `FORCE` and an owner policy over `current_setting('app.current_user_id', true)`. There SHALL be **no** public-read policy on projection tables: `visibility = 'public'` chats are readable via the sharing path but their projection rows MUST NOT be readable by any other identity, including the empty (public) identity. Query-time candidate queries SHALL additionally carry the owner filter as defense-in-depth. Cross-tenant and public-chat negative tests SHALL run in the RLS harness.

#### Scenario: FORCE RLS holds against the table owner

- **WHEN** the RLS harness queries projection tables as the owning role with another user's identity set (and with the empty identity)
- **THEN** no cross-tenant row and no public chat's row is readable

### Requirement: Lexical indexing is synchronous on turn completion, with async fallback and coalescing

Turn completion — assistant finalization, including any regenerate — SHALL rebuild the whole chat's lexical projection **synchronously, after the user-facing write commits, inside the chat owner's own tenant scope**, so the turn's content (the user message and the assistant reply together) is searchable as soon as finalization completes, requiring no BYPASSRLS and no background worker. This is the sole inline indexing site: a user message persisted before its turn finalizes is not rebuilt inline (finalize covers it moments later), and fork enqueues its own content asynchronously rather than rebuilding inline. The synchronous rebuild MUST NOT run inside the user-facing write transaction and MUST NOT fail the user-facing write; on any failure it SHALL fall back to enqueuing an asynchronous per-chat reindex job so the update is not lost. Every rebuild SHALL be an idempotent reconstruction from canonical `messages`, run under **REPEATABLE READ** so the message read and the `indexed_at` watermark share one snapshot (a plain message write landing mid-rebuild is then either fully indexed or fully excluded — never chunked-out but stamped into the watermark — and an excluded write leaves `chats.updated_at` ahead of `indexed_at` so discovery re-flags the chat). A rebuild that loses a write race with a concurrent rebuild of the same chat (a serialization failure under REPEATABLE READ) SHALL be retried — the rebuild is idempotent, so the retry's fresh snapshot converges — and `search_chat_state.indexed_at` SHALL be advanced monotonically (`GREATEST(existing, excluded)`). The asynchronous paths (the Tier-1 fallback, fork, the discovery sweep, and phase-2 embedding work) SHALL be coalesced so at most one job is pending and one running per chat (pg-boss queue policy `'stately'` + `singletonKey = chat_id`).

#### Scenario: Fresh turn is searchable synchronously

- **WHEN** a user's message is answered and the assistant's reply finalizes with a distinctive term
- **THEN** the term is searchable immediately on that request's completion, without any background job having run

#### Scenario: Synchronous rebuild failure falls back to the queue

- **WHEN** the synchronous rebuild throws after the user-facing write has committed
- **THEN** the user-facing write still succeeds, an asynchronous reindex job is enqueued for the chat, and the chat becomes searchable once that job runs

#### Scenario: Concurrent rebuilds of one chat converge

- **WHEN** two rebuilds for the same chat run concurrently (e.g. a Tier-1 inline write racing a queued reindex job)
- **THEN** if one fails with a serialization error it is retried and converges on the same projection, and `indexed_at` only ever advances

#### Scenario: A message written during a rebuild is never lost by a stale watermark

- **WHEN** a new message is committed to a chat while that chat's rebuild is mid-flight
- **THEN** the rebuild (under REPEATABLE READ) either includes the message or excludes it entirely; if excluded, `indexed_at` is not stamped past that message, so `chats.updated_at` stays ahead and discovery re-flags the chat for reindex

#### Scenario: Async paths coalesce per chat

- **WHEN** the fallback, fork, or sweep enqueues reindex jobs for one chat while a rebuild is running
- **THEN** at most one additional rebuild is queued, and the final projection reflects all messages

### Requirement: Discovery is a producer, not a processor

There SHALL be one general per-chat reindex job type ("reindex chat C"), enqueued by several equal producers — the Tier-1 inline-finalize fallback, fork, and a scheduled cross-tenant discovery mechanism — and drained by a pool of worker consumers; producers only enqueue, workers process. The discovery mechanism SHALL find chats whose canonical content is newer than their projection state (including chats never indexed) across all tenants, and enqueue their reindex jobs. Its role is **backfill** (pre-existing chats at deploy) and **re-enqueue on chunker-version bump** — NOT primary freshness, which the synchronous Tier-1 index carries, and NOT a named repair path: its stale predicate also happens to catch a rebuild whose own fallback enqueue was lost, but that is a last-resort backstop (defense-in-depth), not the mechanism's primary role. Because discovery must enumerate cross-tenant under FORCE RLS, it SHALL use a dedicated `SECURITY DEFINER` function owned by the `app_rls` (BYPASSRLS) role returning only `(chat_id, owner_user_id, updated_at)` tuples — never content; the reindex worker SHALL then process each chat strictly under `runAs(owner)`. Initial backfill of pre-existing chats SHALL be this same mechanism operating on empty projection state.

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

The schema SHALL create the `pg_trgm` extension via a migration (trusted contrib extension — creatable by the non-superuser owning role; no Docker image change). pgvector is explicitly NOT part of this capability (phase 2).

#### Scenario: Fresh database provisions cleanly

- **WHEN** migrations run against a fresh stock `postgres:17-alpine` database as the non-superuser owner role
- **THEN** the extension and projection schema are created without superuser intervention
