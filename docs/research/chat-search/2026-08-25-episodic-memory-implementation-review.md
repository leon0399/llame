# Episodic memory after #194: implementation review

Status: noncanonical research memo

Date: 2026-08-25

Scope: issue #194, its child issues, current repository contracts and code,
comparable systems, and retrieval research

## Executive Summary

The current issue stack is directionally sound but centered on the wrong risk.
Retrieval quality is measurable and replaceable. A false or untraceable quotation
is a product-integrity failure. Dense retrieval can identify a semantically
related Russian message from an English query; it cannot identify which English
words may be presented as an original quote. Search artifacts therefore must
never become evidence.

Keep canonical chats and message parts as llame's episodic source of truth. Use
lexical, trigram, vector, translated, contextualized, or generated text only to
locate candidates. Then re-authorize and rehydrate canonical source spans before
the model reads or cites them. For cross-language hits, return the exact
original-language excerpt and, optionally, a separately labeled generated
translation. The vector score proves neither the excerpt boundary nor that the
excerpt supports a downstream claim.

Hybrid retrieval through weighted Reciprocal Rank Fusion is the correct initial
candidate generator. It is not a confidence model. Keep component ranks, group
and diversify results by chat, and add a multilingual reranker only if measured
precision justifies its cost. Treat time as an explicit filter when the query is
temporal and otherwise as a weak tie-breaker. Do not let global recency decay bury
an older exact decision.

The issue sequence also needs correction. Invocation, corpus routing, consent,
and citation provenance are higher leverage than another retrieval leg and can
advance independently. Define the citation/read contract in #198 before #197
ships a vector-only hit shape; complete the two-chat invocation proof and owner
gate in parallel. Add true cross-language fixtures and end-to-end tool-invocation
metrics. Defer contextual prefixes, late interaction, fact extraction, and
temporal graphs until the simpler pipeline fails a named evaluation gate.

Confidence: high on the architecture boundary and issue corrections; moderate
on the eventual need for reranking or query translation because llame has not yet
run a representative multilingual retrieval experiment.

## Introduction

The phrase “episodic memory” hides three products:

1. a canonical historical record;
2. a retrieval system that locates relevant history; and
3. a policy for deciding when a model should look and what it may read.

Issue #194 increasingly recognizes this split: shipped work covers the lexical
projection, chunking, embedding write path, recency digest, and temporal framing;
open work covers hybrid retrieval, richer recall semantics, owner control,
recent-chat enumeration, chat-scoped search, model-generated chunk context, and
end-to-end evaluation [1]-[6]. The repository contract is narrower than some
older notes: chats, runs, messages, and events are episodic history; semantic
facts and automatic content injection remain outside the shipped product
[31]-[33].

That boundary should not be relaxed. Mem0-style extracted memories and
Graphiti-style temporal facts may become useful later, but they are derived
memory corpora. They are not substitutes for source-grounded conversation
evidence.

## Methodology

This review used the live GitHub issue graph on 2026-08-25, the repository at
commit `f39c14c3`, current OpenSpec contracts, implementation code, local research
notes, primary papers, standards, and official project documentation. Issue
bodies and research notes were treated as hypotheses, not authority. Shipped
specifications and code were used to establish current behavior; research and
comparable systems were used to challenge the proposed design.

The comparison dimensions were retrieval quality, invocation, multilingual
behavior, exact citation provenance, tenant isolation, latency/cost, operational
complexity, and reversibility. Vendor results were retained as directional
evidence, not independent validation. No retrieval experiment was run for this
memo; recommendations that depend on corpus behavior are therefore evaluation
gates rather than asserted implementation facts.

Confidence labels mean:

- **high**: directly supported by current code/specs, a standard, or convergent
  primary evidence;
- **moderate**: plausible and supported, but corpus- or deployment-dependent;
- **low**: speculative or based on narrow/vendor evidence;
- **unknown**: requires measurement or a product decision.

## Main Analysis

### Current state and issue graph

The shipped search path is still lexical. The `search_conversations` tool accepts
only `query` and `limit`, delegates to the same owner-scoped repository method as
the web surface, and returns chat-level snippets without canonical source spans
[34], [35]. The projection stores role-labeled derived content, hashes, message
ranges, and nullable embedding fields behind owner RLS [36]. The embedding
capability is explicitly write-only from the query path today [37].

This is an important correction to old design material. The accepted embedding
design chose nullable vector fields on the existing projection and one active
model binding per corpus, not parallel per-model tables or indefinite side-by-side
model residency [38]. The older cross-report remains useful for hybrid/RRF and
corpus separation, but parts of its storage and migration direction are stale
[41].

The work now divides into three lanes:

- **Invocation and awareness:** #216, #307, #327, and #331.
- **Retrieval and result quality:** #197, #198, and #518.
- **Governance and evaluation:** #326 and #600.

Treating these as a serial “vector database” project is self-deception. Better
ranking has zero value when the model does not know a relevant chat exists, and
unsafe value when a stale search hit can bypass current authorization. The lanes
share contracts but should progress independently.

### Retrieval is not evidence

A lexical match can often produce a natural highlight because the query tokens
occur in the source. A dense match has no equivalent property. A vector represents
the retrieval unit as a whole; cosine similarity does not identify a supporting
sentence, token range, or quote. Cross-language retrieval makes the distinction
obvious: an English vector query may correctly locate Russian source text, but no
English substring exists to quote.

The minimum trustworthy pipeline is:

1. retrieve derived child units;
2. return server-owned source pointers, not free-form generated excerpts;
3. re-check owner access at read time;
4. hydrate canonical message parts;
5. select one or more exact contiguous source spans;
6. validate each span against the current canonical content and content hash;
7. optionally translate after source resolution, with an explicit generated
   label.

The W3C Web Annotation model provides a useful selector pattern: combine an exact
quote with prefix/suffix context and, where useful, explicit text positions [18].
For llame, a citation should identify `chatId`, `messageId`, `partId`, role,
timestamp, original language, source content hash, exact text, optional
prefix/suffix, and explicitly defined offset units. The exact quote plus hash is
more robust than offsets alone when normalization or JavaScript UTF-16 indexing
would otherwise make “character” ambiguous.

An exact substring check proves provenance, not relevance. A model-selected span
can still be a bad citation. Citation evaluation must therefore test both source
exactness and whether the cited span supports the answer.

### Cross-language search and citation

Multilingual E5 and BGE-M3 show that a single dense representation can retrieve
across many languages [13], [14]. That supports multilingual dense recall as one
leg; it does not remove the need for lexical retrieval, source hydration, or
cross-language evaluation. Query/document language mismatch remains a distinct
information-retrieval problem, and query translation is a viable but fallible
expansion strategy [30].

Recommended behavior for an English query that finds a Russian message:

- `excerptOriginal`: exact Russian source text;
- `language`: `ru`;
- `translation`: optional English text marked `generated: true`;
- `retrievalBasis`: dense, lexical, trigram, title, or a combination;
- stable source selectors and timestamps;
- no claim that the translated wording is an original quote.

Do not create a translated shadow corpus first. Start with multilingual embeddings
and true cross-language fixtures. If recall remains weak, compare query-translation
fan-out, multilingual query rewriting, and a multilingual reranker. Query rewriting
can close vocabulary gaps, but it adds latency and can silently change intent [16].
Every variant must converge on the same canonical source resolver.

The existing evaluation cannot answer this question. Its `ru` and `es` cases are
same-language inflection cases, not English-to-Russian or Russian-to-English
retrieval; the published lexical baseline is already weak on those categories
[39], [40], [42]. Add bidirectional language-pair fixtures, mixed-language chats,
transliteration, named entities, code identifiers, and hard negatives before
tuning weights.

### Ranking and score semantics

RRF is a sensible first fusion method because lexical, trigram, and vector scores
are not calibrated to the same distribution. The standard form is:

`RRF(d) = sum(weight_i / (k + rank_i(d)))`

RRF's original `k = 60` was a robust experimental setting, not a universal
constant or probability [7]. PostgreSQL full-text rank normalization also does
not produce global relevance probability [9]. Exposing either RRF or cosine as a
model-facing confidence score would be false precision.

Use this staged ranking contract:

1. **Candidates:** owner-filtered lexical, trigram, and exact dense legs.
2. **Fusion:** weighted RRF using ranks; log component ranks and contributions.
3. **Grouping:** cap evidence from one chat and diversify the first result pass by
   chat so one long conversation cannot flood top-k.
4. **Hydration:** fetch canonical source windows.
5. **Optional reranking:** score only a bounded candidate set against canonical
   text with a multilingual cross-encoder if measured precision is inadequate.
6. **Temporal adjustment:** apply explicit time filters first; otherwise use
   recency only for near-ties or when temporal intent is present.

Cross-encoder reranking is a credible precision layer [15], but it is not free:
it adds model availability, latency, cost, and another failure mode. The current
fixed top-three per-chat weights in #197 are acceptable as an experiment, not a
contract. They reward long chats with many correlated chunks. Compare max-only,
capped diminishing evidence, and one-best-per-chat diversification on the same
fixture set.

The tool should return `rank`, `matchedBy`, component-rank diagnostics when useful,
time bounds, and provenance. It should not return a universal `confidence: 0.83`
unless that value has been calibrated against held-out judgments for the exact
model, corpus, and query class.

### “Partial vector match” means three different things

The term must be disambiguated before any decision:

1. **A smaller retrieval unit or child chunk:** keep it. Retrieve the child and
   hydrate the canonical parent evidence window.
2. **A user-visible subspan allegedly identified by one dense vector:** reject it.
   A vector-only hit cannot justify an exact quote boundary.
3. **A PostgreSQL partial ANN index:** defer until exact search breaches a measured
   latency gate. With dimensionless `vector`, pgvector requires a per-model
   expression/partial index for a fixed dimension. Filtered approximate scans can
   lose recall because filtering occurs after the ANN scan; iterative scans can
   mitigate that [8]. Do not create per-tenant vector indexes. Keep owner filtering
   in every search and read path, and compare ANN results against exact-search
   recall before activation.

Late-interaction multi-vector retrieval is a fourth possible interpretation. It
may improve localized matching, but it should follow the much cheaper sequence of
hybrid fusion, true multilingual evaluation, query expansion, and reranking.

### Invocation, awareness, and governance

Issue #194 correctly identifies invocation as the current bottleneck. Tool design
research likewise emphasizes explicit descriptions, targeted result shapes, and
clear positive/negative triggers rather than large generic tools [27]. The model
needs a low-friction path:

1. use pointer-only recent-chat awareness for vague references;
2. search broadly with natural-language queries;
3. refine by time or chat when necessary;
4. read a canonical range only after a useful hit;
5. cite exact source spans or abstain.

Automatic awareness may expose pointers such as chat ID, title, and time. It
should not silently inject historical message content. Search output and read
content remain untrusted historical data, not current instructions.

The evaluation plan in #600 is mostly right to separate tool invocation from
correctness given invocation [6]. One premise is now stale: proactive/context-
driven memory-retrieval benchmarks exist [28]. They do not replace a private llame
fixture corpus, but they provide a useful external comparison. LongMemEval remains
strong because it separates temporal, multi-session, update, and abstention
abilities and demonstrates that retrieval and reading can fail independently
[10]. LoCoMo remains useful as a smoke test [11], but an independent audit found
material annotation/category problems, so it should not be a release gate [29].

Governance is not a later hardening task. GateMem finds that useful recall,
principal-scoped access, and forgetting are not jointly solved by existing memory
methods [12]. For llame, search and follow-up read must both re-authorize under
current owner/consent state. A `hitId` is a locator, never a capability token.

### Comparable systems

#### obra/episodic-memory

obra validates the product shape closest to llame: verbatim local transcripts,
semantic/exact search, metadata filters, and a separate read operation [43], [44].
It does not establish multi-tenant isolation, hybrid ranking quality, or a hardened
historical-data framing contract. Borrow search/read separation and provenance;
do not copy raw retrieval injection as a safety model.

#### Mem0

Mem0's marketing material usefully emphasizes time, scope, context, and memory
type [19]. Its paper and current documentation center on extracting, consolidating,
and retrieving promoted memory objects, with raw storage requiring an explicit
non-inference path [20], [21]. That is a future semantic-memory corpus, not the
source of exact transcript evidence. “Semantic recall solved” is not a relevant
claim for llame until invocation, cross-language retrieval, provenance, and
tenant-negative tests pass.

#### Graphiti/Zep

Graphiti is the strongest surveyed provenance analogue because ingestion episodes
are first-class temporal objects and extracted facts can retain episode links
[22], [23]. It also supports hybrid retrieval and multiple reranking strategies
[24]. The cost is a graph extraction/mutation pipeline and domain schema. Use it
as evidence that temporal facts need provenance; do not make a temporal graph the
canonical transcript layer.

#### Letta, MemGPT, and LangMem

Letta's split between always-visible memory blocks and searchable message/archive
content reinforces llame's separation between small standing context and episodic
search [45], [46]. MemGPT provides the broader tiered-memory/explicit-transfer
model [25]. LangMem separates hot-path search tools from background extraction and
consolidation [26]. These are useful control-plane patterns; none supplies exact
message-span citations without a canonical source schema built by llame.

### Alternative implementation approaches

| Approach                                                | Strength                                            | Failure mode / cost                                         | Decision                           |
| ------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| Lexical/trigram/title only                              | Exact identifiers, cheap, easy highlights           | Misses paraphrase and cross-language meaning                | Keep as baseline and fallback      |
| Dense-only retrieval                                    | Simple semantic path                                | Weak exact identifiers, opaque scores, language/model drift | Reject                             |
| Three-leg hybrid RRF                                    | Robust candidate coverage without score calibration | Constants and chat aggregation still need evaluation        | Adopt first                        |
| Hybrid plus multilingual cross-encoder                  | Better top-rank precision                           | Extra model, latency, availability, cost                    | Gate on measured precision         |
| Query rewrite/translation fan-out                       | Recovers vocabulary and language mismatch           | Intent drift, duplicate candidates, latency                 | Test after base multilingual eval  |
| Child retrieval plus canonical parent hydration         | Separates recall unit from evidence unit            | Requires source pointers and read stage                     | Adopt                              |
| Contextualized embedding input (#518)                   | May disambiguate small chunks                       | Vendor-skewed evidence, generated-text trust/cost           | Defer and evaluate [17]            |
| Multi-key index: verbatim plus derived questions/events | Improves under-specified queries                    | More derived state and deduplication                        | Later; derived keys are noncitable |
| Late-interaction/multi-vector retrieval                 | Localized token-level matching                      | Storage/compute complexity; still not citation proof        | Defer                              |
| Extracted fact memory (Mem0-like)                       | Compact preferences and stable facts                | Extraction errors and source drift                          | Separate future corpus             |
| Temporal graph (Graphiti/Zep-like)                      | Structured update and temporal reasoning            | Highest schema and mutation cost                            | Defer                              |
| Long-context/digest injection                           | Avoids some tool calls                              | Context pollution, stale content, instruction risk          | Pointer awareness only             |

## Synthesis

### Recommended architecture

Use two distinct tool operations, even if the first release presents them behind
one model workflow:

**`search_conversations`**

- input: natural-language query, bounded limit, optional explicit time range and
  optional chat scope;
- processing: owner-scoped candidate legs, RRF, grouping/diversification;
- output: opaque hit ID, chat identity/title, matched message/part pointers, time
  bounds, exact original excerpt when already resolvable, `matchedBy`, and
  component ranks;
- no full history, raw cosine, generated quote, or authorization grant.

**`read_conversation_range`**

- input: hit ID or server-validated chat/message range plus a small context window;
- processing: current owner/consent re-check and canonical part hydration;
- output: ordered canonical messages, exact selectors, timestamps, roles, source
  hashes, and optional labeled translations;
- fail closed if the hit is stale, deleted, changed, or no longer authorized.

The retrieval projection may contain normalized text, deterministic temporal
anchors, generated contextual prefixes, translations, and embeddings. Every one
of those fields is derived and noncitable. The projection points to canonical
messages; canonical messages never point to the projection as truth.

For a narrow excerpt, prefer deterministic sentence/clause boundaries plus exact
source selectors. A reranker or model may choose among candidate spans, but the
server must verify the returned text is an exact current substring. If support is
ambiguous, return the larger exact message/turn window. Precision theater is
worse than a longer honest quote.

### Evaluation and scorecard

Measure three layers independently:

| Layer      | Required metrics                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retrieval  | Recall@10, MRR, nDCG@10, zero-result rate, per-leg contribution, exact-vs-ANN recall, chat diversity                                                 |
| Citation   | exact-source validity, speaker/time attribution, quote support, span precision/coverage, original/translation labeling                               |
| End to end | invocation precision/recall, correct corpus/tool, correctness given invocation, supported-answer rate, abstention, cross-tenant denial, latency/cost |

Required slices include same-language lexical, paraphrase, bidirectional
cross-language pairs, code/identifiers, explicit temporal queries, vague recent
references, old-but-exact decisions, updates/contradictions, multi-chat synthesis,
oversized messages, deleted/stale hits, and malicious instructions inside recalled
content.

Do not accept “hybrid beats lexical on average.” Require non-regression on exact
identifiers and owner isolation, improvement on paraphrase/cross-language slices,
and citation exactness of 100% for every returned quote. Report confidence
intervals or repeated-run variance for model-dependent stages. Any approximate
index must be compared against exact owner-filtered search on the same queries.

## Counterevidence Register

- **Exact search may remain enough for a long time.** pgvector ANN work could be
  pure operational theater at current corpus sizes. That is why the recommendation
  is latency-gated, not scheduled.
- **A reranker may not pay for itself.** Hybrid RRF may already produce sufficient
  top results. Add the dependency only after a blinded precision comparison.
- **Generated chunk context has positive vendor evidence.** Anthropic reports
  substantial retrieval-failure reduction from contextualization and reranking
  [17]. The evidence is not independent, and llame's conversational chunks differ
  from enterprise document chunks.
- **Automatic content injection can improve recall without tool invocation.** It
  also raises token cost, irrelevant-context load, instruction-confusion risk, and
  consent complexity. Pointer-only awareness preserves the benefit needed to
  trigger retrieval without preloading historical content.
- **Temporal graphs can outperform flat retrieval on update questions.** That may
  justify a future derived fact/event layer. It does not justify replacing
  canonical transcripts or blocking the simpler episodic-search path.
- **Message-range provenance is cheaper than exact spans.** It is acceptable for
  an initial read result only if the product does not present a narrower generated
  sentence as an exact citation. Exact quoting requires exact selectors.

## Claims-Evidence Table

| Claim                                                                                  | Evidence                                                                              | Confidence |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------- |
| Current vector state is derived and unused by query search                             | Current spec/code and archived design [34]-[38]                                       | High       |
| Hybrid rank fusion is a sound initial candidate layer, not a confidence probability    | RRF, PostgreSQL, and pgvector references [7]-[9]                                      | High       |
| Cross-language retrieval does not authorize translated quotation                       | Multilingual retrieval research plus annotation selectors [13], [14], [18], [30]      | High       |
| Invocation must be evaluated separately from retrieval correctness                     | #194/#600, tool research, proactive benchmark, LongMemEval [1], [6], [10], [27], [28] | High       |
| Extracted fact/graph memory is adjacent to, not a replacement for, transcript evidence | Mem0, Graphiti/Zep, and repo contract [19]-[24], [31], [32]                           | High       |
| Reranking and contextualization may help but require corpus-specific gates             | BERT reranking and vendor contextual retrieval [15], [17]                             | Moderate   |

## Limitations

This is a design review, not an implementation benchmark. It did not run llame's
private corpus, compare embedding models on the deployment hardware, measure exact
scan latency, or calibrate reranker cost. Several comparable-system claims come
from vendor-authored papers or documentation. The 2026 proactive-retrieval and
governance benchmarks are new and have less replication than LongMemEval. The
recommended selectors still require a concrete decision on offset units and
message-part mutability. Those unknowns are precisely why model choice, ANN, and
generated retrieval context remain gated experiments rather than architecture
commitments.

Two adjacent spec/code drifts were observed but are not resolved here: the
embedding spec asks for explicit per-item result identifiers while the provider
adapter validates provider indexes and position-zips results; the coverage spec
asks for lexical state alongside embedding counts while the current operator
readout omits that lexical field. They should be corrected separately, not folded
into #197.

## Recommendations

Prioritized by leverage:

1. **Rewrite #198's provenance acceptance criteria first.** Define canonical
   source selectors, original-language excerpts, labeled translations, stale-hit
   behavior, and authorization on read. Confidence: high.
2. **Split search from canonical read.** Keep a small search result and add an
   owner-rechecked range read. Do not let a hit ID act as authorization.
   Confidence: high.
3. **Tighten #197 before implementation.** Add true cross-language fixtures,
   component-rank observability, chat-diversity evaluation, exact-search baseline,
   and a measured gate for ANN/reranking. Treat `k = 60` and top-three aggregation
   weights as hypotheses. Confidence: high.
4. **Advance invocation and governance in parallel.** Complete #216, #326, #327,
   and #331 without waiting for perfect semantic ranking. Evaluate invocation and
   correctness-given-invocation separately. Confidence: high.
5. **Keep #518 and larger memory architectures behind failures.** Contextual
   prefixes, query translation, late interaction, extracted facts, and graphs
   must each solve a named failed slice before adding permanent complexity.
   Confidence: high.

The immediate decision is not which embedding model to choose. It is whether
llame will guarantee this invariant:

> Approximate retrieval may locate evidence; only current, authorized canonical
> message content may be quoted as evidence.

If that invariant is not accepted, the rest of the score tuning is noise.

## Bibliography

[1] llame issue #194, “tracking: chat search to episodic memory.” [Source](https://github.com/leon0399/llame/issues/194)

[2] llame issue #197, “Hybrid chat retrieval: query embeddings, RRF fusion, scoring.” [Source](https://github.com/leon0399/llame/issues/197)

[3] llame issue #198, “Episodic memory: temporal recall, provenance, recency ranking, safe framing.” [Source](https://github.com/leon0399/llame/issues/198)

[4] llame issue #216, “Prove safe two-chat episodic recall.” [Source](https://github.com/leon0399/llame/issues/216)

[5] llame issue #518, “Model-generated chunk context for embedding input.” [Source](https://github.com/leon0399/llame/issues/518)

[6] llame issue #600, “Long-term memory benchmark once episodic recall and indexed Knowledge ship.” [Source](https://github.com/leon0399/llame/issues/600)

[7] Cormack, Clarke, and Büttcher, “Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods,” 2009. [Source](https://cormack.uwaterloo.ca/cormack/cormacksigir09-rrf.pdf)

[8] pgvector documentation. [Source](https://github.com/pgvector/pgvector/blob/master/README.md)

[9] PostgreSQL, “Controlling Text Search.” [Source](https://www.postgresql.org/docs/current/textsearch-controls.html)

[10] Wu et al., “LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory,” 2024. [Source](https://arxiv.org/abs/2410.10813)

[11] Maharana et al., “Evaluating Very Long-Term Conversational Memory of LLM Agents,” 2024. [Source](https://arxiv.org/abs/2402.17753)

[12] “GateMem: Benchmarking Memory Governance in Multi-Principal Shared-Memory Agents,” 2026. [Source](https://arxiv.org/abs/2606.18829)

[13] Wang et al., “Multilingual E5 Text Embeddings: A Technical Report,” 2024. [Source](https://arxiv.org/abs/2402.05672)

[14] Chen et al., “BGE M3-Embedding,” 2024. [Source](https://arxiv.org/abs/2402.03216)

[15] Nogueira and Cho, “Passage Re-ranking with BERT,” 2019. [Source](https://arxiv.org/abs/1901.04085)

[16] Ma et al., “Query Rewriting in Retrieval-Augmented Large Language Models,” 2023. [Source](https://aclanthology.org/2023.emnlp-main.322/)

[17] Anthropic, “Introducing Contextual Retrieval,” 2024. [Source](https://www.anthropic.com/engineering/contextual-retrieval)

[18] W3C, “Web Annotation Data Model,” 2017. [Source](https://www.w3.org/TR/annotation-model/)

[19] Mem0, “Episodic memory for AI agents,” 2026. [Source](https://mem0.ai/blog/episodic-memory-for-ai-agents)

[20] “Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory,” 2025. [Source](https://arxiv.org/abs/2504.19413)

[21] Mem0 documentation, “How it works.” [Source](https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/how-it-works.mdx)

[22] Rasmussen et al., “Zep: A Temporal Knowledge Graph Architecture for Agent Memory,” 2025. [Source](https://arxiv.org/abs/2501.13956)

[23] Graphiti documentation, “Adding Episodes.” [Source](https://help.getzep.com/graphiti/core-concepts/adding-episodes)

[24] Graphiti documentation, “Searching the Graph.” [Source](https://help.getzep.com/graphiti/working-with-data/searching)

[25] Packer et al., “MemGPT: Towards LLMs as Operating Systems,” 2023. [Source](https://arxiv.org/abs/2310.08560)

[26] LangMem, “Core Concepts.” [Source](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)

[27] Anthropic, “Writing effective tools for AI agents,” 2025. [Source](https://www.anthropic.com/engineering/writing-tools-for-agents)

[28] “When Users Do Not Ask: Benchmarking Context-Driven Memory Retrieval,” 2026. [Source](https://openreview.net/pdf?id=jaAA72U0tr)

[29] LoCoMo Benchmark Audit. [Source](https://github.com/dial481/locomo-audit)

[30] Zhang et al., “Document Translation vs Query Translation for Cross-Lingual Information Retrieval,” 2020. [Source](https://aclanthology.org/2020.acl-main.613/)

[31] llame `SPEC.md` at `f39c14c3`. [Source](https://github.com/leon0399/llame/blob/f39c14c3/SPEC.md)

[32] llame `VISION.md` at `f39c14c3`. [Source](https://github.com/leon0399/llame/blob/f39c14c3/VISION.md)

[33] llame `ROADMAP.md` at `f39c14c3`. [Source](https://github.com/leon0399/llame/blob/f39c14c3/ROADMAP.md)

[34] llame `search_conversations` tool implementation at `f39c14c3`. [Source](https://github.com/leon0399/llame/blob/f39c14c3/apps/api/src/tools/search-conversations.ts)

[35] llame `ChatsRepository` search implementation at `f39c14c3`. [Source](https://github.com/leon0399/llame/blob/f39c14c3/apps/api/src/chats/chats-repository.ts)

[36] llame search schema at `f39c14c3`. [Source](https://github.com/leon0399/llame/blob/f39c14c3/apps/api/src/db/schema/search.ts)

[37] llame search-embeddings specification at `f39c14c3`. [Source](https://github.com/leon0399/llame/blob/f39c14c3/openspec/specs/search-embeddings/spec.md)

[38] llame archived chat-search embedding design at `f39c14c3`. [Source](https://github.com/leon0399/llame/blob/f39c14c3/openspec/changes/archive/2026-08-23-add-chat-search-embeddings/design.md)

[39] llame chat-search evaluation dataset at `f39c14c3`. [Source](https://github.com/leon0399/llame/blob/f39c14c3/apps/api/src/search/chat/eval/dataset.ts)

[40] llame chat-search evaluation baseline at `f39c14c3`. [Source](https://github.com/leon0399/llame/blob/f39c14c3/apps/api/src/search/chat/eval/BASELINE.md)

[41] llame noncanonical chat-search cross-report, 2026-07-12. [Source](https://github.com/leon0399/llame/blob/f39c14c3/docs/research/chat-search/2026-07-12-chat-search-cross-report.md)

[42] llame noncanonical cross-lingual recall follow-up, 2026-07-27. [Source](https://github.com/leon0399/llame/blob/f39c14c3/docs/research/chat-search/2026-07-27-cross-lingual-recall.md)

[43] llame research note on obra/episodic-memory, 2026-07-12. [Source](https://github.com/leon0399/llame/blob/f39c14c3/docs/research/chat-search/2026-07-12-obra-episodic-memory.md)

[44] obra, `episodic-memory` README. [Source](https://github.com/obra/episodic-memory/blob/main/README.md)

[45] Letta documentation, “Memory blocks.” [Source](https://docs.letta.com/guides/core-concepts/memory/memory-blocks/)

[46] Letta documentation, “Search messages.” [Source](https://docs.letta.com/api/typescript/resources/messages/methods/search)
