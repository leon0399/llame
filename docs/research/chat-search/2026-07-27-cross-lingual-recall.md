# Cross-lingual recall — asking in one language, finding a chat held in another

**Status:** Exploration — noncanonical; no spec/issue deltas applied yet
**Date:** 27 July 2026
**Question:** A user discusses something in Russian, something else in Spanish, and later — no longer remembering which language it was — asks (in English, via the palette or the assistant) to find it. What happens today, what will the adopted plan (#194, phases #195–#198) do about it, and where does the plan under-serve this exact scenario?
**Relation:** Follow-up to the [cross-report](./2026-07-12-chat-search-cross-report.md); grounded in the shipped phase-1 code (verified 2026-07-27) and current external evidence on cross-lingual retrieval bias.

---

## 1. Verdict

1. **Shipped phase 1 cannot bridge languages, by design and at every layer** — FTS, trigram, title leg, and the title _generation policy_ are all same-language surfaces. The only cross-language hits today are language-invariant tokens (code, error ids, URLs, Latin-script product names).
2. **The phase 2/3 embedding leg is the designed answer and will work for ru/en/es** (confidence: high — this language triple is first-tier for every current multilingual embedding model), **but with two structural weaknesses the plan does not currently name**: cross-lingual queries degrade to single-leg retrieval under RRF, and the vector leg itself carries a measured same-language bias (bge-m3: a same-language document is ~1.64× more likely to be retrieved than a cross-language one). The two compound.
3. **The eval dataset has no cross-language category**, so the phase-3 acceptance story cannot currently _measure_ the flagship multilingual scenario. This is the cheapest gap to close and should land before #196/#197 work starts.
4. **A zero-infrastructure bridge exists today** in the agent-facing path: the model can translate/fan out the `search_conversations` query across the user's languages. Nothing makes this deterministic — the tool description doesn't suggest it. One sentence fixes that, and the technique stays valuable _after_ embeddings land (a translated query revives the lexical + trigram legs).
5. **llame's architecture matches the 2025–2026 industry consensus** (light lexical + multilingual dense → RRF, inside one datastore) **except for one stage the industry treats as standard and the plan doesn't mention: a multilingual cross-encoder reranker over the fused top-K.** Reranking is the textbook fix for exactly the two weaknesses in §3 — it should be the named next step if the `cross` eval category underperforms after #197's tuning, ahead of any exotic debiasing (§5.3, §6.4).

---

## 2. Ground truth: the shipped phase-1 surface (verified in code)

| Layer         | Where                                                                                                                  | Cross-lingual behavior                                                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FTS leg       | `buildHybridSearchQuery` — `simple` config, `websearch_to_tsquery`                                                     | ✗ — surface-token match; EN query shares zero tokens with Cyrillic text                                                                                                                                                                         |
| Trigram leg   | `word_similarity` + ILIKE arm over `normalized_content`                                                                | ✗ for translation; partial for _transliteration_ within Latin↔Latin only ("valencia"→"Valencia" works; "испания"→"Spain" cannot)                                                                                                               |
| Title leg     | `chats.title` candidates                                                                                               | ✗ — and `TITLE_SYSTEM_PROMPT` **deliberately** instructs "Write the title in the same language as the conversation" (`apps/api/src/titles/title.ts`), so titles reinforce the same-language surface. Correct UX; don't "fix" cross-lingual here |
| Normalization | `normalizeForSearch` (`apps/api/src/search/core/text.ts`) — NFKC, lowercase, accent-preserving, **no transliteration** | Neutral — deliberately language-preserving (transliteration would merge distinct ru/es words); this is the right call and is not the place to bridge languages                                                                                  |
| Agent tool    | `search_conversations` (`apps/api/src/tools/search-conversations.ts`) — `query` ≤200 chars, `limit` ≤10                | Same repository path (`ChatsRepository.searchByOwner`), so same ✗ — but the _caller_ is an LLM that can translate (see §6.1)                                                                                                                    |
| Eval          | `apps/api/src/search/chat/eval/dataset.ts` — categories `ru`, `es`, `mixed` all use **same-language** queries          | Blind spot — no `cross` category; `BASELINE.md` already admits ru/es score 1.0 "only because the fixture queries reuse surface word forms"                                                                                                      |

What _does_ cross languages today: `SVM-1842`, `compose.yaml`, `gin_trgm_ops`, package names, URLs — Latin-script invariant tokens embedded in a Russian or Spanish chat. In technical usage this covers a meaningful share of real recall queries; in personal/household usage ("что мы решили про отпуск?") it covers ~none.

---

## 3. What phases 2–3 buy, and the two weaknesses they inherit

The adopted design (multilingual embedding leg, operator-config backend, bge-m3-class flagship via Ollama, 3-leg RRF in #197) does answer the core scenario: multilingual embedding models place ru/en/es paraphrases of the same content near each other in one vector space, so an EN query lands near the RU chunk without any language detection or translation. That part of the plan is sound and unchanged.

Two structural weaknesses, neither named in the cross-report or the phase issues:

### 3.1 Cross-lingual queries are single-leg retrieval

For an EN query over a RU chat, the FTS and trigram legs contribute nothing — RRF fuses one live leg. Consequences:

- Cross-lingual ranking quality equals raw embedding quality; the hybrid safety net exists only for same-language queries.
- Worse: RRF _sums_ leg contributions, so an English chat with incidental lexical overlap ("trip", "route") collects lexical + vector ranks while the true Russian target has vector-only evidence. Same-language near-misses are systematically advantaged in mixed-language corpora — precisely the corpus this user has.

### 3.2 The vector leg itself prefers the query's language

This is not hypothetical. Multilingual embeddings cluster by language before topic; measured effects ([The Cross-Lingual Cost, Arabic–English RAG corpora](https://arxiv.org/pdf/2507.07543)):

- OpenAI embeddings: a query-language document is **1.29×** more likely to be retrieved than an equally relevant cross-language one.
- **bge-m3: 1.64×** — the _stronger_ multilingual model shows _more_ same-language preference in mixed pools.
- Balanced-retrieval mitigations recover ~3–5% for bge-m3 and up to ~20% for mE5 in that study.

Related work confirms the mechanism (embeddings organize by language identity; [LAReQA](https://arxiv.org/pdf/2004.05484), [LangSAE post-hoc language-identity removal](https://arxiv.org/pdf/2601.04768)) and one counter-intuitive lever: [query-embedding interpolation toward English](https://arxiv.org/html/2606.13537v1) improves retrieval from non-English indices because English acts as the highest-quality anchor subspace.

**Compounding:** §3.1 biases the _fusion_ toward same-language chats; §3.2 biases the _vector leg itself_ the same way. For "I don't remember which language it was" — the exact scenario motivating multilingual search — both push against the correct answer. Expected practical effect for a personal ru/en/es corpus: the right chat still surfaces in top-10 most of the time (ru/en/es alignment is strong), but top-1/MRR will measurably favor query-language chats. Only an eval with a `cross` category will tell us whether that's acceptable or needs a mitigation from §6.

---

## 4. Embedding model landscape check (July 2026)

The cross-report's "bge-m3-class via Ollama" flagship remains a defensible default; the landscape has one notable addition since it was written:

- **bge-m3** — still the self-hosted multilingual workhorse (MIT, ~1.2 GB on Ollama, 100+ languages, 8k context, dense+sparse+multi-vector — we use dense only). Most-adopted option; known 1.64× same-language preference (§3.2).
- **Qwen3-Embedding (0.6b/4b/8b)** — tops the MTEB multilingual leaderboard (8b ≈ 70.6, 4b ≈ 69.5 on Ollama at Q4); supports instruction prefixes (fits the registry's `query_prefix` column) and **user-defined output dimensions 32–1024** (fits the dimensionless `vector` column + per-model partial index design as-is). 0.6b is 639 MB — a plausible _better-than-bge-m3_ default at comparable footprint, pending our own eval.
- Hosted (OpenAI text-embedding-3-large, Cohere embed-multilingual) remain adapter options behind `EmbeddingBackend`; nothing in the landscape disturbs the provider-neutral registry design.

Decision stays where the cross-report put it: operator config, local-first, and **the eval set — not leaderboards — picks the model**. That requires the eval to contain cross-language queries (§6.2).

Sources: [BentoML open-source embedding guide 2026](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models), [Ollama embedding benchmark roundup](https://www.morphllm.com/ollama-embedding-models), [Milvus RAG embedding comparison 2026](https://milvus.io/blog/choose-embedding-model-rag-2026.md), [M3-Embedding paper](https://arxiv.org/pdf/2402.03216).

---

## 5. Industry standard practice & SOTA (surveyed July 2026)

How the rest of the industry solves multilingual search, and where llame's adopted plan sits relative to it.

### 5.1 The consensus production pipeline

Elastic and OpenSearch — the two largest deployed search platforms — have converged on the same shape for multilingual search: a **light lexical leg + a multilingual dense leg, fused by RRF, with an optional multilingual reranker for top-K precision** ([Elastic Labs: multilingual embedding + hybrid + reranking](https://www.elastic.co/search-labs/blog/multilingual-embedding-model-hybrid-search-reranking), [OpenSearch: multilingual search](https://opensearch.org/blog/multilingual-search/)). Cross-lingual recall is explicitly assigned to the dense leg ("handle languages the analyzers don't support"), and Elastic's guidance names reranking as the fix for cross-lingual _precision_: a cross-lingual query yields many keyword-plausible results, but the top 1–2 aren't the most relevant without a reranker. This is the same pipeline used by Cohere's and OpenAI's RAG cookbooks (BM25 top-50 + dense top-50 → RRF top-100 → cross-encoder top-10).

llame's adopted plan (#194) is this pipeline **minus the reranker stage** — validating, not coincidental: the plan was derived from the same evidence base. The reranker is the one industry-standard component with no counterpart anywhere in #195–#198.

### 5.2 The hybrid-era stemming consensus retro-validates `simple` — conditionally

Current guidance has inverted the old default of aggressive per-language stemming: **in a hybrid setup the dense leg absorbs morphological recall, so the lexical leg should stem lightly or not at all** — aggressive stemming mostly adds false positives that fusion can't undo ([BigDataBoutique: light beats aggressive in the hybrid era](https://bigdataboutique.com/blog/stemming-in-elasticsearch-and-opensearch-hybrid-search)). llame's `simple`-config choice (zero stemming) is therefore the _industry-aligned end state_ — but only **once phases 2–3 land**. Today, with no dense leg, the no-stemming cost (inflected Russian recall) is unhedged, which `BASELINE.md` already documents honestly. The industry consensus strengthens the case for shipping #196/#197 rather than adding per-language tsvector configs in the interim.

### 5.3 Rerankers: the standard fix for §3, and the current SOTA options

A cross-encoder reranker scores query and document **jointly** — cross-attention over both texts — so the language-identity clustering that biases bi-encoder cosine similarity (§3.2) largely doesn't apply; multilingual rerankers are trained explicitly on cross-lingual pairs. Retrieve-then-rerank is the industry-standard two-stage pattern: bi-encoder/lexical legs optimize recall over the corpus, the reranker optimizes precision over the fused top 50–100 ([reranking guide](https://www.dataaihub.co/learn/re-ranking), [2026 reranker comparison](https://futureagi.com/blog/best-rerankers-for-rag-2026/), [local reranker guide](https://localaimaster.com/blog/reranking-cross-encoders-guide)).

Current landscape:

- **bge-reranker-v2-m3** — the open-source default (≈0.6B params, MIT-licensed lineage, multilingual, trained for cross-lingual settings); consistently named the best quality/latency/license combination for self-hosted production.
- **Qwen3-Reranker (0.6B/8B)** — generative pointwise rerankers from the same family as the §4 embedding challenger.
- **jina-reranker-v2** (CC-BY-NC — hosted API required for commercial use) and **v3** (listwise, ≈0.6B).
- **Cohere Rerank** — the managed-API default; multilingual, long-context.
- **ColBERT-style late interaction** — assessed as niche in 2026; the plain two-stage pipeline is simpler at equivalent quality.

Fit for llame (assessment, not a proposal): a reranker slots in as an optional **phase-3.5** stage behind the same operator-config/fail-degrade pattern as the embedding backend — absent config ⇒ RRF order ships as-is. Two real costs: (a) latency — a 0.6B cross-encoder over ~50 chunk-sized candidates is fine on GPU, borderline-seconds on CPU; acceptable for the agent path, questionable for palette keystroke search; (b) serving — stock Ollama does not serve cross-encoder rerankers (confidence: moderate), so it needs a TEI/Infinity-class server or in-process ONNX, a heavier operator ask than "pull bge-m3 in Ollama". Both costs argue for the plan's current sequencing: measure the `cross` eval after #197, and only then decide.

### 5.4 Benchmarks: what "multilingual SOTA" actually measures — and doesn't

- **MMTEB** has superseded English-centric MTEB as the de-facto embedding benchmark (250+ languages, 500+ tasks), with regional derivatives — **ruMTEB** is directly relevant to llame's Russian case ([MMTEB](https://arxiv.org/html/2502.13595v1)).
- **MIRACL** — the headline "multilingual retrieval" benchmark — is **monolingual retrieval in 18 languages**: query and corpus share a language. A model's MIRACL/MTEB-multilingual rank therefore does _not_ measure the cross-lingual scenario this note is about; that lives in separate, less-reported testbeds (LAReQA-style language-agnostic pools, XOR-TyDi, the §3.2 bias studies).
- **Leaderboard overfitting is documented**: Arctic-Embed 2.0's authors show models excelling on MIRACL degrade notably on CLEF, attributing it to training on MIRACL's Wikipedia domain ([Arctic-Embed 2.0](https://arxiv.org/pdf/2412.04506)). Commercial APIs drop 20–30% retrieval quality moving from English to lower-resource languages.

Consequence for #196: a model's public "multilingual" rank is a prior, not evidence — the in-repo eval set with a `cross` category (§6.2) is the only measurement that tests query-in-A/chat-in-B, and the industry's own caveats say to trust exactly that kind of judged, domain-local query set over leaderboards.

### 5.5 Postgres-native practice check

Staying inside Postgres for hybrid search is now a recognized production pattern, not a compromise: ParadeDB (`pg_search`/Tantivy BM25), Tiger Data's `pg_textsearch` (BM25 index access method, late 2025, `shared_preload_libraries` caveat on managed Postgres), and the widely-cited guidance to fuse tsvector/BM25 + pgvector with RRF in SQL ([ParadeDB hybrid-search manual](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual), [Tiger Data on hybrid Postgres search](https://www.tigerdata.com/blog/hybrid-search-postgres-you-probably-should), [J. Katz](https://jkatz05.com/post/postgres/hybrid-search-postgres-pgvector/)). **PGroonga** remains the named multilingual-lexical escape hatch — for CJK tokenization, which ru/en/es do not need — matching the plan's existing "only after measurements demand it" posture. Reranking, where used, is called out to an external model service, never done in-database — consistent with §5.3's serving note. Nothing in the ecosystem argues for leaving Postgres; the plan's architecture is the pattern the ecosystem is converging on.

### 5.6 What the big chat products do

Slack, Notion, and OpenAI do not publicly document their history-search architectures (ChatGPT's Slack integration advertises natural-language search over accessible messages, nothing about internals). The pattern teams building comparable systems replicate is the same one llame adopted: chunked content + MTEB-benchmarked multilingual embeddings + ANN + optional rerank. No evidence of a materially different industrial approach to the cross-lingual case; no correction to the plan from this quarter.

---

## 6. Mitigation catalog, ranked

### 6.1 Model-side query fan-out (works today, one sentence)

The agent path is the user's own framing ("ask model to find it in english"). The LLM already knows the query in every language; the tool allows repeated calls inside the bounded loop. Making it deterministic is a tool-description edit, e.g.: _"The user's chats may be in any language (e.g. English, Russian, Spanish). If a query finds nothing, retry it translated into the user's other languages before concluding there is no match."_

- Cost: zero infrastructure; a few extra bounded read-only tool calls.
- Value **persists after phase 3**: a translated query re-arms the lexical + trigram legs (§3.1), and translation + exact lexical match beats a biased vector rank for names and set phrases. Recent CLIR work is mixed on translation vs. native dense retrieval ([What Drives Cross-lingual Ranking?](https://arxiv.org/abs/2511.19324), [CLIRudit](https://arxiv.org/pdf/2504.16264)) — which argues for having _both_ legs, which is exactly what LLM-side fan-out plus the shipped hybrid gives us for free.
- Limitation: does nothing for the web palette (no LLM in that path). Palette users get cross-lingual recall only from phase 3.
- Natural home: #198 already owns `search_conversations` semantics; this is a phase-4-adjacent tweak that could ship any time.

### 6.2 Add a `cross` eval category now (before #196 starts)

Extend `dataset.ts` with recorded-only (unasserted, like `paraphrase`) queries, reusing the existing fixtures:

- EN→RU: `"week-long Spain itinerary"` → `ru-travel`; RU→EN: `"условные типы в TypeScript"` → `ts-generics`
- EN→ES: `"authentic paella recipe"` → `es-recipe`; ES→RU: `"ruta por España una semana"` → `ru-travel` (the adversarial one: the _Spanish_ query's true target is the _Russian_ chat while a Spanish chat about Spain-adjacent content exists — this directly measures §3.1/§3.2 compounding)
- Transliteration: `"marshrut po Ispanii"` → `ru-travel` (Latin-script Russian; today only the trigram leg could ever touch it, and can't)

Expected phase-1 baseline: 0.00 across the board — the honest measuring stick, same role `paraphrase` plays. Without this, #197's eval-gated tuning literally cannot see the flagship scenario, and the model choice in §4 has no cross-lingual signal.

### 6.3 RRF behavior under missing legs (phase-3 design note, not a change)

When tuning #197, evaluate cross-language queries _separately_ — aggregate Recall@10/MRR will be dominated by same-language queries and will hide §3 entirely. If the `cross` category underperforms, the cheap knobs in order: raise vector-leg weight for low-lexical-overlap queries (detectable as "FTS leg returned <N candidates"), or run the vector leg with a larger candidate pool. Both are query-time-only and eval-gated. Anything fancier needs evidence first — and the first "fancier" step is 6.4, not debiasing.

### 6.4 Multilingual reranker stage (industry-standard; candidate phase 3.5, evidence-gated)

If 6.3's cheap knobs don't close the `cross` gap, the industry-standard escalation (§5.1, §5.3) is a cross-encoder reranker over the fused top ~50: bge-reranker-v2-m3 self-hosted as the default candidate, behind the same operator-config/fail-degrade pattern as the embedding backend (absent config ⇒ RRF order unchanged). It attacks both §3 weaknesses at once — joint query–document scoring is largely blind to language-identity clustering, and it re-orders _after_ fusion so the single-leg disadvantage stops being terminal. Costs that keep it evidence-gated: CPU latency on keystroke-path palette search, and a serving surface Ollama doesn't cover (§5.3). Decision point belongs after #197's eval, not before.

### 6.5 Deliberately NOT recommended

- **Language detection / per-language tsvector configs** — already rejected in the adopted plan; nothing here changes that.
- **Document translation at index time** (translate every chunk into a pivot language) — storage + drift + provenance mess; CLIR evidence says dense retrieval derives little benefit from it and it can add noise.
- **English-pinned or bilingual titles** — titles-in-conversation-language is correct UX; cross-lingual recall belongs to the embedding leg, not the title surface.
- **Transliteration in `normalizeForSearch`** — would merge distinct ru/es words; the code comment's reasoning stands.
- **Embedding debiasing / query interpolation** (LangSAE, English-anchor mixing) — research-grade, and now clearly dominated: if bias proves material, the industry-standard reranker (6.4) is the proven mitigation; revisit debiasing only if even a reranker can't close the gap at personal-corpus scale (thousands of chunks, top-10 cutoff — unlikely).
- **ColBERT-style late interaction** — assessed as niche in 2026 (§5.3); the two-stage pipeline is simpler at equivalent quality.

---

## 7. Implications for spec/issues (NOT applied — exploration only)

If/when adopted, these become deltas:

1. `chat-search` spec, eval requirement: add "cross-language (query in one language, conversation in another; transliteration)" to the dataset categories (recorded-only) — the spec currently lists ru/es/mixed but not cross. Companion diff: `dataset.ts` + regenerated `BASELINE.md` (#195 follow-up sized; no schema impact).
2. #197 acceptance: report the `cross` category separately; state the single-leg + same-language-bias caveat so tuning doesn't optimize it away blindly — and name the reranker stage (6.4) as the designated escalation if `cross` underperforms, so the decision is pre-made and evidence-gated rather than re-litigated.
3. #198 (or earlier): `search_conversations` description gains the multilingual-retry sentence (§6.1).
4. #196 model-selection note: evaluate qwen3-embedding (0.6b first) alongside bge-m3 on the eval set, cross category included; treat public MIRACL/MTEB-multilingual ranks as priors only — they measure monolingual-in-many-languages, not this scenario (§5.4).
