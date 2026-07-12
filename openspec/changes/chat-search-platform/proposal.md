# Proposal: chat-search-platform

## Why

Chat search is a value-safe ILIKE over `chats.title` + an unindexed jsonb scan of message parts (`ChatsRepository.searchByOwner`, shipped as the MVP in PR #143 with "FTS/pg_trgm is the follow-up" written into its doc comment). It has no ranking, no typo tolerance, degrades linearly with data volume (bounded only by a 3 s `statement_timeout`), and the command palette re-filters its results client-side through cmdk — which drops server-matched hits and is the root of the case-sensitivity bug #171. This change is phase 1 of the chat-search → episodic-memory tracker (#194, issue #195): it builds the **search projection platform** (Postgres-only features — FTS + pg_trgm, no embeddings) that phases 2–4 extend, and because the `search_conversations` tool shares `searchByOwner` with the web palette (tool-calling D7), it upgrades the agent's episodic recall in the same stroke.

Design rationale is already settled and reviewed in `docs/research/chat-search/` (source doc + cross-report); this change implements the phase-1 slice of it.

## What Changes

- New **search projection**: `search_documents` table of contextual multi-message chunks derived from `messages` (deterministic, versioned, content-hashed chunker over text parts of user/assistant turns only), with RLS `ENABLE`+`FORCE` owner policies and **no public-read policy**.
- New Postgres extension dependency: `pg_trgm` (contrib, trusted — no image change; pgvector explicitly deferred to phase 2 / #196).
- **Rewritten retrieval** inside the same `searchByOwner` signature: FTS (`simple` config, `websearch_to_tsquery`) + trigram (`word_similarity`) + live title-match candidates, fused with Reciprocal Rank Fusion, aggregated to chats with weighted top-3 scoring, snippets via `ts_headline`. Response DTO and tool contract unchanged.
- New **asynchronous reindex pipeline** on pg-boss: per-chat rebuild jobs coalesced via queue policy `'stately'` + `singletonKey = chat_id`; the queue wrapper (`Queue`/`QueueOptions`/`EnqueueOptions`) gains the policy/singleton options it deliberately deferred. Includes cross-tenant dirty-chat discovery (SECURITY DEFINER, `app_rls`-owned — migration 0019 pattern) powering both backfill and drift repair.
- **Web fix (#171)**: the command palette stops re-filtering server search results through cmdk's client-side filter; server rank order becomes authoritative.
- New **relevance eval baseline**: small versioned in-repo dataset (exact/typo/paraphrase/ru/en/es/mixed/code queries) + opt-in harness recording Recall@10, MRR, zero-result rate — the baseline phase 3 (#197) is judged against.

Not breaking: `GET /api/v1/chats/search` request/response shape and the `search_conversations` tool schema are preserved.

## Capabilities

### New Capabilities

- `chat-search`: user-facing and agent-facing search over the user's own chats — matching semantics (title + user/assistant text content, case/typo tolerance, multilingual behavior), ranking, snippets, tenant isolation of the search path, and index freshness.
- `search-projection`: the derived, rebuildable search index — chunking determinism, content hashing, RLS invariants of projection tables, reindex triggering/coalescing, backfill/drift repair, and exclusion rules (system/tool/reasoning content never indexed).

### Modified Capabilities

- `tool-calling`: no requirement change expected (the `search_conversations` tool contract is preserved); listed for verification only — if spec text pins ILIKE-era behavior, a delta will adjust wording, otherwise no delta ships.

## Impact

- `apps/api/src/db/schema/` + migrations: new `search_documents` (+ per-chat index state), `CREATE EXTENSION pg_trgm`, FORCE RLS statements (hand-maintained exception, AGENTS.md Gotchas pattern).
- `apps/api/src/chats/chats-repository.ts` (`searchByOwner` rewrite), `chat-loop.service.ts` / run finalization / fork paths (reindex enqueue hooks).
- `apps/api/src/queue/` (`QueueOptions.policy`, `EnqueueOptions.singletonKey` with verified pg-boss v12 semantics).
- New `apps/api/src/search/` module (chunker, projection service, reindex worker/consumer).
- `apps/web` command palette (#171 fix); no API contract change.
- `scripts/rls-test.sh` suite grows the search-isolation negative tests (cross-tenant + public-chat exclusion).
- CHANGELOG entry; #195 closes on merge (fixes #171 as a rider).
