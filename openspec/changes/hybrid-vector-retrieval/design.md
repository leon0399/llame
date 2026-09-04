## Context

See proposal.md — Why. The pieces this change composes already exist:

- `search/core/fusion.ts` builds the hybrid query: two document legs (FTS, trigram) and a title leg, RRF with `k = 60`, weights `fts 1 / trgm 0.35 / title 1`, candidate caps `100 / 40 / 50`, and a weighted top-3 rollup `[1, 0.25, 0.1]` per Chat. A scope predicate is mandatory per side (throw on absence).
- `search_chat_documents` carries `embedding` (dimensionless `vector`), `embedding_model_key`, `embedded_content_hash`, `embed_input_version`. Documents were embedded from `content` verbatim (original case, role labels), never from `normalized_content`.
- `search.chats.embeddingModelId` selects the corpus model; `embeddingModels[]` declares provider, `providerModelId`, `revision`, `dimensions`, `distanceMetric`, and optional `documentPrefix` / `queryPrefix`. The binding ledger rejects a redefinition of an in-use key at boot.
- `EmbeddingBackend.embedQuery` exists and applies `queryPrefix`, but a backend is only constructed inside the `search-embed` worker. The `EMBEDDING_BACKEND` token is declared and uninjected.
- `searchByOwner` runs inside `tenantDb.runAs` at two call sites (`ChatsService.searchChats`, the `search_conversations` tool), sets `statement_timeout = 3000`, and lexically normalizes the query before the SQL.
- Model shaping hydrates the winning document through #609, then runs the canonical-line matcher; a document with no qualifying line is omitted today.
- The eval harness (`search-eval.integration.test.ts`) runs in CI under `test:integration` and asserts lexical floors; `RUN_SEARCH_EVAL=1` prints the summary that `BASELINE.md` records.

Decisions D1–D8 below were settled with Leo on 2026-09-05 before this proposal was written.

## Goals / Non-Goals

**Goals:**

- Add the vector leg where #546 (Knowledge hybrid retrieval) can reuse it unchanged.
- Keep both surfaces on one candidate path, with per-surface budgets as the only difference.
- Make every degradation path silent, bounded, and logged.
- Produce evidence that is reproducible without a provider for everything CI asserts, and reproducible with one for everything CI records.

**Non-Goals:**

- ANN indexes, rerankers, query translation, language detection, chunk-context generation, late interaction, fact extraction.
- Any new result kind, any change to the web response contract, any change to the tool input schema.
- Re-embedding the corpus or changing `embed_input_version`.
- Making the embed budget, fusion weights, `k`, or grouping configurable.

## Decisions

### D1. The vector leg is an optional third document leg in `search/core/fusion.ts`

`HybridSearchConfig` gains an optional `vector` block: the query vector, the active model key, the column names (`embedding`, `embeddingModelKey`, `embeddedContentHash`, `contentHash`), a weight, and a candidate cap. When present, a `vec_c` CTE ranks `embedding <=> <query>` ascending over rows matching the scope predicate, `embedding_model_key = <active>` and `embedded_content_hash = content_hash`, and `doc_fused` unions its term. When absent, the emitted SQL is byte-identical to today's. The query vector is bound as a typed `vector` literal, never interpolated as text.

Alternative: build the vector CTE in `chats-repository.ts`. Rejected — the builder is the shared kernel and #546 would copy the leg, the validity filter, and the fusion term.

### D2. Query embedding happens before `runAs`, from the trimmed raw query

`searchByOwner(ownerUserId, query, limit, queryVector?)` takes an optional vector. Each call site obtains it from a request-path `ChatSearchQueryEmbedder` (one per process, bound to the corpus model, `undefined` when no model is selected) before opening the tenant transaction, so a provider round-trip never holds a pooled connection or the 3 s statement timeout. The embedder receives `query.trim()`; `normalizeForSearch` stays where it is, applied to the lexical legs only, because document vectors were produced from original-cased `content` and asymmetric prefixes are the model's own case-sensitive convention. The issue text says "normalize, then embed"; that is corrected here.

Alternative: embed inside the transaction. Rejected — a hung provider would pin a connection for the whole budget, and the statement timeout does not cover it.

### D3. Budgets are literal constants, one per surface

`QUERY_EMBED_BUDGET_MS = { tool: 10_000, web: 1_500 }`. The tool constant is a fixed ceiling rather than a fraction of `tools.callTimeoutSeconds` (now 120 s by default, 300 s on Leo's instance) because the point of fallback is to hand the model lexical results quickly, not after a minute. A cold local embedder (Ollama, TEI) can miss the 10 s ceiling once on model load; that query degrades to lexical, the next is warm. No config key until someone hits that miss in practice.

Alternative: `search.chats.queryEmbedTimeoutSeconds`. Rejected as speculative configuration.

### D4. Degradation is a single code path with a logged reason

`embedQueryForSearch` returns `{ vector } | { fallback: reason }` where reason ∈ `no_model | provider_error | timeout | empty | dimension_mismatch`. Any non-vector outcome runs the lexical builder unchanged. The dimension check compares the vector length to the declared `dimensions` before SQL, so a mismatch can never reach pgvector as an operator error. The log line carries the reason, the surface, and the model key — never the query, credential, or owner content. Nothing retries, nothing waits on the embed worker or backfill.

### D5. Vector-only winners get the document window, not an invented span

When the canonical-line matcher yields no passage for a hydrated winning document, `search_conversations` returns `kind: "content"` with the document's complete #609 message-local window as `{ chatId, messageSeq, offset, limit }` and an excerpt cropped at the window start under the existing 500-code-point cap. This is the existing "fixed crop fallback" applied to the whole window instead of a qualifying line. No new result kind, no `matchedBy` in the public shape. #198 owns any later shaping. Documents that fail hydration are omitted exactly as today.

Alternative: `kind: "metadata"`. Rejected — it forces the model to guess a read range. Alternative: omit until #198. Rejected — AC4 would have nothing to test and the tool could not exercise the leg.

### D6. Fusion and grouping constants are chosen by one recorded comparison, then fixed

Starting hypotheses: vector weight 1 (parity with FTS), `k = 60`, vector candidate cap 100. The opt-in eval records Recall@10, MRR, nDCG@10, zero-result rate, per-leg contribution, and chat diversity for the constant grid (vector weight ∈ {0.5, 1, 1.5}, grouping ∈ {top-3 weighted, max-only, capped diminishing}) and the chosen set is written into `chats-repository.ts` with the comparison in `BASELINE.md`. The research memo's adaptive vector weight (boost when FTS returns few candidates) is a named follow-up, evidence-gated by the `cross` category.

### D7. Evidence is split by what CI can reproduce

CI (`test:integration`) keeps the lexical floors and gains fake-backend integration tests that plant vectors directly: model-key filter, stale-hash exclusion, dimension mismatch, provider error and timeout fallback, cross-tenant / public / empty-identity negatives on the vector leg, RRF ordering with a planted nearest neighbor, and the D5 tool result. The vector lift, the D6 comparison, and exact-scan latency at synthetic owner sizes (20k and 100k chunks, deterministic vectors) run only under `RUN_SEARCH_EVAL=1` with a real provider from `llame.config.json`, and their numbers land in `BASELINE.md`. No committed vectors: 3072-dim fixtures would be roughly 1 MB of noise in every diff for a ten-chat corpus.

Alternative: committed vector fixtures replayed in CI. Rejected by Leo — the eval stays out of CI.

### D8. The role-label A/B is not run

D11 of the embedding change kept role labels in the embedding input as a moderate-confidence call and deferred an A/B to this change. It is skipped: the fixture corpus is ten chats and cannot separate the conditions, and the experiment costs a full re-embed of a live 3072-dim corpus. `BASELINE.md` records it as not run; reversal remains one `embed_input_version` bump.

### D9. Tool defaults move in the same change

`tools.callTimeoutSeconds` 15 → 120 and `tools.maxStepsPerRun` 8 → 20 are a drive-by requested alongside this change. They are one delta each on `tool-calling` and `instance-config`, one line each in `BUILT_IN_DEFAULTS` and the example config, and their own stack layer so the retrieval review is not diluted. Leo's instance keeps its explicit 300 s timeout and moves steps to 20.

## Risks / Trade-offs

- [Same-language bias: RRF sums legs, so a query-language chat with incidental lexical overlap outranks a cross-language target that has vector-only evidence] → the eval reports `cross` separately from the aggregate; the adaptive-weight follow-up is filed only if that category underperforms.
- [Exact scan cost grows linearly with an owner's chunk count] → recorded p50/p95 at 20k and 100k synthetic chunks; an ANN follow-up is filed only if a budget is breached, and it would be a per-model partial cast index, never per tenant.
- [Web palette pays a provider round-trip per debounced keystroke] → 1.5 s ceiling, lexical results on miss, and the existing debounce already batches keystrokes.
- [A planted-vector test suite can pass while real semantics are poor] → CI proves plumbing and isolation only; the recorded opt-in run is the acceptance evidence and is part of the eval layer's exit criterion.
- [A request-path backend on every API process reaches the provider even when the operator only intended background embedding] → the backend is built only when `search.chats.embeddingModelId` is set, the same condition that already enables the worker; there is no separate switch to forget.
- [Dimensionless `vector` column: a row from another model could reach the `<=>` operator with a mismatched dimension] → the `embedding_model_key` filter sits in the same `WHERE` as the operator, and the leg is exercised by a fake-backend test that plants a wrong-dimension row under a superseded key.

## Migration Plan

No schema change. Deploy the API; instances without `search.chats.embeddingModelId` are unaffected. Instances with a selected model start embedding queries immediately and fall back to lexical whenever the provider is slow; no backfill is required first because unembedded documents simply do not enter the vector leg. Rollback is redeploying the previous API; stored vectors are untouched either way.

## Open Questions

None that change the specs, approach, or tasks. The chosen fusion constants (D6) and the recorded latency numbers (D7) are produced by the eval layer and written back into `BASELINE.md`.
