# Tasks: chat-search-platform

## 1. Schema & migration (design D1, D9, D10)

- [x] 1.1 Add `search_chat_documents` + `search_chat_state` to `apps/api/src/db/schema/` (new `search.ts`), built from a shared `searchProjectionColumns()` factory (D10) plus chat-specific columns: RLS owner policies over denormalized `owner_user_id`, no public-read policy; tsvector via `customType` + `.generatedAlwaysAs()`, GIN indexes (`fts`, `normalized_content gin_trgm_ops`) via `.using('gin', …)`
- [x] 1.2 Generate the migration (`db:generate`, timestamp-prefixed) and hand-append the documented exceptions: `CREATE EXTENSION IF NOT EXISTS pg_trgm`, `FORCE ROW LEVEL SECURITY` for both tables, `llame_search_stale_chats(current_chunker_version int, max_rows int)` SECURITY DEFINER function (staleness predicate: `updated_at > indexed_at` OR stale `chunker_version` OR no state row; + `GRANT EXECUTE TO app`). Renaming the already-shipped `search_documents` table to `search_chat_documents` (D1 naming decision, post-dating the original migration) SHALL be a hand-authored, non-destructive `ALTER TABLE ... RENAME` (+ dependent index/constraint/policy renames) preserving existing rows, not a from-scratch recreate — a fresh database still gets the table under its final name via the normal generated CREATE that precedes it in migration order
- [x] 1.3 Wire function ownership reassignment to `app_rls` into `docker/postgres/rls-function-owner.sql` / `pnpm db:provision-rls` (same lifecycle as `llame_role_on_unit_path`); update `scripts/rls-test.sh` provisioning accordingly
- [x] 1.4 Document the new migration exceptions + filename in `apps/api/AGENTS.md` Gotchas; verify `migration-journal.spec.ts` passes and a fresh `postgres:17-alpine` migrates as the non-superuser `app` role (spec: "Fresh database provisions cleanly")

## 2. Search core module (design D10 — corpus-agnostic, imports nothing from chats)

- [x] 2.1 Create `apps/api/src/search/core/`: normalization (NFKC, whitespace collapse, lowercase; accents/code/URLs preserved) + `content_hash` (sha256 over version + normalized content + range) as pure functions; chunking toolkit (character-budget accumulator, overlap helper)
- [x] 2.2 Implement the hybrid query builder: typed config (`table`+columns, `legs: [{kind: 'fts' | 'trgm' | 'custom', weight, limit}]`, `rrfK`, optional `groupBy` with weighted top-N, `tieBreak`) → composed `sql` statement; **`scopePredicate` is a required argument** (builder refuses to construct an unscoped query); snippet helpers (`ts_headline` + excerpt fallback)
- [x] 2.3 Unit tests for the builder: RRF math, weighted top-N grouping, deterministic tie-breaks, scope predicate present in every candidate CTE, config validation (missing scope predicate throws)
- [x] 2.4 Eval metrics module (Recall@K, MRR, zero-result rate) + dataset format types — corpus-agnostic runner core

## 3. Conversation chunker (design D2 — lives in `search/chat/`)

- [x] 3.1 Implement the deterministic conversation chunker: text parts of user/assistant only (reasoning/tool/attachments/system excluded), `[user]`/`[assistant]` role markers, **3,000-char budget, 1-message overlap** (grill-locked v1 constants), oversized-message passthrough, message-range metadata, `CHUNKER_VERSION` + constants object
- [x] 3.2 Unit tests: determinism/idempotence (same input ⇒ byte-identical chunks), boundary/overlap behavior, oversized message, exclusion rules (tool/reasoning/system content never serialized), non-ASCII normalization (Cyrillic casing, accents kept)

## 4. Two-tier index maintenance (design D5, D6)

- [x] 4.1 Extend the queue wrapper: `QueueOptions.policy` (typed to pg-boss v12 `QueuePolicy`) and `EnqueueOptions.singletonKey`; replace the `queue.ts:86` deferral note with the verified semantics; integration-test `'stately'` + `singletonKey` coalescing (one queued + one active per key)
- [x] 4.2 Projection service in `search/chat/`: idempotent rebuild-per-chat under `runAs(owner)`, serialized by a per-chat transaction-scoped advisory lock (`pg_advisory_xact_lock(hashtextextended(chat_id::text, 0))`) taken at the top of the rebuild — read ordered messages, chunk, hash-diff, upsert changed, delete obsolete, upsert `search_chat_state` with `indexed_at` advanced monotonically (`GREATEST(existing, excluded)`). Define `SEARCH_REINDEX_QUEUE` (`{ chatId, ownerUserId }`, policy `'stately'`, parse guard) as the async channel for the Tier-1 fallback + fork + sweep
- [x] 4.3 **Tier 1 — synchronous lexical on write**: the **sole inline site** is assistant finalization (`run-execution.service.ts` → `updateAssistantReply`, on the run worker) — call the projection service **inline, post-commit, awaited** (never inside the write transaction), rebuilding the whole chat including the user message that started the turn; on any failure, fall back to enqueuing the async job + log — the user-facing write must never fail. User-message persist (`chat-loop.service.ts`) is deliberately **not** inline: finalize re-indexes the same content moments later, so an inline rebuild there is double-work on time-to-first-token and, in phase 2, a double embed of the same region (question-only, then the final turn). Fork bulk-inserts a whole chat at once with no model call to hide behind, so it **enqueues async** rather than rebuilding inline; its content is findable via the source chat and its title is searchable instantly via the live title leg in the meantime. Register the async fallback/sweep consumer next to the existing co-located workers
- [x] 4.4 **Discovery sweep** (pg-boss cron via `Queue.schedule()`, **5-minute cadence**) — a producer only: it enqueues reindex jobs, it never processes them. Call `llame_search_stale_chats(current_chunker_version, max_rows)` under `runAsPublic`, enqueue reindex jobs most-recently-active first; verify it doubles as backfill on empty state and as re-enqueue on a `CHUNKER_VERSION` bump. **Boot self-check**: verify the discovery function is owned by a `rolbypassrls` role (reads `pg_proc`/`pg_roles` only) and emit a loud error-level log if not — **non-fatal** (must not crash the process); there is no readiness endpoint in phase 1 (deferred to #203)
- [x] 4.5 Integration tests (jest `.integration`, DB-backed): a fresh turn (finalize) is searchable **synchronously** (no queue drain), including the user message that started it; synchronous-rebuild failure falls back to an enqueue and the write still succeeds; edited assistant reply rebuilds; chat delete cascades; unchanged chat is a hash no-op; concurrent rebuilds of one chat (advisory lock) converge on the freshest projection with a monotonic `indexed_at`; sweep backstops a deliberately-missed fallback enqueue (last-resort, not the sweep's primary role); sweep re-enqueues on version bump; discovery function returns identifiers only; boot self-check flags a deliberately mis-owned function with a non-fatal log (process does not crash)

## 5. Retrieval rewrite (design D3, D4)

- [x] 5.1 Rewrite `ChatsRepository.searchByOwner` (same signature/DTO) as a consumer of the core builder: FTS + `word_similarity` trigram legs over `search_chat_documents` + live-title leg over `chats`, all owner-scoped, RRF (k=60; fts 1.0 / trgm 0.35 / title 1.0), weighted top-3 chat aggregation (1.0/0.25/0.10), **pure-relevance ordering** with `updated_at DESC, chat_id` tie-break, `ts_headline` snippets (null for title-only), blank-query short-circuit, statement-timeout guard
- [x] 5.2 Extend `chats-search.integration.spec.ts`: case-insensitive exact-title (Cyrillic included), typo/partial-word via trigram, content snippet vs title-only null snippet, blank query, relevance-order determinism; keep existing wildcard/system-tool-exclusion cases green
- [x] 5.3 RLS negative tests in the harness suite: cross-tenant exact-match exclusion (both directions), public-chat-of-another-user exclusion through the search path, FORCE assertion (`relforcerowsecurity`) for both new tables; confirm `search_conversations` tool integration spec stays green (contract unchanged)

## 6. Web — #171 fix (design D7)

- [x] 6.1 Command palette: exempt server search results from cmdk client-side filtering (id-keyed values / group-scoped filter disable); server rank order authoritative; verify quick-actions fuzzy matching unaffected
- [x] 6.2 Repro-then-fix the sub-`MIN_SEARCH_LENGTH` recent-chats local filter for case folding if affected (per #171 acceptance); web unit tests: lowercased exact title surfaces via both paths, Cyrillic case included

## 7. Eval baseline (design D8)

- [x] 7.1 Author the versioned dataset (`apps/api/src/search/chat/eval/`): fixture conversations + labeled queries across exact/typo/paraphrase/ru/en/es/mixed/code categories
- [x] 7.2 Env-gated harness (`RUN_SEARCH_EVAL`, `TEST_DATABASE_URL`-backed) on the core runner (metrics module in `apps/api/src/search/core/`): index fixtures through the real chunker/projection, run `searchByOwner`; **hard floors asserted on exact-title / exact-content / typo categories** (expected chat in top-10); paraphrase + inflected-Russian recorded-only
- [x] 7.3 Record the lexical baseline numbers in-repo (markdown next to the dataset in `apps/api/src/search/chat/eval/`), paraphrase categories annotated as the phase-3 measuring stick

## 8. Ship

- [x] 8.1 Full verification: `pnpm --filter api lint` + `typecheck` + unit tests, web lint/tests, `apps/api/scripts/rls-test.sh` green including the new suites, `pnpm build` (openapi diff clean — no contract change expected)
- [x] 8.2 CHANGELOG entry (same PR); note the phase-2 constraints recorded in D10 on issue #196; PR references: `Closes #195`, `Fixes #171`, refs #194; tick the #194 tracker checkbox on merge
