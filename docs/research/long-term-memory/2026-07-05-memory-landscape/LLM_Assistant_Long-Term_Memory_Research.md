# Long-Term Cross-Chat Memory for AI Assistants: State of the Field, Hype Assessment, and Recommendations for llame

**Date:** 2026-07-05 · **Mode:** deep (8-phase pipeline, 5 parallel retrieval agents) · **Sources:** 87 unique, 101 evidence items · **Audience:** staff-level technical, architecture-decision use case

---

## Executive Summary

The cross-chat memory field in mid-2026 has a working consensus on *mechanics* and near-total anarchy on *evaluation*. Three architectural camps compete — fact extraction (Mem0), temporal knowledge graphs (Zep/Graphiti), and verbatim-storage-plus-retrieval (MemPalace, RAG-over-transcripts) — and every one of them has published benchmarks showing itself winning. The benchmarks are the least trustworthy artifact in the space: Mem0 and Zep publicly accused each other of misconfigured evaluations of each other's systems [31][32], MemPalace's headline scores collapsed under independent audit [1], and LongMemEval numbers for the same products vary by 30+ points across sources [52].

Underneath the marketing, the load-bearing empirical findings are: (1) a controlled ablation found **verbatim chunks beat LLM-extracted facts by 15.9–22 points**, and extraction never beat naive RAG [7] — write-time extraction as the *sole* memory representation is on shaky ground; (2) production assistants (ChatGPT, Claude) independently converged on **two tiers** — a small explicit/editable fact layer plus retrieval over raw history — with consolidation moved to **asynchronous background jobs** [38][39][41]; (3) **temporal reasoning and knowledge-update/contradiction handling are the universal weak point** of every system tested [3][5][6]; Zep's bi-temporal `valid_at`/`invalid_at` model is the cleanest mitigation and requires no graph database [9]; (4) **memory decay is proven as a cost optimization, unproven as a quality improvement** — and the Ebbinghaus-curve framing itself is contested as phenomenological rather than mechanistic [19][20][6].

**MemPalace verdict:** real engineering, misleading benchmarks, wrong problems for llame. Its two stealable ideas are the ~170-token layered wake-up budget and the deterministic zero-LLM write path [1]. Its spatial metaphor is metadata filtering with branding [1], it has no forgetting, no multi-user story, and an unbounded-growth storage model [1][2].

**For llame:** your instincts are directionally correct and, unusually, ahead of most of the market on the multi-user question. The recommended architecture is a Postgres-native `memory_facts` layer (scope inherited from the chat's container, RLS-enforced at read time, bi-temporal columns, immutable provenance), retrieval over the existing run/event log as the episodic layer, async consolidation via the existing pg-boss queue, and a decay *framework* that stores raw signals now and defers any scoring formula to retrieval-time ranking — never destructive deletion. The shared-vs-private vault design you sketched matches the strongest available research (Collaborative Memory [26], GateMem [27]) almost exactly, with one correction: scope must be inherited from the conversation container and promoted only by explicit user action, never inferred by a classifier reading private chats.

---

## 1. Introduction: Scope, Method, Assumptions

**Question.** What is real vs. hype in LLM assistant long-term cross-chat memory as of July 2026 — papers, systems, decay/salience scoring, multi-user shared memory, file-first architectures — and what should llame build?

**Method.** Deep-mode pipeline: 4 orientation searches, then 5 parallel deep-dive agents (MemPalace verification; academic survey 2023–2026; production systems; multi-user/shared memory; file-first architectures, including source-level inspection of the local OpenClaw and Hermes Agent checkouts). 101 evidence items persisted to `evidence.jsonl`; 87 unique sources in `sources.jsonl`. Claims below carry explicit confidence levels; low-confidence single-source claims are marked.

**Assumptions.** (a) Recommendations target llame's existing constraints: TypeScript/NestJS, Postgres as sole system of record under FORCE RLS, Drizzle, pg-boss queue, groups/projects as first-class entities, wiki-centric Knowledge Spaces (SPEC §15), planned memory layer (SPEC §20). (b) Recency emphasis July 2024–July 2026; foundational papers from 2023 included. (c) "Memory" here means durable cross-chat state, distinct from within-run context management and from Knowledge Space document indexing — though the boundary with the latter is deliberately porous in llame's design.

---

## 2. Finding 1 — The field has three camps, and the honest answer is "hybrid, tiered"

The 2023–2024 generation established the vocabulary: MemGPT's OS-style memory hierarchy (paged context, archival store) [15], Generative Agents' retrieval scoring by `recency × importance × relevance` [16], MemoryBank's Ebbinghaus decay [17], Reflexion's episodic self-notes [4-biblio]. From 2025 the field split into camps:

- **Extraction pipelines** (Mem0 [8]): an LLM extracts candidate facts at write time and applies ADD/UPDATE/DELETE/NOOP against the store. Dominant production baseline; $24M Series A, AWS Strands' exclusive memory provider [49].
- **Temporal knowledge graphs** (Zep/Graphiti [9], HippoRAG 1/2 [10][11], MAGMA [13], EverMemOS [14]): entities and relations with temporal validity; retrieval via graph traversal or Personalized PageRank.
- **Verbatim + retrieval** (MemPalace [1][2], and the quieter position that plain RAG over stored transcripts is a strong baseline): store everything, defer all relevance decisions to query time.

Three results cut across the camp marketing:

**Extraction has a structural flaw.** The controlled ablation "Verbatim Chunks Beat Extracted Artifacts" (arXiv:2601.00821) isolated *representation only* — same retrieval, same reader — and found LLM-extracted artifacts lose to raw verbatim chunks by 15.9 points on LoCoMo and 22.0 points on LongMemEval-S, with extraction *never* beating naive RAG [7]. The mechanism is obvious in hindsight: extraction commits to what will matter before the question is known; verbatim defers that decision to retrieval time. Confidence: moderate-high (single paper, but consistent with MemPalace's independent result [1] and with Anthropic's agentic-search experience [48]). Implication: **an extracted-facts store must never be the only memory; raw history must stay retrievable.**

**Graphs pay off narrowly, not universally.** Mem0's own graph variant (Neo4j + multi-stage entity extraction) beat its plain vector variant on only 2 of 4 LoCoMo categories, unexplained by the authors [50]. Zep's genuinely valuable contribution is not "graph" but **bi-temporality**: four timestamps distinguishing when a fact was true in the world (`valid_at`/`invalid_at`) from when the system learned/invalidated it, with superseded facts invalidated rather than deleted [9]. That idea ports to plain relational columns.

**Production converged on tiers, not camps.** ChatGPT: Saved Memories (explicit, editable) + reference-chat-history (implicit) [38-adjacent]; reportedly rebuilt around background synthesis in June 2026 after internal time-sensitive accuracy of the original system measured 9.4% (low confidence, single secondary source [59]). Claude went the opposite direction — started with pure retrieval-time search over raw transcripts and *no* preloaded profile [38], added a synthesized, user-editable memory layer later (reported March 2026; low confidence [60]) — and Anthropic's API memory tool is deliberately primitive: six file operations, no embeddings, no vector DB, full developer ownership [39][40]. Letta (the MemGPT company) landed on memory blocks + sleep-time background agents + a git-backed markdown projection of memory (MemFS) [41][43]. Everyone ended up with: **small always-loaded core, explicit editable facts, retrieval over raw history, async consolidation.** That convergence — reached independently from opposite starting points — is the most reliable signal in this entire research area.

The most credible academic synthesis agrees: FluxMem argues different memory units want different structures and adaptive/hybrid selection beats any fixed representation [61]; the major 2026 survey rejects the long/short-term dichotomy entirely in favor of forms × functions × dynamics [24]. "Which camp wins" is the wrong question.

---

## 3. Finding 2 — MemPalace: separable halves of engineering and theater

MemPalace (April 2026, Ben Sigman + Milla Jovovich; ~7k stars in 48h, ~48k in two weeks — the commonly repeated "22K in 48 hours" is inflated [1]) is the most instructive case study in the space, because an independent arXiv critique (2604.21284) plus the maintainers' own retractions did a clean autopsy while the project was still viral.

**What does not survive scrutiny (high confidence, primary-source quotes in `evidence.jsonl`):**
- The 96.6% LongMemEval Recall@5 is attributable to **verbatim storage + ChromaDB's default all-MiniLM-L6-v2 embeddings**, not the spatial architecture. The Wings→Rooms→Closets→Drawers hierarchy "operates as standard vector database metadata filtering" [1].
- The "100%" LongMemEval claim required undisclosed iterative LLM reranking; the "100%" LoCoMo claim used `top_k=50`, i.e., retrieving essentially the whole conversation [1].
- "30× lossless compression" (AAAK) is lossy: 84.2% vs 96.6% recall, a 12.4-point drop — enabling the marketed features makes retrieval *worse* [1][63].
- Retrieval recall was headlined where end-to-end QA accuracy (~67.2%) is the number that matters to a user [1]. The maintainers themselves pulled their cross-system comparison table in v3.3.0 after recognizing they'd mixed recall and QA-accuracy columns [1].
- A distance-metric bug (L2 default instead of cosine) went unnoticed through the initial benchmark runs [1].

**What is genuinely good engineering (high confidence):**
- The **four-layer wake-up stack**: ~100-token always-loaded identity layer + ~500–800-token essentials + on-demand topic context + per-query search, totaling ~170 tokens of fixed session-bootstrap cost [1]. This is a budget discipline worth copying into llame's context assembly regardless of storage architecture.
- The **deterministic, zero-LLM write path**: nothing is summarized or extracted at write time, so writing memory costs nothing, adds no latency, and cannot hallucinate [1]. This independently validates the anti-extraction finding in [7].
- A clean, minimal pluggable backend layer (ChromaDB/qdrant/pgvector/sqlite) shipped *after* launch rather than speculatively [2].

**What it simply lacks:** any forgetting/pruning (single ever-growing collection, flagged scaling risk past ~1M docs [1]), any multi-user model (explicitly single-machine local-first; namespace isolation only as an opt-in property of external backends, not governed access control [2]), and strong performance on exactly the temporal/knowledge-update questions the field is worst at.

**Verdict:** ~30% durable engineering, ~70% distribution phenomenon. Nothing in MemPalace argues for adopting it or its metaphor in llame; two of its ideas (wake-up budget, zero-LLM writes) should be absorbed as principles.

---

## 4. Finding 3 — Treat every memory benchmark as marketing until proven otherwise

The evaluation situation is genuinely bad, and this matters because it is the primary channel through which hype propagates:

- **The Mem0↔Zep war.** Mem0's paper reported Zep at ~66% on LoCoMo using a configuration Zep called "demonstrably incorrect"; Zep's rebuttal reported itself at 84%; Mem0's counter-rebuttal re-ran Zep's setup and got 58.44% [31][32]. Both parties agree only that LoCoMo itself is flawed (81 QA pairs, known answer-leakage issues).
- **Self-reported LongMemEval scores for shipping products span 49%→91%** across sources with incompatible configurations [52].
- **MemPalace's audit trail** (Section 3) shows the same pathologies in a third, unrelated project — benchmark distortion is structural to the space, not a bad actor problem.
- The trustworthy baselines are sobering: LongMemEval found commercial assistants at 30–70% accuracy on tasks *simpler* than the full benchmark, with 30–60% drops for long-context baselines [3]; LoCoMo shows ~56% lag behind humans overall, 73% on temporal reasoning [4]; BEAM shows a further ~25% degradation scaling 1M→10M tokens and that **contradiction resolution is unsolved everywhere** [5]; MemoryAgentBench: of 22 systems, none master all four competencies, and **selective forgetting is the most-failed one** [6].

Practical consequence for llame: never select a memory library or validate llame's own memory layer on vendor numbers. If/when llame needs an internal yardstick, LongMemEval (+ its temporal/knowledge-update categories specifically) is the least-bad public choice [3], and the metric to track is end-task answer accuracy plus token cost — not retrieval recall (the exact confusion MemPalace exploited).

---

## 5. Finding 4 — Decay and salience: build the signal substrate now, not the formula

Your sketched `support_weight = Σ(source_trust × signal_confidence × recency_weight)` sits squarely inside a genuine research lineage — and the literature both supports the *shape* of your thinking and warns against committing to any formula now.

**What converges.** From Generative Agents' equal-weighted `recency + importance + relevance` [16], through MemoryBank's Ebbinghaus exponential [17], to the 2026 multi-factor frameworks — FSFM (time-decay × usage frequency × contextual relevance × quality × user feedback; four-way forgetting taxonomy: passive decay / active deletion / safety-triggered / adaptive-RL) [18], DMF (deterministic "Survival Score," decaying by *interaction count* rather than wall-clock time) [19], Mnemosyne, SuperLocalMemory — the same factor families recur: **recency, access frequency, importance/salience, novelty, confirmation/trust, and user feedback**. Your `source_trust` term is actually ahead of most of these: explicit provenance-weighted trust appears mainly in the governance literature (confidence states + provenance metadata in governed shared memory [28]; source trust in the security survey [25]), not in the decay papers — which is an argument that llame's version should unify the two.

**What should give you pause (this is the critical part):**
1. **Decay's proven benefit is cost, not quality.** DMF matches Mem0's accuracy at 5–242× fewer tokens with zero LLM calls [19] — impressive, but that's an efficiency result. No paper in this sweep demonstrates that decay *improves end-task accuracy* against a non-decaying baseline with matched retrieval; several implicitly show retrieval ranking doing the real work.
2. **The mechanism story is contested.** "The Geometry of Forgetting" (2604.06222) found forgetting-curve behavior emerges from *interference between competing memories*, not from intrinsic time decay — the identical decay function without competitors produced a ~50× smaller effect [20]. The Ebbinghaus framing that most of these systems cite may be phenomenological decoration.
3. **Selective forgetting is the most-failed competency in the field** [6]. Systems that delete by score destroy information they later need; nothing yet does this well.
4. RL-learned memory policies (MemRL [21], DeltaMem [22], Mem-T [23]) are the fashionable frontier — every one a single-paper SOTA from Jan–Apr 2026, none independently reproduced, none production-adopted. Watch, don't build.

**Design consequence — the framework-first plan you wanted:** store the *raw signals* from day one and keep scoring a pure, replaceable read-time function:

- Per memory row: `created_at`, `last_accessed_at`, `access_count`, `source_kind` (user_stated > user_confirmed > agent_inferred > imported), `extraction_confidence`, `confirmations`, `contradictions`, `valid_at`, `invalid_at`, `superseded_by`, immutable provenance (origin chat/run/user).
- Decay/salience then becomes a **retrieval-time ranking term** (cheap, reversible, A/B-testable) and a **review/archival policy** (surface low-strength memories to the user in the Brain UI for confirm/archive) — never an automatic destructive delete. Archival ≠ deletion: an archived memory drops out of default recall but remains searchable and auditable, which is also what the Forget & Rollback governance literature demands [25].
- When you later want your `support_weight`, it's a SQL expression or a scoring service over columns that already exist — no migration, no backfill problem. And the formula can start as exactly your sketch and be falsified cheaply.

---

## 6. Finding 5 — Multi-user memory: your "common + private vaults" idea is validated, with two hard rules

This is the area where llame's requirements are furthest ahead of the commercial market, and — fortunately — where 2025–2026 research gives unusually direct guidance.

**Precedents.** Mem0 scopes by `user_id`/`agent_id`/`run_id` (with the notable wart that scopes can't be AND-combined in one query [33]); Zep runs separate user graphs and *group graphs* for organizational knowledge, recalled side-by-side [34]; Letta shares memory blocks across agents with block-level (not per-agent) read-only flags [35]; ChatGPT's shared Projects use **deliberately isolated** memory contexts — OpenAI treats mixing personal and shared memory in one pool as the privacy failure mode, and makes the project-only setting irreversible [36]. Consumer household assistants (Alexa Voice ID, Google Voice Match) spent a decade on the same problem and still leak across profiles when identity attribution fails [58] — the durable lesson being that **scope misattribution at ingest is the persistent error class**, not access-control math.

**Research.** The Collaborative Memory framework (arXiv:2505.18279) is nearly a blueprint for your idea: two tiers (private fragments visible only to their originating user; selectively shared fragments), every fragment carrying immutable provenance, with *separate write policies and read policies* — reads dynamically construct a per-user filtered view under current permissions [26]. GateMem benchmarks exactly the household/enterprise shared-assistant setting and lands the key aphorism: **"high recall without strict governance is not an achievement but a security vulnerability"** [27]. The memory-security survey elevates Share & Propagate to a first-class lifecycle phase and documents *silent cross-user contamination in ordinary operation* — no attacker needed [25]. A governed-shared-memory paper independently proposes the same tiering llame would use (agent-local / team-shared / tenant-global / restricted, with supersession references and confidence states) [28].

**The two hard rules the evidence supports:**

1. **Scope is inherited from the conversation container and widened only by explicit human action.** A memory extracted from a project chat defaults to project scope; from a private chat, private scope. Do **not** build a classifier that reads private conversations and decides a fact is "general" and promotes it to shared — misclassification of private-as-shared is the catastrophic direction, identity misattribution is the recurring real-world failure [58][27], and one leaked fact destroys trust in the whole memory system. Your "common memory regarding general topics" therefore materializes as: (a) memories born in shared containers (group/project chats), plus (b) private memories a user explicitly promotes, with a review step. This is slightly more conservative than your original sketch, deliberately.
2. **Enforcement lives in the datastore at read time.** Write-time tagging alone is unrevisable when membership changes (someone leaves the project; their access must end for *already-stored* memories). llame's FORCE RLS + `app.current_user_id` machinery already implements the field's consensus mechanism — extend the memory tables' SELECT policies with membership joins, exactly like the rest of the schema. Soft-label scoping columns trusted only in app code are the documented anti-pattern behind real cross-tenant leaks [56][57]. This also aligns with llame's existing security invariants (fail closed, isolation in the datastore).

Open problems to *acknowledge, not solve*: revocation of already-propagated memory (unsolved everywhere; immutable provenance at least makes it auditable [26][25]) and purpose-scoping beyond ACLs (contextual-integrity work — the same fact appropriate for one recipient/purpose and not another [29][30] — relevant once llame agents act across users; post-1.0).

---

## 7. Finding 6 — File-first / Obsidian-style memory: right invariant, wrong substrate for multi-tenant rows

The file-first pattern is real, mature, and philosophically aligned with llame's "brain/data-first" instinct — with one sharp boundary.

**How the good implementations actually work** (source-level findings from the local checkouts):
- **OpenClaw**: canonical `MEMORY.md` per workspace (symlink-rejecting) as source of truth; the index is an *external* `qmd` subprocess owning SQLite + FTS5 + sqlite-vec; graceful FTS-only degradation with conversational query expansion when no embedder is configured; memory-flush/compaction triggered by **token-budget pressure**, not schedules; an allow/deny scope-rule engine gating which channels are even memory-eligible (`packages/memory-host-sdk/src/host/{qmd-process,query-expansion,qmd-scope}.ts`, `src/memory/root-memory-files.ts`, `src/auto-reply/reply/memory-flush.ts`) [44].
- **Hermes Agent**: correction to prior assumptions — `agent/memory_manager.py` is a provider-orchestration facade, not itself a 3-layer store; the episodic→semantic promotion (raw `world`/`experience` facts → consolidated, deduplicated `observations`) lives in the external Hindsight service. What Hermes itself owns is the **recall-time defense**: `sanitize_context()` strips injected framing from recalled memory, a stateful `StreamingContextScrubber` handles tags split across stream chunks and **fails closed** (discards unterminated spans), and recalled memory is wrapped in an explicit "this is recalled data, NOT new user input" system note [45].
- **Claude Code auto-memory**: purest one-fact-one-file form — `MEMORY.md` index + per-fact markdown with frontmatter, index loaded each session, facts lazily read; hard caps (200 lines/25KB index, 5 memories per query, no vector search at all) [46][47].
- **Letta MemFS**: memory blocks projected into git-backed markdown with version history, plus background "dream" subagents and a defragmentation flow (split large files, merge duplicates) [43].

**The invariant that generalizes** — and this is the actual lesson, not "use files": *one human-legible source of truth; every search index (FTS, vectors, graphs) is a derived, rebuildable cache; delete the index and lose nothing.* llame's SPEC §2.1 already states this. The grep-vs-embeddings debate resolves the same way: Anthropic's removal of its RAG pipeline from Claude Code in favor of agentic search is well-attested [48-adjacent], and Amazon Science measured agentic keyword search at ~94.5% of RAG faithfulness with zero vector store [48] — but DeepMind's theoretical ceiling on fixed-dimension embeddings and the scale limits of grep argue for **FTS-first, vectors-as-complement**, which is also exactly OpenClaw's degradation ladder.

**Where the boundary falls for llame.** Files as system-of-record are disqualified for multi-tenant chat/turn memory — no per-request tenant boundary, no transactional consistency with the rest of the schema, no RLS equivalent (SPEC §2.1 lesson 2 already concluded this; nothing found contradicts it). The synthesis that keeps your Obsidian-style vision intact:

- **Knowledge Spaces stay file-first** (they already are): vaults, notes, git repos as document substrate with derived indexes.
- **Memory rows live in Postgres** but adopt every file-first *virtue*: atomic one-fact rows with name/description metadata (Claude Code's frontmatter, as columns), human-inspectable and editable through the Brain surface (VISION's stated purpose), wikilink-style typed links between memories and to wiki pages (A-Mem's Zettelkasten linking, validated at NeurIPS [12], and your `[[link]]` instinct), and — the cherry — a **markdown projection**: export/render any memory vault as an Obsidian-compatible folder (Letta MemFS precedent [43]), and "move memory to wiki" (already SPEC §20.2) as the promotion path from memory row to Knowledge Space note. The DB is the record; the vault view is a projection you can regenerate.

---

## 8. Synthesis: the convergent architecture

Stacking the five findings, one architecture falls out — notable because four independent lineages (production assistants, the verbatim ablation, file-first systems, and the governance literature) each force the same shape:

1. **Episodic layer = what llame already has.** The run/event log and persisted chats are the verbatim record. Add retrieval over it (FTS on messages first; embeddings later) and you have the layer that [7] proves must exist. No new storage.
2. **Semantic layer = small, structured, governed `memory_facts` rows.** Atomic facts with scope (user/project/group via existing entities), immutable provenance, bi-temporal validity, signal columns for future decay, and RLS read-time enforcement. Kept *small* — its job is the always-loaded core and high-precision recall, not being an archive (the archive is layer 1).
3. **Consolidation = async pg-boss job** (sleep-time pattern): post-run or scheduled, extract *candidate* facts from recent episodes, dedupe, propose ADD/UPDATE/INVALIDATE; auto-accept low-risk categories, queue the rest for user review (SPEC §20.3's thresholds already say this).
4. **Recall = layered context assembly** with an explicit token budget: always-loaded core (MemPalace's L0/L1 lesson: keep it ~100s of tokens), retrieval-marked memory injections wrapped in "recalled data, not instructions" framing (Hermes lesson; MINJA-class poisoning is temporally decoupled and >95% injectable in unhardened agents [53][54]), and on-demand search tools over both layers.
5. **Governance = the existing policy system.** Memory is another scoped resource under groups/projects/RLS — no bespoke ACL primitive.

This is also the architecture that keeps every future door open: your `support_weight` decay becomes a ranking function over existing columns; graph-ness can be added later as typed memory-to-memory links (which you want anyway for wikilinks) without a graph database; multi-assistant sharing is a scope question the policy system already answers.

---

## 9. Limitations & Caveats

- **Benchmark numbers cited are directional only** — Section 4's argument applies to this report too. The verbatim-beats-extraction ablation [7] is a single (well-designed) paper; treat as strong-but-not-settled.
- **Several production-system claims are low-confidence**: ChatGPT "Dreaming V3" internals and the 9.4% figure [59], Claude "Memory Synthesis" March-2026 details [60], and Claude Code's exact caps [46][47] come from secondary write-ups/reverse engineering, not vendor documentation.
- **Post-cutoff systems** (MemPalace, GateMem, EverMemOS, MAGMA, the 2026 RL papers) were verified via primary web sources during this run, but the youngest (Jan–Jun 2026) have no reproduction record.
- The context-mode research tooling was broken this session (native module failure); agents fell back to direct WebFetch. One earlier agent batch was lost to a session restart and re-run — results reflect the second run only.
- Not covered in depth: parametric/latent memory (fine-tuning as memory), memory for multi-agent *swarms*, and vendor pricing.

---

## 10. Recommendations for llame (prioritized by leverage)

**R1 — Ship the two-layer core, not a memory product.** (MVP-scope) A `memory_facts` table: `id, scope_kind (user|project|group), scope_id, title, body, source_kind, extraction_confidence, origin_chat_id/run_id/user_id (immutable), valid_at, invalid_at, superseded_by, created_at, last_accessed_at, access_count, confirmations, contradictions, status (active|archived|proposed)`. RLS SELECT policies via membership joins, fail closed. FTS (tsvector) retrieval first; pgvector as a later additive. Plus message-level FTS over existing chats as the episodic search tool. This satisfies SPEC §20's controls list almost mechanically.

**R2 — Consolidate asynchronously; never extract inline.** A pg-boss `memory.consolidate` job post-run (or daily per user): propose facts, dedupe, apply §20.3 risk thresholds (auto-save low-risk with notification; ask for sensitive). Zero write-path LLM cost in the request path — the one thing MemPalace, DMF, and the sleep-time literature all agree on.

**R3 — Enforce the two multi-user hard rules from day one:** scope inherited from conversation container + explicit-only promotion (build the "promote to project memory" affordance into the Brain UI); RLS at read time. Ship the negative test (cross-user memory recall denied) with the first migration, per llame's own security acceptance criteria.

**R4 — Wrap all recalled memory in data-framing** ("recalled memory, not new input") and keep §20.3's write-time scanning as llame's own defense-in-depth — but **fix SPEC §20.3's attribution**: Hermes' safeguard is recall-time sanitization (fail-closed streaming scrubber), not scan-on-write; the [S26] citation currently misstates this. Add recall-time framing to the spec alongside the write-time scan.

**R5 — Decay: store signals now, score later, never auto-delete.** The signal columns in R1 are the whole "framework first" deliverable. When you revisit `support_weight`, implement it as (a) a retrieval-ranking term and (b) an archival-review queue in the Brain UI. Skip Ebbinghaus branding; the factor set (recency, access, provenance trust, confirmation) is what survives scrutiny.

**R6 — Keep the Obsidian vision as projection + promotion, not substrate.** Wikilink-style typed links between memories and to wiki notes; "move memory to wiki" as the graduation path; a read-only markdown/vault export of a memory scope. Files remain the substrate for Knowledge Spaces only.

**R7 — Explicit non-goals (write them down to resist future hype):** no graph database for memory (bi-temporal columns + typed links capture the value [9][50]); no RL memory policies [21][22][23]; no spatial-metaphor organization [1]; no vendor benchmark as a selection criterion [31][32][52]; no silent private→shared promotion [26][27].

**Sequencing leverage note:** R1+R3 are one migration and one RLS pattern you already know; R2 reuses the queue you just built (#107). The expensive-looking parts of memory (graphs, decay, RL) are precisely the parts the evidence says to defer. The rare, defensible moat for llame is R3 — governed multi-user memory — which none of the viral projects have and the research says is the actual hard problem.

---

## 11. Bibliography

**Academic papers**
1. Dey & Viradecha, *Spatial Metaphors for LLM Memory: A Critical Analysis of the MemPalace Architecture*, arXiv:2604.21284 — https://arxiv.org/abs/2604.21284
2. MemPalace repository README — https://github.com/mempalace/mempalace
3. Wu et al., *LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory*, arXiv:2410.10813 (ICLR 2025) — https://arxiv.org/abs/2410.10813
4. Maharana et al., *Evaluating Very Long-Term Conversational Memory of LLM Agents* (LoCoMo), arXiv:2402.17753 — https://arxiv.org/abs/2402.17753
5. *Beyond a Million Tokens: Benchmarking and Enhancing Long-Term Memory in LLMs* (BEAM), arXiv:2510.27246 — https://arxiv.org/abs/2510.27246
6. *Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions* (MemoryAgentBench), arXiv:2507.05257 — https://arxiv.org/abs/2507.05257
7. *Verbatim Chunks Beat Extracted Artifacts: A Controlled Ablation of Memory Representations for Long LLM Conversations*, arXiv:2601.00821 — https://arxiv.org/abs/2601.00821
8. Chhikara et al., *Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory*, arXiv:2504.19413 — https://arxiv.org/abs/2504.19413
9. Rasmussen et al., *Zep: A Temporal Knowledge Graph Architecture for Agent Memory*, arXiv:2501.13956 — https://arxiv.org/abs/2501.13956
10. Gutiérrez et al., *HippoRAG: Neurobiologically Inspired Long-Term Memory for LLMs*, arXiv:2405.14831 — https://arxiv.org/abs/2405.14831
11. Gutiérrez et al., *From RAG to Memory: Non-Parametric Continual Learning for LLMs* (HippoRAG 2), arXiv:2502.14802 — https://arxiv.org/abs/2502.14802
12. Xu et al., *A-MEM: Agentic Memory for LLM Agents*, arXiv:2502.12110 (NeurIPS 2025) — https://arxiv.org/abs/2502.12110
13. *MAGMA: A Multi-Graph based Agentic Memory Architecture for AI Agents*, arXiv:2601.03236 — https://arxiv.org/abs/2601.03236
14. *EverMemOS: A Self-Organizing Memory Operating System*, arXiv:2601.02163 — https://arxiv.org/abs/2601.02163
15. Packer et al., *MemGPT: Towards LLMs as Operating Systems*, arXiv:2310.08560 — https://arxiv.org/abs/2310.08560
16. Park et al., *Generative Agents: Interactive Simulacra of Human Behavior*, arXiv:2304.03442 — https://arxiv.org/abs/2304.03442
17. Zhong et al., *MemoryBank: Enhancing LLMs with Long-Term Memory*, arXiv:2305.10250 — https://arxiv.org/abs/2305.10250
18. *FSFM: A Biologically-Inspired Framework for Selective Forgetting of Agent Memory*, arXiv:2604.20300 — https://arxiv.org/abs/2604.20300
19. *DMF: A Deterministic Memory Framework for Conversational AI Agents*, arXiv:2606.03463 — https://arxiv.org/abs/2606.03463
20. *The Geometry of Forgetting*, arXiv:2604.06222 — https://arxiv.org/abs/2604.06222
21. *MemRL: Self-Evolving Agents via Runtime Reinforcement Learning on Episodic Memory*, arXiv:2601.03192 — https://arxiv.org/abs/2601.03192
22. *DeltaMem: Towards Agentic Memory Management via Reinforcement Learning*, arXiv:2604.01560 — https://arxiv.org/abs/2604.01560
23. *Mem-T: Densifying Rewards for Long-Horizon Memory Agents*, arXiv:2601.23014 — https://arxiv.org/abs/2601.23014
24. *Memory in the Age of AI Agents: A Survey*, arXiv:2512.13564 — https://arxiv.org/abs/2512.13564
25. Lin et al., *A Survey on Long-Term Memory Security in LLM Agents: Attacks, Defenses, and Governance Across the Memory Lifecycle*, arXiv:2604.16548 — https://arxiv.org/abs/2604.16548
26. *Collaborative Memory: Multi-User Memory Sharing in LLM Agents with Dynamic Access Control*, arXiv:2505.18279 — https://arxiv.org/abs/2505.18279
27. *GateMem: Benchmarking Memory Governance in Multi-Principal Shared-Memory Agents*, arXiv:2606.18829 — https://arxiv.org/pdf/2606.18829
28. *Governed Shared Memory for Multi-Agent LLM Systems*, arXiv:2606.24535 — https://arxiv.org/pdf/2606.24535
29. *Contextualized Privacy Defense for LLM Agents*, arXiv:2603.02983 — https://arxiv.org/html/2603.02983v1
30. *Memory as a Service (MaaS): Purpose-Bound Memory Mediation for Cooperative Agents*, arXiv:2506.22815 — https://arxiv.org/html/2506.22815
48. *Is Grep All You Need? How Agent Harnesses Reshape Agentic Search* (Amazon Science, AAAI 2026), arXiv:2605.15184 — https://arxiv.org/html/2605.15184v1
53. *Hidden in Memory: Sleeper Memory Poisoning in LLM Agents* (incl. MINJA results), arXiv:2605.15338 — https://arxiv.org/pdf/2605.15338
61. *FluxMem* (adaptive/hybrid memory structures), arXiv:2602.14038
65. *RecMem: Recurrence-based Memory Consolidation*, arXiv:2605.16045 — https://arxiv.org/pdf/2605.16045

**Vendor documentation & engineering blogs**
31. Zep, *Is Mem0 Really SOTA in Agent Memory?* — https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/
32. getzep/zep-papers issue #5, *Revisiting Zep's 84% LoCoMo Claim* (Mem0 rebuttal) — https://github.com/getzep/zep-papers/issues/5
33. Mem0 docs, *Entity-Scoped Memory* — https://docs.mem0.ai/platform/features/entity-scoped-memory
34. Zep docs, *Share Memory Across Users Using Group Graphs* — https://help.getzep.com/v2/cookbook/how-to-share-memory-across-users-using-group-graphs
35. Letta docs, *Shared memory blocks* — https://docs.letta.com/tutorials/shared-memory-blocks/
36. OpenAI Help, *Projects in ChatGPT* — https://help.openai.com/en/articles/10169521-projects-in-chatgpt
37. OpenAI Help, *Memory FAQ (Business)* — https://help.openai.com/en/articles/9295112-memory-faq-business-version
38. Khemani, *Claude Memory: A Different Philosophy* — https://www.shloked.com/writing/claude-memory
39. Khemani, *Anthropic's Opinionated Memory Bet* — https://www.shloked.com/writing/claude-memory-tool
40. Anthropic, *Managing context on the Claude Developer Platform* — https://anthropic.com/news/context-management
41. Letta, *Sleep-time Compute* — https://www.letta.com/blog/sleep-time-compute/
42. Letta, *Agent Memory* / *Is a Filesystem All You Need?* — https://www.letta.com/blog/agent-memory/
43. Letta, *Rearchitecting Letta's Agent Loop* (MemFS) — https://www.letta.com/blog/letta-v1-agent
49. TechCrunch, *Mem0 raises $24M…* — https://techcrunch.com/2025/10/28/mem0-raises-24m-from-yc-peak-xv-and-basis-set-to-build-the-memory-layer-for-ai-apps/
50. Emergent Mind, *Mem0: Scalable Memory Architecture* — https://www.emergentmind.com/topics/mem0-system
51. Dwarves Memo, *Mem0 & Mem0-Graph breakdown* — https://memo.d.foundation/breakdown/mem0
62. MemPalace.tech, *Benchmark Results: Fact-Checked* — https://www.mempalace.tech/benchmarks
63. Hacker News, MemPalace thread — https://news.ycombinator.com/item?id=47672792

**Local source-code evidence (reference checkouts)**
44. OpenClaw — `~/.cache/checkouts/github.com/openclaw/openclaw`: `packages/memory-host-sdk/src/host/qmd-process.ts:59-130`, `engine-storage.ts:54`, `host/query-expansion.ts:1-11`, `host/qmd-scope.ts:14-52`, `src/memory/root-memory-files.ts:6,44-51`, `src/auto-reply/reply/memory-flush.ts:1`
45. Hermes Agent — `~/.cache/checkouts/github.com/NousResearch/hermes-agent`: `agent/memory_manager.py:163-168, 256-267, 344-347, 353-358`, `hermes_state.py:12,687`, `plugins/memory/hindsight/__init__.py:998`

**Secondary/press (low-confidence, marked in text)**
46. ReadySolutions, *How Auto-Memory Actually Works* — https://readysolutions.ai/blog/2026-05-29-claude-code-auto-memory-how-it-works/
47. Gurgone, *Claude Code's Experimental Memory System* — https://giuseppegurgone.com/claude-memory
52. Atlan, *Best AI Agent Memory Frameworks in 2026* — https://atlan.com/know/best-ai-agent-memory-frameworks-2026/
54. Schneider, *Memory poisoning in AI agents: exploits that wait* — https://christian-schneider.net/blog/persistent-memory-poisoning-in-ai-agents/
55. Zylos, *Indirect Prompt Injection: 2026 State of the Art* — https://zylos.ai/research/2026-04-12-indirect-prompt-injection-defenses-agents-untrusted-content/
56. FutureAGI, *What Is Cross-Session Leak?* — https://futureagi.com/glossary/cross-session-leak/
57. Nexumo, *Shared Agent Memory: The Multi-Tenant Time Bomb* — https://medium.com/@Nexumo_/shared-agent-memory-the-multi-tenant-time-bomb-b5e2ea0b306d
58. Gearbrain (Alexa Voice Profile) — https://www.gearbrain.com/alexa-voice-profile-feature-explained-2647656954.html; Google Nest Help (Voice Match) — https://support.google.com/googlenest/answer/7342711
59. TechTimes, *ChatGPT Memory Dreaming Update* — https://www.techtimes.com/articles/317840/20260605/chatgpt-memory-dreaming-update-openai-rewrites-personalization-engine-limits-audit-trail.htm
60. LumiChats, *Claude Memory 2026: Complete Guide* — https://lumichats.com/blog/claude-memory-2026-complete-guide-how-to-use
64. jrcruciani, *obsidian-memory-for-ai* — https://github.com/jrcruciani/obsidian-memory-for-ai

---

## 12. Methodology Appendix

**Pipeline:** SCOPE → PLAN → RETRIEVE (4 orientation WebSearches + 5 parallel deep-dive agents) → TRIANGULATE (cross-agent convergence on ~12 core claims; contradictions flagged inline) → OUTLINE REFINEMENT (added SPEC-correction item R4 after Hermes source inspection contradicted SPEC §20.3's [S26] attribution) → SYNTHESIZE → CRITIQUE (personas: skeptical practitioner — "does this specify a schema?"; adversarial reviewer — "are MemPalace claims multi-source?"; implementation engineer — "does this fit the RLS/queue stack?") → PACKAGE.

**Triangulation highlights:** verbatim-vs-extraction supported independently by [1], [7], [19], and [48]; async consolidation by [41], [43], [59], [60]; read-time ACL by [26], [25], IBM-guidance, and llame's own RLS precedent; decay-as-cost-not-quality by [19] vs [20] and [6].

**Incidents:** initial 5-agent batch lost to a session restart (/tmp transcript wipe); all agents re-run. context-mode indexing tools failed (better-sqlite3 native module) — agents used direct WebFetch; session knowledge-base search unavailable.

**Artifacts:** `run_manifest.json`, `outline.md`, `agent_finals/*.md` (5 files), `evidence.jsonl` (101 items), `sources.jsonl` (87 sources), this report.
