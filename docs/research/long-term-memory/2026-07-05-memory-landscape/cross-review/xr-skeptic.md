# Cross-review: ADVERSARIAL SKEPTIC lens (independent reviewer, 2026-07-05)

## 1. Evidence-strength ranking

- **Verbatim-beats-extraction**: single-paper (arXiv:2601.00821, S13, conf=**moderate**, not high). Report itself says "moderate-high" — slight overstatement, but flagged in Limitations. **Single-source, load-bearing.**
- **Decay=cost-only**: multi-source-primary (DMF/S18, Geometry-of-Forgetting/S19, MemoryAgentBench/S6) — genuinely convergent, well-supported.
- **Two hard multi-user rules**: multi-source-primary (Collaborative Memory S59, GateMem S60, governed-shared-memory S61, security-survey S25/S62) — solid, high-confidence cluster.
- **MemPalace verdict**: multi-source but **all from one investigating agent** (mempalace-dive: 13 high/1 mod/2 low). The two low-confidence items (S50 HN reproduction, S51 Jovovich commit-authorship) are cited in the main report body as if corroborating — they don't; they're unverified color, correctly caveated only in the agent-final, not in the main report's Section 3 bullets.
- **Async-consolidation convergence** ("most reliable signal in this entire research area"): this claim rests heavily on the **production-systems** agent, whose evidence bucket is the weakest in the whole corpus — **1 high / 9 moderate / 10 low** out of 20 items. Both concrete data points for the claim (ChatGPT "Dreaming V3" 9.4%, S72; Claude "Memory Synthesis" details, S74) are single secondary-source, low-confidence. Calling this "the most reliable signal in the entire research area" is not supported by the underlying evidence grade — it's reliable as *directional convergence* (Letta+Anthropic corroborate the shape with primary docs), not reliable on the specific mechanics/numbers cited.

## 2. Internal contradictions

- **Write-time scanning has zero evidentiary support anywhere in the corpus.** S33/S35 (high conf, primary source read of `memory_manager.py`) explicitly state Hermes does **recall-time-only** sanitization, "**no write-time content scan**." Production-systems agent's own text even says "almost no shipped system validates content at write time." Yet R4 tells llame to "keep §20.3's write-time scanning as llame's own defense-in-depth" — this is not a research-derived recommendation, it's the pre-existing SPEC default rubber-stamped. The report correctly fixes the *attribution* error (Hermes ≠ write-time) but doesn't apply the same scrutiny to whether write-time scanning should survive at all. That's a dodge, not a resolution.
- **Extraction vs. memory_facts is real but under-examined.** Production-systems explicitly recommends an async-extracted `memory_facts` table; academic-survey's ablation (S13) tested extraction-as-sole-representation vs. verbatim, **not** a two-tier hybrid. The main report's "extracted-facts store must never be the only memory" resolution is *consistent with* [7] but not *validated by* it — nobody in the corpus tested whether a small extracted layer alongside verbatim retrieval beats verbatim alone. The two-tier design is inference, presented with more confidence than the evidence chain supports.

## 3. Overclaim check — don't act on yet

- **R4 write-time scanning**: cut it or mark explicitly as "unvalidated, inherited from SPEC" rather than "defense-in-depth." Cheap validation: red-team the recall-time-only design with injected content before adding a second unproven layer.
- **R2/R5 "async consolidation" as validated pattern**: cheap to de-risk — this is architecturally free to adopt (matches existing pg-boss queue) regardless of evidence quality, so risk is low even though evidence (S72/S74) is weak. Fine to ship, but don't cite it as strongly evidenced.
- **Two-tier semantic+episodic split**: before building `memory_facts` as scoped in R1, run a cheap internal ablation once any data exists — does the extracted layer add measurable recall/accuracy over FTS-on-episodic alone? If not, R1's schema is premature complexity.

## 4. What's missing (could change conclusions)

- **GDPR / right to erasure**: absent from all 101 evidence items and both agent-final docs that touch it. R5 mandates "never destructive delete, archival only" — for a self-hosted **multi-tenant EU-reachable** product this is a legal, not just architectural, question; archived-but-retained rows likely don't satisfy erasure requests. Needs its own pass before R5 ships as-is.
- **Cost modeling**: report explicitly excludes vendor pricing, but also skips llame's *own* inference-cost tradeoff (async extraction job cost, embedding-generation cost at scale) — only qualitative "cheap/expensive" language throughout.
- **Embedding model selection**: appears only inside the MemPalace critique (as the actual cause of its benchmark numbers) — never addressed as a first-class decision for llame's own pgvector layer (self-hosted model? dimension? multilingual?).
- **Memory-review UX**: the "Brain UI" archival/confirm surface is asserted repeatedly (R3, R5) with zero UX-research backing — pure design assumption, unlabeled as such.
