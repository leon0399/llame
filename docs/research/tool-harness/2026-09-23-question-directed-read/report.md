---
type: Research
title: "Question-directed reads: LensVLM and interchangeable reader models"
description: "Assesses LensVLM, local Qwen/Gemma, hosted and promotional models for bounded read questions and explicit read-only investigation, with source evidence and reproducible cost/mechanics probes."
tags: [read, delegated-inspection, lensvlm, qwen, model-routing, context]
status: stable
canonical: false
generated: { by: omp/openai-codex-gpt-6-astra, at: 2026-09-23T21:49:06Z }
sources:
  - id: "225152e9c8d1f228"
    resource: "https://huggingface.co/apple/LensVLM-9B"
    title: "Apple LensVLM-9B model card"
  - id: "95f18f68dd101455"
    resource: "https://huggingface.co/apple/LensVLM-9B/raw/main/LICENSE"
    title: "Apple Machine Learning Research Model License"
  - id: "d0be0c24030a1db1"
    resource: "https://arxiv.org/html/2605.07019v1"
    title: "LensVLM: Selective Context Expansion for Compressed Visual Representation of Text"
  - id: "969911f423f20c15"
    resource: "https://huggingface.co/apple/LensVLM-9B/raw/main/config.json"
    title: "LensVLM released model configuration"
  - id: "b7737dbcc9e485f6"
    resource: "https://github.com/apple-aiml-research/ml-lensvlm/blob/10709a7e2a80bdf971628359d47e4bd35fce3d95/LICENSE"
    title: "LensVLM Apple Sample Code License"
  - id: "7dfe45c871b1e422"
    resource: "https://github.com/apple-aiml-research/ml-lensvlm/blob/10709a7e2a80bdf971628359d47e4bd35fce3d95/README.md"
    title: "LensVLM official runtime and evaluation entrypoints"
  - id: "a6d9908366d482e5"
    resource: "https://github.com/apple-aiml-research/ml-lensvlm/blob/10709a7e2a80bdf971628359d47e4bd35fce3d95/lensvlm/rendering.py"
    title: "LensVLM source normalization and page mapping"
  - id: "5a56ffb9a6fc3cc4"
    resource: "https://github.com/apple-aiml-research/ml-lensvlm/blob/10709a7e2a80bdf971628359d47e4bd35fce3d95/lensvlm/evaluate.py"
    title: "LensVLM bounded page-expansion loop"
  - id: "ec4072a47d01eeaf"
    resource: "https://github.com/apple-aiml-research/ml-lensvlm/blob/10709a7e2a80bdf971628359d47e4bd35fce3d95/requirements.txt"
    title: "LensVLM runtime dependencies"
  - id: "581e10a8f9a590e3"
    resource: "https://github.com/leon0399/llame/issues/849"
    title: "Question selector for read: delegated inspection"
  - id: "153cb8e29978b1f3"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/docs/research/harnesses/spotify-shunt.md"
    title: "llame Spotify Shunt reference"
  - id: "01d1f8a5ba73e9df"
    resource: "https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/utils/image-question.ts"
    title: "OMP explicit image-question worker"
  - id: "e6b6fd2fd0cbd064"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/tools/web-read/locator.ts"
    title: "llame existing HTTP query and selector grammar"
  - id: "c9ef00e6f9c7c8e6"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/tools/permissions/locator-projection.ts"
    title: "llame locator permission projection"
  - id: "f76edc456146d134"
    resource: "./probes/lens-preprocessing-result.json"
    title: "Executed LensVLM preprocessing mechanics"
  - id: "48a3b19809bd9e14"
    resource: "./probes/economics-result.json"
    title: "Executed illustrative helper economics"
  - id: "e0a64484787e9317"
    resource: "https://huggingface.co/Qwen/Qwen3.5-9B"
    title: "Qwen3.5-9B post-trained model"
  - id: "e3a8ccacb982d0cf"
    resource: "https://huggingface.co/Qwen/Qwen3.5-4B/tree/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a"
    title: "Qwen3.5-4B local alternative"
  - id: "82d7923da79cca64"
    resource: "https://huggingface.co/Qwen/Qwen3.5-27B/tree/fc05daec18b0a78c049392ed2e771dde82bdf654"
    title: "Qwen3.5-27B dense alternative"
  - id: "a01ee15bf28f5081"
    resource: "https://huggingface.co/Qwen/Qwen3.5-35B-A3B/tree/59d61f3ce65a6d9863b86d2e96597125219dc754"
    title: "Qwen3.5-35B-A3B MoE alternative"
  - id: "f23b0b274bf1d161"
    resource: "https://huggingface.co/google/gemma-4-12B-it"
    title: "Gemma 4 12B instruction-tuned alternative"
  - id: "8eb12065b9344787"
    resource: "https://api-docs.deepseek.com/quick_start/pricing"
    title: "DeepSeek model pricing and route identity"
  - id: "db28700ee6d07a1c"
    resource: "https://help.aliyun.com/en/model-studio/qwen3-8-flash"
    title: "Qwen3.8-Flash hosted model"
  - id: "b0ba3683a0dc5627"
    resource: "https://help.aliyun.com/en/model-studio/privacy-notice"
    title: "Model Studio privacy notice"
  - id: "f00960a1192814bf"
    resource: "https://developers.openai.com/api/docs/models/gpt-6-luna"
    title: "GPT-6 Luna model and pricing"
  - id: "e3a5934e3172ec52"
    resource: "https://developers.openai.com/api/docs/models/gpt-6-sol"
    title: "GPT-6 Sol primary cost baseline"
  - id: "2aca780af5aa59ce"
    resource: "https://developers.openai.com/api/docs/guides/your-data"
    title: "OpenAI API data controls"
  - id: "116c1a7f3be0904b"
    resource: "https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash"
    title: "Gemini 3.8 Flash capabilities"
  - id: "b88c4950bbf39196"
    resource: "https://ai.google.dev/gemini-api/docs/pricing"
    title: "Gemini API dated paid and free pricing"
  - id: "a56c52f541d6ad5f"
    resource: "https://ai.google.dev/gemini-api/terms"
    title: "Gemini API terms and data-use boundary"
  - id: "746b888a3a6472b8"
    resource: "https://ai.google.dev/gemini-api/docs/openai"
    title: "Gemini OpenAI-compatible API"
  - id: "c4759988399b2201"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/native-file-tools/spec.md"
    title: "llame exact read and source-selector contract"
  - id: "2eec27a5b96e8046"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/tool-calling/spec.md"
    title: "llame tool authority and bounded replay"
  - id: "a55ca7fcab266b2e"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/model-system-prompts/spec.md"
    title: "llame prompt preparation receipt contract"
  - id: "6b3e943cd1fe085f"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/conversation-reads/spec.md"
    title: "llame exact episodic message reads"
  - id: "098f797eb9f933b9"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/VISION.md"
    title: "llame ownership and local inference direction"
  - id: "cf22f78099135172"
    resource: "../2026-09-23-system-one-jev/report.md"
    title: "Earlier System One/Jev research layer"
  - id: "3625dc1afe52ad01"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/knowledge/knowledge-tools.ts"
    title: "llame bounded live Knowledge search"
  - id: "5e356f9875f85bb8"
    resource: "https://github.com/apple-aiml-research/ml-lensvlm/blob/10709a7e2a80bdf971628359d47e4bd35fce3d95/lensvlm/vision_config.py"
    title: "LensVLM reference serving defaults"
  - id: "8aaffeb263754fbe"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/testing/portable-tool-policy.ts"
    title: "llame recommended portable permission test fixture"
  - id: "8b6697f4cd451071"
    resource: "./probes/locator-policy-result.json"
    title: "Executed delegated-locator policy pattern probe"
---

# Question-directed reads: LensVLM and interchangeable reader models

Research date: 2026-09-23. Revision: v3. Noncanonical research; no implementation or scope approval.

## Executive Summary

Adopt `?q=`, but not Apple LensVLM-9B as the default engine: use a bounded, text-first reader on an operator-selected existing model entry, local `Qwen/Qwen3.5-9B` or a qualified hosted model such as GPT-6 Luna or DeepSeek Flash. Confidence in this fit: moderate; no candidate's answer quality on llame workloads was measured.

LensVLM is mechanism prior art only: research-only weights and a reported latency penalty (L2/L3). The two scopes here are #849's selected-source answer (Q1) and the broader bounded investigator over nearby documents and episodic history (Q2); delegation pays only under the cost conditions in Context savings. The offline probes cover mechanics and arithmetic, not model quality. [^95f18f68dd101455][^d0be0c24030a1db1][^581e10a8f9a590e3]

## Introduction and authority

Second research layer after the [System One/Jev study](../2026-09-23-system-one-jev/report.md). It examines the commented `read.md` drafts and [issue #849](https://github.com/leon0399/llame/issues/849), which reserves `?q=` and `?question=` for a second model's generated answer. The WIP prompt is an input, not shipped behavior, and stays untouched. Proposed lookup:

```text
kb://<space-id>/research/jev.md?q=What%20did%20we%20research%20about%20Jev%3F
```

Not implemented here; `path://` is shorthand for a locator, not a new scheme. A literal `?` inside a Knowledge filename stays encoded, and the question is separate metadata. `?jq=` and `?select=` remain deterministic; `q` is not a general SQL or search-expression parameter. [^581e10a8f9a590e3][^c4759988399b2201]

Pins: llame `e70228485042967fd9545ad0cb133faae1be2268`; the follow-on branch starts from the published Jev research head `41e9d46e7bfe2fb1d693f5d0c1320c5351de2216`; LensVLM source revision `10709a7e2a80bdf971628359d47e4bd35fce3d95`. No application code, WIP prompt, OpenSpec contract or issue acceptance changed.

## Main Analysis

### L1 — What LensVLM actually does

LensVLM is a post-trained Qwen3.5-derived vision-language model, not a general filesystem agent. The paper trains from `Qwen3.5-9B-Base` with supervised trajectories and reinforcement learning for page selection and expansion; the model card names `Qwen/Qwen3.5-9B`, the separate post-trained conversational checkpoint, as base model. The released weights' exact lineage is unresolved between these sources. Do not treat Base, ordinary post-trained Qwen and Apple's derivative as interchangeable, or assume the release reproduces the paper's setup. [^d0be0c24030a1db1][^225152e9c8d1f228][^e0a64484787e9317]

Reference path: rasterize a selected text document into labeled page images; supply the pages and question; parse a `read_page` call selecting an integer page; append that page's text or a higher-resolution image, then continue; return the answer when the model stops calling the tool or the bounded loop ends. Runtime defaults: six turns, generation capped per turn. The tool reads only the supplied page array; it does not search neighboring files, resolve `kb://` locators, enumerate Knowledge Spaces or query chat history, which need a separate host-controlled tool surface and their own evaluation. Select-then-expand prompting also improved untrained Qwen and Sonnet (the method is model-agnostic in principle), but that does not establish arbitrary tool-use competence. [^5a56ffb9a6fc3cc4][^7dfe45c871b1e422][^d0be0c24030a1db1]

Rendered text favors text expansion; native visual documents can retain layout evidence OCR misses through high-resolution image expansion. Lens-style processing is therefore more interesting for scanned reports, diagrams and dense tables than for a Markdown note whose exact text llame already has. Application hypothesis, not a claim that rasterizing Markdown never helps. [^d0be0c24030a1db1]

### L2 — Compression evidence is narrower than a speed or quality guarantee

The 5x/10x/15x presets compress input; effective compression also counts expanded evidence and drops when more pages are read. The authors report accuracy near full text at 4.3x effective compression and favorable comparisons up to 10.1x: scoped, author-reported results, not a guarantee of tenfold savings on a llame request. [^d0be0c24030a1db1]

| Reported observation                                                                                                                    | Interpretation for llame                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text-QA comparison: LensVLM 68.9% versus full-text 72.4% at the 5x preset / about 4.3x effective compression                            | "Comparable" still includes a quality gap; it does not establish superiority over a post-trained Qwen reader on raw Markdown.                              |
| Code-understanding table: 38.1% versus full-text 65.6% at the 5x preset                                                                 | Selective recovery improves compressed-code reading but remains far behind that full-text baseline in this experiment.                                     |
| At 15x with 20 images: 2,288 final-context tokens / 71 MiB KV versus 10,686 / 334 MiB for text                                          | A useful memory tradeoff in the reported vLLM TP=8 B200 setup; not total process memory or an API-billing ledger.                                          |
| Typical one expansion: approximately 17 seconds versus 8 seconds for single-turn text, batch size one and 256 generation tokens on B200 | Sequential generation/expansion and the vision encoder can make the compressed route slower. No local workstation p95 or cold-start result is established. |

All rows are the paper's, not this investigation's runs. Its evaluation uses an LLM judge and curated QA/data constructions; the retrieval comparisons are reader-budget comparisons and do not show every practical retrieval pipeline needs an expensive offline index. llame's live literal Knowledge search is an obvious counterexample. [^d0be0c24030a1db1][^3625dc1afe52ad01]

### L3 — The released weights are a research candidate, not a product dependency

The Apple Machine Learning Research Model License allows only non-commercial scientific research and academic development and explicitly excludes product development and commercial product/service use; personal or self-hosted use does not automatically qualify. Do not add these weights to llame product behavior under that license. [^95f18f68dd101455]

The source code uses the separate Apple Sample Code License (use/modification/redistribution under its notice and disclaimer terms). Reimplementing select-expand with an eligible model is separate from deploying Apple's checkpoint; Qwen's Apache-2.0 does not override Apple's terms for derivative weights. [^b7737dbcc9e485f6][^e0a64484787e9317]

The runtime adds Python/PyTorch/vLLM/Transformers/Pillow. Config declares a 262,144 positional ceiling, but reference `load_model` defaults to `max_model_len=32768`, and the paper's main text evaluation stays below 32K text tokens. The loader also defaults to trusted remote code and root-wide local-media access; those research defaults must not become llame filesystem authority. Neither the ceiling nor the B200 setup proves fit or latency on an operator's GPU. No weights or ML packages were downloaded. [^969911f423f20c15][^ec4072a47d01eeaf][^5e356f9875f85bb8][^d0be0c24030a1db1]

### L4 — A production read answer needs stronger provenance than page numbers

The upstream renderer collapses whitespace, paragraph boundaries and code indentation: returned page text is normalized and line-wrapped, not original bytes. An optional original-character mapping covers supplied training/evaluation evidence spans only, and a page index is not a native file line citation. Integration must preserve source identity and coordinates independently. [^a6d9908366d482e5]

The preprocessing probe loads unchanged pure-function ASTs from the pinned upstream files, without model or rendering imports. It shows indentation/newlines disappearing, answer characters mapping through normalization, the parser accepting a page key under an unrelated tool name, and the response builder bounded by its supplied page list: not arbitrary filesystem access. That is why the research parser is not a general llame tool dispatcher. [^f76edc456146d134]

## Model choices for the reader role

Candidate baselines, not a measured ranking; context figures are advertised ceilings, and prices are dated 2026-09-23 for the named route. A model name alone does not specify deployment cost, data terms or feature compatibility.

| ID  | Candidate                                       | Use in the comparison                                                                        | Important limit                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `apple/LensVLM-9B`                              | Research-only comparison of compressed-page selection and expansion                          | Product-development exclusion; custom visual pipeline; reported latency penalty. [^225152e9c8d1f228][^95f18f68dd101455]                                                                                                                                           |
| M2  | `Qwen/Qwen3.5-9B`                               | First local, text-first source-answering baseline; post-trained checkpoint                   | Apache-2.0; native 262,144 context. Validate backend, quantization and tool parser. No canonical `-Instruct` suffix is needed for this model ID. [^e0a64484787e9317]                                                                                              |
| M3  | `Qwen/Qwen3.5-4B`                               | Lower-resource comparison for focused extraction/short answers                               | Evaluate losses in synthesis and abstention; do not assume parity with 9B. [^e3a8ccacb982d0cf]                                                                                                                                                                    |
| M4  | Qwen3.5-27B or Qwen3.5-35B-A3B                  | Optional quality/throughput escalation when already provisioned                              | More memory; 3B active MoE compute does not mean 3B total weights. No automatic escalation without an eligible configured route. [^82d7923da79cca64][^a01ee15bf28f5081]                                                                                           |
| M5  | `google/gemma-4-12B-it`                         | Independent local family for document/OCR and multimodal comparison                          | Apache-2.0; 256K context and native function calling are vendor-stated capabilities, not llame integration proof. [^f23b0b274bf1d161]                                                                                                                             |
| M6  | `gpt-6-luna` via OpenAI Responses               | Inexpensive hosted text/image baseline, especially if OpenAI is already an accepted provider | $0.10 input / $0.01 cached / $0.125 cache write / $0.50 output per million. More than 272K input changes rates. Chat Completions function calling requires effort `none`; prefer the documented Responses path for tool use. [^f00960a1192814bf]                  |
| M7  | `deepseek-flash`, currently DeepSeek-V4.1-Flash | Hosted text/vision reader and bounded-tool-loop comparison                                   | Off-peak $0.15 input miss / $0.003 hit / $0.60 output; peak $0.30 / $0.006 / $1.20. Advertised 1M context and 384K maximum output. Alias/price can change; API data-retention suitability remains an operator decision. [^8eb12065b9344787]                       |
| M8  | `qwen3.8-flash` on Model Studio                 | Hosted Qwen alternative without operating local weights                                      | Beijing list price CNY 0.8 input / 0.1 cache hit / 2.7 output per million; regional pricing differs. Advertised 1M context, tool use and multimodal input. No FX conversion or cross-provider quality equivalence is assumed. [^db28700ee6d07a1c]                 |
| M9  | `gemini-3.8-flash`                              | Multimodal/PDF comparator and an example of time-limited pricing/free quota                  | Paid $0.75 input / $3.75 output through 2026-12-31, doubling from 2027-01-01; caching adds its own rates/storage. Native modality support is not automatic parity through an OpenAI-compatible adapter. [^116c1a7f3be0904b][^b88c4950bbf39196][^746b888a3a6472b8] |

**Recommendation:** begin with M2 and one already accepted hosted route, M6 or M7; add M3 for the lower-resource boundary, and M5/M9 only when visual documents justify a modality experiment. Do not build a nine-model router because nine candidates were compared.

**Local economics:** local is not free: weight memory, KV/recurrent state, batching, vision preprocessing, idle capacity and electricity count. Lower-bound arithmetic: nine billion 16-bit parameters occupy 18 GB before other allocations; ideal four-bit storage is 4.5 GB before scales, runtime and context. These are not package sizes or a fit promise. Keep a warm operator-managed endpoint; make the context disposable, not the weights. llame's vision leaves model-runtime operation to configured providers. [^098f797eb9f933b9]

## Free and promotional endpoints

An operator-configured no-charge model can fill the reader role if capability, terms and data recipient are acceptable; zero price is no privacy or availability guarantee. Treat quota exhaustion, campaign expiry, changed aliases and disabled tool use as normal failures; a failed `?q=` must not silently send the source to an unaccepted paid or free provider. The exact-read path stays available. [^581e10a8f9a590e3][^b88c4950bbf39196]

Google is a concrete caution: unpaid-service terms allow product improvement and human review and prohibit sensitive/confidential/personal information. Regional exceptions apply (EEA/Swiss/UK treatment differs; API clients there require Paid Services). A project with active billing can have paid-service data terms even at zero effective price, and the terms specify professional/business use, not consumer use. Check the actual account/use case; not every Gemini free quota is an eligible private-memory backend. [^a56c52f541d6ad5f]

Alibaba states it does not train on customer data but stores model/application-call data, with no fixed retention duration in the inspected notice. OpenAI's no-training default does not mean no retention: abuse monitoring and Responses application state are distinct controls. DeepSeek's balance-credit listing does not establish an active free campaign or a retention guarantee. These are selection prerequisites, not a vendor blacklist. [^b0ba3683a0dc5627][^2aca780af5aa59ce][^8eb12065b9344787]

Record the configured route, accepted data policy, observed usage and offer limits; expiry management can stay operator-owned. No campaign discovery service, silent substitution or automatic cheapest-model router for the first feature.

## Synthesis: two read scopes and one explicit authority boundary

### Q1 — Selected-source answering, matching issue #849

A caller gives a locator, optional selector and question. Once a new grammar/projection separates recognized delegation metadata from resource identity, the existing read authorization/resolution path obtains the bounded text or listing, and a configured reader returns generated analysis. A file/range answer covers the shown text; a directory answer covers its listing, not every listed file's contents. A missing worker returns the issue's structured error, not a raw read or a different provider call. [^581e10a8f9a590e3][^c4759988399b2201][^c9ef00e6f9c7c8e6]

The image part of #849 needs bounded media decoding and transport, type/size limits, a declared hash/transform domain and worker-modality admission. Today's text path does not produce the decoded image payload, and a model ID alone does not establish that the worker accepts it; modality does not follow from a vendor or model name. [^581e10a8f9a590e3][^c4759988399b2201]

This can be a one-shot subcall on the parent Run/tool call: no general subagent product, autonomous session or new authority. "Throwaway" means a fresh, bounded working context discarded after the result, with identity, source coverage, usage and outcome still inspectable. [^2eec27a5b96e8046][^a55ca7fcab266b2e]

OMP precedent: an already-loaded image and question go to a separate completion with its own prompt, model identity, usage and abort/timeout handling, and its vision chain can fall through to other models. Borrow the bounded subcall/accounting shape, not that cross-provider fallback without accepted egress. [^01d1f8a5ba73e9df]

### Q2 — Bounded source investigation, matching the broader user example

The worker starts with the selected note but may request more evidence: a distinct capability, not incidental to Q1. Its expansion scope must be explicit: a named Knowledge subtree, an enumerated set of related locators, or a separately enabled owner-chat corpus. Filename relationships and model beliefs are not authorization. [^581e10a8f9a590e3][^c9ef00e6f9c7c8e6][^2eec27a5b96e8046]

`knowledge_search` scopes to a whole `knowledgeSpaceId`, not a subtree or enumerated set. Q2 needs a new host-enforced search boundary with compatible continuation, or direct reads of an enumerated set. Broad search plus hidden post-filtering must not be presented as narrow-scope inspection. [^3625dc1afe52ad01]

For "what did we research about Jev?":

1. Read the seed note/range with the existing resolver and permission gate.
2. If that cannot answer, search only the declared Knowledge scope and read selected passages.
3. If episodic recall is included, use owner-scoped conversation search and exact message reads; keep message dates and provenance distinct from maintained notes.
4. Return a bounded synthesis with per-claim citations, conflicts, omissions and incomplete-search status.

Allowed tools are specific read/search operations, not Bash described as read-only, arbitrary MCP tools, network access or recursive delegation; every expansion passes the same policy/owner checks. `conversation_read` excludes tool observations, so the worker cannot claim to inspect historical tool results through it. Source access and permission to send it to the worker provider are separate. [^6b3e943cd1fe085f][^2eec27a5b96e8046][^c9ef00e6f9c7c8e6]

A tightly bounded inspector stays subordinate to the parent Run. Independent resumability, steering, background lifetime or child conversations would cross into VISION's child-agent lifecycle; do not build that product for one file question. [^098f797eb9f933b9]

The [source-aware investigation extension](./source-aware-investigation.md) develops this with OKF navigation, source-native relationships, evidence-carrying area workers and a visual branch before aggressive passage pruning, and reconciles the supplied analysis's checkpoint and benchmark claims. Separately cited design additions, not expansion of #849 or newly shipped child-agent/revision-read capabilities.

### Q3 — Evidence and lifecycle requirements for either mode

- **Generated answer, never source bytes.** Keep `kind: answer`, untrusted framing and an exact-read route for editing. Validate cited coordinates against what the worker saw, not the current file's length. Shown ranges and untrusted Knowledge notices are useful inputs, but worker answers, content hashing and citation checks do not ship because a prompt draft mentions them. [^581e10a8f9a590e3][^c4759988399b2201]
- **Content identity must name its domain.** Hashing the worker-visible selection/representation differs from hashing a source file or live page; never read outside the allowed selection to manufacture a whole-file hash. Keep locator, representation/transform, requested versus shown coverage, truncation and retrieval time, and decide explicitly whether exact snapshots are retained. A valid line range proves addressability, not support. [^a6d9908366d482e5][^f76edc456146d134][^581e10a8f9a590e3]
- **No invisible second inference.** Prompt receipts prove preparation of the main attempt, not generic actual calls. A helper needs its own parent Run/attempt/tool-call linkage, safe model identity, prompt/source binding, usage, status and coverage. Do not enlarge a system-only receipt or report only the primary's cost; `maxStepsPerRun` and maximum output tokens are not an existing helper-spend budget. [^a55ca7fcab266b2e][^2eec27a5b96e8046]
- **Bound work in code.** Before each expansion, enforce remaining input/output, source-count, time and tool-call allowances, propagate cancellation and stop new calls after it. A budget stop returns a partial answer with inspected coverage, not a comprehensive-sounding completion. Authorize the source before opening it and each later target; low confidence never widens scope. [^581e10a8f9a590e3][^2eec27a5b96e8046][^c9ef00e6f9c7c8e6]
- **Separate question metadata before policy, not only before opening.** Host-path permission projection currently leaves the submitted path unchanged: in the recommended fixture, credential rejects match `/p/.env` and `/h/.npmrc` but miss the same strings with an unparsed `?q=`/`?question=` suffix (the pattern probe confirms this). Authorizing the unsplit string and stripping the suffix before opening would bypass the rejection. Parse first, then use the same parsed identity for policy and execution on every supported scheme. Conditional hazard, not a shipped exploit; the fixture is not a runtime default, and omitted permissions deny all calls. [^8aaffeb263754fbe][^c9ef00e6f9c7c8e6][^8b6697f4cd451071]
- **Resolve host and URL grammar before promising all-source parity.** HTTP `?q=` currently goes to the publisher, and a generic suffix parser must not steal it. Absolute host filenames may contain a literal `?`, and the native contract prefers an existing literal filename over selector-shaped suffixes; extending that blindly would let filesystem contents decide whether `q` means inference, contradicting #849's reservation. Choose literal-path escaping/precedence and an unambiguous question channel for these targets; Knowledge's `%3F` alone does not solve host paths or URL queries. No grammar change here. [^e6b6fd2fd0cbd064][^c4759988399b2201][^581e10a8f9a590e3]

## Context savings, latency and total cost

If only the final answer/evidence package returns, the primary avoids the worker's intermediate observations, a real benefit but not zero context: the answer, citations, coverage metadata and verification reads still consume primary input, and a verbose report may cost more than the few exact passages needed. Output should be complete for the question and explicit about limits, not automatically long. [^153cb8e29978b1f3]

For comparable work: `W` = all helper input/output/reasoning/tool-call charges; `A` = added primary answer/evidence/verification input at its actual rate class; `E` = incremental final-answer output, rendering, storage or hosting cost; `S` = primary source input actually avoided at its actual uncached/cache-read/cache-write rate. Delegation saves money only when `W + A + E < S`. Do not credit a full document a normal range read would have avoided, and do not convert a final-context compression ratio into total multi-turn savings; caching and repeated tool history make the request ledger the authority. [^153cb8e29978b1f3][^d0be0c24030a1db1]

Compare alternatives from the same point: source text already in the model-facing primary context and retained by both is common cost, so avoided `S` is zero. Before first insertion, compare source tokens `s` against returned answer/evidence/verification tokens `a`; if both alternatives stay sufficient and retain their payloads for `N` primary model requests, both use the same rate factor `r_first + (N - 1) * r_cached`. First-touch may be ordinary input or a cache write; do not charge only one alternative at the write rate. `N` counts model requests, not user messages or completed Runs. [^153cb8e29978b1f3][^e3a5934e3172ec52]

Check residency against llame's actual projection: stored replay caps each serialized call/result pair at 8,000 UTF-16 units and each stored assistant turn at 32,000, and payloads clear before irreducible old pairs are dropped. A source payload can clear while its shorter helper answer survives, making later delegation carry _more_ primary context; these limits are character-based, not token-based. The symmetric cases hold only while both payloads stay resident, for example consecutive in-Run steps, not across stored turns. Across Runs, measure each request's post-projection source and answer tokens separately; compaction, new worker calls and changing answers invalidate the simple carry assumption. [^2eec27a5b96e8046]

The corrected Decimal script assumes 3,000 source tokens, 4,000 aggregate worker input tokens, 500 worker output tokens and normally 1,500 added primary tokens: illustrative totals, not measured counts or proposed limits. Common final-answer output cancels; changed output, extra worker calls, storage and hosting are omitted. [^48a3b19809bd9e14]

| Scenario                                                                                       | Avoidable direct source cost | Delegated incremental cost |               Difference |
| ---------------------------------------------------------------------------------------------- | ---------------------------: | -------------------------: | -----------------------: |
| C1 — New source, one Sol ordinary-input request; DeepSeek off-peak worker                      |                     $0.00600 |                   $0.00390 |           Saves $0.00210 |
| C2 — Selected source already carried by both alternatives; add the same helper                 |                           $0 |                   $0.00390 | Entirely additional cost |
| C3 — New source, one Luna ordinary-input request; DeepSeek off-peak worker                     |                     $0.00030 |                   $0.00105 |      Costs $0.00075 more |
| C5 — C3 resident for 51 model requests, with no extra helper calls or payload clearing         |                     $0.00180 |                   $0.00180 |  Illustrative break-even |
| C6 — C1 with the first insertion charged as a Sol cache write on both sides                    |                     $0.00750 |                   $0.00465 |           Saves $0.00285 |
| C7 — Zero-price worker returns 4,000 answer/verification tokens instead of 3,000 source tokens |                     $0.00600 |                   $0.00800 |      Costs $0.00200 more |

The old draft's 19,500-token cached-source break-even is withdrawn: it credited removal of already-carried source while pricing the helper result as new input. The corrected cases show helper cost can dominate a cheap primary, and a verbose helper or unnecessary delegation can lose even at zero provider price. Smaller carry amortizes a helper only while that differential remains in actual requests. C5 is conditional arithmetic, not a promise of 51 useful steps, step-limit eligibility or savings over 51 user messages; replay clearing can remove the advantage. [^2eec27a5b96e8046][^48a3b19809bd9e14][^8eb12065b9344787][^f00960a1192814bf][^e3a5934e3172ec52]

Time is separate: cold acquisition/loading, warm queueing/prefill, each sequential tool turn, preprocessing, validation and primary continuation. Reuse a warm local service instead of loading a model per `?q=`; a stateless request or disposable worker context can still use a resident process. LensVLM's published latency warns against optimizing token count alone. [^d0be0c24030a1db1][^7dfe45c871b1e422]

## Concrete llame applications and evaluation cases

| ID  | Application                                                                        | What the worker should return                                                                     | Evaluation boundary                                                                                                 |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| U7  | Explain a long spec's exception or failure behavior                                | A narrow answer with exact cited clauses and explicit absence when the selection lacks the answer | Q1; place evidence at beginning/middle/end, include exceptions and no-answer cases                                  |
| U8  | Synthesize the existing Jev research note with related notes                       | Supported conclusions, conflicting dates/versions and per-note references                         | Q2; seed plus explicitly allowed nearby scope; test unlisted siblings and stale contradictions                      |
| U9  | Reconcile a maintained note with prior chat decisions                              | Separate what the note says from dated user decisions/corrections                                 | Q2 with explicit episodic scope; test namesakes, cross-owner denial and tool-part exclusion                         |
| U10 | Explain a code subsystem without loading the whole module into the primary context | Relevant symbols, reasoning and exact verification ranges                                         | Compare text-first reader to outlines/range reads; preserve indentation and do not use generated text as edit input |
| U11 | Answer a question over a scanned report/table or diagram                           | Page/region evidence and uncertainty about unreadable detail                                      | Future media path; compare ordinary VLM/real page zoom before synthetic text rasterization                          |
| U12 | Triage a directory for the next exact read                                         | Candidate entries and the basis in visible names/metadata                                         | Q1 listing alone cannot assert file contents; Q2 file inspection must be explicitly enabled                         |

Proposed uses, not measured successes or automatic additions to #849. Jev could optionally score candidate relevance; it cannot write the answer. Do not default to a three-model classify-read-verify chain without evidence it beats one qualified reader. [^cf22f78099135172][^581e10a8f9a590e3]

Fixture set (fixed, owner-controlled, synthetic/public): answerable and unanswerable selections; code whitespace; multilingual text; misleading same-keyword notes; a later correction contradicting an older statement; query-string collisions; out-of-range citations; budget/truncation stops; cancelled/unavailable workers; credential paths and cross-owner resources refused before any provider sees content. Label answer claims and exact supporting source locations.

Compare exact/outlined/range reads, Q1 on each qualified model, Q2 at identical scope/budgets, and Lens-style visual scanning only in a separate license-compatible research track. Score supported-claim precision/recall, citation validity versus semantic support, abstention, scope breaches, total token/currency charges, parent context occupancy, median/p95 latency and cold/warm behavior. Context-window size and permissive licenses are eligibility facts, not quality results.

This fixture stage does **not** satisfy #849's implementation-approval gate, which stays open until owner-consented real transcripts are replayed against the counterfactual alternatives with actual provider usage, repeated reads, verification costs and task outcomes. Record that break-even before implementation approval; no such replay was performed here. [^581e10a8f9a590e3]

## Recommendations

1. **D6 — Build the research baseline around a model-independent reader role.** Reference an existing configured model entry, not a hard-coded Apple/Qwen/DeepSeek identity; text-first Qwen3.5-9B plus one accepted hosted route suffices for the first comparison.
2. **D7 — Keep selected-source `?q=` and broader investigation distinct.** Q1 matches #849; develop Q2's explicit expansion/episodic scope independently. Never silently turn a file question into a search across the owner's world.
3. **D8 — Treat LensVLM as mechanism prior art and a research-only comparator.** Do not adopt the released weights for llame product development. For native visual sources, first test an eligible ordinary VLM with controlled page expansion.
4. **D9 — Make evidence, accounting and egress part of the proposal.** These are missing contracts, not configuration details supplied by `models[]` or system-prompt receipts. Retain the exact-read route and no-worker structured error.
5. **D10 — Select on measured useful output, not a free label or model size.** Keep campaigns operator-controlled with explicit provider/price/data constraints, reject silent cross-provider or paid fallback, and measure total work and support quality before automatic routing.

Priority: evaluate Q1 on text fixtures first; test the broader Jev/episodic example as a separately scoped Q2 experiment. No OpenSpec approval or implementation is implied.

## Limitations and counterevidence

No LensVLM/Qwen/Gemma inference, hosted-model benchmark, private-corpus query or GPU fit test was run, and no weights or ML dependencies were downloaded. Three offline probes cover unchanged upstream pure-function mechanics, synthetic permission-pattern behavior and arithmetic only; capability/benchmark claims remain vendor or paper reports.

Apple's abstract calls the quality comparable, but the reported text and code comparisons still contain gaps; its final-context/KV measurements and two-turn latency cannot establish llame billing or p95. The paper's stated Base control differs from ordinary post-trained Qwen, and the released card's lineage metadata does not match that starting point. No head-to-head result here shows the best reader on llame data.

The endpoint caveats above (regional terms, retention, aliases and prices) are open unknowns, not assurances. The paper page identifies arXiv v1 / May 7 but also displays an August 24 date; this report cites the versioned artifact rather than inventing a later revision date. The issue is live and can change; its scope is recorded as read on September 23. Existing file hashes, broad egress consent and full raw-result archives must not be inferred from future requirements.

## Appendix: Methodology

Four research slices covered LensVLM, local models, hosted economics and llame boundaries. Main analysis verified the model license, preprocessing and page loop, current price/terms pages, and OMP helper and HTTP locator behavior; it corrected a delegated arithmetic error by recalculating cost scenarios and used the newer GPT-6 Luna card instead of an older inexpensive model as the comparison.

The preprocessing command needs Python 3.10+ and Git plus a source-only checkout at the pinned LensVLM revision:

```bash
python3 probes/lens-preprocessing.py /path/to/ml-lensvlm
python3 probes/economics.py
```

Run from this bundle directory. The first script extracts and executes only the identified upstream function ASTs, without importing vLLM, PyTorch, Transformers or Pillow; output is in `probes/lens-preprocessing-result.json`, arithmetic results in `probes/economics-result.json`. This is deliberately narrower than running the model or its full renderer. [^f76edc456146d134][^48a3b19809bd9e14]

`pnpm exec tsx probes/locator-policy.mjs` uses llame's installed Node/pnpm development dependencies and the recommended policy fixture. It evaluates synthetic path strings only, opens no credential target, and records the future parser/projection hazard in `probes/locator-policy-result.json`. [^8b6697f4cd451071]

Source inspection, executed mechanics, price arithmetic, recommendations and untested hypotheses stay distinguishable. Relevant checks are Markdown, formatting, OKF/YAML, evidence links and the offline scripts; unrelated integration CI is not a research handoff gate.

## Revision history

- v3 (2026-09-23): Defined repeated carry as conditional model requests, not stored conversation turns; incorporated llame's per-pair/per-turn replay caps and the possibility that a small answer outlives an oversized source.
- v2 (2026-09-23): Corrected cache counterfactuals and retained withdrawn draft evidence as superseded; surfaced checkpoint-lineage conflict, serving defaults, question-aware permission projection, host/HTTP grammar ambiguities, image/search-scope prerequisites and the still-open real-transcript measurement gate.
- v1 (2026-09-23): Second research layer covering LensVLM's license/mechanism/latency, plain and hosted reader alternatives, explicit expansion scope, evidence boundaries and cost scenarios.

## Sources

[^225152e9c8d1f228]: [Apple LensVLM-9B model card](https://huggingface.co/apple/LensVLM-9B)

[^95f18f68dd101455]: [Apple Machine Learning Research Model License](https://huggingface.co/apple/LensVLM-9B/raw/main/LICENSE)

[^d0be0c24030a1db1]: [LensVLM: Selective Context Expansion for Compressed Visual Representation of Text](https://arxiv.org/html/2605.07019v1)

[^969911f423f20c15]: [LensVLM released model configuration](https://huggingface.co/apple/LensVLM-9B/raw/main/config.json)

[^b7737dbcc9e485f6]: [LensVLM Apple Sample Code License](https://github.com/apple-aiml-research/ml-lensvlm/blob/10709a7e2a80bdf971628359d47e4bd35fce3d95/LICENSE)

[^7dfe45c871b1e422]: [LensVLM official runtime and evaluation entrypoints](https://github.com/apple-aiml-research/ml-lensvlm/blob/10709a7e2a80bdf971628359d47e4bd35fce3d95/README.md)

[^a6d9908366d482e5]: [LensVLM source normalization and page mapping](https://github.com/apple-aiml-research/ml-lensvlm/blob/10709a7e2a80bdf971628359d47e4bd35fce3d95/lensvlm/rendering.py)

[^5a56ffb9a6fc3cc4]: [LensVLM bounded page-expansion loop](https://github.com/apple-aiml-research/ml-lensvlm/blob/10709a7e2a80bdf971628359d47e4bd35fce3d95/lensvlm/evaluate.py)

[^ec4072a47d01eeaf]: [LensVLM runtime dependencies](https://github.com/apple-aiml-research/ml-lensvlm/blob/10709a7e2a80bdf971628359d47e4bd35fce3d95/requirements.txt)

[^581e10a8f9a590e3]: [Question selector for read: delegated inspection](https://github.com/leon0399/llame/issues/849)

[^153cb8e29978b1f3]: [llame Spotify Shunt reference](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/docs/research/harnesses/spotify-shunt.md)

[^01d1f8a5ba73e9df]: [OMP explicit image-question worker](https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/utils/image-question.ts)

[^e6b6fd2fd0cbd064]: [llame existing HTTP query and selector grammar](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/tools/web-read/locator.ts)

[^c9ef00e6f9c7c8e6]: [llame locator permission projection](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/tools/permissions/locator-projection.ts)

[^f76edc456146d134]: [Executed LensVLM preprocessing mechanics](./probes/lens-preprocessing-result.json)

[^48a3b19809bd9e14]: [Executed illustrative helper economics](./probes/economics-result.json)

[^e0a64484787e9317]: [Qwen3.5-9B post-trained model](https://huggingface.co/Qwen/Qwen3.5-9B)

[^e3a8ccacb982d0cf]: [Qwen3.5-4B local alternative](https://huggingface.co/Qwen/Qwen3.5-4B/tree/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a)

[^82d7923da79cca64]: [Qwen3.5-27B dense alternative](https://huggingface.co/Qwen/Qwen3.5-27B/tree/fc05daec18b0a78c049392ed2e771dde82bdf654)

[^a01ee15bf28f5081]: [Qwen3.5-35B-A3B MoE alternative](https://huggingface.co/Qwen/Qwen3.5-35B-A3B/tree/59d61f3ce65a6d9863b86d2e96597125219dc754)

[^f23b0b274bf1d161]: [Gemma 4 12B instruction-tuned alternative](https://huggingface.co/google/gemma-4-12B-it)

[^8eb12065b9344787]: [DeepSeek model pricing and route identity](https://api-docs.deepseek.com/quick_start/pricing)

[^db28700ee6d07a1c]: [Qwen3.8-Flash hosted model](https://help.aliyun.com/en/model-studio/qwen3-8-flash)

[^b0ba3683a0dc5627]: [Model Studio privacy notice](https://help.aliyun.com/en/model-studio/privacy-notice)

[^f00960a1192814bf]: [GPT-6 Luna model and pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)

[^e3a5934e3172ec52]: [GPT-6 Sol primary cost baseline](https://developers.openai.com/api/docs/models/gpt-6-sol)

[^2aca780af5aa59ce]: [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)

[^116c1a7f3be0904b]: [Gemini 3.8 Flash capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)

[^b88c4950bbf39196]: [Gemini API dated paid and free pricing](https://ai.google.dev/gemini-api/docs/pricing)

[^a56c52f541d6ad5f]: [Gemini API terms and data-use boundary](https://ai.google.dev/gemini-api/terms)

[^746b888a3a6472b8]: [Gemini OpenAI-compatible API](https://ai.google.dev/gemini-api/docs/openai)

[^c4759988399b2201]: [llame exact read and source-selector contract](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/native-file-tools/spec.md)

[^2eec27a5b96e8046]: [llame tool authority and bounded replay](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/tool-calling/spec.md)

[^a55ca7fcab266b2e]: [llame prompt preparation receipt contract](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/model-system-prompts/spec.md)

[^6b3e943cd1fe085f]: [llame exact episodic message reads](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/conversation-reads/spec.md)

[^098f797eb9f933b9]: [llame ownership and local inference direction](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/VISION.md)

[^cf22f78099135172]: [Earlier System One/Jev research layer](../2026-09-23-system-one-jev/report.md)

[^3625dc1afe52ad01]: [llame bounded live Knowledge search](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/knowledge/knowledge-tools.ts)

[^5e356f9875f85bb8]: [LensVLM reference serving defaults](https://github.com/apple-aiml-research/ml-lensvlm/blob/10709a7e2a80bdf971628359d47e4bd35fce3d95/lensvlm/vision_config.py)

[^8aaffeb263754fbe]: [llame recommended portable permission test fixture](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/testing/portable-tool-policy.ts)

[^8b6697f4cd451071]: [Executed delegated-locator policy pattern probe](./probes/locator-policy-result.json)
