---
type: Research
title: "System One, Jev, and applicability to llame"
description: "Evaluates TypeSafe Jev, OMP JUDGE, extractive compaction, public use cases, and llame project/tool/model routing with evidence and reproducible offline probes."
tags: [jev, system-one, classification, compaction, tool-search, model-routing]
status: stable
canonical: false
generated: { by: omp/openai-codex-gpt-6-astra, at: 2026-09-23T20:50:17Z }
sources:
  - id: "0605bcba6b5c7739"
    resource: "https://typesafe.ai/blog/introducing-system-one-models-and-jev"
    title: "Introducing System One Models & Jev"
  - id: "3b9396096fc7b4f4"
    resource: "https://docs.typesafe.ai/models.md"
    title: "TypeSafe models"
  - id: "199f6b071e6b846c"
    resource: "https://docs.typesafe.ai/api.md"
    title: "TypeSafe evaluation API"
  - id: "64154f4aee021df4"
    resource: "https://docs.typesafe.ai/confidence.md"
    title: "TypeSafe confidence"
  - id: "8830c774f063a588"
    resource: "https://docs.typesafe.ai/model-jaggedness/jev-1.13.md"
    title: "Jev 1.13 jaggedness"
  - id: "73461b3e97af0d93"
    resource: "https://openai.com/index/introducing-gpt-6-sol-and-luna/"
    title: "Introducing GPT-6 Sol and Luna"
  - id: "c86beef864f4e446"
    resource: "https://developers.openai.com/api/docs/guides/prompt-caching"
    title: "OpenAI prompt caching"
  - id: "666b02e52f00adad"
    resource: "https://developers.openai.com/api/docs/guides/tools-tool-search"
    title: "OpenAI tool search"
  - id: "ec400e9e55dcff2e"
    resource: "https://developers.openai.com/api/docs/guides/reasoning"
    title: "OpenAI reasoning models"
  - id: "ec3184bd3393c480"
    resource: "https://docs.typesafe.ai/cookbooks/skill_suggestion.md"
    title: "TypeSafe skill suggestion cookbook"
  - id: "8813bab3cd144364"
    resource: "https://docs.typesafe.ai/legal.md"
    title: "TypeSafe legal documentation"
  - id: "8096abfcb65eef3f"
    resource: "https://typesafe.ai/legal/data-processing"
    title: "TypeSafe data processing addendum"
  - id: "a837179309fc5dde"
    resource: "./probes/adapter-probe-result.json"
    title: "Offline AI SDK wire-shape experiment"
  - id: "098f797eb9f933b9"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/VISION.md"
    title: "llame vision"
  - id: "89ed2f298996bdac"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/docs/research/product-vision/2026-07-15-working-synthesis/report.md"
    title: "llame product vision synthesis"
  - id: "b2618f474b296d21"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/projects/spec.md"
    title: "llame projects capability"
  - id: "21e2cd8ac930bbd7"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/compaction/compaction.service.ts"
    title: "llame compaction orchestration"
  - id: "4c863fcdba09b740"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/compaction/compaction.ts"
    title: "llame compaction planning"
  - id: "a69dcdc3e454f59a"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/changes/tool-search/design.md"
    title: "llame approved tool-search design"
  - id: "03aec42edc684f81"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/SPEC.md"
    title: "llame current architecture"
  - id: "c928d70f34493417"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/models/openai-model-client.ts"
    title: "llame Responses client"
  - id: "4f89b26cf16ee239"
    resource: "https://github.com/leon0399/llame/issues/338"
    title: "llame tool-search issue 338"
  - id: "7b44005a8e75c461"
    resource: "./probes/compaction-probe-result.json"
    title: "Offline extractive compaction mechanics probe"
  - id: "ca43fdfdb2723b18"
    resource: "https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/judgment/index.ts"
    title: "OMP typed judgment role and backend chain"
  - id: "ebb0ae72e6b00c80"
    resource: "https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/priority.json"
    title: "OMP default judgment priority"
  - id: "b40f0faa2ee125fb"
    resource: "https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/ai/src/judgment/typesafe.ts"
    title: "OMP native System One client"
  - id: "8c2fff6039d2157b"
    resource: "https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/tools/jfind/cascade.ts"
    title: "OMP semantic find cascade"
  - id: "870371284aef47c9"
    resource: "https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/auto-thinking/classifier.ts"
    title: "OMP automatic reasoning effort classifier"
  - id: "8707726e1027e18d"
    resource: "https://github.com/can1357/oh-my-pi/blob/d49918fab2dba3986927f2d46721629ed0f3a02c/packages/coding-agent/src/eval/judgment-batch-bridge.ts"
    title: "OMP host-owned judge_batch at initial inspection"
  - id: "0a34f7ffa362434d"
    resource: "https://github.com/tamaratran/fast-jev-compaction/blob/e3f262a7f4d42bd8dd32ced30d26176f7cb545b0/src/compact.ts"
    title: "fast-jev-compaction selection algorithm"
  - id: "e10e504a390d04bd"
    resource: "https://github.com/tamaratran/fast-jev-compaction/blob/e3f262a7f4d42bd8dd32ced30d26176f7cb545b0/src/state.ts"
    title: "fast-jev-compaction judgment-state construction"
  - id: "4165f2071a8c3b31"
    resource: "https://github.com/tamaratran/fast-jev-compaction/blob/e3f262a7f4d42bd8dd32ced30d26176f7cb545b0/hooks/fast-jev.ts"
    title: "fast-jev-compaction Claude Code adapter"
  - id: "6b315587b4ef6e42"
    resource: "https://registry.npmjs.org/fast-jev-compaction/latest"
    title: "fast-jev-compaction npm published metadata"
  - id: "3622234ebf4d871e"
    resource: "https://github.com/thruwire/foreman/blob/7a76bf3304b21912f8a0af0efff2cc7ecf82a718/src/foreman/routing.py"
    title: "Foreman responsibility router"
  - id: "53249c9545234798"
    resource: "https://github.com/vinilana/jev-gateway/tree/332f7c1f1f46d6c57e5a98076a79971957ca8869"
    title: "jev-gateway source"
  - id: "f3bfeb233b8e7523"
    resource: "https://github.com/vinilana/jev-gateway-bench/blob/f60db2e9ca4ec54466cd30d7064d15b346b702c9/README.md"
    title: "jev-gateway paired benchmark"
  - id: "c51b44394496ba9d"
    resource: "https://github.com/coldteadotai/abide/tree/94cc79da677ae83596438e03d1ef03702a5c4a44"
    title: "Abide typed code-rule checks"
  - id: "7967511960150972"
    resource: "https://github.com/coldteadotai/abide/blob/94cc79da677ae83596438e03d1ef03702a5c4a44/benchmarks/replay/README.md"
    title: "Abide replay benchmark"
  - id: "fd69f31cde24ac85"
    resource: "https://www.mindstudio.ai/blog/jev-use-cases-automation"
    title: "12 Jev Use Cases Tested: Where This Decision-Only AI Actually Fits"
  - id: "b164f6b97d9f7020"
    resource: "https://hackernoon.com/101-real-world-examples-of-how-to-use-jev"
    title: "101 Real-World Examples of How to Use Jev"
  - id: "9e45c053dcabfa34"
    resource: "https://www.langchain.com/blog/building-a-harness-with-jev"
    title: "Building a Harness with Jev"
  - id: "c4cd472a746f893f"
    resource: "https://www.shipwithjev.com"
    title: "shipwithjev build catalog"
  - id: "a4fc79611d9a7d17"
    resource: "https://x.pcstyle.dev/zodchiii/status/2102377493705740417?thread=full"
    title: "Disputed viral Jev harness PDF thread"
  - id: "417ee78585552fff"
    resource: "https://x.pcstyle.dev/sydneyrunkle/status/2100754364545761643?thread=full"
    title: "Sydney Runkle Jev harness thread"
  - id: "408f550752167419"
    resource: "https://x.pcstyle.dev/ctatedev/status/2101022101750571357?thread=full"
    title: "Chris Tate json-render and Jev experiment"
  - id: "4ad45f89aad83867"
    resource: "https://x.pcstyle.dev/JamesWard/status/2100976393546772628?thread=full"
    title: "James Ward Jev LLM MCP orchestration thread"
  - id: "61bd2288cebd9fe2"
    resource: "https://github.com/priorbench/jev/blob/main/README.md"
    title: "PriorBench independent Jev evaluation"
  - id: "9838fa027e54d7c1"
    resource: "https://github.com/scienthoon/jev-ood-calibration/blob/main/README.md"
    title: "Does Jev know when it does not know?"
  - id: "36fead1f32c4c857"
    resource: "https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/eval/judgment-batch-bridge.ts"
    title: "OMP current judge_batch lifecycle"
  - id: "f2265b4571683072"
    resource: "./probes/adapter-source-evidence.json"
    title: "Installed @ai-sdk/openai 3.0.97 adapter source"
  - id: "5c390f1a54da0051"
    resource: "https://github.com/tamaratran/fast-jev-compaction/blob/e3f262a7f4d42bd8dd32ced30d26176f7cb545b0/package.json"
    title: "Inspected upstream compaction package metadata"
  - id: "fff5f685407e9767"
    resource: "https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/cli/git-tui/ai-stage.ts"
    title: "OMP AI-assisted staging judgment caller"
  - id: "88d63eea2eea07c2"
    resource: "https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/session/unexpected-stop-classifier.ts"
    title: "OMP unexpected-stop judgment caller"
  - id: "2eec27a5b96e8046"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/tool-calling/spec.md"
    title: "llame tool-observation replay and compaction contract"
  - id: "1997552fefe32db0"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/chats/tool-observation-part.ts"
    title: "llame payload-cleared compaction replacements"
  - id: "6b3e943cd1fe085f"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/conversation-reads/spec.md"
    title: "llame conversation-read visibility contract"
  - id: "380921d284183391"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/memory/spec.md"
    title: "llame owner-controlled history disclosure"
  - id: "815eeaf8c2ede6ed"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/db/schema/projects.ts"
    title: "llame current Project metadata schema"
  - id: "5b6fbd481c4f1031"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/search/core/fusion.ts"
    title: "llame scoped reciprocal rank fusion"
  - id: "3625dc1afe52ad01"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/knowledge/knowledge-tools.ts"
    title: "llame bounded Knowledge search results"
  - id: "53bc20bcb6729c65"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/runs/run-execution.service.ts"
    title: "llame model finish and durable completion"
  - id: "3deeaf9588736ad6"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/tools/web-read/pipeline.ts"
    title: "llame deterministic web rendering quality gates"
  - id: "c5bf53b5fd72fdde"
    resource: "https://docs.typesafe.ai/cookbooks/citation_check.md"
    title: "TypeSafe citation support checking cookbook"
  - id: "c009c52dc6e09d43"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/available-models/spec.md"
    title: "llame accepted reasoning-effort contract"
  - id: "35816d44c221fdd1"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/tools/native-files.ts"
    title: "llame native kb mutation execution"
  - id: "6834bc3ae2929531"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/tools/permissions/types.ts"
    title: "llame current permission decision outcomes"
---

# System One, Jev, and applicability to llame

Research date: 2026-09-23. Revision: v4. Status: noncanonical research, not an approved implementation proposal.

## Executive Summary

Jev is worth evaluating as a low-cost decision service beside llame's generative models. First experiment: retrieval relevance (U1). Among the five supplied ideas, Project suggestions (D2) are evaluable now; tool preloading (D3) only after tool search ships and a catalog problem is measured; replacing durable compaction (D1) or routing every subagent (D5) is premature. Confidence: moderate; deployment benefit unmeasured.

Jev takes text/structured state and returns bounded choices, yes probabilities or rubric scores, never summaries or code. Advertised price: $0.042 per million input tokens, free output; state plus the longest question must fit 32k tokens. A classifier, not a replacement chat model. [^0605bcba6b5c7739][^3b9396096fc7b4f4][^199f6b071e6b846c]

Three findings change the proposed applications: `confidence` derives from the answer distribution, not independent correctness, and public evaluations show task-dependent calibration; `fast-jev-compaction` is an extractive tool-history pruner that never shows Jev the result content it judges; OpenAI's cache-preserving controls require stable definitions or append-only additions, not arbitrary tool-list replacement. [^64154f4aee021df4][^8830c774f063a588][^0a34f7ffa362434d][^e10e504a390d04bd][^c86beef864f4e446][^666b02e52f00adad][^9838fa027e54d7c1]

OMP's prior art: separate JUDGE role, typed callers, bounded fan-out, usage accounting; current code refuses prompted probabilities when a native judge fails. Copy that distinction, not uniform trust in backend confidence. [^ca43fdfdb2723b18][^ebb0ae72e6b00c80][^b40f0faa2ee125fb][^36fead1f32c4c857]

## Introduction and scope

Covers all supplied articles, repositories and X threads, including replies available through the requested Markdown mirror; evaluates the five supplied applications (D1-D5) and proposes six more (U1-U6) in llame's retrieval, response-quality and knowledge workflows. Evidence classes: interface documentation, executable source, author-run measurements, social demonstrations and this investigation's own offline experiments.

No application behavior or proposal changed, no private chat history transmitted, no integration installed, no controlled benchmark workload sent to Jev/OpenAI inference endpoints. Repository exploration used the harness's own search tools; their inference is not a controlled Jev benchmark. llame baseline `e70228485042967fd9545ad0cb133faae1be2268`, pre-existing working-tree edits excluded. Issue #338 approves the tool-search proposal; inspected runtime code has no implementation, and current code and SPEC outrank the proposal's older architecture assumptions. [^4f89b26cf16ee239][^03aec42edc684f81][^a69dcdc3e454f59a]

Confidence labels: high = directly inspected behavior or documentation; moderate = bounded synthesis or reproducible-but-not-rerun third-party measurements; low/unknown = adoption scale, transferable quality, deployment promises. A high-confidence report of an author's result is not confidence llame reproduces it.

## Connections to harness research

Companion reading: [harness index](../../harnesses/index.md) and [OMP reference](../../harnesses/oh-my-pi.md#typed-judgments-and-jev). F3 expands the OMP JUDGE source trace; U1-U3 derive from its search, effort and completion mechanisms. The OMP reference keeps this 2026-09-23 observation separate from its older whole-document baseline.

Design comparisons: [SoL-Pi](../../tools/sol-pi.md) for D1's recoverability requirement; [Spotify Shunt](../../tools/spotify-shunt.md) for U1's question-focused selection and displaced inference cost. Neither integration is claimed to use Jev.

The [cookbook companion](./cookbooks.md) assesses the full TypeSafe cookbook collection and how-to patterns, reuses recipe logic in smaller source-bound helpers, and develops U21-U29. Analysis extension of this bundle, not another implementation layer or benchmark result.

## Main Analysis

### F1 — What System One and Jev actually provide

System One is TypeSafe's new model class, attributed to a new architecture, parallel sampler and RLCD; vendor positioning, not verified here. The useful difference is the interface: one state plus independent typed questions instead of autoregressive free text. [^0605bcba6b5c7739][^199f6b071e6b846c]

| Primitive | Returned decision                                                                  | Suitable llame responsibility                                                   |
| --------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Choice    | One predefined option, option probabilities, distribution-derived confidence       | Pick one Project or eligible model, with an explicit no-match option            |
| Noul      | Probability that a yes/no proposition holds; no separate confidence field          | Independently judge whether each tool/server is relevant; allow several or none |
| Score     | Probability-weighted index over ordered rubric levels, distribution and confidence | Rank candidate relevance or rate a defined difficulty rubric                    |

Choice allows at most 255 options; Score 2-10 levels. Question identifiers are bookkeeping and never reach inference: a field named `needs_atlassian` does not replace explicit question wording. Questions share state but cannot read each other's answers: dependent decisions need code between calls, independent questions should be batched. [^199f6b071e6b846c]

Documented model `jev-1.13.0` (`jev-latest` and `jev-preview` currently resolve to it). Inputs: text, JSON objects or arrays; not images/audio/video. Ceilings: 64k tokens per request, 32k for state plus the longest question. Listed limits 250,000 tokens/second, 1,200 requests/minute, changeable without notice during early access; English is the strongest documented language. [^3b9396096fc7b4f4]

Documented weaknesses: literal interpretation, irrelevant long context, indirection, adversarial instructions, numeric precision and generation. State is not treated as hostile by default; precise rubrics and bounded inputs matter more than the appeal of a short call. [^8830c774f063a588]

**Cost.** List-price arithmetic: 10,000 input tokens cost $0.00042, 4,000 cost $0.000168 (examples, not measured totals). GPT-6 Luna's advertised input price is $0.10/million, only 2.38 times Jev's; a fully cache-read-eligible 10,000-token Luna prefix costs $0.0001 before new suffix/output charges. The advantage is parallel workload decisions and avoided generation, not a 400-fold edge. [^3b9396096fc7b4f4][^73461b3e97af0d93][^c86beef864f4e446]

The 193.6x faster/444.6x cheaper vendor headline comes from four authored workflows against reference probabilities from expensive models, with other models producing full distributions through a wrapper. The founder calls the multiples likely near the high end and notes West Coast measurement geography. The quoted 70-500ms is vendor end-to-end latency, not a llame p95. [^0605bcba6b5c7739]

### F2 — Calibration, abstention and the meaning of confidence

`confidence` collapses the shape of the answer distribution; it is not an independently estimated probability that the chosen action succeeds. TypeSafe's own confidence page describes this derivation; its interactive example approximates one formula, not a guaranteed wire-level formula. [^64154f4aee021df4]

Choice asks which candidate fits best relative to its competitors; Noul asks whether a condition holds. A model can confidently pick the least-wrong Project when none belongs, or the best available tool when no tool is needed. Use an explicit no-match option and, where useful, a separate absolute-fit question: the skill-suggestion cookbook ranks candidates, then checks whether any actually fits. [^8830c774f063a588][^ec3184bd3393c480]

| Evidence                                      | Reported result                                                                                                                                                                                                 | What it does and does not establish                                                                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PriorBench, author-run independent evaluation | 5,721 calls, 21 experiments; about 430ms latency floor from Western Europe through OpenRouter; 800 typed judgments in one call in 985ms. Cake/random text still got confident labels without a no-match option. | Batching and out-of-scope handling matter. One location/day/version and custom benchmarks do not establish universal latency or a universal 0.99 threshold. [^61bd2288cebd9fe2]                                                   |
| OOD calibration study                         | 900 synthetic records; hidden organizational-priority rule had 44.7% accuracy with mean selected probability 0.74.                                                                                              | Confidence does not reliably expose missing policy. Hidden-label and 5% label-noise design is not an estimate of ordinary Project-routing accuracy. Run used Vercel AI Gateway, with unexposed model version. [^9838fa027e54d7c1] |
| OOD correction                                | At a 0.005 floor for rounded zeros, recoverable-queue Choice refit temperature changed from 3.29 to 1.30, and hidden-priority Score from 3.40 to 1.92.                                                          | The original magnitude was overstated, especially for Choice; the hidden-rule Score remains overconfident under the corrected analysis. Do not quote the original temperatures as settled evidence. [^9838fa027e54d7c1]           |
| Abide replay                                  | Review confirmed 10/39 edit flags and 11/15 turn flags. The independent reviewer was Claude, with four owner spot-checks.                                                                                       | A plausible rubric can still have many false positives. This is neither comprehensive human ground truth nor a measured repair-success rate. [^7967511960150972]                                                                  |
| Tool-routing benchmark                        | GPT-5.6 Luna solved a feature task 3/5 times with routing versus 5/5 without; Opus 5 median time increased 83% on that task.                                                                                    | Reduced tokens do not necessarily improve task success or wall time. Samples are small and task-specific. [^f3bfeb233b8e7523]                                                                                                     |

Type safety constrains the output space, not truth, tool choice, safe execution or preserved memory. "Zero hallucinations" is a schema claim, not an empirical zero-error one. Confidence: high. [^0605bcba6b5c7739][^8830c774f063a588]

### F3 — OMP's actual JUDGE design

Initial inspection used OMP `d49918f`; the refreshed checkout advanced to `f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7` and changed judgment fallback. The recommendations below use the refreshed source; the initial revision survives only as a pinned citation and evidence record. [^ca43fdfdb2723b18][^ebb0ae72e6b00c80][^8707726e1027e18d]

**Role and wire.** JUDGE is a separate model role for internal decisions and eval helpers, not the code-writing assistant. Priority: direct TypeSafe Jev, OpenRouter Jev, then tiny/smol/default. Backends are selected by API type, not provider-name guessing: TypeSafe `POST /v1/systemone`, OpenRouter `/api/alpha/decisions`, both carrying state, model and typed questions. [^ca43fdfdb2723b18][^ebb0ae72e6b00c80][^b40f0faa2ee125fb]

**Fallback.** Discovery accounts for availability and credentials; without a native candidate, a local or ordinary chat model supplies prompted judgments. A native candidate removes later prompted candidates and blocks appending a session chat model, so "no TypeSafe configured" differs from "configured native judge failed": current code refuses prompted probabilities for a failed native judgment. Aborts/timeouts propagate; eligible ordinary failures advance to another retained candidate. [^ca43fdfdb2723b18]

**Bounds.** 10-second per-attempt timeout, up to three HTTP attempts, capped exponential/Retry-After backoff; caller latency can far exceed one Jev response. Token usage is priced from catalog metadata when billed cost is absent, OpenRouter cost is preserved, and judgment usage is journaled separately from assistant conversation text. [^b40f0faa2ee125fb][^ca43fdfdb2723b18]

**Single request versus batch job.** `judge(state, questions)` sends independent questions over one state. `judge_batch(states, questions)` is a host-owned job: per-state calls, bounded concurrency, item-level outcomes/retries, a drain cursor, reattachment after an eval-kernel reset. It is not one provider request, and kernel-reset survival is not database-durable recovery across host failure. Batch status exposes model, cost and elapsed time. [^36fead1f32c4c857]

Concrete uses:

- **F3a — Semantic `find`:** lexical candidates, filename and sketch judgments, then full-passage verification; cutoffs include 0.45 for sketch pruning and 0.20 for verified hits. Failed final verification cannot establish a hit, and failure handling can preserve sketch candidates as unknown. Cutoffs are not transferable calibration. [^8c2fff6039d2157b]
- **F3b — Automatic reasoning effort:** a Choice classifies the prompt; code clamps to the model's supported effort range and configured ceiling. Tiny local models get a coarser three-bucket question. Effort changes; model identity does not. [^870371284aef47c9]
- **F3c — Bulk decisions and supervision:** eval judgment helpers, AI-assisted staging and unexpected-stop checks; the reusable mechanism is a small typed decision API with caller-owned effects. Staging or resuming execution remains a separate policy decision. [^fff5f685407e9767][^88d63eea2eea07c2][^36fead1f32c4c857]

Recommendation: copy the role separation and native-versus-prompted rule; defer the multi-provider registry until llame has a second real consumer. First trial: one explicitly identified decision backend, application-specific no-op on failure.

### F4 — `fast-jev-compaction`: useful idea, wrong replacement boundary

Upstream revision `e3f262a7f4d42bd8dd32ced30d26176f7cb545b0`. The algorithm pairs tool calls/results, protects the first and newest six messages, and asks two Noul questions per other pair: does the call remain useful, must its full result remain verbatim. At threshold 0.5, a positive result verdict keeps both; a positive call verdict alone keeps the call and a truncated result; otherwise both records vanish from the projection. Prose is not summarized. [^0a34f7ffa362434d]

**Decisive limitation:** tool-output contents never enter Jev's scoring state. It carries dialogue, inputs, tool identity and a result note with error/success status and character length, so a long output holding a unique rollback ID and an equal-length output of routine noise look identical. Content never received cannot be recovered. [^e10e504a390d04bd]

The library keeps the first 300 characters of a sufficiently long truncated result plus a note advising rerunning the tool. Unsuitable as universal recovery for writes, non-idempotent shell commands, mutable web pages or historical observations; llame should retrieve the durable observation, not repeat an effect (architectural inference from source behavior and llame's durable-history contract). [^0a34f7ffa362434d][^4c863fcdba09b740][^03aec42edc684f81]

State fitting progressively shortens call inputs and dialogue, then omits old text/entries; questions split into multiple batches when necessary, each repeating the fitted state, and batches run concurrently, so "one fast request" is conditional. The library throws on failures with no integrated retry/deadline policy, and its Claude Code adapter falls back to native summarization on failure or insufficient character reduction. No end-to-end retention/task-success benchmark in the tree. [^0a34f7ffa362434d][^e10e504a390d04bd][^4165f2071a8c3b31]

**E1, performed here.** Two synthetic transcripts differing only in an equal-length trailing tool-result outcome produced identical classifier states from actual upstream `compact()`; with injected `keepCall=0.9`, `keepResult=0.1`, the projection lost the trailing outcome while the input transcript stayed unchanged. Proves the information boundary and truncation behavior, not Jev's judgment quality; no network call occurred. Source and output: `probes/compaction-probe.mjs`, `probes/compaction-probe-result.json`. [^7b44005a8e75c461]

Provenance trap: the inspected upstream package says 0.2.0; npm's current `fast-jev-compaction` is 0.4.0 under publisher `aleksvega` with a different `gitHead`. The bare npm name does not install the examined repository — a provenance mismatch, not evidence of malicious publication. [^6b315587b4ef6e42][^5c390f1a54da0051]

For llame, change the **existing deterministic tool-observation projection**, not add a compactor assumed to fill an empty role (D1). Changing the prescribed selection rule requires a tool-calling contract change; exact model-facing recovery is new because `conversation_read` excludes tool parts. Keep generative checkpoint compaction for the summary Jev cannot write. [^2eec27a5b96e8046][^1997552fefe32db0][^6b3e943cd1fe085f][^4c863fcdba09b740][^0a34f7ffa362434d]

### F5 — What people are actually doing

Real code and useful experiments exist, but listings mix working integrations, demonstrations, measured trials and ideas. HackerNoon's 101 entries and ShipWithJev's 551 listings count no verified production deployments; HackerNoon warns many projects have minimal code/history. [^b164f6b97d9f7020][^c4cd472a746f893f]

| Source                      | Mechanism and evidence class                                                                                                                                                                                                               | Transferable part / limitation                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MindStudio                  | Reported email/comment batch classification; seven criteria over 1,000 emails reportedly fell from about 70 seconds to 6 seconds after concurrency/batching changes, at $0.09. Feed tagging demo; trading bot initially performing poorly. | Shared-state batching and pipeline structure are useful. No supplied error denominator; its GPT comparison is not the same seven-criterion workload. [^fd69f31cde24ac85]                                                         |
| LangChain and Sydney Runkle | Middleware routes latest user message to a fast/powerful model for the run; tool-risk middleware is shown before execution.                                                                                                                | Direct prior art for role routing; not evidence for per-step optimal routing or reliable authorization. Thread and article are the same underlying source, not independent corroboration. [^9e45c053dcabfa34][^417ee78585552fff] |
| Foreman                     | Executable Python router asks one Noul per conditional responsibility; global responsibilities cannot be routed out. Later judgments supervise a coding worker.                                                                            | Multi-label relevance plus mandatory baseline rules. It selects responsibilities, not subagent model identities; malformed/failed initial routing can stop worker startup. [^3622234ebf4d871e]                                   |
| jev-gateway                 | Proxy chooses a next tool, checks whether any tool is needed, and may force tool choice, hint, or synthesize a closed-schema call. Errors/uncertainty preserve the original request.                                                       | Useful bounded selection pattern. It controls more than preloading and can choose wrongly; author reports added latency, and its paired benchmark includes regressions. [^53249c9545234798][^f3bfeb233b8e7523]                   |
| Abide                       | Compiled, path-scoped code rules become typed judgments over diffs; flags or hook blocks ask the coding agent to repair them.                                                                                                              | Good shape for optional semantic review. Fail-open errors, low edit-flag precision and no repair-success measurement mean it is not an enforcement guarantee. [^c51b44394496ba9d][^7967511960150972]                             |
| Chris Tate                  | `json-render + Jev` demonstration over a known component/action vocabulary.                                                                                                                                                                | Constrained UI composition, not unrestricted generated UI. "Instant" is demo rhetoric without a supplied UX benchmark. [^408f550752167419]                                                                                       |
| James Ward                  | Jev inside an LLM tool, or Jev as outer orchestrator with LLM generation as a tool; bounded workflow AST and MCP output schemas.                                                                                                           | Output schemas can make subsequent decisions explicit. A schema is not the actual returned state; parsing, dependencies and execution authorization remain code responsibilities. [^4ad45f89aad83867]                            |
| HackerNoon / ShipWithJev    | Browser-action selection, games, simulation, extraction, semantic review, compaction and ranking directories.                                                                                                                              | Discovery leads. Some entries are toys or prototypes; directory counts and self-reported per-call numbers cannot establish product reliability. [^b164f6b97d9f7020][^c4cd472a746f893f]                                           |

The zodchiii thread is weak evidence: it attributes a harness PDF to the founder under the wrong name; replies dispute provenance, note the PDF disclaims affiliation and request a reproducible workload. It does not establish the author, and its 200x/400x coding-agent promise is not a measured coding-task result. [^a4fc79611d9a7d17]

Best directly relevant vendor experiment, the skill-suggestion cookbook: two Jev calls rank 182 skills, then recheck the top three with absolute-fit questions and permission to suggest nothing. The winner becomes an additive hint after an unchanged full skill index; no tool-schema shortlist is preloaded or restricted. On 488 synthetic requests against Haiku 4.5, reported wrong loads fell from 16.8% to 7.3% and needless loads from 9.8% to 4.0%; covered requests came from the skills themselves and are acknowledged easier than natural traffic. This supports relevance hints, not schema preloading. It used Jev 1.12, not the documented 1.13.0. [^ec3184bd3393c480]

### F6 — The OpenAI announcement enables a specific protocol design

The Sol/Luna cache claim is supported by OpenAI docs, but it merges distinct controls. [^73461b3e97af0d93][^c86beef864f4e446][^666b02e52f00adad][^ec400e9e55dcff2e]

| Desired change                   | Documented cache-compatible method                                                                                   | What it does not promise                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Enable/disable existing tools    | Keep `tools` definitions/order/schema stable; change `tool_choice` to `none` or use `allowed_tools`                  | Does not remove already loaded schema tokens or authorize execution                                   |
| Introduce more tools mid-history | Tool search, or developer-role `additional_tools` at the desired input position                                      | Must preserve the addition's original position on replay; not arbitrary reordering/removal            |
| Change reasoning effort          | On supported GPT-6 standard single-agent mode, append `configuration_update`, keeping request-level effort unchanged | Not a generic promise for Chat Completions, Anthropic, pro mode or arbitrary top-level option changes |

Tool search is documented for Responses models from GPT-5.4 onward, so not every announced capability is new or exclusive. Deferred functions still expose names/descriptions; namespaces can defer more of the inventory. Cache reuse also depends on prefix eligibility, model, routing and lifetime. [^666b02e52f00adad][^c86beef864f4e446]

`configuration_update` constraints: adjacent updates rejected; automatic compaction/truncation and the standalone `/responses/compact` endpoint incompatible with histories containing these items; `compaction_trigger` documented separately. llame's summarization differs, but it must still persist/replay or rebase configuration state deliberately instead of dropping it at its checkpoint boundary. [^ec400e9e55dcff2e][^4c863fcdba09b740]

**E2, performed here.** Installed `@ai-sdk/openai` 3.0.97 exercised through `generateText` with a local intercepted fetch: `providerOptions.openai.allowedTools` retained both Whoards and Atlassian schemas while encoding only Whoards as callable; `activeTools: ['whoards_lookup']` removed Atlassian from the wire's `tools` array. An adapter behavior check, not a live OpenAI cache-hit test. See `probes/adapter-probe.mjs` and its result JSON. [^a837179309fc5dde]

llame strips operator-supplied `allowedTools` because it can override trusted tool choice. A future harness-owned callability layer can use the adapter capability without letting operator options override structured-generation or step-cap invariants. The installed adapter encodes neither `additional_tools` nor `configuration_update`; prove support at the wire seam before planning those as configuration-only changes. [^c928d70f34493417][^a837179309fc5dde][^f2265b4571683072]

## Synthesis: applicability to the five proposed ideas

Recommendations, not implemented features or approved changes. Quality confidence remains moderate until evaluated on llame workloads.

### D1 — Alternative compaction: evaluate the existing projection, retain the summary engine

Current compaction preserves canonical messages, writes a summary checkpoint with `upto_seq`/parent lineage, keeps a recent tail, accounts for usage and checks staleness before publishing. Post-turn compaction is already off the completed response's critical path; model-transition compaction has different latency concerns. Faster selection must justify end-to-end savings, not a faster isolated API call. [^21e2cd8ac930bbd7][^4c863fcdba09b740][^03aec42edc684f81]

The baseline includes deterministic observation reduction: replay caps each serialized pair at 8,000 UTF-16 code units and each stored assistant turn at 32,000, preserving pairing, newer observations and identity/outcome ahead of payload. Compaction clears absorbed inputs/results into bounded stored replacement records that later replay must not recompute. Jev-based importance ordering or selective retention would change those specified rules, not swap a summary backend. [^2eec27a5b96e8046][^1997552fefe32db0]

Trial: shipped summary-plus-projection baseline versus a Jev-assisted selection variant on the same continuation tasks; keep source records, make projection changes inspectable. Recovery first needs a separately specified owner-authorized reader for stored tool observations, since `conversation_read` returns visible text only. Do not substitute the upstream "rerun tool" instruction for that reader, especially for mutations or historical observations. [^6b3e943cd1fe085f]

Pass condition: continuation quality at a controlled context budget — user constraints, decisions, identifiers, errors and mutation receipts retained; omitted observations recoverable; no invalid call/result pairing; no data/tenant-boundary change — measured with task success, cache effects, recovery turns and total cost. Character reduction alone is inadequate; defer replacement until the comparison shows a net benefit.

### D2 — Project assignment: good fit for suggestions, automatic moves later

The Project today is an owner-only chat group: at most one per Chat, duplicate names allowed, no description or bounded-memory field. Description-based evaluation can start on offline fixtures; real traffic needs a Projects contract/schema change or explicitly authorized cross-chat evidence, and names alone may not distinguish candidates. Vision research supports automatic organization changing relevance rather than authority, with visible correction and future-Run context changes. [^b2618f474b296d21][^815eeaf8c2ede6ed][^89ed2f298996bdac][^098f797eb9f933b9]

Decision input: current prompt plus enough bounded same-chat context to resolve references, and a tenant-authorized shortlist of Project IDs with owner-authored descriptions. Default to no excerpts from other chats: `shareRecentChats` is default-off and explicitly not blanket history permission, so cross-chat excerpts for classification need a specified owner opt-in covering purpose and provider, not reused digest consent. Then include bounded provenance-bearing excerpts only when they improve discrimination. Opaque candidate IDs and a no-match option; evaluate any absolute-fit gate separately from Choice confidence. [^380921d284183391]

First output: a nonblocking suggestion with explicit target and easy correction; code can explain "matches this Project description" instead of asking Jev to invent rationale it cannot generate. Manual filing stays authoritative, with no repeated suggestions after rejection, and classifier failure leaves the chat where it is. Automatic filing should be opt-in, reversible and validated against the accepted automation error rate, not an arbitrary `confidence > 0.9`. Test ambiguous and multi-project prompts, new projects, stale descriptions, multilingual input and anaphoric follow-ups; measure false-move rate and abstention coverage (a classifier that never moves anything is safe but useless). Before a move commits, recheck ownership and whether the user already filed the chat; never rewrite an active Run's context or retroactively change prior provenance.

### D3 — Initial tool selection: strongest integration candidate after proposal reconciliation

The approved tool-search design already budgets eligible MCP declarations, keeps code-owned tools declared, promotes previously loaded tools within a compaction epoch, and rejects speculative budget filling until measured need. Jev-driven preloading is such an extension, not a detail the proposal authorizes. [^a69dcdc3e454f59a][^4f89b26cf16ee239]

Recommended order: filter by trusted eligibility; resolve unambiguous named-server references deterministically; classify only ambiguous intent against a bounded set of admitted server/tool descriptors, reserving Jev for cases that need semantic judgment. "Use my Whoards MCP ... vocabulary" may need no Jev; "search this Atlassian issue" sets a lexical baseline worth beating. Use multi-label relevance rather than a forced tool choice, since a request can need Whoards and Atlassian together. Preload a bounded shortlist, keep `tool_search` for misses, let the main model generate open-ended arguments. A shortlist error should cost a discovery step, not make an authorized tool permanently unreachable; a positive verdict must never grant access to a policy-excluded tool.

The proposal's architecture is stale where it describes accept-time durable tool snapshots and old provider dispatch; current SPEC uses per-attempt in-memory catalogs and system-only receipts. Reconcile that baseline before adding a classifier; do not implement against the old snapshot model. Selection evidence and delivered schemas need an inspectable recording contract, since the system-only receipt does not record tool descriptions. [^a69dcdc3e454f59a][^03aec42edc684f81][^c928d70f34493417]

Success: fewer discovery-only round trips and lower total latency/cost without lower tool/task success. Today's baseline declares the full admitted catalog; compare it and deterministic matching first, treating the approved search design as an experimental baseline only after a prototype or implementation exists. Test no-tool requests, mixed-server tasks, misleading descriptions, missing servers, ambiguous follow-ups and provider outages.

### D4 — Per-turn tool selection: feasible; separate authorization, disclosure and callability

Three sets: tools policy permits, schemas the model has received, tools callable on this request. Cache preservation affects how they are represented, not what they mean. [^c86beef864f4e446][^666b02e52f00adad][^03aec42edc684f81][^c928d70f34493417]

Near-term Responses experiment: keep admitted declarations stable and vary `allowed_tools`/`tool_choice` through a harness-owned layer — preserves the portable replay shape, not schema context size. The approved search design uses llame-owned cross-Run promotion as ordinary declarations and explicitly does not depend on provider tool-loading history across Runs; callability and promotion solve different parts of the problem. [^a69dcdc3e454f59a][^c86beef864f4e446]

Append-only provider-native schema introduction is a separate architectural option, not current behavior: it needs a revised portable SDK tool-call/result replay contract and proposal D11, durable placement records, adapter support, model-switch/cross-wire rules and compaction rebasing. Fresh per-attempt composition stays authoritative on eligibility and current schemas; persisted history must never resurrect revoked or obsolete capabilities. [^2eec27a5b96e8046][^a69dcdc3e454f59a][^03aec42edc684f81]

Recall of a tool name or previous call is not a current declaration, schema or execution grant. OpenAI preserves provider-recognized loading items only if the application replays them correctly; llame does not preserve prior searches that way across Runs, and prose saying "I used tool X" cannot substitute. Disabling a tool does not evict its consumed tokens either; context pressure still requires a deliberate rebaseline. [^666b02e52f00adad][^a69dcdc3e454f59a][^03aec42edc684f81]

Per-turn selection needs the current prompt plus bounded unresolved task/tool context; "do that again" alone is underspecified, and a second hidden conversation state should not be manufactured. Low confidence or deadline expiry should preserve the approved discovery path, not silently remove capabilities.

### D5 — Future subagent model routing: useful fit, nonzero overhead, later priority

A bounded Choice over eligible models matches Jev's interface, and LangChain already demonstrates fast/powerful per-run selection. But model cards are capability hypotheses, not observed workload performance, and child Runs must retain llame identity, cancellation, provenance and policy regardless of model. [^199f6b071e6b846c][^9e45c053dcabfa34][^098f797eb9f933b9]

Route ordering: obey explicit user/parent model selection; enforce modality, context size, tool protocol, privacy and budget constraints in code; then let a bounded classifier rank eligible choices using task-specific measured descriptions. Preserve an abstain/default path; record selected model, judge version, route inputs/policy version and outcome. Never include ineligible models and hope the classifier remembers the constraints.

One call per child Run is more defensible than switching after every tool result. Batch independent classifications when prompts are known together, or overlap classification with unavoidable preparation. Overhead remains real: network latency, payload cost, retries and incorrect routing. OMP's smaller use, selecting reasoning effort within a fixed supported model, may be a simpler intermediate experiment. [^b40f0faa2ee125fb][^870371284aef47c9][^61bd2288cebd9fe2]

Measure cost per successful child outcome, task completion, escalation rate and p95 added latency; a cheap route forcing a second expensive retry can lose. Defer until child Runs exist; the vision puts orchestration behind the single-agent personal-context loop. [^098f797eb9f933b9]

## Additional applications proposed for llame

New proposals beyond D1-D5, not claims that these features ship or that Jev improves their outcomes. Derived by inspecting the existing retrieve-answer-record loop for a bounded judgment, an earlier check or removed model work; all benefits below are hypotheses. Private content reaching a separate judge provider needs an explicit data policy; retrieved text never supplies authority.

### U1 — Improve recall precision before the answering model reads results

**Product effect:** for "why did we reject Redis?", surface the passage holding that decision instead of chats that merely mention Redis — improving shipped recall without waiting for subagents.

**Decision:** give Jev the current question and a bounded set of already-authorized candidate passages; ask which contain evidence needed for the answer. Code selects the subset under a context budget and retains source locators: a second-stage relevance signal, not a retrieval replacement. Chat search already has rank fusion; Knowledge search exposes bounded excerpts with readable locators and continuation cursors. Start with a fixed retrieved page or answer-context selection; do not silently change cursor semantics or run inference over every owner file. [^5b6fbd481c4f1031][^3625dc1afe52ad01]

**First experiment:** existing order versus reranked candidates on questions with known supporting passages; measure support recall and answering success at the same context budget, plus extra latency. A narrow excerpt may omit the answer, so low relevance is not proof the source lacks it; preserve access to the original candidate set. **Priority: first; confidence in fit: moderate.**

### U2 — Select reasoning effort for the main Run

**Product effect:** less reasoning for lookups or mechanical edits, more for diagnosis or design, without changing model/provider identity. An earlier, smaller consumer than subagent model routing.

**Decision:** classify the request plus bounded active-task context into the selected model's supported effort levels. Deterministic policy retains explicit user effort choices and configured floors/ceilings; classifier failure uses the existing default. OMP has a concrete effort classifier and llame already records resolved effort with Run telemetry. Cache behavior still follows F6, not an assumption that changing top-level effort is free. [^870371284aef47c9][^53bc20bcb6729c65][^ec400e9e55dcff2e]

**Prerequisite:** llame resolves omitted effort to the model default and freezes the concrete value at Run acceptance. Add an explicit auto-selection intent distinct from both an explicit level and omission, classified before that accept-time binding, never by changing an already queued Run. Level values and labels are opaque, so auto selection needs an operator-authored difficulty-rubric mapping to the model's declared values. [^c009c52dc6e09d43]

**First experiment:** fixed effort baseline versus classification on paired tasks; measure cost per correct outcome, latency and under-allocation failures, not just reasoning tokens. **Priority: second; confidence in fit: moderate.**

### U3 — Detect responses that promise work and stop before doing it

**Product effect:** catch "I'll inspect the logs now" followed by a terminal response with no inspection, so the user need not notice and restart.

**Decision:** judge the request, final assistant text and bounded tool activity for `answered`, `needs_user_input` or `promised_unperformed_work`; begin as a shadow signal or visible continuation suggestion. OMP implements unexpected-stop classification, and llame already distinguishes abort/error/completion and records step-cap notices. A score must not rewrite a durable terminal outcome, override cancellation/caps or trigger unbounded retries, and automatic continuation needs its own lifecycle contract. [^88d63eea2eea07c2][^53bc20bcb6729c65]

**First experiment:** label normal text-only completions for premature stops, measuring false intervention rate before considering continuation; distinguish honest answers and clarification requests from promises to act. **Priority: third, shadow mode; confidence in fit: moderate.**

### U4 — Identify unusable content inside apparently successful tool results

**Product effect:** recognize a login page, interstitial or irrelevant landing page returned as HTTP 200 before the assistant treats it as the requested evidence.

**Decision:** classify a bounded read result against its requested document as substantive content, access barrier, unrelated content or uncertain; attach a visible observation, never hide the original or auto-authorize another fetch. llame already has deterministic size/shape and known challenge-phrase gates, so test only their ambiguous residual cases rather than paying per page. Structured MCP error/status fields stay deterministic inputs, not Jev reinterpretations. [^3deeaf9588736ad6]

**First experiment:** known good pages and missed access barriers; measure false rejection of legitimate short/code-heavy pages and whether the warning prevents unsupported answers. **Priority: opportunistic, after observing a real miss class; confidence in fit: moderate.**

### U5 — Check whether a cited source actually supports an answer's claim

**Product effect:** catch an answer citing a real document that does not say what the answer claims — trustworthy recall, not just valid URLs.

**Decision:** for an explicit claim-to-source mapping, check literal quote presence in code, then ask Jev whether the relevant passage supports, contradicts or leaves the claim unsupported. Verdicts are review signals, not truth certificates. TypeSafe publishes this recipe, but its small synthetic example is not a llame effectiveness benchmark. Claim extraction and mapping are prerequisites; Jev cannot invent them from unrestricted prose. [^c5bf53b5fd72fdde]

**First experiment:** offline on grounded answers and deliberately incorrect citations; measure unsupported-claim detection and false alarms. A streamed answer cannot be silently rewritten after publication, so any live gate needs draft-before-publish or post-answer review. **Priority: after U1; confidence in fit: moderate, integration value unknown.**

### U6 — Triage duplicate and contradictory Knowledge writes

**Product effect:** fewer duplicate lessons and contradictory edits in Knowledge, covering today's direct file writes and the future recoverable learning loop.

**Current seam:** authorized `edit` and `write` already mutate `kb://` files through an owner-scoped pre-effect fence, with no existing proposal or human-approval gate — tool permission decisions are allow/reject. The future layer is Git-backed recovery and versioned publication, not the first ability to write Knowledge. [^35816d44c221fdd1][^6834bc3ae2929531][^03aec42edc684f81][^098f797eb9f933b9]

**Decision:** compare the intended note/update and its cited evidence against a retrieved shortlist of existing notes; classify as new information, duplicate, compatible addition, contradiction or insufficient evidence. Record advisory verdicts in shadow mode, execution unchanged. Interactive review or a blocking gate is a separate product contract; Jev must not manufacture write permission, edit the proposal or bypass the fence.

**First experiment:** intended edits and note pairs containing paraphrases, corrections and genuinely new facts. Supersession needs explicit dates/source authority; contradiction alone cannot identify which note is true. **Priority: advisory now, review-gated automation later; confidence in fit: moderate.**

## Counterevidence Register and unresolved boundaries

- **R1 — Calibration is task-specific.** Vendor calibration claims, PriorBench's favorable custom benchmark and OOD failures cover different distributions; no vendor or community 0.99 threshold licenses automatic filing or execution on llame traffic. [^0605bcba6b5c7739][^61bd2288cebd9fe2][^9838fa027e54d7c1]
- **R2 — Latency is deployment-specific.** West Coast native figures, Western Europe OpenRouter results and proxy overhead cannot combine into one p95; native/API-route/model-version comparisons remain unmeasured here. [^0605bcba6b5c7739][^53249c9545234798][^61bd2288cebd9fe2]
- **R3 — Selection can reduce correctness.** The gateway benchmark contains cheaper but less successful runs and slower routed runs; preloading is deliberately less restrictive than forcing the next tool. [^f3bfeb233b8e7523]
- **R4 — External provider boundary.** TypeSafe documents no training on customer inputs/outputs and enterprise ZDR; its DPA states retention as necessary for processing, not a fixed default deletion interval. Project excerpts or private transcripts need an explicit provider/data policy — self-hosting llame does not make Jev inference local. [^3b9396096fc7b4f4][^8813bab3cd144364][^8096abfcb65eef3f]
- **R5 — Changing upstreams and proposals.** OMP fallback changed during research and the approved tool-search proposal contains superseded architecture; pin source/model versions and reconcile contracts before implementation. [^ca43fdfdb2723b18][^8707726e1027e18d][^a69dcdc3e454f59a][^03aec42edc684f81]

## Recommendations

Prioritized within D1-D5 by expected value and reversibility. U1 first (improves shipped recall, no durable-content change), U2 next (the smaller cost-control experiment), U3 advisory initially, U4-U6 with their stated prerequisites.

1. **A1 — Offline/shadow evaluation of Project suggestions and tool shortlists.** Baselines: deterministic named-server matching and today's all-declared catalog; add approved tool search only once prototyped or implemented. Authorized, redacted or synthetic fixtures; freeze rubrics and thresholds before held-out evaluation; compare Jev with a small generative classifier on identical inputs; no production mutation.
2. **A2 — Reconcile the tool-search proposal with current runtime ownership, then evaluate preloading separately (D3).** Prove a real catalog/latency problem before adding per-turn inference; keep search as the correction path.
3. **A3 — Validate provider-native cache behavior on real model requests:** stable schemas plus `allowed_tools`, dynamic `activeTools`, deferred search and append-only introduction; observe cached-input/cache-write tokens, total cost, p95 time and callable behavior. The offline wire-shape experiment shows a difference, not a cache hit.
4. **A4 — Keep compaction exploratory until continuation-quality evidence exists (D1):** compare against the shipped deterministic projection and summary engine; a recovery variant needs a stored-observation reader and a selection-contract change — rerunning mutations is not recovery.
5. **A5 — Revisit model routing when child Runs ship:** fixed route per child plus measured task cards; no routing framework, adaptive per-step switching or new durable agent system before that consumer exists.

Experiment record (not a new platform schema): input fixture/version, eligible candidates, judge/API/model version, rubric/version, raw probabilities, policy outcome, latency/cost, downstream success and correction. Per-task calibration; keep authorization outside all model judgments.

## Limitations

No controlled live Jev classification benchmark, OpenAI cache experiment or upstream performance benchmark was run. The two probes tested deterministic local mechanics with synthetic data and intercepted/fake model responses; their millisecond timings are not model latency. Third-party measurements stay attributed, not independently reproduced.

Sources were covered, but public examples do not establish production scale; X mirror replies are what that service returned, not exhaustive reply coverage. Videos, the disputed PDF and every linked project in the two directories were not executed or audited. No private conversations or credentials were inspected.

Citations are pinned where a revision was established. The two independent-evaluation READMEs are default-branch snapshots with stated run dates and ledger-preserved read-time evidence; the initial OMP revision keeps a pinned citation and evidence record, and final current-source citations govern disagreement.

Deployment-trial unknowns: llame-specific accuracy/calibration, native-service p95 from the deployment region, stable account limits, exact default retention and availability. No source can settle them merely by being copied into a design.

## Appendix: Methodology and Claims-Evidence Table

Four source investigations covered OMP, the compaction repository, community articles/threads and three example applications. Main analysis verified material claims against primary docs/current source, corrected the OOD API-route attribution to Vercel AI Gateway, refreshed OMP, found its newer native-only fallback boundary, and executed both probes. Canonical bundle `docs/research/tool-harness/2026-09-23-system-one-jev/`; application and proposal files unchanged.

| Material claim                                                            | Evidence                                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Jev produces bounded decisions, not summaries                             | API/model docs and failure-mode documentation [^3b9396096fc7b4f4][^199f6b071e6b846c][^8830c774f063a588]       |
| Confidence is distribution-derived and needs task validation              | Primary definition plus independent counterevidence [^64154f4aee021df4][^61bd2288cebd9fe2][^9838fa027e54d7c1] |
| Current OMP does not fall from native failure into prompted probabilities | Refreshed chain and priority source [^ca43fdfdb2723b18][^ebb0ae72e6b00c80]                                    |
| Compactor judges absent output content                                    | Source plus executed equal-length-output probe [^e10e504a390d04bd][^7b44005a8e75c461]                         |
| Cache-safe callability differs from removing schemas                      | OpenAI docs plus installed-adapter probe [^c86beef864f4e446][^666b02e52f00adad][^a837179309fc5dde]            |
| Tool-search proposal needs architecture reconciliation                    | Approved issue, proposal and current SPEC [^4f89b26cf16ee239][^a69dcdc3e454f59a][^03aec42edc684f81]           |
| Coding-tool routing can reduce task success                               | Paired author-run benchmark with stated limits [^f3bfeb233b8e7523]                                            |
| Project assignment is relevance, not authority                            | Current Project capability and vision research [^b2618f474b296d21][^89ed2f298996bdac]                         |

Reproduction from the bundle directory: `node probes/adapter-probe.mjs` (uses this repository's installed API dependencies) and `pnpm exec tsx probes/compaction-probe.mjs /path/to/fast-jev-compaction` (uses the repository-installed TypeScript runner, requires upstream `e3f262a7f4d42bd8dd32ced30d26176f7cb545b0` and checks that revision before import). Both intercept or inject the model boundary and make no external inference request; both passed on the Node/pnpm toolchain, with no Bun prerequisite.

Source IDs are stable and OKF footnotes join those same IDs in frontmatter; the numeric-citation projection serves only legacy research validators. Evidence records distinguish paraphrase from direct quotes/data points. Automated report, citation and claim-link checks supplement independent review; lexical overlap is not semantic proof.

## Revision history

- v4 (2026-09-23): compaction reproduction uses the repository-installed `tsx` runner; undeclared Bun prerequisite removed, verified on the Node/pnpm toolchain.
- v3 (2026-09-23): added six applications beyond the supplied ideas (recall relevance, main-Run effort selection, premature-stop detection, tool-result usability, citation support checking, Knowledge write triage), each naming input, decision, product effect, prerequisite and measurable outcome.
- v2 (2026-09-23): OKF bundle with stable source footnotes and portable probes; added the deterministic observation baseline, the missing model-facing recovery reader, the provider-native replay boundary, explicit cross-chat consent, the corrected unshipped-tool-search baseline, corrected Score temperature wording and the skill-hint versus schema-preloading distinction after independent review.
- v1 (2026-09-23): initial synthesis, including the source-backed OMP native fallback correction, the OpenAI wire-shape experiment and the compaction information-boundary experiment.

## Sources

[^0605bcba6b5c7739]: [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

[^3b9396096fc7b4f4]: [TypeSafe models](https://docs.typesafe.ai/models.md)

[^199f6b071e6b846c]: [TypeSafe evaluation API](https://docs.typesafe.ai/api.md)

[^64154f4aee021df4]: [TypeSafe confidence](https://docs.typesafe.ai/confidence.md)

[^8830c774f063a588]: [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)

[^73461b3e97af0d93]: [Introducing GPT-6 Sol and Luna](https://openai.com/index/introducing-gpt-6-sol-and-luna/)

[^c86beef864f4e446]: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)

[^666b02e52f00adad]: [OpenAI tool search](https://developers.openai.com/api/docs/guides/tools-tool-search)

[^ec400e9e55dcff2e]: [OpenAI reasoning models](https://developers.openai.com/api/docs/guides/reasoning)

[^ec3184bd3393c480]: [TypeSafe skill suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion.md)

[^8813bab3cd144364]: [TypeSafe legal documentation](https://docs.typesafe.ai/legal.md)

[^8096abfcb65eef3f]: [TypeSafe data processing addendum](https://typesafe.ai/legal/data-processing)

[^a837179309fc5dde]: [Offline AI SDK wire-shape experiment](./probes/adapter-probe-result.json)

[^098f797eb9f933b9]: [llame vision](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/VISION.md)

[^89ed2f298996bdac]: [llame product vision synthesis](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/docs/research/product-vision/2026-07-15-working-synthesis/report.md)

[^b2618f474b296d21]: [llame projects capability](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/projects/spec.md)

[^21e2cd8ac930bbd7]: [llame compaction orchestration](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/compaction/compaction.service.ts)

[^4c863fcdba09b740]: [llame compaction planning](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/compaction/compaction.ts)

[^a69dcdc3e454f59a]: [llame approved tool-search design](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/changes/tool-search/design.md)

[^03aec42edc684f81]: [llame current architecture](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/SPEC.md)

[^c928d70f34493417]: [llame Responses client](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/models/openai-model-client.ts)

[^4f89b26cf16ee239]: [llame tool-search issue 338](https://github.com/leon0399/llame/issues/338)

[^7b44005a8e75c461]: [Offline extractive compaction mechanics probe](./probes/compaction-probe-result.json)

[^ca43fdfdb2723b18]: [OMP typed judgment role and backend chain](https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/judgment/index.ts)

[^ebb0ae72e6b00c80]: [OMP default judgment priority](https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/priority.json)

[^b40f0faa2ee125fb]: [OMP native System One client](https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/ai/src/judgment/typesafe.ts)

[^8c2fff6039d2157b]: [OMP semantic find cascade](https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/tools/jfind/cascade.ts)

[^870371284aef47c9]: [OMP automatic reasoning effort classifier](https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/auto-thinking/classifier.ts)

[^8707726e1027e18d]: [OMP host-owned judge_batch at initial inspection](https://github.com/can1357/oh-my-pi/blob/d49918fab2dba3986927f2d46721629ed0f3a02c/packages/coding-agent/src/eval/judgment-batch-bridge.ts)

[^0a34f7ffa362434d]: [fast-jev-compaction selection algorithm](https://github.com/tamaratran/fast-jev-compaction/blob/e3f262a7f4d42bd8dd32ced30d26176f7cb545b0/src/compact.ts)

[^e10e504a390d04bd]: [fast-jev-compaction judgment-state construction](https://github.com/tamaratran/fast-jev-compaction/blob/e3f262a7f4d42bd8dd32ced30d26176f7cb545b0/src/state.ts)

[^4165f2071a8c3b31]: [fast-jev-compaction Claude Code adapter](https://github.com/tamaratran/fast-jev-compaction/blob/e3f262a7f4d42bd8dd32ced30d26176f7cb545b0/hooks/fast-jev.ts)

[^6b315587b4ef6e42]: [fast-jev-compaction npm published metadata](https://registry.npmjs.org/fast-jev-compaction/latest)

[^3622234ebf4d871e]: [Foreman responsibility router](https://github.com/thruwire/foreman/blob/7a76bf3304b21912f8a0af0efff2cc7ecf82a718/src/foreman/routing.py)

[^53249c9545234798]: [jev-gateway source](https://github.com/vinilana/jev-gateway/tree/332f7c1f1f46d6c57e5a98076a79971957ca8869)

[^f3bfeb233b8e7523]: [jev-gateway paired benchmark](https://github.com/vinilana/jev-gateway-bench/blob/f60db2e9ca4ec54466cd30d7064d15b346b702c9/README.md)

[^c51b44394496ba9d]: [Abide typed code-rule checks](https://github.com/coldteadotai/abide/tree/94cc79da677ae83596438e03d1ef03702a5c4a44)

[^7967511960150972]: [Abide replay benchmark](https://github.com/coldteadotai/abide/blob/94cc79da677ae83596438e03d1ef03702a5c4a44/benchmarks/replay/README.md)

[^fd69f31cde24ac85]: [12 Jev Use Cases Tested: Where This Decision-Only AI Actually Fits](https://www.mindstudio.ai/blog/jev-use-cases-automation)

[^b164f6b97d9f7020]: [101 Real-World Examples of How to Use Jev](https://hackernoon.com/101-real-world-examples-of-how-to-use-jev)

[^9e45c053dcabfa34]: [Building a Harness with Jev](https://www.langchain.com/blog/building-a-harness-with-jev)

[^c4cd472a746f893f]: [shipwithjev build catalog](https://www.shipwithjev.com)

[^a4fc79611d9a7d17]: [Disputed viral Jev harness PDF thread](https://x.pcstyle.dev/zodchiii/status/2102377493705740417?thread=full)

[^417ee78585552fff]: [Sydney Runkle Jev harness thread](https://x.pcstyle.dev/sydneyrunkle/status/2100754364545761643?thread=full)

[^408f550752167419]: [Chris Tate json-render and Jev experiment](https://x.pcstyle.dev/ctatedev/status/2101022101750571357?thread=full)

[^4ad45f89aad83867]: [James Ward Jev LLM MCP orchestration thread](https://x.pcstyle.dev/JamesWard/status/2100976393546772628?thread=full)

[^61bd2288cebd9fe2]: [PriorBench independent Jev evaluation](https://github.com/priorbench/jev/blob/main/README.md)

[^9838fa027e54d7c1]: [Does Jev know when it does not know?](https://github.com/scienthoon/jev-ood-calibration/blob/main/README.md)

[^36fead1f32c4c857]: [OMP current judge_batch lifecycle](https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/eval/judgment-batch-bridge.ts)

[^f2265b4571683072]: [Installed @ai-sdk/openai 3.0.97 adapter source](./probes/adapter-source-evidence.json)

[^5c390f1a54da0051]: [Inspected upstream compaction package metadata](https://github.com/tamaratran/fast-jev-compaction/blob/e3f262a7f4d42bd8dd32ced30d26176f7cb545b0/package.json)

[^fff5f685407e9767]: [OMP AI-assisted staging judgment caller](https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/cli/git-tui/ai-stage.ts)

[^88d63eea2eea07c2]: [OMP unexpected-stop judgment caller](https://github.com/can1357/oh-my-pi/blob/f89a6db15e9de4db1f08f6eb4ec8d1a901ca07f7/packages/coding-agent/src/session/unexpected-stop-classifier.ts)

[^2eec27a5b96e8046]: [llame tool-observation replay and compaction contract](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/tool-calling/spec.md)

[^1997552fefe32db0]: [llame payload-cleared compaction replacements](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/chats/tool-observation-part.ts)

[^6b3e943cd1fe085f]: [llame conversation-read visibility contract](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/conversation-reads/spec.md)

[^380921d284183391]: [llame owner-controlled history disclosure](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/memory/spec.md)

[^815eeaf8c2ede6ed]: [llame current Project metadata schema](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/db/schema/projects.ts)

[^5b6fbd481c4f1031]: [llame scoped reciprocal rank fusion](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/search/core/fusion.ts)

[^3625dc1afe52ad01]: [llame bounded Knowledge search results](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/knowledge/knowledge-tools.ts)

[^53bc20bcb6729c65]: [llame model finish and durable completion](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/runs/run-execution.service.ts)

[^3deeaf9588736ad6]: [llame deterministic web rendering quality gates](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/tools/web-read/pipeline.ts)

[^c5bf53b5fd72fdde]: [TypeSafe citation support checking cookbook](https://docs.typesafe.ai/cookbooks/citation_check.md)

[^c009c52dc6e09d43]: [llame accepted reasoning-effort contract](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/available-models/spec.md)

[^35816d44c221fdd1]: [llame native kb mutation execution](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/tools/native-files.ts)

[^6834bc3ae2929531]: [llame current permission decision outcomes](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/tools/permissions/types.ts)
