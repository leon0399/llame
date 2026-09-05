## Why

Chat retrieval is lexical only. The recorded baseline (`apps/api/src/search/chat/eval/BASELINE.md`) scores 0.00 on paraphrase and 0.50 / 0.33 on inflected Russian / Spanish because `simple` FTS does no stemming and a query that shares no tokens with a chat cannot be reached at all. The embedding layer (#196) already produces a vector for every chunk, and the canonical source contract (#609) already resolves a winning document to exact, owner-authorized coordinates — but nothing reads a vector at query time. This change turns the vector on as a third candidate leg, fused by rank with the existing lexical and trigram legs, so paraphrase and cross-language queries reach the right chat without weakening exact-identifier recall, tenant isolation, or the lexical fallback. Issue #197.

## What Changes

- A **vector candidate leg** joins the shared hybrid builder: an owner-filtered exact pgvector cosine scan over the projection, contributing only documents whose recorded model key is the corpus's current selection, whose `embedded_content_hash` still equals the live `content_hash`, and whose `embed_input_version` equals the current version. Stale, superseded, or unembedded documents contribute nothing. RRF fuses the three document legs plus the title leg; weights and `k` are constants chosen by a recorded comparison, not runtime knobs.
- The **query is embedded synchronously at request time** through the corpus's declared model and query prefix, before the tenant transaction opens, from the trimmed raw query — never the lexical normalization, because documents were embedded from original-cased content. One process-wide backend per corpus model is built on the request path regardless of worker profile.
- **Degradation is silent and bounded.** No configured model, a provider error, a timeout, or a vector of the wrong dimension all fall back to lexical + trigram retrieval with no user-facing error. The embed budget is a literal constant per surface: 10 s inside `search_conversations`, 1.5 s for the web palette. Fallbacks are logged with a reason; nothing waits on background embedding.
- A **vector-only model result** is shaped minimally: when the winning document has no lexically qualifying canonical line, `search_conversations` returns a `kind: "content"` result whose coordinates are the winning document's complete #609 message-local window and whose excerpt is a fixed crop at the window start. No match span, score, or semantic quote is invented. #198 owns any later reshaping.
- **Component ranks and matched-by legs** are retained internally for logs and the opt-in eval. The web response contract and the tool's input schema are unchanged; raw cosine, lexical rank, and RRF never appear as model-facing confidence.
- The **eval is split by evidence class.** Lexical floors keep running in CI. The vector lift (paraphrase, inflected ru/es, and six new rows: EN→RU, RU→EN, ES/EN, transliteration, a semantically adjacent hard-negative pair, and a long chat with many correlated chunks), the RRF and chat-grouping constant comparison, and exact-scan latency at synthetic owner sizes are an opt-in real-provider run recorded in `BASELINE.md`. CI never needs a provider or committed vectors. The role-label embedding A/B is deliberately not run and recorded as such.
- **Drive-by contract change:** built-in defaults move to `tools.callTimeoutSeconds: 120` (from 15) and `tools.maxStepsPerRun: 20` (from 8). The example config and both specs follow.
- **No ANN index.** Exact scan ships first; a per-model partial cast index is a follow-up only if the recorded owner-filtered p95 breaches a budget. No reranker, query translation, language detector, or chunk-context generation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-search`: the ranking requirement gains the vector leg, its validity filter, the request-time query embedding with per-surface budgets and silent lexical fallback, and the minimal vector-only model result; the tenant-isolation requirement extends its negatives to the vector leg; the eval requirement records the opt-in real-provider run, the new cross-language and hard-negative rows, and the floors the vector leg must not regress.
- `search-embeddings`: the "retrieval degrades rather than gates" requirement stops being vacuous — a query path now reads vectors — and gains the query-side rule that the query is embedded under the same binding (model key, revision, query prefix, dimensions) as the stored vectors, with dimension mismatch treated as absence.
- `tool-calling`: the documented built-in `tools.callTimeoutSeconds` default becomes 120.
- `instance-config`: the documented built-in defaults become `tools.maxStepsPerRun: 20` and `tools.callTimeoutSeconds: 120`.

## Impact

- **Code:** `apps/api/src/search/core/fusion.ts` gains an optional vector leg (shared kernel, so #546 reuses it); `chats-repository.ts` passes an optional query vector; both `searchByOwner` call sites embed before `runAs`; a request-path embedding backend provider joins `SearchModule`'s consumers; `tools/search-conversations.ts` shapes the vector-only result; `instance-config` defaults and `llame.config.json.example` change.
- **Schema:** none. No migration, no index.
- **Latency:** every search on a configured instance adds one provider round-trip bounded by the surface budget; the SQL adds one exact vector scan filtered by owner and model key. Recorded, not guessed, in the eval layer.
- **Cost:** one query embedding per search on a configured instance. Zero for a self-hosted backend, zero when no model is declared.
- **Tests:** fake-backend integration tests cover the model-key filter, stale-hash exclusion, dimension mismatch, provider failure and timeout fallback, cross-tenant / public / empty-identity negatives on the vector leg, RRF ordering, and the vector-only tool result. The opt-in eval is the only place a real provider is contacted.
- **Docs:** `SPEC.md` search section, `apps/api/CLAUDE.md` ("embeddings are produced but not read until #197"), `docs/conversation-recall.md`, `README.md` tool defaults, `CHANGELOG.md`.
- **Not affected:** the embedding write path, backfill, prune, retry-failed, the chunker, the projection schema, the `conversation_read` tool, and the public share egress.
