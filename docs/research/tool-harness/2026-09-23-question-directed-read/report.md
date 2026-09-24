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
  - id: "e2690a0d9dfca4da"
    resource: "./verification.json"
    title: "Question-directed read research execution record"
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

The `?q=` use case is useful for llame, but Apple LensVLM-9B should not be its default engine. Start with a bounded, text-first reader using an operator-selected existing model entry: local `Qwen/Qwen3.5-9B`, or a qualified hosted model such as GPT-6 Luna or DeepSeek Flash. Confidence in this architectural fit: moderate; no candidate's answer quality on llame workloads was measured.

LensVLM contributes a specific technique: scan compressed page images, select a page, and expand it into readable text or a higher-resolution image. Its released weights are research-only; the license explicitly excludes product development. The paper also reports a latency tradeoff: roughly 17 seconds versus 8 seconds for its typical one-expansion example, despite much lower context/KV use. Neither the license nor the measured latency supports treating this checkpoint as a cheap production replacement for ordinary Markdown reading. [^95f18f68dd101455][^d0be0c24030a1db1]

There are two distinct product scopes. Issue #849 asks for an answer over the selected source, range, image or directory listing. The user's example that also explores nearby documents and episodic history is a bounded read-only investigator. That is viable, but it needs explicit source expansion, per-read authorization, provider egress, accounting and evidence contracts beyond the issue's current acceptance. A disposable context does not require loading and unloading model weights for every question. [^581e10a8f9a590e3][^2eec27a5b96e8046][^098f797eb9f933b9]

The proposed first experiment compares exact reads, one-shot source answering and bounded multi-read investigation on the same grounded questions. Score supported-claim coverage and total parent-plus-worker cost, not just primary tokens avoided. Delegation cannot remove source text already in the primary history, and even a free worker adds cost when its answer and verification are larger than the source it would replace. The offline probes cover preprocessing, a future permission-projection hazard and counterfactual cost arithmetic; they are not model benchmarks. [^153cb8e29978b1f3][^f76edc456146d134][^8b6697f4cd451071][^48a3b19809bd9e14]

## Introduction and authority

This is the second research layer after the [System One/Jev study](../2026-09-23-system-one-jev/report.md). It examines the user's commented `read.md` drafts and [issue #849](https://github.com/leon0399/llame/issues/849), including the owner's latest reservation of `?q=` and `?question=` for a second model's generated answer. The WIP prompt is an input, not shipped behavior, and remains untouched. The proposed lookup can be expressed conceptually as:

```text
kb://<space-id>/research/jev.md?q=What%20did%20we%20research%20about%20Jev%3F
```

This syntax is not implemented here. `path://` in the discussion is shorthand for a locator, not a new shipped scheme. Literal question marks inside a Knowledge filename remain encoded; the inference question is separate metadata. The issue reserves deterministic queries separately (`?jq=` and `?select=`); it does not make `q` a general SQL or search-expression parameter. [^581e10a8f9a590e3][^c4759988399b2201]

Current code/specs govern over older summaries. The source baseline is llame `e70228485042967fd9545ad0cb133faae1be2268`; the follow-on branch starts from the published Jev research head `41e9d46e7bfe2fb1d693f5d0c1320c5351de2216`. The model/runtime assessment uses LensVLM source revision `10709a7e2a80bdf971628359d47e4bd35fce3d95`. No application code, WIP prompt, OpenSpec contract or issue acceptance was changed.

## Main Analysis

### L1 — What LensVLM actually does

LensVLM is a post-trained Qwen3.5-derived vision-language model, not a general filesystem agent. The paper states training from `Qwen3.5-9B-Base`, with supervised trajectories and reinforcement learning teaching page selection and expansion. The released model card instead names `Qwen/Qwen3.5-9B` in its base-model metadata; that is the separate post-trained conversational checkpoint. The exact initialization lineage of the released weights is therefore unresolved across these primary sources. Do not treat Base, ordinary post-trained Qwen and Apple's derivative as interchangeable, or assume the released artifact exactly reproduces the paper's stated setup. [^d0be0c24030a1db1][^225152e9c8d1f228][^e0a64484787e9317]

The reference path is:

1. Normalize and rasterize a selected text document into labeled page images.
2. Supply all those compressed pages and the question to the model.
3. Parse a `read_page` call selecting an integer page number.
4. Append that page's text, or a configured higher-resolution image, then continue.
5. Return the answer when the model stops calling the tool or exhausts the bounded loop.

The runtime defaults to six turns and caps generation per turn. Its tool reads an already supplied page array; it does not search neighboring files, resolve `kb://` locators, enumerate Knowledge Spaces or query chat history. Those capabilities require a separate host-controlled tool surface and their own evaluation. The paper's method is model-agnostic in principle, and it reports improvements from select-then-expand prompting on untrained Qwen and Sonnet as well, but that does not establish arbitrary tool-use competence. [^5a56ffb9a6fc3cc4][^7dfe45c871b1e422][^d0be0c24030a1db1]

For rendered text, the paper favors text expansion. For native visual documents, high-resolution image expansion can retain layout evidence that OCR misses. That makes Lens-style processing more interesting for scanned reports, diagrams and dense tables than for a Markdown note whose exact text llame already has. This is an application hypothesis, not a claim that rasterizing Markdown cannot help at any scale. [^d0be0c24030a1db1]

### L2 — Compression evidence is narrower than a speed or quality guarantee

The named 5x/10x/15x presets are input-compression settings. Effective compression also accounts for expanded evidence; it is lower when more pages must be read. The authors report accuracy near their full-text comparison at 4.3x effective compression and favorable comparisons up to 10.1x. These are scoped, author-reported results, not a guarantee of tenfold savings on a llame request. [^d0be0c24030a1db1]

| Reported observation                                                                                                                    | Interpretation for llame                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text-QA comparison: LensVLM 68.9% versus full-text 72.4% at the 5x preset / about 4.3x effective compression                            | "Comparable" still includes a quality gap; it does not establish superiority over a post-trained Qwen reader on raw Markdown.                              |
| Code-understanding table: 38.1% versus full-text 65.6% at the 5x preset                                                                 | Selective recovery improves compressed-code reading but remains far behind that full-text baseline in this experiment.                                     |
| At 15x with 20 images: 2,288 final-context tokens / 71 MiB KV versus 10,686 / 334 MiB for text                                          | A useful memory tradeoff in the reported vLLM TP=8 B200 setup; not total process memory or an API-billing ledger.                                          |
| Typical one expansion: approximately 17 seconds versus 8 seconds for single-turn text, batch size one and 256 generation tokens on B200 | Sequential generation/expansion and the vision encoder can make the compressed route slower. No local workstation p95 or cold-start result is established. |

All rows are from the paper, not this investigation's inference runs. Its evaluation uses an LLM judge and curated QA/data constructions. Comparisons against retrieval are reader-budget comparisons; they do not establish that every practical retrieval pipeline needs an expensive offline index. llame's live literal Knowledge search is an obvious counterexample to importing that architectural premise. [^d0be0c24030a1db1][^3625dc1afe52ad01]

### L3 — The released weights are a research candidate, not a product dependency

The Apple Machine Learning Research Model License restricts the model and derivatives to non-commercial scientific research and academic development. It explicitly excludes product development, as well as use in commercial products/services. Personal or self-hosted use does not automatically satisfy that definition. Do not add these weights to llame product behavior under the published license. [^95f18f68dd101455]

The source code has a different Apple Sample Code License, granting use/modification/redistribution under its notice and disclaimer terms. Studying or reimplementing the select-expand pattern with an eligible model is a separate decision from deploying Apple's checkpoint. The underlying Qwen's Apache-2.0 license does not override Apple's terms for its derivative weights. [^b7737dbcc9e485f6][^e0a64484787e9317]

The reference runtime also adds a Python/PyTorch/vLLM/Transformers/Pillow stack. Model configuration declares a 262,144 positional ceiling, but the reference `load_model` defaults to `max_model_len=32768`, and the paper's main text evaluation uses examples below 32K text tokens. The loader also defaults to trusted remote code and root-wide local-media access; those research defaults must not become llame filesystem authority. Neither the context ceiling nor the author's B200 setup proves fit or good latency on a particular operator's GPU. This study downloaded no weights and installed no ML packages. [^969911f423f20c15][^ec4072a47d01eeaf][^5e356f9875f85bb8][^d0be0c24030a1db1]

### L4 — A production read answer needs stronger provenance than page numbers

The upstream renderer collapses whitespace, paragraph boundaries and code indentation. Its returned page text is normalized and line-wrapped, not the original file bytes. There is an optional original-character mapping for supplied training/evaluation evidence spans, but a page index is not a native file line citation. A llame integration must preserve original source identity and coordinates independently. [^a6d9908366d482e5]

The executed preprocessing probe loads unchanged pure-function ASTs from the pinned upstream files, without importing model or rendering dependencies. It demonstrates that indentation/newlines disappear, an answer character can be mapped through normalization, the parser accepts a page key even under an unrelated tool name, and the response builder remains bounded by its supplied page list. This does not demonstrate arbitrary filesystem access; it demonstrates why the research parser is not a general llame tool dispatcher. [^f76edc456146d134]

## Model choices for the reader role

These are candidate baselines, not a measured quality ranking. Context figures are advertised ceilings, not tested useful working sets. Prices below are dated 2026-09-23 and describe the named route; model names alone do not specify deployment cost, data terms or feature compatibility.

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

**Recommendation:** begin with M2 and one already accepted hosted route, M6 or M7. Add M3 to test the lower-resource boundary, and M5/M9 only when visual documents justify a second modality experiment. Do not load a nine-model routing framework merely because the research compares nine candidates.

**Local economics:** local does not mean free. Weight memory, KV/recurrent state, batching, vision preprocessing, idle capacity and electricity count. As a lower-bound arithmetic example, exactly nine billion 16-bit parameters occupy 18 GB before every other allocation; ideal four-bit storage is 4.5 GB before scales, runtime and context. These are not actual package sizes or promises that the named checkpoint fits a device. Keep a warm operator-managed endpoint; make the context disposable, not the model weights. llame's vision explicitly leaves model-runtime operation to configured providers rather than bundling one. [^098f797eb9f933b9]

## Free and promotional endpoints

An operator-configured no-charge model can fill the same reader role if its capability, terms and data recipient are acceptable. A price of zero is neither a privacy property nor an availability guarantee. Treat quota exhaustion, campaign expiry, changed model aliases and disabled tool use as normal failure cases; a failed `?q=` must not silently send the source to an unaccepted paid or free provider. The ordinary exact-read path remains available separately. [^581e10a8f9a590e3][^b88c4950bbf39196]

Google supplies a concrete caution. Its general unpaid-service terms allow product improvement and human review and prohibit submission of sensitive/confidential/personal information. Regional exceptions apply: EEA/Swiss/UK data-use treatment differs, and API clients offered there require Paid Services. An API request through a project with active billing can have paid-service data terms even when its effective price is zero. The terms also specify professional/business use rather than consumer use. Check the actual account/use case; do not equate every Gemini free quota with an eligible private-memory backend. [^a56c52f541d6ad5f]

Alibaba states both that it does not train on customer data and that it stores model/application-call data; the inspected notice does not establish a fixed retention duration. OpenAI's no-training default likewise does not mean no retention: abuse monitoring and Responses application state are distinct controls. DeepSeek's listed balance-credit mechanism does not establish an active free campaign or a retention guarantee. These are selection prerequisites, not reasons to hard-code a vendor blacklist or default. [^b0ba3683a0dc5627][^2aca780af5aa59ce][^8eb12065b9344787]

Record the actual configured model/provider route, accepted data policy, observed usage and relevant offer limits. Expiry management can remain operator-owned initially. No campaign discovery service, silent provider substitution or automatic cheapest-model router is needed for the first feature.

## Synthesis: two read scopes and one explicit authority boundary

### Q1 — Selected-source answering, matching issue #849

A caller gives a locator, optional selector and question. After a new grammar/projection separates recognized delegation metadata from resource identity, the existing read authorization/resolution path obtains the bounded text or listing; a configured reader receives that payload and returns generated analysis. A file/range answer is about the shown text. A directory answer is about its listing, not the contents of every listed file. A missing worker gives the issue's structured error; it does not turn the question into a raw read or a different provider call. [^581e10a8f9a590e3][^c4759988399b2201][^c9ef00e6f9c7c8e6]

The image part of #849 needs additional implementation: bounded media decoding and transport, type/size limits, a declared hash/transform domain and worker-modality admission. Today's text read path does not produce the decoded image payload, and a configured model ID alone does not establish that the worker accepts it. Do not infer modality from a vendor or model name. [^581e10a8f9a590e3][^c4759988399b2201]

This can be a one-shot subcall attached to the parent Run/tool call. It does not require the general subagent product, another autonomous session, or new authority. Calling it "throwaway" should mean a fresh, bounded working context discarded after the result, while identity, source coverage, usage and outcome remain inspectable. [^2eec27a5b96e8046][^a55ca7fcab266b2e]

OMP supplies useful one-shot precedent: it passes an already-loaded image and
question to a separate completion with its own prompt, model identity, usage
and abort/timeout handling. Its vision preference chain can fall through to
other available models. llame should borrow the bounded subcall/accounting
shape, not copy that cross-provider fallback without accepted egress.
[^01d1f8a5ba73e9df]

### Q2 — Bounded source investigation, matching the broader user example

The worker starts with the selected note but may request more evidence. This is a concrete additional capability, not an incidental implementation of Q1. Define an explicit expansion scope: for example a named Knowledge subtree, an enumerated set of related locators, or a separately enabled owner-chat corpus. A filename relationship or a model's belief that another source is relevant is not authorization. [^581e10a8f9a590e3][^c9ef00e6f9c7c8e6][^2eec27a5b96e8046]

Current `knowledge_search` scopes to a whole `knowledgeSpaceId`, not a subtree
or an enumerated locator set. A narrower Q2 scope needs a new host-enforced
search boundary and compatible continuation semantics, or direct reads of an
explicitly enumerated set. Broad search followed by hidden post-filtering must
not be represented as having inspected only the narrow scope. [^3625dc1afe52ad01]

For "what did we research about Jev?", a useful bounded flow is:

1. Read the seed note/range using the existing resolver and permission gate.
2. If the question cannot be answered from it, search only the declared Knowledge scope and read selected passages.
3. If episodic recall was explicitly included, use owner-scoped conversation search and exact message reads; keep message dates and provenance distinct from maintained notes.
4. Return a bounded synthesis with per-claim source citations, conflicts, omissions and incomplete-search status.

The allowed tool set should be specific read/search operations, not Bash described as read-only, arbitrary MCP tools, network access or recursive delegation. Route every expansion through the same policy/owner checks. `conversation_read` currently excludes tool observations, so the worker cannot claim to inspect historical tool results through that API. Source access and permission to send it to the worker provider are separate. [^6b3e943cd1fe085f][^2eec27a5b96e8046][^c9ef00e6f9c7c8e6]

A tightly bounded inspector can remain subordinate to the parent Run. If it acquires independent resumability, steering, background lifetime or child conversations, that crosses into the child-agent lifecycle already described by VISION. Do not introduce that product just to answer one file question. [^098f797eb9f933b9]

The [source-aware investigation extension](./source-aware-investigation.md)
develops this proposal with OKF navigation, source-native relationships,
evidence-carrying area workers and a visual branch before aggressive passage
pruning. It also reconciles the supplied analysis's checkpoint and benchmark
claims. These are separately cited design additions, not expansion of #849 or
newly shipped child-agent/revision-read capabilities.

### Q3 — Evidence and lifecycle requirements for either mode

**Generated answer, never source bytes.** Preserve `kind: answer` as a proposed distinct result, untrusted framing and an exact-read route for editing. Validate cited coordinates against what the worker actually saw, not merely against a current file's total length. Existing shown ranges and untrusted Knowledge notices are useful inputs, but worker answers, content hashing and citation checks do not ship just because the prompt draft mentions them. [^581e10a8f9a590e3][^c4759988399b2201]

**Content identity must name its domain.** Hashing the exact worker-visible selection/representation is different from hashing an entire source file or a live web page. Do not read outside an allowed selection merely to manufacture a whole-file hash. Keep locator, representation/transform, requested and shown coverage, truncation and retrieval time; decide explicitly whether exact source snapshots are retained. A valid line range proves addressability, not that the claim is supported. Lens normalization makes this distinction visible. [^a6d9908366d482e5][^f76edc456146d134][^581e10a8f9a590e3]

**No invisible second inference.** Current prompt receipts prove preparation of the main attempt; they are not generic actual-call receipts. A helper needs its own parent Run/attempt/tool-call linkage, safe model identity, prompt/source binding, usage, status and coverage record. Do not silently enlarge a system-only receipt or report only the primary model's cost. `maxStepsPerRun` and maximum output tokens are not an existing total helper-spend budget. [^a55ca7fcab266b2e][^2eec27a5b96e8046]

**Bound work in code.** Before each expansion, enforce remaining input/output, source-count, time and tool-call allowances; propagate cancellation and stop starting new calls after it. A budget stop returns a partial/insufficient answer with inspected coverage, not a comprehensive-sounding completion. Initial source authorization happens before opening/decoding it; later authorization happens per target. Low model confidence never supplies extra scope. [^581e10a8f9a590e3][^2eec27a5b96e8046][^c9ef00e6f9c7c8e6]

**Separate question metadata before policy, not only before opening.** Current
host-path permission projection leaves the submitted path unchanged. In the
recommended operator-policy fixture, credential rejects match `/p/.env` and
`/h/.npmrc`, but miss those strings with an unparsed `?q=`/`?question=` suffix.
The executed pattern probe confirms that distinction. A future implementation
that authorizes the unsplit string and strips the suffix only before opening
would bypass the intended rejection. Resolve the grammar, then use the same
parsed source identity for policy and execution on every supported scheme.
This is a conditional extension hazard, not a shipped `?q=` exploit; the
fixture is not a runtime default, and omitted permissions deny all calls.
[^8aaffeb263754fbe][^c9ef00e6f9c7c8e6][^8b6697f4cd451071]

**Resolve host and URL grammar before promising all-source parity.** An HTTP `?q=` is currently sent to its publisher; a generic suffix parser must not steal it. Absolute host filenames may also contain a literal `?`, and the existing native contract gives an existing literal filename precedence over selector-shaped suffixes. Extending that rule blindly would let filesystem contents decide whether `q` means inference, contradicting #849's reservation. A design must explicitly choose literal-path escaping/precedence and an unambiguous question channel for these targets; Knowledge's `%3F` convention alone does not solve host paths or URL queries. No grammar change is made here. [^e6b6fd2fd0cbd064][^c4759988399b2201][^581e10a8f9a590e3]

## Context savings, latency and total cost

The primary model does avoid the worker's intermediate observations if only the final answer/evidence package returns. That is a real potential context benefit. It is not zero context: the answer, citations, coverage metadata and verification reads still consume primary input, and a verbose "comprehensive" report may cost more than the few exact passages the primary needed. The right output is complete for the question and explicit about limits, not automatically long. [^153cb8e29978b1f3]

For otherwise comparable work, define:

- `W`: all helper input/output/reasoning/tool-call charges across every request.
- `A`: added primary answer/evidence/verification input, at its actual rate class.
- `E`: any incremental final-answer output, rendering, storage or hosting cost.
- `S`: primary source input actually avoided, at its actual uncached/cache-read/cache-write rate.

Delegation saves money only when `W + A + E < S`. Do not credit a full document the primary would have avoided through a normal range read. Do not multiply a final-context compression ratio by an API price and call that total multi-turn savings. Caching and repeated tool history make the request ledger the authority. [^153cb8e29978b1f3][^d0be0c24030a1db1]

Compare the two alternatives from the same point. If a source is already in
the model-facing primary context and retained by both alternatives, delegation
does not remove it: that existing cost is common to both alternatives, and
avoided `S` is zero. Before first insertion,
compare source tokens `s` against returned answer/evidence/verification tokens
`a`. If both alternatives remain sufficient and retain their respective payloads
for `N` primary model requests, both use the same rate factor
`r_first + (N - 1) * r_cached`. First-touch may be ordinary input or a cache
write; do not charge only one alternative at the write rate. Here `N` counts
model requests, not user messages or completed Runs. [^153cb8e29978b1f3][^e3a5934e3172ec52]

That residency condition must be checked against llame's actual projection.
Ordinary stored replay is capped at 8,000 UTF-16 units per serialized call/result
pair and 32,000 per stored assistant turn; payloads clear before irreducible
old pairs are dropped. A source payload may clear while its shorter helper
answer survives, making later delegation carry _more_ primary context.
Token counts do not determine these character-based limits. The symmetric
cases apply only to requests where both payloads actually remain resident,
for example consecutive in-Run steps; they are not a forecast across stored
turns. Across Runs, measure each request's post-projection source and answer
tokens separately. Compaction, new worker calls and changing answers also
invalidate the simple carry assumption. [^2eec27a5b96e8046]

The corrected Decimal script assumes 3,000 source tokens, 4,000 aggregate worker
input tokens, 500 worker output tokens and normally 1,500 added primary tokens.
These are illustrative totals, not measured counts or proposed source limits.
Common final-answer output cancels; changed output, extra worker calls,
storage and hosting remain omitted. [^48a3b19809bd9e14]

| Scenario                                                                                       | Avoidable direct source cost | Delegated incremental cost |               Difference |
| ---------------------------------------------------------------------------------------------- | ---------------------------: | -------------------------: | -----------------------: |
| C1 — New source, one Sol ordinary-input request; DeepSeek off-peak worker                      |                     $0.00600 |                   $0.00390 |           Saves $0.00210 |
| C2 — Selected source already carried by both alternatives; add the same helper                 |                           $0 |                   $0.00390 | Entirely additional cost |
| C3 — New source, one Luna ordinary-input request; DeepSeek off-peak worker                     |                     $0.00030 |                   $0.00105 |      Costs $0.00075 more |
| C5 — C3 resident for 51 model requests, with no extra helper calls or payload clearing         |                     $0.00180 |                   $0.00180 |  Illustrative break-even |
| C6 — C1 with the first insertion charged as a Sol cache write on both sides                    |                     $0.00750 |                   $0.00465 |           Saves $0.00285 |
| C7 — Zero-price worker returns 4,000 answer/verification tokens instead of 3,000 source tokens |                     $0.00600 |                   $0.00800 |      Costs $0.00200 more |

The old draft's 19,500-token cached-source break-even is withdrawn: it credited
removal of already-carried source while pricing the helper result as new input.
The corrected cases show that helper cost can dominate a cheap primary; a
verbose helper or unnecessary delegation can lose even at zero provider price.
Smaller carry can amortize a helper only while that differential remains in
actual requests. C5 is conditional arithmetic, not a promise of 51 useful
steps, eligibility under a Run's step limit, or savings over 51 user messages.
Replay clearing can remove the assumed advantage. [^2eec27a5b96e8046]
[^48a3b19809bd9e14][^8eb12065b9344787][^f00960a1192814bf][^e3a5934e3172ec52]

Measure time separately: cold model acquisition/loading, warm queueing/prefill, each sequential tool turn, preprocessing, validation and primary continuation. Reuse a warm local service rather than making model loading part of every `?q=`. A stateless request or disposable worker context can still use a resident process. LensVLM's published latency is a warning against optimizing token count alone. [^d0be0c24030a1db1][^7dfe45c871b1e422]

## Concrete llame applications and evaluation cases

| ID  | Application                                                                        | What the worker should return                                                                     | Evaluation boundary                                                                                                 |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| U7  | Explain a long spec's exception or failure behavior                                | A narrow answer with exact cited clauses and explicit absence when the selection lacks the answer | Q1; place evidence at beginning/middle/end, include exceptions and no-answer cases                                  |
| U8  | Synthesize the existing Jev research note with related notes                       | Supported conclusions, conflicting dates/versions and per-note references                         | Q2; seed plus explicitly allowed nearby scope; test unlisted siblings and stale contradictions                      |
| U9  | Reconcile a maintained note with prior chat decisions                              | Separate what the note says from dated user decisions/corrections                                 | Q2 with explicit episodic scope; test namesakes, cross-owner denial and tool-part exclusion                         |
| U10 | Explain a code subsystem without loading the whole module into the primary context | Relevant symbols, reasoning and exact verification ranges                                         | Compare text-first reader to outlines/range reads; preserve indentation and do not use generated text as edit input |
| U11 | Answer a question over a scanned report/table or diagram                           | Page/region evidence and uncertainty about unreadable detail                                      | Future media path; compare ordinary VLM/real page zoom before synthetic text rasterization                          |
| U12 | Triage a directory for the next exact read                                         | Candidate entries and the basis in visible names/metadata                                         | Q1 listing alone cannot assert file contents; Q2 file inspection must be explicitly enabled                         |

These are proposed uses, not measured successes or automatic additions to #849. Jev from the previous layer could optionally score candidate relevance; it cannot write the answer. Do not make a three-model classify-read-verify chain the default without evidence that it beats a single qualified reader. [^cf22f78099135172][^581e10a8f9a590e3]

Use a fixed, owner-controlled synthetic/public fixture set: answerable and unanswerable selections; code whitespace; multilingual text; misleading same-keyword notes; a later correction contradicting an older statement; query-string collisions; out-of-range citations; budget/truncation stops; cancelled/unavailable workers; credential paths and cross-owner resources refused before content reaches any provider. Label both answer claims and exact supporting source locations.

Compare exact/outlined/range reads, Q1 on each qualified model, Q2 with identical scope/budgets, and Lens-style visual scanning only in a separate license-compatible research track. Score supported-claim precision/recall, citation validity versus semantic support, abstention, scope breaches, total token/currency charges, parent context occupancy, median/p95 latency and cold/warm behavior. Larger context windows and permissive licenses are eligibility facts, not quality results.

The fixture stage does **not** satisfy #849's implementation-approval measurement
gate. That gate remains open until owner-consented real transcripts are replayed
against the counterfactual alternatives with actual provider usage, repeated
reads, verification costs and task outcomes. Record that break-even in the
proposal before implementation approval; no such replay was performed here.
[^581e10a8f9a590e3]

## Recommendations

1. **D6 — Build the research baseline around a model-independent reader role.** Reference an existing configured model entry, not a hard-coded Apple/Qwen/DeepSeek identity. Text-first Qwen3.5-9B plus one accepted hosted route is enough for the first comparison.
2. **D7 — Keep selected-source `?q=` and broader investigation distinct.** Q1 matches current #849. Develop Q2's explicit expansion/episodic scope and trace independently; do not silently turn a file question into a search across the owner's world.
3. **D8 — Treat LensVLM as mechanism prior art and a research-only comparator.** Do not adopt the released weights for llame product development. For native visual sources, first test an eligible ordinary VLM with controlled page expansion.
4. **D9 — Make evidence, accounting and egress part of the proposal.** These are missing contracts, not configuration details already supplied by `models[]` or system-prompt receipts. Retain the exact-read route and no-worker structured error.
5. **D10 — Select on measured useful output, not a free label or model size.** Keep campaigns operator-controlled, with explicit provider/price/data constraints. Reject silent cross-provider or paid fallback. Measure total work and support quality before automatic routing.

Priority: evaluate Q1 on text fixtures first; use Q2 to test the broader Jev/episodic example as a separately scoped experiment. No OpenSpec approval or implementation is implied by this research.

## Limitations and counterevidence

No LensVLM/Qwen/Gemma inference, hosted-model benchmark, private-corpus query or GPU fit test was run. No model weights or ML dependencies were downloaded. Three offline probes cover unchanged upstream pure-function mechanics, synthetic permission-pattern behavior and arithmetic only. Model capability/benchmark claims remain vendor or paper reports.

Apple's abstract calls the quality comparable, but the reported text and especially code comparisons still contain gaps. Its final-context/KV measurements and published two-turn latency cannot establish llame billing or p95. The paper's stated Base control differs from ordinary post-trained Qwen, and the released model card's lineage metadata does not match that stated starting point. No head-to-head result here establishes the best reader on llame data.

Hosted limits, aliases, regional prices, campaign eligibility and terms can change. Google unpaid terms have regional/account exceptions; Alibaba's no-training statement does not specify retention duration. DeepSeek API prompt-retention suitability was not established by the price documentation. Do not turn these unknowns into assurances.

The paper page identifies arXiv v1 / May 7 but also displays an August 24 date; this report cites the versioned artifact rather than inventing a later revision date. The issue is live and can change; its scope is recorded as read on September 23. Existing file hashes, broad egress consent and full raw-result archives must not be inferred from future requirements.

## Appendix: Methodology

Four independent research slices covered LensVLM, local models, hosted economics and llame boundaries. Main analysis verified the model license, source preprocessing and page loop, current provider price/terms pages, OMP helper and HTTP locator behavior. It corrected a delegated arithmetic error by calculating cost scenarios independently and used the newer GPT-6 Luna model card instead of treating an older inexpensive model as the default comparison.

The offline preprocessing command requires Python 3.10+ and Git, plus a source-only checkout at the pinned LensVLM revision:

```bash
python3 probes/lens-preprocessing.py /path/to/ml-lensvlm
python3 probes/economics.py
```

Run from this bundle directory. The first extracts and executes only the identified upstream function ASTs; it does not import vLLM, PyTorch, Transformers or Pillow. Its output is in `probes/lens-preprocessing-result.json`; arithmetic results are in `probes/economics-result.json`. This bounded execution is deliberately narrower than running the model or even its complete renderer. [^f76edc456146d134][^48a3b19809bd9e14]

The separate `pnpm exec tsx probes/locator-policy.mjs` command uses llame's
installed Node/pnpm development dependencies and recommended policy fixture.
It evaluates synthetic path strings only, opens no credential target, and
records the future parser/projection hazard in `probes/locator-policy-result.json`.
[^8b6697f4cd451071]

This bundle uses OKF stable source footnotes, a source/evidence ledger and typed claim records. Source inspection, executed mechanics, price arithmetic, recommendations and untested hypotheses remain distinguishable. Relevant checks are Markdown, formatting, OKF/YAML, evidence links and the offline scripts; unrelated integration CI is not a research handoff gate.

The [verification record](./verification.json) names checks actually run; the
[review record](./review.json) records corrections and superseded draft evidence.
[^e2690a0d9dfca4da]

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

[^e2690a0d9dfca4da]: [Question-directed read research execution record](./verification.json)

[^5e356f9875f85bb8]: [LensVLM reference serving defaults](https://github.com/apple-aiml-research/ml-lensvlm/blob/10709a7e2a80bdf971628359d47e4bd35fce3d95/lensvlm/vision_config.py)

[^8aaffeb263754fbe]: [llame recommended portable permission test fixture](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/testing/portable-tool-policy.ts)

[^8b6697f4cd451071]: [Executed delegated-locator policy pattern probe](./probes/locator-policy-result.json)
