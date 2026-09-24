---
type: Research
title: "Source-aware investigation: reader routes, evidence intents and bounded workers"
description: "Applicable additions and corrections from a supplied Jev/LensVLM analysis, integrated with the existing reader, find and cookbook research."
tags: [jev, lensvlm, okf, investigation, provenance, delegation]
status: stable
canonical: false
observed:
  date: "2026-09-24"
sources:
  - id: supplied-analysis
    resource: "urn:sha256:3e6c70b98bf3b38d84b6c87da25f4e43593ffa0c8804cb0788ae1a2a410b2cd4"
    title: "User-supplied ChatGPT discussion, received 2026-09-24"
  - id: lens-card
    resource: "https://huggingface.co/apple/LensVLM-9B/raw/main/README.md"
    title: "LensVLM released model metadata"
  - id: lens-license
    resource: "https://huggingface.co/apple/LensVLM-9B/raw/main/LICENSE"
    title: "Apple Machine Learning Research Model License"
  - id: lens-paper
    resource: "https://arxiv.org/html/2605.07019v1"
    title: "LensVLM paper, sections3.3,9 and16.2"
  - id: okf
    resource: "https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/README.md"
    title: "OKF v0.2 and progressive disclosure"
  - id: aider-map
    resource: "https://aider.chat/docs/repomap.html"
    title: "Aider repository map"
  - id: lens-search
    resource: "https://arxiv.org/abs/2608.16185"
    title: "LENS: In-Context Search via Latent Evidence Exploration over Dynamic Raw Documents"
  - id: reader-study
    resource: "./report.md"
    title: "Question-directed reader scopes and current llame constraints"
  - id: find-study
    resource: "../2026-09-24-semantic-find-judge/report.md"
    title: "OMP find, jegrep and JUDGE source analysis"
  - id: cookbook-study
    resource: "../2026-09-23-system-one-jev/cookbooks.md"
    title: "TypeSafe cookbook applicability and derived applications"
---

# Source-aware investigation: integrating the supplied analysis

Analysis extension, 2026-09-24. The supplied ChatGPT discussion contributes useful design detail to the existing [reader study](./report.md), [find/JUDGE study](../2026-09-24-semantic-find-judge/report.md) and [cookbook assessment](../2026-09-23-system-one-jev/cookbooks.md). This document incorporates the additions and records corrections; it is not an implementation or an approved API contract. The source conversation is identified by its digest below rather than copied into the repository. [^supplied-analysis]

## What to retain, correct or defer

| ID      | Supplied claim or proposal                                                                             | Disposition for llame                                                                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IN1** | Generic research workers isolate lookup context; LensVLM optionally broadens what a reader can inspect | **Retain.** These are separate benefits. Context isolation does not require visual compression and does not eliminate total worker cost.                                                                                                                    |
| **IN2** | The released checkpoint directly names Qwen3.5-9B-Base                                                 | **Correct.** The current card names `Qwen/Qwen3.5-9B`; the paper says Base. Keep the existing lineage uncertainty, rather than promoting either description to an established released-weight lineage. [^lens-card][^lens-paper]                            |
| **IN3** | Add LensVLM after the generic reader                                                                   | **Qualify.** The released model license excludes product development. Retain the mechanism as research prior art; a product comparison needs an eligible generic VLM or separately obtained rights. [^lens-license]                                         |
| **IN4** | RepoQA is 63.4% versus 92.4% text at the 5x preset                                                     | **Confirmed, different denominator.** This is the per-dataset result. The existing 38.1% versus 65.6% is the aggregate code table, not a contradictory result. Neither establishes superiority over ordinary text inspection. [^lens-paper]                 |
| **IN5** | Route by vault sizes like 50–300 or 5,000 notes                                                        | **Do not adopt those cutoffs.** They are unmeasured heuristics. Use actual admitted bytes/tokens, evidence distribution, modality and query needs; note count is not a context budget.                                                                      |
| **IN6** | `kb.ask`, revisioned reads, `related`, research handles and per-area subagents                         | **Keep conceptual, not shipped.** Current live Knowledge has no general revision-read/backlink API, and independent resumability/delegation needs a lifecycle contract. Preserve the Q1/Q2 distinction and llame-owned Chat/Run identity. [^reader-study]   |
| **IN7** | The scenario already has hybrid KB retrieval and semantic WIP                                          | **Respect as the supplied scenario.** It does not change the prior shipped-source snapshot, which distinguishes hybrid chat retrieval from live Knowledge search. Reuse whichever candidate mechanisms actually exist in the selected source. [^find-study] |

The supplied discussion later corrects its initial RAG framing: iterative query-dependent retrieval is also available to ordinary text agents. Whole-vault hierarchy and recursive delegation are additional application behavior, not built-in LensVLM capabilities. The cited **LENS** paper is a separate index-free document-search framework, not Apple's LensVLM; its abstract is useful additional prior art, not a demonstrated llame benefit. Only its abstract was inspected here. [^supplied-analysis][^lens-search]

## Three independent responsibilities

- **SA1 — Source access:** admit a scope, discover candidates, read original content, and follow source-native relationships where available. OKF links, repository symbols and issue replies have different semantics.
- **SA2 — Evidence inspection:** use exact text, typed Jev judgments, a generic reader or a visual reader as appropriate. Changing the reader should not redefine source authority.
- **SA3 — Investigation:** identify missing evidence, decide whether another read is useful, reconcile findings and return a bounded answer.

These are responsibility boundaries, not a requirement to introduce three interfaces, a registry or a standalone research service. Start with one bounded investigator using existing source operations. Add an adapter only where representation or execution genuinely differs. A generic model transport may serve both text and visual models, while the visual path still needs rendering, a page-expansion loop and source mapping. Jev's decision API remains distinct from generative chat. [^reader-study][^find-study]

### Place the optional visual branch before narrow passage pruning

First admit and retrieve a broad but bounded candidate pool. Then choose:

- **Text route:** prioritize source passages with deterministic retrieval and optional Jev judgments; read originals; synthesize when needed.
- **Visual route:** render a broader selection of admitted notes/sections, let an eligible VLM select expansions, recover original evidence, then synthesize.

Rendering three already-selected snippets gives the visual reader little additional search coverage. Conversely, sending every note ignores admission and context limits. A reader cannot recover a source excluded from its bundle. The paper explicitly allows coarse retrieval before rendering and describes selection/expansion with other VLMs without task-specific training; those results compare compressed-reading variants, not a guarantee of parity with full text or the trained checkpoint. [^lens-paper]

For source-code caution, the paper's 5x preset reports:

| Evaluation           | LensVLM | Full-text baseline |
| -------------------- | ------: | -----------------: |
| RepoQA               |   63.4% |              92.4% |
| CodeQueries          |   12.8% |              38.7% |
| Aggregate code table |   38.1% |              65.6% |

These author-reported figures support keeping targeted text/code navigation as the default. They are not local reproductions or comparisons with a complete coding agent. Compact OKF descriptions and symbol maps are already text-efficient; rasterizing them has no demonstrated advantage here. [^lens-paper][^aider-map]

### A page manifest is a mapping, not a citation or permission

For a visual experiment, associate each reader-local bundle/page/region ID with the admitted source identity, observed content identity and original spans. A page may cross document boundaries, so allow several source segments rather than assuming one page equals one file. Preserve normalization/layout mapping separately from raw bytes. Apple's normalized page text must not be described as lossless recovery of original Markdown or code. [^reader-study]

Resolve selected pages through that mapping, reapply source/egress admission as needed, and quote original content. Use source-appropriate coordinates: file lines, message offsets or image regions. Do not publish a page number as the only citation, invent the transcript's sample `kb://records/...?...revision=` URI, or promise an immutable historical read where llame currently exposes only live content. A commit identifies committed code, not uncommitted worktree bytes; a trustworthy snapshot/hash claim needs an actual observed representation. [^reader-study]

## OKF navigation should complement source-native inspection

Read relevant `index.md` entries and descriptions to locate plausible areas; use concept links and `resource` references as leads. OKF supplies progressive disclosure, not a retrieval engine, access grant or guarantee that a summary is current. Keep a broader search path inside the already granted scope so missing/stale metadata cannot permanently hide sources. [^okf]

For repositories, use manifests, module notes and compact symbol signatures to find an area, then available definitions/references/implementations and explicit wiring to investigate behavior. Aider demonstrates a token-budgeted text map; that map is not proof of a complete runtime call graph. Syntax structure alone cannot resolve every dependency-injection choice, callback or configuration-selected implementation. Unresolved relationships remain unresolved. [^aider-map]

An optional OKF sidecar can describe subsystems and point to real code. Do not require frontmatter in source files, mandatory generated documentation, a persistent graph, or every source to implement identical `browse/search/read/follow/cite` methods. Preserve useful native operations, and mark unsupported relationships unavailable instead of manufacturing edges.

## Evidence intent changes what counts as relevant

The current OMP/jegrep verification rubric favors implementation/explanation and rejects mere callers, tests and configuration. That is appropriate for one task, not universal repository research. Introduce a task-specific evidence intent in the proposed llame flow; it changes the predicate, never the permission scope. [^find-study]

| Intent                               | Evidence that should remain eligible                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **EI1 — Implementation**             | Definitions and helpers that implement the requested behavior                                     |
| **EI2 — Callers and usage**          | Call sites, API consumers and argument/lifecycle expectations                                     |
| **EI3 — Configuration**              | Registration, dependency wiring, active settings and selection precedence                         |
| **EI4 — Tests and failure behavior** | Test assertions, fixtures and error cases; execution results only when actually obtained          |
| **EI5 — Design rationale**           | Current specs, decision records and admitted discussions, distinguished from implemented behavior |

One question may need several intents simultaneously. Use separate relevance questions or an explicitly inclusive rubric; do not force these evidence roles into one mutually exclusive Choice or transfer thresholds uncritically. A design note, inspected implementation, inspected test source and observed execution answer different questions. An exact quote can still be irrelevant to the claim: validate literal source/coverage first, then assess semantic support. This connects directly to cookbook CB10 and CB11. [^cookbook-study]

## Bounded area workers should return evidence and outward leads

Use delegation only when the question genuinely separates into independent investigations. A small number of workers can share the same generic implementation while receiving different questions and initial areas. Reading another file does not require another agent; deeper delegation is optional, not recursive worker-per-directory behavior. This remains a proposed capability beyond the basic bounded-reader proposal. [^supplied-analysis][^reader-study]

An initial area is a work partition, not necessarily the full permission boundary. A worker may follow a relevant relationship elsewhere inside its inherited grant if policy and budget permit. An out-of-grant lead goes back to the coordinator and host policy; it remains blocked unless properly admitted and never expands the grant itself.

The minimal result should retain:

| Component             | Content                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **EP1 — Findings**    | Claim, original evidence references and basis: documented intent, inspected code/test source, observed execution or inference |
| **EP2 — Leads**       | Specific unresolved question, candidate location/relationship and why inspecting it could close the gap                       |
| **EP3 — Coverage**    | What was actually inspected, observed source identity, truncation/failures and important exclusions                           |
| **EP4 — Uncertainty** | Conflicting evidence, missing dependencies and blocked/out-of-scope work                                                      |

The coordinator reconciles identifiers, conditions and boundaries against original evidence; agreement among workers is not enough. Charge every child call, retry, read, optional judge and final synthesis to a shared parent budget. Keep only the useful answer/evidence/gaps packet in the main model's context, without pretending total inference became free. Preserve llame's existing ownership/lifecycle rather than introducing a second session system. [^find-study][^reader-study]

A continuation handle is an optional later feature. It needs retention, owner binding, expiry, source-consistency and recovery semantics; it is not necessary for one scoped answer. Similarly, answer/partial/conflicted/not-found-within-budget are conceptual outcomes here, not an approved wire schema. Do not convert unsearched, failed or denied coverage into a claim that the corpus contains no answer.

### Two concrete extensions

**U30 — Cross-layer guarantee investigation.** For “Does this queue's deduplication prevent duplicate execution after retry?”, inspect design intent, producer/worker code, storage constraints and test source as distinct evidence roles. Reconcile whether they use the same key and transaction boundary; duplicate enqueue prevention is not automatically duplicate execution prevention. Test execution requires separate authorization and an observed result. This is a hypothetical task, not a reported llame bug.

**U31 — Evidence-gap-directed continuation.** A worker can report “the producer uses this uniqueness key; the retry/claim path is still unresolved” with exact references and a targeted outward lead. The coordinator inspects that lead under the remaining shared budget instead of summarizing uncertain prose again. Cookbook batching and support classification can help evaluate independent claims after the relevant evidence exists; they do not replace following the missing relationship. [^cookbook-study]

## What changes in our recommendations

- **D18 — Keep one text-first investigator as the baseline.** Context isolation and source-grounded synthesis do not depend on LensVLM. Use ordinary exact retrieval for simple questions and expand only for a concrete evidence gap.
- **D19 — Add evidence intent and navigation discipline before visual complexity.** Reuse OKF metadata, source-native relationships and the distinction between rationale, code, test source and execution. This improves the question being asked of a judge without adding a universal framework.
- **D20 — Treat visual reading and hierarchical workers as separable experiments.** A visual route needs a broader admitted candidate bundle and reliable source mapping; workers need evidence/lead packets and one aggregate budget. Neither is a prerequisite for the other, and neither is approved by this analysis.

Only material external facts were spot-checked: model metadata/license, relevant LensVLM paper sections, OKF/Aider documentation and the separate LENS abstract. No new inference, benchmark, runtime feature or review campaign was run. Existing experiment ledgers remain snapshots of their original studies; this companion carries its own sources.

## Sources

[^supplied-analysis]: User-provided `chatgpt-jev-lensvlm-analysis.md`, received 2026-09-24; SHA-256 `3e6c70b98bf3b38d84b6c87da25f4e43593ffa0c8804cb0788ae1a2a410b2cd4`. Reader proposals occur at lines 278-569 and generalized source/worker proposals at 588-908. The original conversation is not copied into this repository.

[^lens-card]: [LensVLM released model metadata](https://huggingface.co/apple/LensVLM-9B/raw/main/README.md)

[^lens-license]: [Apple Machine Learning Research Model License](https://huggingface.co/apple/LensVLM-9B/raw/main/LICENSE)

[^lens-paper]: [LensVLM paper, sections3.3,9 and16.2](https://arxiv.org/html/2605.07019v1)

[^okf]: [OKF v0.2 and progressive disclosure](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/README.md)

[^aider-map]: [Aider repository map](https://aider.chat/docs/repomap.html)

[^lens-search]: [LENS: In-Context Search via Latent Evidence Exploration over Dynamic Raw Documents](https://arxiv.org/abs/2608.16185)

[^reader-study]: [Question-directed reader scopes and current llame constraints](./report.md)

[^find-study]: [OMP find, jegrep and JUDGE source analysis](../2026-09-24-semantic-find-judge/report.md)

[^cookbook-study]: [TypeSafe cookbook applicability and derived applications](../2026-09-23-system-one-jev/cookbooks.md)
