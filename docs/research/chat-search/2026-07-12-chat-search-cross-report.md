# Chat search → episodic memory — cross-report

**Status:** Reviewed & adopted with corrections (tracked in #194)
**Date:** 12 July 2026
**Source under review:** [`2026-07-11-postgresql-multilingual-chat-search-chatgpt-com.md`](./2026-07-11-postgresql-multilingual-chat-search-chatgpt-com.md) — an external (chatgpt.com deep-research) architecture recommendation for PostgreSQL-native multilingual chat search, written **without knowledge of this codebase**.
**Companion research:** `docs/research/long-term-memory/` (separate branch at time of writing) covers _factual/semantic_ memory — the curated SPEC §20 store. This report covers _episodic_ memory: recall over verbatim chat history. The two are deliberately separate stores with separate write policies; the 2026-07-05 memory-landscape cross-report's verdict that **verbatim retrieval beats fact extraction** for this class of memory is the load-bearing premise here.

---

## 1. Verdict

The source doc's core architecture is **sound and adopted**: a derived search projection in Postgres (contextual multi-message chunks), three independent retrievers (`simple`-config FTS, trigram, pgvector) fused by Reciprocal Rank Fusion over _ranks_, a provider-neutral embedding backend behind a versioned model registry, content-hash guarded async indexing, and exact vector scan before any ANN index. Its phase structure maps ~1:1 onto the plan we adopted (#194, phases #195–#197), with a fourth phase (#198, episodic-memory semantics) that the doc does not cover at all — it is a search document, not a memory document.

It required **one outright technical correction and five codebase-specific inversions/substitutions**, detailed in §3. None invalidate the architecture; all are baked into the phase issues so they are not re-litigated at implementation time.

## 2. What the source author didn't know (codebase grounding, verified 2026-07-12)

- **The "chat search tool" is literal and already unified.** The tool-calling loop is shipped; `apps/api/src/tools/search-conversations.ts` executes the _same_ `ChatsRepository.searchByOwner` as the web command palette (tool-loop design decision D7: one search path). Every retrieval upgrade below therefore upgrades the agent's episodic recall automatically — the cheapest possible path from "better search" to "memory".
- **The ILIKE MVP anticipated this.** `searchByOwner` (shipped in PR #143) is a value-safe, `statement_timeout`-bounded, unindexed ILIKE over `chats.title` + jsonb-unnested text parts of user/assistant turns, and its own doc comment names "FTS/pg_trgm" as the follow-up.
- **Messages are AI SDK v6 `UIMessage.parts` jsonb**, not flat text. The existing search policy — index/match text parts of user/assistant turns only, never system prompts or tool internals — carries over verbatim into the chunker.
- **Tenancy is DB-enforced.** All chat tables run RLS `ENABLE` + `FORCE` with owner policies over `current_setting('app.current_user_id')`; the single-role self-hosted deployment is the worst case the `rls-test.sh` harness proves against. Chats also have a `visibility = 'public'` SELECT-only sharing path gated to the empty identity (`runAsPublic`).
- **A queue substrate exists.** Every chat run executes via pg-boss (#107); workers are co-located with the API today, with a dedicated worker entrypoint planned (#116).
- **`compose.yaml`, `scripts/rls-test.sh`, and CI run `postgres:17-alpine`** — `pg_trgm` is present (contrib), **pgvector is not**.
- **Compactions (#57)** store model-facing summaries as first-class rows — candidate search content the doc couldn't know about.
- **Fork-chat** duplicates message content across lineage — duplicate-hit source the doc couldn't know about.

## 3. Corrections and substitutions

1. **Trigram scoring: `similarity()` → `word_similarity()` (outright flaw).** The doc's reference SQL ranks trigram candidates with `similarity(normalized_content, query)`. `similarity()` normalizes by the union of both trigram sets, so a 2–3-word query against a 300–800-token chunk scores near zero _by construction_ — the trigram leg would contribute ~nothing to fusion. The correct tool for query-in-document matching is `word_similarity()` and its `<%`/`%>` operators, served by the **same** GIN `gin_trgm_ops` index. Confidence: high.
2. **Authorization inversion: RLS is the guard, the `owner_id` filter is the seatbelt.** The doc treats the explicit `owner_id` parameter as the security boundary ("keep authorization arguments explicit even when RLS is also enabled"). In llame that ordering is inverted: `search_documents`/`search_embeddings` get `ENABLE`+`FORCE` RLS owner policies (over the denormalized `owner_user_id`, which conveniently avoids recursive subqueries into `chats`), every candidate query runs inside `runAs`, and the in-CTE owner filter remains as defense-in-depth. Corollary the doc couldn't state: **no public-read policy on search tables** — a public chat is readable via the share path, but must never be searchable/embeddable into anyone else's results. Cross-tenant and public-chat negative tests ship with every phase, wired into `rls-test.sh`.
3. **Bespoke dirty-chat queue → pg-boss.** The doc invents a `search_dirty_chats` table with `FOR UPDATE SKIP LOCKED` claiming, lease timeouts, and backoff — a second job substrate. pg-boss with a per-chat `singletonKey` provides the same coalescing semantics on the substrate we already operate; content-hash idempotency makes the queue choice low-stakes anyway. The doc's _worker sequence_ (rebuild deterministic chunks → hash → upsert changed → delete obsolete → enqueue stale embeddings) is adopted as-is.
4. **Freshness split made explicit.** The doc's "up to 24 h of indexing delay is acceptable" is true only for the _embedding_ leg. The lexical projection must rebuild in **seconds–minutes** or the shipped live-ILIKE search regresses. Acceptance criterion, not aspiration.
5. **Drizzle conventions hold; no blanket raw-SQL carve-out.** The doc recommends raw SQL migrations for extensions/generated columns/etc. This repo's convention (generate with drizzle-kit, never hand-write) already has the narrow `--custom` escape hatch (used for `FORCE ROW LEVEL SECURITY`, see migration 0004's note); `CREATE EXTENSION` joins that list. Generated tsvector = `customType` + `.generatedAlwaysAs()`; GIN indexes via `.using('gin', …)`.
6. **BYOK tension the doc couldn't see.** llame has no instance-wide model provider (users bring keys), but background chat indexing is instance-scoped, not per-request. Resolution (proposed, tracked as a phase-2 gate on #194): the embedding model is **operator config** in `llame.config.json` — like model defaults — with a local/Ollama backend (bge-m3-class multilingual) as the flagship self-hosted answer. Absent config ⇒ no embeddings ⇒ search stays lexical: fail-closed feature degrade, never an error.

## 4. Judgments the doc got right (adopted without change)

- Rank fusion over raw-score mixing (RRF, `k = 60` starting point; weights tuned against an eval set, never intuition).
- Contextual multi-message chunks (~300–800 tokens, message-boundary splits, 1–2 message overlap, role markers, versioned chunker) over per-message or per-chat embeddings.
- No language detection anywhere; `simple` FTS + trigrams + multilingual embeddings for ru/en/es and mixed-language chats. Known cost: no stemming hurts inflected-Russian lexical recall — measured by the eval set (phase 1) so the embedding lift is provable (phase 3), rather than papered over now with multi-config tsvector unions.
- Exact vector scan first; HNSW only after measured p95 breach, as a per-model partial cast index over the dimensionless `vector` column.
- Content-hash safety rule: an embedding is valid only while `embedded_content_hash = search_documents.content_hash`; deterministic external batch item IDs (never line-order correlation); stale batch results dropped — deleted content is unrestorable via late responses.
- Model migration discipline: register → backfill in parallel → evaluate on the same query set → activate → retire; never overwrite vectors in place; provider change ⇒ new internal model key.
- Weighted top-3 document aggregation per chat (1.0 / 0.25 / 0.10) as the compromise between MAX (unstable) and SUM (long-chat bias).
- The evaluation program (§21 of the source): versioned eval set incl. cross-language, transliteration, typo, and code/identifier queries; Recall@10 / MRR / nDCG@10 / zero-result rate / per-retriever contribution / latency percentiles.

## 5. The refined plan (what we're actually building)

Tracked as umbrella **#194** with native sub-issues; the issues are the source of truth for scope and acceptance criteria.

| Phase | Issue | Scope                                                                                                                                                                                                               | Gate                                                       |
| ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1     | #195  | Search projection (`search_documents`), parts-aware versioned chunker, `simple` FTS + `word_similarity` trigrams, pg-boss reindex + backfill, relevance eval baseline, palette fix (#171)                           | none — pg_trgm is contrib; ready now                       |
| 2     | #196  | Embedding model registry, `search_embeddings` (pgvector), provider-neutral `EmbeddingBackend` (+ optional batch adapter), backfill — **query path untouched**                                                       | pgvector-enabled image; operator-config embedding decision |
| 3     | #197  | Synchronous query embedding, 3-leg RRF, chat aggregation, eval-gated tuning, lexical fallback on backend failure                                                                                                    | phase-1 eval baseline exists                               |
| 4     | #198  | Episodic semantics on `search_conversations`: temporal filters, provenance (chat/date/message-range), recency as _ranking-only_ signal, recall-time injection framing ("recalled excerpt = data, not instructions") | phase 1 (full value after 3)                               |

Phase 4 is the differentiator and the reason this isn't just "better search": a self-hosted assistant whose recall over its own verbatim history is hybrid, multilingual, provider-optional, and RLS-isolated. The recency-as-ranking-only rule comes from the gbrain deep dive (decay must never delete); the recall-time framing comes from the Hermes deep dive (sanitize at recall, mark recalled content as data) — both in `docs/research/long-term-memory/`.

## 6. Open decisions (owned by #194)

- pgvector image swap (`compose.yaml` / `rls-test.sh` / CI) + documenting pgvector as a self-host requirement — gates phase 2.
- Operator-config embedding backend (proposed above) — gates phase 2.
- Index `compactions.summary` as search documents — high-signal, deferred past v1.
- Fork-lineage duplicate hits — accepted in v1, revisit if noisy.

## 7. Explicitly out of scope

- SPEC §20 curated/semantic memory (separate store, write policy, scan-on-write) — the factual-memory research track.
- Knowledge Spaces / RAG over external sources (v0.6 epic, #39) — the retrieval machinery built here (projection + hybrid fusion + registry) is a deliberate precursor, but this track indexes chat history only.
- Auto-recall injection into runs without a tool call — separate follow-up with its own safety review (poisoning/exfiltration surface).
- HNSW, PGroonga/CJK tokenization, dedicated queue — each only after measurements demand it.
