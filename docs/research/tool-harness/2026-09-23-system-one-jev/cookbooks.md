---
type: Research
title: "TypeSafe cookbooks: direct llame uses and derived applications"
description: "All 18 cookbook recipes assessed for direct reuse, practical adaptation and additional llame applications."
tags: [jev, typesafe, cookbooks, applicability, ideation]
status: stable
canonical: false
observed:
  date: "2026-09-24"
sources:
  - id: cb01
    resource: "https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook.md"
    title: "Self-consistency: nouls"
  - id: cb02
    resource: "https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook.md"
    title: "Self-consistency: choices"
  - id: cb03
    resource: "https://docs.typesafe.ai/cookbooks/parallel_questions.md"
    title: "Parallel questions"
  - id: cb04
    resource: "https://docs.typesafe.ai/cookbooks/rerank_typesafe.md"
    title: "Re-ranking"
  - id: cb05
    resource: "https://docs.typesafe.ai/cookbooks/semantic_find.md"
    title: "Line-by-line search"
  - id: cb06
    resource: "https://docs.typesafe.ai/cookbooks/autoformat.md"
    title: "Structure recovery"
  - id: cb07
    resource: "https://docs.typesafe.ai/cookbooks/function_calling.md"
    title: "Function calling"
  - id: cb08
    resource: "https://docs.typesafe.ai/cookbooks/skill_suggestion.md"
    title: "Skill suggestion"
  - id: cb09
    resource: "https://docs.typesafe.ai/cookbooks/entity_alignment.md"
    title: "Knowledge graph entity alignment"
  - id: cb10
    resource: "https://docs.typesafe.ai/cookbooks/classifying_rag_passages.md"
    title: "Classifying RAG passages"
  - id: cb11
    resource: "https://docs.typesafe.ai/cookbooks/citation_check.md"
    title: "Double-checking citations"
  - id: cb12
    resource: "https://docs.typesafe.ai/cookbooks/llm_guardrails.md"
    title: "Guardrails for LLMs"
  - id: cb13
    resource: "https://docs.typesafe.ai/cookbooks/sde_cascade.md"
    title: "SDE cascade"
  - id: cb14
    resource: "https://docs.typesafe.ai/cookbooks/date_extraction_cookbook.md"
    title: "Date extraction"
  - id: cb15
    resource: "https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook.md"
    title: "Pre-parsed value extraction"
  - id: cb16
    resource: "https://docs.typesafe.ai/cookbooks/hierarchical_classification.md"
    title: "Hierarchical classification"
  - id: cb17
    resource: "https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery.md"
    title: "Autoresearch feature discovery"
  - id: cb18
    resource: "https://docs.typesafe.ai/cookbooks/classification_using_confidence.md"
    title: "Classification using confidence"
  - id: cookbook-index
    resource: "https://docs.typesafe.ai/cookbooks.md"
    title: "TypeSafe cookbook inventory"
  - id: how-to
    resource: "https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md"
    title: "How to build with TypeSafe"
  - id: fan-out
    resource: "https://docs.typesafe.ai/patterns/fan-out.md"
    title: "Speculative fan-out"
  - id: confidence-routing
    resource: "https://docs.typesafe.ai/patterns/confidence-routing.md"
    title: "Confidence-gated routing"
  - id: composite-scoring
    resource: "https://docs.typesafe.ai/patterns/composite-scoring.md"
    title: "Composite scoring"
  - id: intent-routing
    resource: "https://docs.typesafe.ai/patterns/intent-routing.md"
    title: "Intent routing"
---

# TypeSafe cookbooks: direct llame uses and derived applications

Source-reading assessment, 2026-09-24. Same Jev research bundle; no implementation, inference experiment or new approval. This companion covers all 18 cookbooks and the practical how-to/composition patterns. Its citations are local to this document; the original report's experiment ledgers remain unchanged. [^cookbook-index]

## Conclusion

Several recipes are small enough to reuse substantially as-is around text llame already has. Exact-value selection, date-part extraction, checking an explicit claim against a supplied source, and batching independent questions do not require a new agent framework, Workspace system or Knowledge graph. The previous research's emphasis on new retrieval infrastructure missed these smaller entry points.

The useful unit is **bounded input → typed decision → ordinary code**. Jev can choose an existing span, interpret date components or classify support; code copies the value, performs calendar arithmetic or presents a review result. General answer generation can stay with the main model. High confidence in recipe-level compatibility; benefit and error rates on llame traffic remain unmeasured. [^how-to][^cb14][^cb15][^cb11]

**Direct** below means reusable decision flow and generic questions with data substitution and ordinary adapter code. **Near-direct** requires changing a domain rubric, output policy or candidate representation. **Later** needs a genuinely new workflow or labeled dataset. These grades concern the named application, not whether a production feature already exists.

There is one shared integration requirement: an accepted native Jev connection, appropriate owner/source/provider scope and usage attributable to the parent Run. Normal tool permissions remain in force. That is common plumbing, not a reason to classify every cookbook as unusable. Current source boundaries are covered in the [find/JUDGE study](../2026-09-24-semantic-find-judge/report.md); `read?q=` answer generation is covered [separately](../2026-09-23-question-directed-read/report.md).

## All 18 cookbooks: applicability

| ID / recipe                                | What the recipe actually does                                                                                                                                  | Fit and concrete llame use                                                                                                                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CB01 — Noul consistency**                | Repeats a battery of yes/no questions, retains raw probabilities, and maps an intermediate band to uncertainty.                                                | **Direct evaluation/abstention pattern.** Assess ambiguity in bounded decisions. Agreement is not correctness; repeated calls belong in evaluation or selective escalation, not automatically on every turn. [^cb01]                                                            |
| **CB02 — Choice consistency**              | Measures label/distribution stability; abstains when the leading option's probability is too low.                                                              | **Direct pattern; adapt labels.** Keep `uncertain` for task/response-mode suggestions instead of forcing a label. Do not import its moderation categories as llame policy. [^cb02]                                                                                              |
| **CB03 — Parallel questions**              | Sends multiple independent Noul/Choice/Score questions over one shared document.                                                                               | **Direct.** Batch intent, ambiguity, requested date and needed evidence checks over the same supplied context. Dependent questions still need another step. Its latency comparison uses sequential singles; it is not a universal speedup. [^cb03]                              |
| **CB04 — Re-ranking**                      | Retrieves a BM25 shortlist, scores each query/passage pair with a Noul and sorts it. Its rubric asks whether a passage supports a specific legal proposition.  | **Direct flow, adapt rubric.** Rerank existing authorized chat or document candidates; keep llame's retrieval and source locators. General topical relevance is different from legal-proposition support. Nothing rescues an omitted candidate. [^cb04]                         |
| **CB05 — Line-by-line search**             | One Choice distributes probability across document line IDs; a separate Noul asks whether an answer exists at all.                                             | **Direct for one short supplied document.** Select lines for an exact follow-up read or answer excerpt. Choice weights are relative, not independent relevance probabilities. Respect the option/context limits and preserve source coordinates. [^cb05]                        |
| **CB06 — Structure recovery**              | First judges line joins; then classifies blocks; code reconstructs Markdown. It does not ask a model to rewrite the prose.                                     | **Near-direct presentation utility.** Make flattened pasted/read text readable without summarizing it. Keep the original: the recipe normalizes whitespace, so it is not byte-preserving and should not rewrite code or canonical sources automatically. [^cb06]                |
| **CB07 — Function calling**                | Selects a function and closed-set arguments, checks whether arguments were stated, then dispatches through code. Open arguments remain outside that mechanism. | **Near-direct for a bounded command family.** Route a known read-only request or suggest an admitted tool with enum arguments. Add no-match/clarification and keep the existing executor; this is not general free-form Bash/function generation. [^cb07]                       |
| **CB08 — Skill suggestion**                | Wide skill ranking, a small rerank with richer descriptions, independent fit/no-skill signals, then at most one hint.                                          | **Near-direct optional hint.** Use llame's proactively eligible catalog, honor explicit mentions first, and preserve multi-skill use. Gate the selected hint's own fit; do not replace activation policy with the demo's single-winner rule. [^cb08]                            |
| **CB09 — Entity alignment**                | Scores a preselected record pair, adds field-agreement Nouls, and leaves arithmetic comparisons to code.                                                       | **Near-direct duplicate/disambiguation suggestions.** Compare two project descriptions, documents or supplied contact records. Candidate generation is separate; a likely match must not automatically merge identities or histories. [^cb09]                                   |
| **CB10 — RAG passage classification**      | For each query/passage pair, asks relevance, usable evidence, contradiction and injection questions; code applies ordered routes.                              | **Near-direct evidence briefing.** Split retrieved context into supporting, conflicting and irrelevant material. Keep contradictions visible; adapt the routing policy. An injection score is an advisory signal, not a security boundary. [^cb10]                              |
| **CB11 — Citation checking**               | Locates a supplied quote deterministically, then asks whether its source context supports, contradicts or says nothing about the claim.                        | **Direct for explicit claim/source pairs.** Offer an on-demand source-support review. Missing text in a truncated excerpt is not proof of fabrication. Automatic pre-publication checking needs additional claim mapping/streaming behavior. [^cb11]                            |
| **CB12 — LLM guardrails**                  | Batches hazard probabilities and severity; host code chooses pass, review, block or another route.                                                             | **Near-direct advisory checks.** Flag likely injection or sensitive-content concerns under a deliberate llame policy. Do not copy the demo's moderation taxonomy or let confidence grant file, tool or provider access. [^cb12]                                                 |
| **CB13 — SDE cascade**                     | A generative small model extracts; Jev judges whether individual fields are wrong; code escalates flagged records to a stronger generative model.              | **Near-direct verifier, later full extraction workflow.** Check source-backed structured results where deterministic validation is insufficient. The gate uses any flagged field, not an average that can hide one error. Jev is the verifier, not the generator. [^cb13]       |
| **CB14 — Date extraction**                 | Choices identify absolute/relative date parts; code resolves and validates the calendar date, reviewing incomplete/uncertain cases.                            | **Direct calendar-date primitive.** Answer a date question from selected text with an explicit reference date. Historical messages need their own timestamp anchor. Timezones, times of day and search intervals require additional semantics. [^cb14]                          |
| **CB15 — Pre-parsed values**               | Regexes propose emails/phones/amounts; Choice selects a candidate or `none`; code copies and normalizes the selected value.                                    | **Direct, strongest small entry point.** Answer “which email/amount/value?” from an admitted source without generating the value. Retain raw spans and occurrence IDs; candidates missed by the parser cannot be selected. Normalization remains field/locale-specific. [^cb15] |
| **CB16 — Hierarchical classification**     | Host code traverses child-label Choices with greedy or beam search; a geometric mean ranks paths.                                                              | **Near-direct when a hierarchy exists.** Suggest categories from an explicitly supplied taxonomy or admitted server/tool grouping. The path score is not a calibrated whole-path probability; include unknown/stop behavior. No new universal taxonomy is needed first. [^cb16] |
| **CB17 — Autoresearch feature discovery**  | A generative model proposes questions; Jev converts text to numeric features; a supervised CatBoost loop evaluates and revises them.                           | **Later end-to-end.** Useful for offline question/rubric discovery once a real labeled task exists. It is not a recipe for silently learning from all chats or treating model outputs as ground truth. [^cb17]                                                                  |
| **CB18 — Confidence-based classification** | One Choice picks a fine category; code returns its broader ancestor when confidence is lower, without another inference call.                                  | **Near-direct specificity control.** Suggest a broad topic/server/category instead of guessing a leaf. Requires a real mapping; a wrong leaf's ancestor can also be wrong. [^cb18]                                                                                              |

The important distinction is between a **source-bound helper** and a new product workflow. CB11 works directly when the caller already supplies the claim and source; it becomes a larger change when asked to discover every claim in a streamed answer. CB14 supplies a date, not a complete natural-language temporal search planner. CB15 returns a selected value, not a general extraction agent.

## How-to patterns worth copying

- **HT1 — Deterministic work first.** Parse obvious values, check schema/IDs and apply permissions in code. Supply structured state and narrow questions only for the ambiguous part. This avoids paying a model to do arithmetic or re-discover known facts. [^how-to]
- **HT2 — Batch independent interpretations.** Ask several questions over the same state, then ignore irrelevant answers after routing. Speculate on judgments, not side effects. Do not assume one question can use another question's answer inside the same request. [^fan-out]
- **HT3 — Preserve an uncertainty outcome.** Return a broader label, ask a specific question or escalate when appropriate. Cookbook thresholds are starting policies, not measured llame guarantees. The confidence-routing example auto-approves a transfer above 0.85; that action policy should not be copied into llame. [^confidence-routing]
- **HT4 — Separate dimensions before combining.** Judge support, relevance and contradiction separately; use explicit host weights or gates. Never average an access denial or one unsupported required field into an otherwise positive score. [^composite-scoring][^cb13]
- **HT5 — Route to the smallest adequate handler.** A known-value lookup, narrow extractor or clarifying question can precede expensive generative work. Start with a bounded, explicit request family, not a universal router that silently overrides the owner's selected model or available tools. [^intent-routing]

## Recipe-derived applications beyond the existing U1-U20

These are proposals derived by combining and repurposing the recipes, not claims that the features ship. They are deliberately small and can reuse state already available in a Run.

| ID                                                | Application                                                                                                  | Recipe combination and useful result                                                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **U21 — Temporal recall planner**                 | Turn “what did we decide last week?” into a proposed recall filter.                                          | CB14 + intent routing: extract time references, then code computes an interval and distinguishes required from preferred bounds. This extends the single-date recipe; ambiguous timezone/“next week” conventions stay explicit.              |
| **U22 — Exact-value answer path**                 | Answer “which contact address?”, “which invoice amount?” or “which version?” without regenerating the value. | CB15 + CB11: select an existing candidate, copy it with its source occurrence, optionally check that its context supports the requested role. New value types need parsers, not a new agent architecture.                                    |
| **U23 — Contradiction-aware evidence brief**      | Show what supports the current answer and what records an earlier/different decision.                        | CB10 + CB11: keep support and conflict packets with dates/locators; check the eventual claim against the selected source. A later date alone does not decide which source is authoritative.                                                  |
| **U24 — Ask only for the uncertain slot**         | Ask “which repository?” or “which date?” instead of asking the user to restate the whole task.               | CB07 + CB15 + uncertainty routing: inspect only genuinely ambiguous required fields after deterministic context resolution; preserve everything already known.                                                                               |
| **U25 — Marginal-context selector**               | Avoid another read or injection of content that adds nothing to the current evidence brief.                  | CB10 + parallel questions: distinguish relevant-new, redundant and conflicting material. Preserve conflict; do not equate topic similarity with duplication or delete durable history. Savings require actually avoiding extra context/work. |
| **U26 — Readability view with original retained** | Turn flattened pasted material into headings/lists for inspection without replacing the source.              | CB06 + CB05: derive a readable view and select relevant original lines. Treat the view as a transformation, not new source evidence; preserve the original for quotes and code.                                                              |
| **U27 — On-demand advice freshness review**       | Recheck a pasted old recommendation against explicitly fetched current documentation.                        | CB11 + CB10 + date extraction: return supported, contradicted or unresolved items with current source links. No continuous crawler or automatic Knowledge rewrite is required.                                                               |
| **U28 — Coarse capability hint**                  | Suggest a server or capability family when a precise tool/skill is uncertain.                                | CB16/CB18 + CB08: narrow only as far as a supplied/admitted hierarchy supports. Remain an ignorable hint; do not imply that model-facing tool discovery already ships.                                                                       |
| **U29 — Preference-scope suggestion**             | Distinguish “do this quickly” for the current task from a proposed durable preference.                       | CB02 + CB18: suggest temporary constraint, lasting preference or unclear. The owner decides persistence; this does not invent automatic memory writes or let a classifier override explicit instructions.                                    |

## Where to start

**D15 — Exact-value selection first (CB15/U22).** Input is a source already selected for reading plus the requested field role. Code finds candidates; Jev picks one or none; code returns the original value and location. It avoids free-form value generation and does not depend on a taxonomy, larger search system or agent lifecycle. Start with a value type the existing parser can recognize reliably.

**D16 — Calendar-date interpretation next (CB14/U21).** Begin with a requested date role in one selected message/document and a fixed reference instant. Keep calendar arithmetic and validity in code. Only then extend it to date intervals for chat search; the cookbook does not implement those interval semantics for us.

**D17 — Explicit claim/source review (CB11/U23/U27).** Start as a user-invoked review, not a hidden streaming gate. Check quote presence and source coverage, classify support/contradiction, and show the result as source support rather than proof of truth. This is a useful standalone operation before any generalized answer-review pipeline exists.

Batch independent questions throughout. Reranking, optional skill hints and evidence-packet classification are the next useful integrations. Taxonomy infrastructure and supervised autoresearch should follow a demonstrated need, not precede these small helpers.

## Scope and confidence

This is the requested quick analysis of the recipe pages and how-to patterns, using the existing llame research rather than another repository exploration pass. Recipe mechanics and fit are source-based; the new combinations are recommendations. No model accuracy, speedup, cost saving or production readiness was measured. Vendor example results are not transferred to llame, and no new test, benchmark or review campaign was run.

## Sources

[^cb01]: [Self-consistency: nouls](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook.md)

[^cb02]: [Self-consistency: choices](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook.md)

[^cb03]: [Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions.md)

[^cb04]: [Re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md)

[^cb05]: [Line-by-line search](https://docs.typesafe.ai/cookbooks/semantic_find.md)

[^cb06]: [Structure recovery](https://docs.typesafe.ai/cookbooks/autoformat.md)

[^cb07]: [Function calling](https://docs.typesafe.ai/cookbooks/function_calling.md)

[^cb08]: [Skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion.md)

[^cb09]: [Knowledge graph entity alignment](https://docs.typesafe.ai/cookbooks/entity_alignment.md)

[^cb10]: [Classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages.md)

[^cb11]: [Double-checking citations](https://docs.typesafe.ai/cookbooks/citation_check.md)

[^cb12]: [Guardrails for LLMs](https://docs.typesafe.ai/cookbooks/llm_guardrails.md)

[^cb13]: [SDE cascade](https://docs.typesafe.ai/cookbooks/sde_cascade.md)

[^cb14]: [Date extraction](https://docs.typesafe.ai/cookbooks/date_extraction_cookbook.md)

[^cb15]: [Pre-parsed value extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook.md)

[^cb16]: [Hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification.md)

[^cb17]: [Autoresearch feature discovery](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery.md)

[^cb18]: [Classification using confidence](https://docs.typesafe.ai/cookbooks/classification_using_confidence.md)

[^cookbook-index]: [TypeSafe cookbook inventory](https://docs.typesafe.ai/cookbooks.md)

[^how-to]: [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md)

[^fan-out]: [Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out.md)

[^confidence-routing]: [Confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing.md)

[^composite-scoring]: [Composite scoring](https://docs.typesafe.ai/patterns/composite-scoring.md)

[^intent-routing]: [Intent routing](https://docs.typesafe.ai/patterns/intent-routing.md)
