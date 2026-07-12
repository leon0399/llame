# Delta: search-projection (phase 1 — derived lexical index)

## ADDED Requirements

### Requirement: Search reads from a derived, rebuildable projection

Search SHALL execute against a derived projection (`search_documents`) of contextual multi-message chunks, not by scanning `messages` at query time. The canonical `chats`/`messages` tables SHALL remain the single source of truth and SHALL NOT be modified by this capability; the projection MUST be fully rebuildable from them at any time.

#### Scenario: Full rebuild reproduces the projection

- **WHEN** the projection is emptied and the backfill/discovery mechanism runs to completion
- **THEN** the projection is reconstructed from canonical tables and search results are equivalent to before

### Requirement: Chunking is deterministic, versioned, and content-hashed

Chunks SHALL be produced by a deterministic, versioned chunker: multi-message windows split on message boundaries with a bounded character budget and adjacent-message overlap, carrying role markers and the covered message range (`first/last message id` and timestamps). Each chunk SHALL store a content hash; re-running the chunker over unchanged input MUST produce byte-identical chunks (idempotent, no-op upserts). Changing the algorithm SHALL require a version bump, and documents of different `chunker_version` SHALL NOT mix within one chat's live projection.

#### Scenario: Unchanged chat is a no-op

- **WHEN** a reindex runs for a chat whose messages have not changed
- **THEN** no projection rows are written (hashes match)

#### Scenario: Edited assistant reply rebuilds affected chunks

- **WHEN** an assistant message's parts are updated after initial persistence
- **THEN** the next reindex replaces the chunks covering that message and removes any obsolete chunks

### Requirement: Only user-visible conversation text is indexed

The chunker SHALL serialize only the text parts of `user` and `assistant` turns. System prompts, tool-role messages, tool invocation payloads/results, model reasoning parts, and attachments MUST NOT enter `search_documents` in any form. Normalization (Unicode NFKC, whitespace collapse, lowercasing for the match column) MUST preserve accents, code, identifiers, and URLs.

#### Scenario: Tool and reasoning content is absent from the projection

- **WHEN** a chat containing tool calls and reasoning parts is indexed
- **THEN** no projection row contains that content, and no search query can match or excerpt it

### Requirement: Projection tables enforce tenant isolation at the datastore

`search_documents` (and any projection state table) SHALL carry a denormalized `owner_user_id` (`text`, matching `users.id`), with RLS `ENABLE` and `FORCE` and an owner policy over `current_setting('app.current_user_id', true)`. There SHALL be **no** public-read policy on projection tables: `visibility = 'public'` chats are readable via the sharing path but their projection rows MUST NOT be readable by any other identity, including the empty (public) identity. Query-time candidate queries SHALL additionally carry the owner filter as defense-in-depth. Cross-tenant and public-chat negative tests SHALL run in the RLS harness.

#### Scenario: FORCE RLS holds against the table owner

- **WHEN** the RLS harness queries projection tables as the owning role with another user's identity set (and with the empty identity)
- **THEN** no cross-tenant row and no public chat's row is readable

### Requirement: Reindexing is asynchronous, coalesced per chat, and freshness-bounded

Content-changing writes (new user message, finalized/updated assistant reply, fork, regenerate) SHALL enqueue a per-chat reindex job after persistence. Reindex jobs SHALL be coalesced so that at most one job is pending and one is running per chat (pg-boss queue policy `'stately'` extended with `singletonKey = chat_id`); a burst of writes to one chat collapses into one pending rebuild. The pipeline SHALL meet the freshness target (seconds to low minutes) under normal operation, and an enqueue failure MUST NOT fail the user-facing write (repair happens via discovery).

#### Scenario: Write burst coalesces

- **WHEN** several messages are persisted to one chat in quick succession while a rebuild is running
- **THEN** at most one additional rebuild is queued, and the final projection reflects all messages

### Requirement: Discovery repairs gaps and powers backfill

A scheduled discovery mechanism SHALL find chats whose canonical content is newer than their projection state (including chats never indexed) across all tenants, and enqueue their reindex jobs. Because discovery must enumerate cross-tenant under FORCE RLS, it SHALL use a dedicated `SECURITY DEFINER` function owned by the `app_rls` (BYPASSRLS) role returning only `(chat_id, owner_user_id, updated_at)` tuples — never content; the reindex worker SHALL then process each chat strictly under `runAs(owner)`. Initial backfill of pre-existing chats SHALL be this same mechanism operating on empty projection state.

#### Scenario: Missed enqueue is repaired

- **WHEN** a message write's reindex enqueue fails and the discovery job later runs
- **THEN** the chat is identified as stale and reindexed without manual intervention

#### Scenario: Discovery leaks no content

- **WHEN** the discovery function executes
- **THEN** it returns only chat identifiers, owner ids, and timestamps; all message reads happen inside per-owner `runAs` scopes

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
