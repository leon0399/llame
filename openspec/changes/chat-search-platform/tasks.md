# Tasks: chat-search-platform

## 1. Schema & migration (design D1, D9, D10)

- [ ] 1.1 Add `search_documents` + `search_chat_state` to `apps/api/src/db/schema/` (new `search.ts`), built from a shared `searchProjectionColumns()` factory (D10) plus chat-specific columns: RLS owner policies over denormalized `owner_user_id`, no public-read policy; tsvector via `customType` + `.generatedAlwaysAs()`, GIN indexes (`fts`, `normalized_content gin_trgm_ops`) via `.using('gin', …)`
- [ ] 1.2 Generate the migration (`db:generate`, timestamp-prefixed) and hand-append the documented exceptions: `CREATE EXTENSION IF NOT EXISTS pg_trgm`, `FORCE ROW LEVEL SECURITY` for both tables, `llame_search_stale_chats(max_rows)` SECURITY DEFINER function (staleness predicate: `updated_at > indexed_at` OR stale `chunker_version` OR no state row; + `GRANT EXECUTE TO app`)
- [ ] 1.3 Wire function ownership reassignment to `app_rls` into `docker/postgres/rls-function-owner.sql` / `pnpm db:provision-rls` (same lifecycle as `llame_role_on_unit_path`); update `scripts/rls-test.sh` provisioning accordingly
- [ ] 1.4 Document the new migration exceptions + filename in `apps/api/AGENTS.md` Gotchas; verify `migration-journal.spec.ts` passes and a fresh `postgres:17-alpine` migrates as the non-superuser `app` role (spec: "Fresh database provisions cleanly")

## 2. Search core module (design D10 — corpus-agnostic, imports nothing from chats)

- [ ] 2.1 Create `apps/api/src/search/core/`: normalization (NFKC, whitespace collapse, lowercase; accents/code/URLs preserved) + `content_hash` (sha256 over version + normalized content + range) as pure functions; chunking toolkit (character-budget accumulator, overlap helper)
- [ ] 2.2 Implement the hybrid query builder: typed config (`table`+columns, `legs: [{kind: 'fts' | 'trgm' | 'custom', weight, limit}]`, `rrfK`, optional `groupBy` with weighted top-N, `tieBreak`) → composed `sql` statement; **`scopePredicate` is a required argument** (builder refuses to construct an unscoped query); snippet helpers (`ts_headline` + excerpt fallback)
- [ ] 2.3 Unit tests for the builder: RRF math, weighted top-N grouping, deterministic tie-breaks, scope predicate present in every candidate CTE, config validation (missing scope predicate throws)
- [ ] 2.4 Eval metrics module (Recall@K, MRR, zero-result rate) + dataset format types — corpus-agnostic runner core

## 3. Conversation chunker (design D2 — lives in `search/chat/`)

- [ ] 3.1 Implement the deterministic conversation chunker: text parts of user/assistant only (reasoning/tool/attachments/system excluded), `[user]`/`[assistant]` role markers, **3,000-char budget, 1-message overlap** (grill-locked v1 constants), oversized-message passthrough, message-range metadata, `CHUNKER_VERSION` + constants object
- [ ] 3.2 Unit tests: determinism/idempotence (same input ⇒ byte-identical chunks), boundary/overlap behavior, oversized message, exclusion rules (tool/reasoning/system content never serialized), non-ASCII normalization (Cyrillic casing, accents kept)

## 4. Queue extension + reindex pipeline (design D5, D6)

- [ ] 4.1 Extend the queue wrapper: `QueueOptions.policy` (typed to pg-boss v12 `QueuePolicy`) and `EnqueueOptions.singletonKey`; replace the `queue.ts:86` deferral note with the verified semantics; integration-test `'stately'` + `singletonKey` coalescing (one queued + one active per key)
- [ ] 4.2 Define `SEARCH_REINDEX_QUEUE` (`{ chatId, ownerUserId }`, policy `'stately'`, parse guard) and the projection service in `search/chat/`: rebuild-per-chat under `runAs(owner)` — read ordered messages, chunk, hash-diff, upsert changed, delete obsolete, upsert `search_chat_state`
- [ ] 4.3 Register the reindex consumer next to the existing co-located workers; enqueue hooks (post-persist, non-fatal on failure) at the **three** sites on master: user-message persist (`chat-loop.service.ts`), assistant finalization (`run-execution.service.ts` → `updateAssistantReply`), fork
- [ ] 4.4 Discovery sweep (pg-boss cron via `Queue.schedule()`, **5-minute cadence**): call `llame_search_stale_chats`, enqueue reindex jobs most-recently-active first; verify it doubles as backfill on empty state and as full rebuild on a `CHUNKER_VERSION` bump
- [ ] 4.5 Integration tests (jest `.integration`, DB-backed): fresh message indexed end-to-end; write-burst coalescing; edited assistant reply rebuilds; chat delete cascades; unchanged chat is a hash no-op; sweep repairs a deliberately-missed enqueue; sweep re-enqueues on version bump; discovery function returns identifiers only

## 5. Retrieval rewrite (design D3, D4)

- [ ] 5.1 Rewrite `ChatsRepository.searchByOwner` (same signature/DTO) as a consumer of the core builder: FTS + `word_similarity` trigram legs over `search_documents` + live-title leg over `chats`, all owner-scoped, RRF (k=60; fts 1.0 / trgm 0.35 / title 1.0), weighted top-3 chat aggregation (1.0/0.25/0.10), **pure-relevance ordering** with `updated_at DESC, chat_id` tie-break, `ts_headline` snippets (null for title-only), blank-query short-circuit, statement-timeout guard
- [ ] 5.2 Extend `chats-search.integration.spec.ts`: case-insensitive exact-title (Cyrillic included), typo/partial-word via trigram, content snippet vs title-only null snippet, blank query, relevance-order determinism; keep existing wildcard/system-tool-exclusion cases green
- [ ] 5.3 RLS negative tests in the harness suite: cross-tenant exact-match exclusion (both directions), public-chat-of-another-user exclusion through the search path, FORCE assertion (`relforcerowsecurity`) for both new tables; confirm `search_conversations` tool integration spec stays green (contract unchanged)

## 6. Web — #171 fix (design D7)

- [ ] 6.1 Command palette: exempt server search results from cmdk client-side filtering (id-keyed values / group-scoped filter disable); server rank order authoritative; verify quick-actions fuzzy matching unaffected
- [ ] 6.2 Repro-then-fix the sub-`MIN_SEARCH_LENGTH` recent-chats local filter for case folding if affected (per #171 acceptance); web unit tests: lowercased exact title surfaces via both paths, Cyrillic case included

## 7. Eval baseline (design D8)

- [ ] 7.1 Author the versioned dataset (`apps/api/test/search-eval/`): fixture conversations + labeled queries across exact/typo/paraphrase/ru/en/es/mixed/code categories
- [ ] 7.2 Env-gated harness (`RUN_SEARCH_EVAL`, `TEST_DATABASE_URL`-backed) on the core runner: index fixtures through the real chunker/projection, run `searchByOwner`; **hard floors asserted on exact-title / exact-content / typo categories** (expected chat in top-10); paraphrase + inflected-Russian recorded-only
- [ ] 7.3 Record the lexical baseline numbers in-repo (markdown next to the dataset), paraphrase categories annotated as the phase-3 measuring stick

## 8. Ship

- [ ] 8.1 Full verification: `pnpm --filter api lint` + `typecheck` + unit tests, web lint/tests, `apps/api/scripts/rls-test.sh` green including the new suites, `pnpm build` (openapi diff clean — no contract change expected)
- [ ] 8.2 CHANGELOG entry (same PR); note the phase-2 constraints recorded in D10 on issue #196; PR references: `Closes #195`, `Fixes #171`, refs #194; tick the #194 tracker checkbox on merge
