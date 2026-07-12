# Design: chat-search-platform (phase 1 of #194 — Postgres-only)

## Context

Shipped search is `ChatsRepository.searchByOwner`: value-safe ILIKE over `chats.title` + an unindexed `jsonb_array_elements` scan of user/assistant text parts, `statement_timeout 3000`, newest-first — with "FTS/pg_trgm is the follow-up" in its own doc comment. Both surfaces (web palette via `ChatsService.searchChats`, agent via the `search_conversations` tool) call this one method (tool-calling D7), and the tool-calling spec explicitly anticipates a retrieval upgrade improving both simultaneously. The full architecture (through embeddings and episodic memory) is reviewed and corrected in `docs/research/chat-search/2026-07-12-chat-search-cross-report.md`; this change implements its phase 1 exactly — projection + FTS + trigram, **no embeddings, no infra change**.

Grounded facts this design leans on (verified in code):

- Messages are AI SDK v6 `UIMessage.parts` jsonb; assistant replies are **updated** post-stream (`updateAssistantReply`), fork bulk-inserts messages — the canonical content of a chat mutates, so per-chat rebuild is the correct reindex unit.
- The enqueue precedent is post-transaction with best-effort failure handling (`RunDispatchService`); there is no transactional-enqueue infrastructure.
- `chats.touch()` bumps `updatedAt` on every message turn — a reliable dirtiness signal for discovery.
- The queue wrapper deliberately defers dedup: pg-boss v12 ties dedup to the queue **policy** (`queue.ts:86`); `singletonKey` alone dedups nothing on a `standard` queue.
- `pg_trgm` is a _trusted_ contrib extension (PG13+): the non-superuser `app` role that owns the database can `CREATE EXTENSION` it — no image or provisioning change.

## Goals / Non-Goals

**Goals:**

- Indexed, ranked, case/typo-tolerant, multilingual-safe lexical search over titles + user/assistant content; same API/tool contract.
- The projection platform phases 2–4 extend (embedding-ready: content hashes, message ranges, versioned chunker) without rebuilding.
- Fix #171 at its actual site (client-side cmdk re-filter).
- Relevance eval baseline for phase 3 to be judged against.
- Tenant isolation of every new table and query path, proven by negative tests in `rls-test.sh`.

**Non-Goals:**

- Embeddings, pgvector, model registry (phase 2 / #196); RRF over a vector leg (phase 3 / #197); episodic-memory semantics (phase 4 / #198).
- Indexing compaction summaries, tool outputs, reasoning, attachments.
- HNSW, PGroonga/CJK tokenization, dedicated queue, search-result pagination changes.
- Any change to sharing semantics — public chats stay readable via the share path only.

## Decisions

### D1 — Projection schema: `search_documents` + per-chat `search_chat_state`

`search_documents`: `id` uuid PK, `owner_user_id` text (denormalized; matches `users.id`), `chat_id` uuid FK → chats ON DELETE CASCADE, `chunk_ordinal` int, `chunker_version` int, `first_message_id`/`last_message_id` uuid, `first_message_at`/`last_message_at` timestamptz, `content` text (original casing, for snippets), `normalized_content` text (NFKC, whitespace-collapsed, lowercased; accents/code/URLs preserved), `content_hash` text, `fts tsvector` GENERATED ALWAYS AS `to_tsvector('simple', normalized_content)` STORED, timestamps; `UNIQUE (chat_id, chunk_ordinal, chunker_version)`. Indexes: GIN on `fts`, GIN `gin_trgm_ops` on `normalized_content`, `(owner_user_id, chat_id)`, `(owner_user_id, last_message_at DESC)`.

`search_chat_state`: `chat_id` uuid PK FK cascade, `owner_user_id` text, `indexed_at` timestamptz, `chunker_version` int. Why a state row instead of deriving from `max(search_documents.updated_at)`: a chat whose content produces zero chunks (all-excluded parts, empty) would otherwise look permanently dirty to discovery; the state row records "indexed, empty" and makes the discovery predicate a simple join (`chats.updated_at > state.indexed_at OR state IS NULL`).

Both tables: RLS `ENABLE`+`FORCE`, owner policy directly on `owner_user_id = current_setting('app.current_user_id', true)` (no subquery into `chats` — the denormalized column exists precisely for cheap policies and in-query filters), **no public-read policy**. FORCE statements are hand-appended to the generated migration (AGENTS.md Gotchas pattern, like 0004/0011/0018/0021/0023). Alternative rejected: policy via `chat_id IN (SELECT … FROM chats)` — costs a correlated subquery on every candidate row in the hottest query of the feature.

### D2 — Chunker: message-boundary windows, ~3,000-char budget, 1-message overlap

Deterministic pure function over ordered `(seq, role, parts)`: serialize text parts of user/assistant turns as `[user]`/`[assistant]`-prefixed blocks; accumulate whole messages into a chunk until adding the next message would exceed **3,000 characters** (≈750 tokens — inside the research doc's 300–800-token target, tokenizer-independent); overlap: each next chunk re-includes the previous chunk's last message. A single message longer than the budget becomes its own oversized chunk, split only at the embedding backend's limit in phase 2 (never split here — lexical indexes have no input cap worth the complexity). Reasoning parts, tool parts, attachments, system/tool roles: skipped (same policy as today's search — this exclusion is spec-level). `content_hash` = sha256 of `chunker_version + normalized_content + message-range`. Constants live in one exported object next to `CHUNKER_VERSION`; changing them requires a version bump (spec requirement).

### D3 — Titles are matched live, not chunked

Title matching stays a candidate leg over `chats.title` directly (ILIKE remains adequate at title cardinality; add `word_similarity` for typo tolerance on the same leg). Rejected alternative: prepend the title into chunk 0 — every rename would dirty the whole chat's projection, and a rename between reindexes would serve stale titles. Live title matching also preserves the existing "title-only match ⇒ `snippet: null`" contract for free.

### D4 — Query: three candidate CTEs → RRF → weighted top-3 chat aggregation

**Ordering is pure relevance** (grill decision): results are ordered by fused RRF score; recency participates only as the deterministic tie-break (`updated_at DESC, chat_id`). This intentionally replaces the MVP's `updated_at DESC` ordering — a strong old match must beat a weak recent one. Recency _browsing_ survives via the palette's recent-chats affordance (below `MIN_SEARCH_LENGTH`); recency as a _ranking signal_ is explicitly phase 4's job (#198), tuned against eval data.

Inside the same `searchByOwner(ownerUserId, query, limit)` signature, built via the shared hybrid query builder (D10):

1. `fts_candidates`: `fts @@ websearch_to_tsquery('simple', query)`, ranked by `ts_rank_cd`, LIMIT 100.
2. `trgm_candidates`: `query <% normalized_content` (`word_similarity` — NOT `similarity()`, which is length-crushed for query-vs-chunk; cross-report §3.1), ranked by `word_similarity(query, normalized_content)`, LIMIT 40.
3. `title_candidates`: over `chats` (ILIKE OR `word_similarity` above threshold), LIMIT 50 — fused at chat level.

Document legs fuse with RRF (`k=60`, weights: fts 1.0, trgm 0.35 — research-doc starting points, tuned only via the eval set), then weighted top-3 aggregation per chat (1.0/0.25/0.10) with deterministic tie-breaks (`chat_id`); the title leg joins the fused chat scores with weight 1.0 at its RRF rank. Snippet: `ts_headline('simple', content, …)` on the best document when the FTS leg matched; else a trimmed excerpt around the trigram match; `null` for title-only. Every CTE carries `owner_user_id = $1` (seatbelt) and runs under `runAs` (guard). Keep a `statement_timeout` guard (raised from the MVP's 3 s only if eval latency demands). DTO unchanged; ordering becomes relevance-ranked instead of `updated_at DESC` — the one observable behavior change, and the point of the feature.

### D5 — Reindex pipeline: post-persist enqueue + `'stately'`/`singletonKey` coalescing

New `SEARCH_REINDEX_QUEUE` (`defineQueue`): payload `{ chatId, ownerUserId }`, queue policy `'stately'`, enqueue with `singletonKey = chatId` — at most one queued + one active job per chat; a write burst collapses to one pending rebuild (verified semantics from pg-boss 12.24.1 types; cross-report §3.3). The wrapper gains `QueueOptions.policy` and `EnqueueOptions.singletonKey` — the extension `queue.ts:86` explicitly deferred until a consumer needed verified semantics; this is that consumer. Hooks (post-persist, non-fatal on failure, mirroring `RunDispatchService`'s contract) at the **three** content-write sites that exist on master: user-message persist (`chat-loop.service.ts`, next to `touch()`), assistant finalization (`run-execution.service.ts` → `updateAssistantReply`), and fork. (Regenerate is not implemented on master — verified during grilling; when it lands it adds a fourth hook, and until then the sweep covers any missed path.) The worker (co-located consumer, `RunsWorkerService` pattern) rebuilds the whole chat under `runAs(ownerUserId)`: read ordered messages → chunk → hash-diff vs existing rows → upsert changed / delete obsolete → update `search_chat_state`.

Rejected: the research doc's same-transaction dirty-table upsert — no transactional-enqueue infra exists, and D6 makes at-most-once enqueue acceptable.

### D6 — Discovery/backfill: `app_rls`-owned SECURITY DEFINER + cron sweep

Cross-tenant discovery cannot run as a plain `runAs` identity under FORCE RLS. Mechanism (0019 precedent): `llame_search_stale_chats(max_rows int)` — `SECURITY DEFINER`, owned by `app_rls` (BYPASSRLS), `GRANT EXECUTE TO app` — returns `(chat_id, owner_user_id, updated_at)` for chats with `updated_at > state.indexed_at`, a stale `state.chunker_version`, or no state row. **Returns identifiers only, never content**; all content reads stay inside per-owner `runAs`.

The sweep's job is **repair and migration, not freshness** (grill decision — freshness is carried by the D5 hooks): it exists for (a) initial backfill of all pre-existing chats, (b) automatic full-projection rebuilds on `CHUNKER_VERSION` bumps, and (c) repairing lost enqueues/terminally-failed jobs, which are otherwise silently stale forever. Accordingly it runs at a relaxed **5-minute cadence** (pg-boss cron via the wrapper's existing `schedule()`), a millisecond-class timestamp query returning zero rows in steady state; it enqueues the same per-chat jobs the hooks would (the `'stately'` policy dedups against already-pending work). Backfill = the same sweep against empty state — no separate command; deploy-time indexing of all existing chats happens organically after migration, oldest-activity last (ordered by `updated_at DESC` so active chats index first). Ownership assignment of the function follows the existing split: created in the migration owned by `app`, reassigned to `app_rls` by `pnpm db:provision-rls` / `rls-function-owner.sql` (same lifecycle as `llame_role_on_unit_path`).

### D7 — Web (#171): server results bypass the cmdk filter

Server search-result items in the command palette stop participating in cmdk's client-side filter (item `value` keyed by id with filtering disabled for the server-results group), making server rank order authoritative. Case-insensitivity is asserted end-to-end (Cyrillic included) per #171's acceptance criteria; the recent-chats (sub-`MIN_SEARCH_LENGTH`) local filter gets a case-folding fix if the repro shows it's affected.

### D8 — Eval harness: opt-in jest + fixture corpus, with floors on what lexical must do

`apps/api/test/search-eval/`: a versioned JSON dataset (queries × expected chat labels across the required categories: exact/typo/paraphrase/ru/en/es/mixed/code) + seeded fixture conversations + an env-gated jest suite (`RUN_SEARCH_EVAL=1`, `TEST_DATABASE_URL`-backed like the integration suites) that indexes the fixtures through the real chunker/projection and reports Recall@10, MRR, zero-result rate. **Gating (grill decision): exact-title, exact-content, and typo categories are hard assertions** (expected chat in top-10, Recall ≈ 100%) — a fusion-math regression on what lexical search has no excuse to miss fails the suite. Paraphrase and inflected-Russian categories are recorded-only: they are the phase-3 measuring stick and expected weak. Baseline numbers are committed alongside (Markdown table). The runner and metrics module are corpus-agnostic (D10); the chat dataset is its first instance.

### D9 — Migrations

One timestamp-prefixed generated migration for tables/indexes + hand-maintained additions: `CREATE EXTENSION IF NOT EXISTS pg_trgm`, `FORCE ROW LEVEL SECURITY` for both tables, the discovery function (documented in AGENTS.md Gotchas per the established pattern). GIN/expression indexes expressed via Drizzle `.using('gin', …)` with `gin_trgm_ops` opclass; the generated tsvector column via `customType` + `.generatedAlwaysAs()`.

### D10 — Multi-corpus platform posture (adopted at grill: anti-YAGNI, deliberately)

Chat search is the **first consumer of a retrieval platform** — Knowledge/RAG (v0.6 #39, artifacts #41) and curated memory (SPEC §20) will need the same feature set (FTS + trigram + vector + fusion). The platform rules, decided now so the patterns are established by the first implementation:

- **Share behavior (code) and contracts (column factories) — never state (tables).** Per-corpus projection/embedding tables forever; no polymorphic `source_type` store. Rationale: the corpora have different authorization shapes (chat-owner vs project-membership vs user/project memory scope) — one table means one RLS policy handling all of them, which multi-tenant llame must not do. The episodic-vs-knowledge boundary ("documents are not episodic memory") is enforced **by construction** — separate tables, separate tool surfaces — not by a WHERE clause someone forgets. Attachments mark the boundary: episodic = what was said; knowledge = files that exist.
- **Module layout with enforced dependency direction**: `apps/api/src/search/core/` (hybrid query builder, normalization, hashing, chunking toolkit, snippet helpers, eval metrics — imports nothing corpus-specific) and `apps/api/src/search/chat/` (conversation chunker, projection service, reindex worker, discovery — the first corpus adapter).
- **The shared hybrid query builder ships in phase 1**: a typed config (`table+columns`, `legs: [{kind: fts | trgm | custom, weight, limit}]`, `rrfK`, optional `groupBy` with weighted top-N, `tieBreak`) → composed SQL. `scopePredicate` is a **required** argument — the in-CTE tenant seatbelt becomes structurally mandatory, not a convention. Phase 3 adds a `vector` leg kind (a union entry, not a redesign); knowledge and memory become configs, not reimplementations. Deliberately a function, not a framework.
- **Projection tables only where unit ≠ storage row or extraction is policy** (chat: yes — chunks from jsonb parts; docs: yes — sections from files; curated memory: **no** — atomic items index their canonical table directly with a generated tsvector + sibling embedding table).
- **Recorded constraints for phase 2 (#196)**: the `embedding_models` registry is one global (operator-scoped) table, but _which model serves queries_ is per-corpus/per-index configuration — corpora backfill at different speeds, and a global `active_for_search` flip would strand the slower corpus on missing vectors. Embedding tables are per-corpus via a shared column factory; the `EmbeddingBackend` interface and batch machinery are shared code.
- **Explicitly not built now**: corpus plugin interfaces (module boundaries suffice until a second corpus exists), cross-corpus federated search, dormant vector-leg internals.

## Risks / Trade-offs

- **[`simple` FTS has no stemming — inflected-Russian lexical recall suffers]** → known and accepted for phase 1; `word_similarity` trigrams recover shared stems partially; the eval set measures the gap explicitly so phase 3 proves the embedding lift instead of papering over it now.
- **[Projection roughly doubles stored conversation text (+ overlap)]** → text is small relative to jsonb parts overhead; GIN indexes are the real growth — measured via the eval harness dataset; acceptable for the feature's value; revisit only with data.
- **[Relevance ordering replaces recency ordering]** → intended, but the palette's "recent chats" affordance (below `MIN_SEARCH_LENGTH`) is untouched, so recency browsing survives.
- **[Reindex worker adds DB write load per message turn]** → hash-diff makes unchanged chunks no-ops; `'stately'` coalescing bounds concurrent rebuilds to one per chat; worker is queue-buffered, not on the request path.
- **[SECURITY DEFINER discovery function widens the bypass surface]** → returns identifiers only; content reads stay under `runAs`; function body is three columns + a join; covered by an RLS-harness test asserting it leaks nothing beyond the tuple shape.
- **[Fork duplicates content across lineage → duplicate search hits]** → accepted for v1 (tracker decision); results are per-chat, so duplicates are distinguishable by title/recency.
- **[cmdk filter bypass could regress quick-action fuzzy matching]** → scope the filter change to the server-results group only; palette unit tests cover both groups.

## Migration Plan

1. Migration applies extension + tables + policies (+ FORCE, function) — additive, no data movement; old search keeps working until the code switch (same deploy).
2. On boot, the cron sweep finds every chat stale (no state rows) and backfills organically, most-recently-active first; until a chat is indexed, it is findable only by title (title leg is live) — a bounded, self-healing gap.
3. Rollback: revert the code; projection tables are inert derived data (safe to leave or drop).

## Open Questions

None blocking — parameters explicitly marked as tunable (chunk budget, RRF weights, candidate limits, sweep cadence) are locked to the research-doc starting values and only move via the eval set.
