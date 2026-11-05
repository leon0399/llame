---
type: Research
title: "The decision-model landscape: an open, self-hostable model class"
description: "Decision models as one model class with many hosted members, open-weight releases, wrappers and local serving options, their licences and measured limits, and the provider-neutral decision lane llame would need to use any of them."
tags:
  [
    decision-models,
    system-one,
    jev,
    d1,
    open-weights,
    self-hosting,
    egress,
    calibration,
    rerank,
  ]
status: draft
generated: { by: "omp/claude-opus-5-5", at: "2026-11-05" }
sources:
  - id: liquid-d1
    resource: "https://docs.liquid.ai/lfm/models/d1"
    title: "Liquid API hosted d1: models, request and response shape, pricing, image token usage (live page, no version identifier; read 2026-11-05)"
  - id: liquid-dm
    resource: "https://docs.liquid.ai/lfm/models/decision-models"
    title: "Liquid AI decision models overview: primitives, d1 family, typed answers, runtimes (live page, no version identifier; read 2026-11-05)"
  - id: liquid-d1-3b
    resource: "https://huggingface.co/LiquidAI/d1-3B/blob/051bcc464b01b9f92942b364d9586b0ef5912432/README.md"
    title: "d1-3B model card at 051bcc4: Decision Index 0.2.1 table, latency tables, licence name"
  - id: liquid-d1-omni-600m
    resource: "https://huggingface.co/LiquidAI/d1-omni-600M/blob/02b55d7076f15129e59ab3f94783f32c4b088674/README.md"
    title: "d1-omni-600M model card at 02b55d7: modalities, context, Decision Index 0.2.1 row"
  - id: liquid-blog-d1-open
    resource: "https://www.liquid.ai/blog/d1-open"
    title: "Liquid AI: Open d1, edge decision models for text, vision and audio (dated 2026-10-07)"
  - id: lfm-license
    resource: "https://huggingface.co/LiquidAI/d1-3B/blob/051bcc464b01b9f92942b364d9586b0ef5912432/LICENSE"
    title: "LFM Open License v1.0 full text at 051bcc4"
  - id: lfm-license-guide
    resource: "https://docs.liquid.ai/lfm/help/model-license.md"
    title: "LFM Open License v1.0 user guide: commercial threshold, research use, distribution duties (live page, last updated 2026-10-15)"
  - id: decido
    resource: "https://huggingface.co/decido-ai/decido-26b-a4b/blob/118ca197a7331f33585aa61709e5fe347fa291a6/README.md"
    title: "decido-26b-a4b model card at 118ca19: Apache-2.0 GGUF, CPU serving, six-group benchmark and its caveat"
  - id: openjev
    resource: "https://huggingface.co/openjev/openjev/blob/b4a89f5884f3482a5e894b2e7ff01db8ea033726/README.md"
    title: "OpenJev model card at b4a89f5: Jev-compatible wire, 10,000-question comparison, quantized builds, CC BY-NC 4.0 weights"
  - id: jevbench-alt
    resource: "https://benchmarkheaven.com/jev-models/alternatives"
    title: "JevBench v1.8.7 alternatives board: 338 models measured, 217 open-weight systems ranked, method v1.7 (board published 2026-11-03; read 2026-11-05)"
  - id: decision-index
    resource: "https://huggingface.co/spaces/multimodalart/jev-decision-index"
    title: "Jev Decision Index leaderboard space and its model list (live page, no version identifier; read 2026-11-05)"
  - id: anyjev
    resource: "https://github.com/nokia-applied-research/AnyJev/blob/35311c58955716cb8955ce1368a665988bc63735/README.md"
    title: "AnyJev README at 35311c5: training-free L0 readout, rotation budget, self-distilled Tacit checkpoints, Decision Index placements"
  - id: reflex
    resource: "https://github.com/kshetrajna12/reflex/blob/231f896d818a62b94fec305ed553df1088486dcb/README.md"
    title: "reflex README at 231f896: frozen-backbone readout, /v1/systemone server, negative fine-tuning results, official JevBench placement"
  - id: system-one-open
    resource: "https://github.com/mithalouni/system-one-open/blob/77f1f7cccf8aa752e0ed7edcc8d2094bac707bdc/README.md"
    title: "system-one-open README at 77f1f7c: trained replica on Gemma 4 E2B and Gemma 3 270M, TypeSafe eval comparison"
  - id: unsloth-head
    resource: "https://huggingface.co/SnowGemma/Qwen3.5-0.8B-Typed-Decisions/blob/1746874469d7535c90dd01181d010e514b7e5585/README.md"
    title: "Qwen3.5-0.8B Typed Decisions model card at 1746874: Unsloth QLoRA with a Clef-style joint decision head, trainer-reported metrics"
  - id: arize
    resource: "https://arize.com/blog/decision-model-benchmark/"
    title: "Arize: decision model benchmark of eight models across three tasks, published 2026-10-07"
  - id: ddods-rag
    resource: "https://blog.dailydoseofds.com/p/rag-vs-jev-rag-clearly-explained"
    title: "Daily Dose of Data Science: RAG vs Jev + RAG, ranking and answerability as different questions (dated 2026-10-08)"
  - id: ddods-build
    resource: "https://blog.dailydoseofds.com/p/build-a-jev-powered-agentic-rag"
    title: "Daily Dose of Data Science: Build a Jev-powered Agentic RAG, sponsored build tutorial with d1-3B gate versus a BGE reranker (dated 2026-10-22)"
  - id: bbgo
    resource: "https://blog.bytebytego.com/p/ep230-rag-vs-agentic-rag"
    title: "ByteByteGo EP230: RAG versus agentic RAG, iterative tool retrieval with sufficiency checks (dated 2026-10-24)"
  - id: decision-apis
    resource: "./2026-10-08-decision-apis.md"
    title: "Decision APIs: OpenAI /v1/decisions, decisionapi.net, egress and authorization cautions"
  - id: jev-report
    resource: "./2026-09-23-system-one-jev/report.md"
    title: "System One and Jev report: primitives, calibration evidence, OMP JUDGE, applications U1-U6"
  - id: objective-rerank
    resource: "./2026-11-02-objective-rerank-engine.md"
    title: "Objective-ranked results with offloaded artifacts: stage-2 backends, egress and accounting"
  - id: extraction
    resource: "./2026-10-27-system-one-extraction.md"
    title: "System One extraction models: Clairic and the decision-gated RAG prerequisites"
  - id: vision
    resource: "https://github.com/leon0399/llame/blob/8efba5ac06d2/VISION.md"
    title: "llame VISION.md at 8efba5ac06d2: explicit deferrals and standalone operation on user-configured providers"
  - id: available-models
    resource: "https://github.com/leon0399/llame/blob/8efba5ac06d2/openspec/specs/available-models/spec.md"
    title: "available-models spec at 8efba5ac06d2: provider types, per-provider baseUrl, unknown type is an internal error"
  - id: usage-accounting
    resource: "https://github.com/leon0399/llame/blob/8efba5ac06d2/openspec/specs/run-usage-accounting/spec.md"
    title: "run-usage-accounting spec at 8efba5ac06d2: what the message usage aggregate covers and excludes"
  - id: issue-1521
    resource: "https://github.com/leon0399/llame/issues/1521"
    title: "#1521 Objective-ranked grep: kernel and stage 1"
  - id: issue-1433
    resource: "https://github.com/leon0399/llame/issues/1433"
    title: "#1433 web_search objective ranking over a wider candidate set"
---

# The decision-model landscape

Noncanonical research. `openspec/specs` and `SPEC.md` win any disagreement.
Statements marked `[INFERENCE]` are reasoning, not a source claim. Vendor
numbers, vendor benchmark tables and vendor latency figures are vendor claims;
none was reproduced here. Benchmark dates and board versions are given where a
number is not stable over time.

## Question

llame's earlier notes treated the typed-judgment "decision model" as one hosted
vendor, TypeSafe's Jev, and drew two conclusions from that framing: every call
ships its state to a provider, and running open weights needs the
[VISION](../../../VISION.md) deferral of local inference runtimes lifted
([R1](./2026-10-08-decision-apis.md), prerequisite 3 in
[System One extraction](./2026-10-27-system-one-extraction.md)). This note asks
what the class actually contains, who ships members of it, what each member
costs and permits, and what llame would have to build to use any of them.

## Findings

### F1. One class, one interface

A decision model takes a **state** (text, JSON, images, and on some members
audio) and a set of **typed questions**, and returns a probability for every
listed answer in one forward pass, with **zero generated tokens**.[^liquid-dm][^liquid-d1-3b]

- The primitives are `noul` (P(yes)), `choice` (distribution over named
  options plus a `confidence`) and `score` (probability-weighted position over
  2-10 ordered levels plus a distribution and a legend).[^liquid-d1-3b][^decision-apis]
- Questions carry `type`, `instructions` and optional `criteria`; answers
  repeat their `type`. Model cards and runtimes call this the **Decision Index
  schema**.[^liquid-d1-3b][^unsloth-head]
- Questions in one request are independent. They share the state and cannot
  read each other's answers, so a dependent decision needs code between
  calls.[^liquid-d1-3b][^jev-report]
- `usage.output_tokens` is always `0`; billing is input tokens only, and each
  question is billed with its own text and all supplied images.[^liquid-d1][^liquid-d1-3b]

Names differ by provider for the same thing: OpenAI's `predicate` is the
`noul` question, `input` is the `state`, and an array of questions replaces the
keyed map.[^decision-apis]

The class cannot explain itself, write text, or reason step by step on request.
Typed answers constrain the answer space, not the truth of the answer.[^jev-report]

### F2. Hosted members are one access mode, not the class

| Member            | Wire                      | Price (vendor)                  | Weights |
| ----------------- | ------------------------- | ------------------------------- | ------- |
| TypeSafe Jev      | `/v1/systemone`           | $0.042 per M input, output free | closed  |
| Liquid `d1.1`     | `/decisions/v1/systemone` | input tokens only               | closed  |
| Liquid `d1-ultra` | same endpoint             | input tokens only               | closed  |
| OpenAI Decisions  | `/v1/decisions`           | $0.10 per M input               | closed  |

Jev's wire, primitives and documented limits are covered by the
[System One report](./2026-09-23-system-one-jev/report.md); OpenAI's endpoint,
the decisionapi.net gateway and OpenRouter's `/api/alpha/decisions` by
[Decision APIs](./2026-10-08-decision-apis.md).[^jev-report][^decision-apis]

Liquid's hosted ids are `d1.1` (default) and `d1-ultra` ("most capable, built on
a larger open-weight model"); the earlier `d1` and `d1-ultra` are also resold
on OpenRouter and Vercel AI Gateway.[^liquid-d1] The page that documents them
lists five d1 members in the same table — `d1-2B`, `d1-omni-2B`,
`d1-omni-600M` under open weights, `d1.1` and `d1-ultra` under the API — with
one primitive set and one answer shape across all five.[^liquid-dm]

`[INFERENCE]` Hosted access is therefore a deployment choice for the same
model class, not a property of it. A provider-neutral lane that speaks the
primitives reaches both a vendor endpoint and the operator's own server without
changing the caller.

### F3. Open weights cover a wide range of sizes and licences

**Liquid d1 family.**

- **`d1-3B`**: 3.12B parameters, post-trained from `LFM2.5-VL-3B`, SigLIP2
  NaFlex 400M vision encoder, 32,768-token context, text/JSON/images. It scores
  **48.57** on Decision Index 0.2.1 (Knowledge 23.8, Language 56.4, Retrieval
  52.8, Tools 74.5, Arts 36.3) against Winnow-12B's 50.02 and Decider
  35B-A3B's 47.11. Liquid scored it with the official scorer; the other rows
  come from leaderboard v0.2.1.[^liquid-d1-3b]
- **Latency**, warm, one request at a time, median of 20 runs: 8 ms for one
  question on an RTX 4090, 9 ms on an MI325X, 30 ms on an Apple M5 Pro; a
  3.4k-token state takes 102 ms on the 4090 and 640 ms on the M5 Pro; 64 packed
  states reach 475/s and 1,106/s on the two GPUs. `model.compile` runs single
  questions as CUDA graphs, and a new shape pays kernel selection or
  compilation on its first call.[^liquid-d1-3b][^liquid-blog-d1-open]
- **`d1-omni-600M`**: 587M parameters (381M trunk and decision head, 94M vision
  encoder, 112M audio encoder), 16,384-token context, text with up to 30 s of
  speech or with images, Decision Index 0.2.1 **15.95**. Liquid calls it an
  experimental checkpoint under active development. Text answers are calibrated
  with per-type temperatures from `config.json`; image and audio answers are the
  trained softmax.[^liquid-d1-omni-600m][^liquid-blog-d1-open]
- The docs' current recommended member is **`d1-2B`** (1.9B, built on
  `LFM3-VL-2B`), with `d1-omni-2B` (2.2B) for audio; typed answers (`text`,
  `number`, `date`, `box`, `boxes`, estimates) run in Transformers, while
  llama.cpp supports only `noul`, `choice` and `score`.[^liquid-dm]

**Licence.** Both open-weight cards read here declare `license_name: lfm1.0`,
and the docs name that licence the LFM Open License.[^liquid-d1-3b][^liquid-d1-omni-600m][^liquid-dm]
What the text actually permits:

- **Commercial use is free below a revenue threshold.** Grants under the
  copyright and patent sections are conditioned on the licensee's legal entity
  not reaching the "Threshold", defined as annual revenue of **$10,000,000 or
  more**; at or above it, commercial use of the model or a derivative is **not
  licensed** by this licence.[^lfm-license]
- **No copyleft.** Modifications may stay closed and may carry the modifier's
  own terms, provided use of the original still complies.[^lfm-license]
- **Redistribution duties:** include a copy of the licence, cause modified files
  to carry prominent change notices, retain copyright, patent, trademark and
  attribution notices, and include a readable copy of `NOTICE` attributions when
  the Work ships one.[^lfm-license]
- **Research and non-commercial use** is not revenue-limited; qualified
  non-profits are exempt from the threshold for non-commercial or research
  purposes.[^lfm-license][^lfm-license-guide]
- **Termination:** automatic and immediate on any non-compliance, with a duty to
  stop use and delete copies. The licence is otherwise Apache 2.0 with the
  commercial-use section, the definitional additions and the termination clause
  as its differences.[^lfm-license][^lfm-license-guide]

`[INFERENCE]` For a self-hosted single-operator deployment below the threshold
this is a permissive licence. It is not OSI-open, and an operator above the
threshold needs a commercial agreement before running it in production.

**Other open-weight members.**

- **`decido-26b-a4b`**: an Apache-2.0 LoRA fine-tune of Gemma 4 26B-A4B shipped
  as a Q8_0 GGUF of 26.9 GB for stock llama.cpp, about 30 GB RAM, CPU-only p50
  4.14 s for a ~1k-token state with five questions on an M4 Pro. Answers are
  bit-identical across repeated calls, request order and thread count on one
  machine; x86 and Apple Silicon kernels differ on close calls. Its six-group
  mean is 85.38 against Jev 1.13's published 83.85, and the author states the
  margin depends on in-domain train splits (82.04 without them) — read it as
  in-domain supervised, not a general win. Training used no Jev and no Claude
  outputs, and `NOTICE` records data provenance.[^decido]
- **OpenJev**: CC BY-NC 4.0 weights with Apache-2.0 helper and serving code,
  speaking the Jev `/v1/systemone` shape at up to 52 options per question and
  16,384 prompt tokens. On 10,000 held-out text questions it answers 84.0%
  against the hosted Jev API's 85.4%. About 80 ms per short text decision and
  about 210 ms per web decision on one H100 in FP8; separate FP8, MLX and GGUF
  builds each carry their own measured accuracy. Commercial use needs a licence
  by email.[^openjev]
- **Cloudflare Clef** (27B, Apache 2.0) and its Flash variant appear as
  open-weight members on the JevBench board, and Clef was one of three models
  that survived Arize's wording flip (F5).[^jevbench-alt][^arize]

**Census.** JevBench v1.8.7 measures **338 decision models** and ranks **217
open-weight systems**, with Jev 1.13.0 as an unranked reference at 77.1
Capability; hosted APIs get a separate board that includes `d1`, `d1-ultra`,
Jev 1.14.0, OpenAI Decisions, `openjev-sglang` and `system-one-open`.[^jevbench-alt]
The Jev Decision Index space lists members by name across many backbone
families, from 17M-parameter encoders to 35B mixture-of-experts models.[^decision-index]
Its method has limits worth naming before quoting a rank:

- Self-hosted latency is measured over loopback on the evaluator's own hardware,
  and the ranking and its cost figures apply a `2× + 150 ms` network estimate on
  top.[^jevbench-alt]
- Some rows are paid fast-lane evaluations, some are marked not eligible, and
  rows outside the cost and latency caps carry no Capability rank.[^jevbench-alt]
- Wrappers and subsidised listings are excluded from the ranking, and the
  publisher sells a related hosted-API comparison through the same page.[^jevbench-alt]

`[INFERENCE]` The board is a useful census of who ships what, and a weak
authority on which member is best for a given task.

### F4. Wrappers and re-creations split the class into weights plus readout

- **AnyJev** turns any open causal LM into a typed decision model with **no
  training**. Its L0 readout reads a K-option choice once per rotation of the
  option order and averages, which removes order sensitivity and label priors:
  on Qwen3-8B and BANKING77-20 the order-flip rate falls 0.230 → 0.073, accuracy
  rises 0.747 → 0.803, ECE falls 0.240 → 0.184, and the share of decisions
  auto-decidable at 5% error rises 7.7% → 46.3%. A rotation budget stops early
  against its own full-cycle answer at a label-free threshold. The same project
  ships self-distilled Tacit checkpoints from 1.7B to 9B with a capped adaptive
  escalation to reasoning, and its training-free readout on unchanged Gemma-4-31B
  scored 60.22 on Decision Index 0.3, 5th of 149 entries on 2026-10-12.
  Apache-2.0.[^anyjev]
- **reflex** serves a frozen Qwen3.5-4B behind `POST /v1/systemone` at about
  200 ms, using a lettered yes/no readout, Evidence/Criterion framing and the
  average of two option orders. Its official JevBench v1.2 run placed an earlier
  LoRA configuration of the 4B #5 of 36 at 71.7. Every fine-tuning attempt it
  reports — four LoRA mixes, distillation from a 27B teacher, GEPA prompt search,
  wording ensembles, more than two option orders, a reasoning cascade — lost
  general judgement on long or ambiguous inputs, so what ships is the untrained
  model with a better readout. MIT.[^reflex]
- **system-one-open** is a trained replica on Gemma 4 E2B with an attention LoRA
  and Gemma 3 270M, served from Modal with the Jev-shaped primitives and 52
  options per pass. It reaches 76.7% against Jev's 86.9% on TypeSafe's public
  eval strict common subset (343 pairs). MIT.[^system-one-open]
- **Unsloth-trained heads** are the smallest path: a Qwen3.5-0.8B backbone with a
  newly initialised Clef-style joint decision head, QLoRA over a synthetic typed
  decisions dataset in about an hour on an Apple M4 Pro at 3.1 GB reported peak
  memory. The card records held-out accuracy 0.355 → 0.780 and ECE 0.0289 →
  0.0208 as saved by the training application, not independently reproduced, and
  warns that a normal text-generation pipeline does not execute the decision
  head. Apache-2.0.[^unsloth-head]

`[INFERENCE]` These results make "decision model" a property of a readout over
weights, not a vendor product: a frozen model plus a rotation-averaged label
readout reaches within a few points of a trained member at 4B, and training only
helps when the evaluation is shaped like the training data.[^reflex][^anyjev]

### F5. Independent comparison: close on accuracy, brittle on wording

Arize ran eight models through three tasks in a knockout: hallucination
detection on 2,675 RAGTruth rows, the 13 Phoenix evaluator suites (655 labelled
cases), and 52 agent routing decisions, with hosted models called over the
network and open models run on one MacBook Pro (M4 Max, 36 GB).[^arize]

- Accuracy separated almost nothing. Jev scored 85.5% / 91.1% / 49-of-52,
  Clef 27B 85.2% / 91.5% / 50-of-52, Liquid d1 84.8% / 87.6% / 48-of-52 and
  OpenAI 81.5% / 90.0% / 48-of-52, with overlapping confidence intervals in most
  matches. The cloud final between Jev and Liquid d1 was declared a draw, and Kev
  won the local final on speed after an accuracy and cost draw.[^arize]
- The gap it did find is **question polarity**. Re-asking the hallucination
  question in the opposite phrasing dropped ROC AUC from 0.92 to **0.17** for
  Liquid d1, 0.85 → 0.25 for Jeeves, 0.75 → 0.26 for Strands Decider and
  0.85 → 0.54 for Kev, while Jev, Clef and OpenAI held their scores.[^arize]
- Caveats the post states or that its method implies: OpenAI's cases were
  written as labelled text sections by Arize because its API takes one text
  block; 52 routing cases make one answer worth about two points; local
  latencies come from one laptop and are not comparable with network timings;
  it is one day, one harness and one cutoff procedure.[^arize]

`[INFERENCE]` The transferable result is procedural: a thresholded gate must be
tested on both phrasings of its question before it may act, because a model can
answer the opposite question confidently rather than fail.

### F6. Ranking and answerability are different questions

- A reranker orders candidates. A decision model can judge **each** candidate
  against a typed question and then judge whether the surviving evidence is
  sufficient, which lets the application skip generation entirely. Retrieval
  still sets the ceiling, because a decision model cannot recover a passage that
  never entered the candidate set.[^ddods-rag]
- The worked build puts `d1-3B` in that role: score each candidate for relevance
  and answerability, keep thresholds in a table so they change without code,
  retry once with a wider search, open a ticket instead of calling the generator
  when nothing passes, and log every decision.[^ddods-build]
- On 75 labelled questions across four cases (answerable from text, answerable
  only from screenshots, question carries a screenshot, should escalate) the
  decision gate had the highest accuracy and was the only pipeline that held full
  performance on image-only questions; a BGE reranker avoided wrong answers but
  escalated most image questions.[^ddods-build]

Evidence weight: the build post is a **sponsored tutorial** (InsForge backend,
Lightning AI hosting), its result table is published as an image, and no
per-case counts, seeds or repeats are given. Treat it as a demonstration that
the pattern is buildable, not as a measurement that transfers.[^ddods-build]

Agentic RAG as commonly described is exactly this loop: pick tools, fetch,
check whether the evidence is sufficient, and adjust the search or the tool
until it is.[^bbgo] llame's tool loop already has the shape; what it lacks is a
cheap, calibrated sufficiency judgment inside it.

### F7. What each serving mode asks of llame

`[INFERENCE]` throughout this table; the sources of each cell are the member
entries above and the egress cautions in
[Decision APIs](./2026-10-08-decision-apis.md).

| Mode                                                                                      | Data egress                                                              | Latency source                                                                                  | Licence                                                           | What llame must build                                                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Hosted decision API (Jev, Liquid `d1.1`/`d1-ultra`, OpenAI, OpenRouter)                   | The state leaves the host for a named third party                        | Provider network; 0.08 s (Jev), 0.16 s (OpenAI), 0.20 s (Liquid d1) per decision in Arize's run | Provider terms; weights closed                                    | A decisions client on a new provider `type`, an owner declaration for the data classes it may see, accounting       |
| Operator-run open weights behind an endpoint (`/v1/systemone`, vLLM shim, llama.cpp GGUF) | None off the host; the request goes where the operator pointed `baseUrl` | Operator hardware: 8 ms `d1-3B` on a 4090, 30 ms on an M5 Pro, 4.1 s `decido` on a CPU          | LFM Open License v1.0 revenue threshold; Apache-2.0; CC BY-NC 4.0 | The same client plus the System One request shape; no runtime, no download, no process supervision                  |
| Wrapper over an already-configured provider (AnyJev L0, reflex readout)                   | Whatever that provider already receives for a normal request             | N forward passes per decision; about 200 ms for a 4B on one GPU                                 | Wrapper Apache-2.0 or MIT, plus the model's licence               | Reads label logits, so it needs a provider that returns token logprobs or a local runtime; rotation multiplies cost |
| Hosted cross-encoder reranker (incumbent stage 2)                                         | Passages leave the host                                                  | Tens of milliseconds, provider-reported                                                         | Model terms                                                       | Nothing new: already scoped by the ranking study                                                                    |

A decision backend cannot be smuggled into the existing model client. Each
executable provider `type` maps to exactly one client and an unrecognised type
is an internal error, not a silent fallback, so a decision lane is a **new
provider type**, not a variant of chat.[^available-models]

### F8. VISION boundary: an operator-run endpoint is not a bundled runtime

VISION's explicit deferrals include "bundled, downloaded, or llame-managed
local inference runtimes", and VISION defers them rather than rejecting
them.[^vision] The nearby horizon describes standalone personal operation that
works "using user-configured inference providers".[^vision]

`[INFERENCE]` An operator-run decision model behind an endpoint is outside that
deferral for the same reason every other operator-configured provider is inside
the current architecture: llame resolves a run to a provider entry and speaks
that entry's `type` at that entry's `key`/`baseUrl`, including a `baseUrl` that
names a local or third-party server serving the expected wire.[^available-models]
llame does not fetch weights, install a runtime, launch or supervise a server,
allocate GPU memory, or pick a model on the operator's behalf. It opens a socket
to an endpoint the operator chose, configured and is responsible for — which is
what it already does for an Ollama-declared provider.

`[INFERENCE]` The inside of the deferral is the packaging, not the protocol:
shipping weights with the product, downloading a checkpoint at install,
auto-selecting a member or a quantisation from the operator's hardware, or
managing a local server's lifecycle. A bundled decision model would need that
review; calling an endpoint would not.

Prerequisite 3 in [System One extraction](./2026-10-27-system-one-extraction.md) follows this rule:
open weights remove the egress only when an operator runs them, and the work
that remains for llame is a decisions client and a provider entry, not a
deferral review.[^extraction]

### F9. One provider-neutral decision lane

Contract: a state plus typed questions in; per-question probabilities, usage and
status out. The lane owns the wire, the bounds and the accounting; the caller
owns the question, the threshold and every effect.

- **Status.** `answered | refused | unavailable`. A refusal is not an error, and
  a transport failure resolves to the caller's safe default — never to "allow",
  "sufficient" or "rank first".[^decision-apis]
- **Usage.** Input tokens per question, including image tokens, with output
  always zero.[^liquid-d1] Side calls are unaccounted today: the message usage
  aggregate covers model requests of the attempt and explicitly excludes
  compaction and title generation, so a decision call needs its own accounted
  line rather than being folded into it.[^usage-accounting]
- **No text, no ids invented.** The lane returns probabilities and an answer
  index over the options the caller supplied; a member that returns text (typed
  `text` answers) is a different contract and out of scope for the ranking and
  gating consumers below.[^liquid-dm]

Consumers, by the strength of the evidence behind them:

1. **Ranking kernel stage 2** ([#1521](https://github.com/leon0399/llame/issues/1521)).[^issue-1521]
   Stage 1 stays local and free: the judge only sees the findings retrieval
   already returned, so a model ranker improves the order of a bounded candidate
   set and cannot improve recall.[^ddods-rag] Stage 2's backends now include
   three kinds of judge rather than one: a hosted cross-encoder, an
   operator-run decision model with no egress, and a wrapper over an
   already-configured provider.[^objective-rerank]
2. **`web_search` ranking** ([#1433](https://github.com/leon0399/llame/issues/1433)),
   which already plans a wider candidate set for the same kernel.[^issue-1433]
3. **Recall relevance** (U1 in the Jev report, A1 in Decision APIs): a
   question-conditioned `noul` per candidate.[^jev-report][^decision-apis]
4. **Answerability and sufficiency gates** — the newest and least validated use.
   Three conditions come from the evidence: tune thresholds on questions that
   are genuinely unanswerable, test both phrasings of the question, and record
   the threshold values with each attempt.[^ddods-rag][^ddods-build][^arize]

`[INFERENCE]` A gate is where an operator-run member pays for itself: it runs on
every retrieval, it sees private text, and an 8 ms GPU decision replaces a
generation call. A ranking judge runs once per search and can wait.

Costs to state plainly rather than hide:

- A local member is not free of a loop: latency multiplies by the number of
  questions and calls, and a 3.4k-token state is 102 ms on a 4090 and 640 ms on
  an M5 Pro, not 8 ms.[^liquid-d1-3b]
- Hosted members sit within a factor of about 2.5 of each other on list price
  ($0.042, $0.04 and $0.10 per million input tokens), so cost is a token-count
  and question-count question, not a vendor question.[^jev-report][^liquid-d1][^arize]
- Every card says to calibrate on your own data; per-task calibration is the work,
  and calibration error varies more than accuracy between members.[^arize][^liquid-dm]

### F10. Data classes

Existing llame practice gates disclosure per setting and per destination, for
example `shareRecentChats` for recency digests, and search results never expose
their scores to the model
(`openspec/specs/chat-search/spec.md`).[^objective-rerank]

`[INFERENCE]` The same shape applies here, with one new case:

- A **hosted** member is a third party and needs an explicit declaration naming
  the data classes it may receive, checked before the request, in the same
  pattern as the existing disclosure settings.[^decision-apis]
- An **operator-run** member sends nothing off the host. The declaration then
  describes the operator's own trust boundary rather than a vendor's, and the
  model must not be treated as an egress destination in the permission
  projection.[^vision]
- A **wrapper** inherits the egress of the provider it wraps: if that provider
  may not see chat text, neither may the wrapper.

### F11. Live probe: one request shape answers on every hosted route

A throwaway script (not committed) sent one state with three `noul`, one
`choice` and one `score` question to each route on 2026-11-05, with the keys
in the operator's environment. Every route that answered used the System One
request shape verbatim and returned the same answer envelope.

| Route                                             | Model id sent          | Model id served              | HTTP | Latency                               | `usage`                                                              |
| ------------------------------------------------- | ---------------------- | ---------------------------- | ---- | ------------------------------------- | -------------------------------------------------------------------- |
| OpenRouter `POST /api/v1/systemone`               | `typesafe/jev-1.14`    | `typesafe/jev-1.14-20261014` | 200  | 600 ms (first call), 245–290 ms after | `input_tokens` 514, `output_tokens` 104, `cost` 0.000021588          |
| OpenRouter `POST /api/v1/systemone`               | `~typesafe/jev-latest` | `typesafe/jev-1.14-20261014` | 200  | 261 ms                                | same                                                                 |
| OpenRouter `POST /api/alpha/decisions`            | `typesafe/jev-1.14`    | `typesafe/jev-1.14-20261014` | 200  | 245 ms                                | same, plus `id` and `provider: "TypeSafe"`                           |
| OpenRouter `POST /api/v1/systemone`               | `typesafe/jev-1.13`    | `typesafe/jev-1.13-20260917` | 200  | 290 ms                                | same                                                                 |
| OpenCode `POST /zen/v1/systemone`                 | `jev-1.13`             | `jev-1.13`                   | 200  | 223 ms                                | same tokens; `cost` 0.00002159, `opencode.billing_source: "balance"` |
| OpenCode `POST /inference/systemone/v1/systemone` | `jev-1.13-free`        | `jev-1.13-free`              | 200  | 340 ms                                | `cost` 0, `opencode.billing_source: "free"`                          |

The `cost` field matches $0.042 per million input tokens with free output on
both gateways. An OpenRouter key with a $0 spending limit answers 403
`key_limit` on every route; the error names the key hash and `limit_usd`.
The served `model` carries the pinned revision, so an alias such as
`~typesafe/jev-latest` resolves to a dated id in the response and a receipt
can record it. Calibration looked stable across revisions on this one state:
the two relevant candidates scored 0.86–0.91 and the unrelated one 0.01 on
every route, while `choice` confidence varied between 0.30 and 0.44.
`[INFERENCE]` One codec and a per-entry `baseUrl` therefore cover TypeSafe,
OpenRouter and OpenCode; that settles Q1 for an implementation.

## Open decisions

- **Q1. Which wire is canonical?** The System One shape (`state` plus a keyed
  question map) is spoken by Jev, OpenJev, reflex and Liquid's hosted models;
  OpenAI's `/v1/decisions` renames the fields and arrays the questions. One
  client that speaks the System One shape and adapts per provider entry is the
  smaller build; a provider `type` per wire is the more honest
  one.[^openjev][^reflex][^decision-apis]
- **Q2. Does a decision call join the message usage aggregate?** The aggregate is
  defined as the model requests of an attempt and excludes compaction and title
  generation; a decision call is neither a chat request nor housekeeping, so it
  likely needs its own ledger entry plus a visible cost line.[^usage-accounting]
- **Q3. Does the gate ship before the ranker?** The measure-me-first rule the
  ranking study sets applies with more force to gates, where a wrong threshold
  suppresses answers rather than reordering them.[^objective-rerank]
- **Q4. Which member is the default self-hosted one?** `d1-3B` at 8 ms on a GPU
  and a permissive-under-threshold licence, an Apache-2.0 26B GGUF that runs on
  a CPU in seconds, or a wrapper over whatever the operator already serves. The
  answer follows from the hardware the lane's first consumer runs on, not from a
  leaderboard.[^liquid-d1-3b][^decido][^anyjev]

## Sources

[^liquid-d1]: [Liquid API hosted d1](https://docs.liquid.ai/lfm/models/d1)

[^liquid-dm]: [Liquid AI decision models overview](https://docs.liquid.ai/lfm/models/decision-models)

[^liquid-d1-3b]: [d1-3B model card at 051bcc4](https://huggingface.co/LiquidAI/d1-3B/blob/051bcc464b01b9f92942b364d9586b0ef5912432/README.md)

[^liquid-d1-omni-600m]: [d1-omni-600M model card at 02b55d7](https://huggingface.co/LiquidAI/d1-omni-600M/blob/02b55d7076f15129e59ab3f94783f32c4b088674/README.md)

[^liquid-blog-d1-open]: [Liquid AI: Open d1](https://www.liquid.ai/blog/d1-open)

[^lfm-license]: [LFM Open License v1.0 full text](https://huggingface.co/LiquidAI/d1-3B/blob/051bcc464b01b9f92942b364d9586b0ef5912432/LICENSE)

[^lfm-license-guide]: [LFM Open License v1.0 user guide](https://docs.liquid.ai/lfm/help/model-license.md)

[^decido]: [decido-26b-a4b model card at 118ca19](https://huggingface.co/decido-ai/decido-26b-a4b/blob/118ca197a7331f33585aa61709e5fe347fa291a6/README.md)

[^openjev]: [OpenJev model card at b4a89f5](https://huggingface.co/openjev/openjev/blob/b4a89f5884f3482a5e894b2e7ff01db8ea033726/README.md)

[^jevbench-alt]: [JevBench v1.8.7 alternatives board](https://benchmarkheaven.com/jev-models/alternatives)

[^decision-index]: [Jev Decision Index leaderboard](https://huggingface.co/spaces/multimodalart/jev-decision-index)

[^anyjev]: [AnyJev README at 35311c5](https://github.com/nokia-applied-research/AnyJev/blob/35311c58955716cb8955ce1368a665988bc63735/README.md)

[^reflex]: [reflex README at 231f896](https://github.com/kshetrajna12/reflex/blob/231f896d818a62b94fec305ed553df1088486dcb/README.md)

[^system-one-open]: [system-one-open README at 77f1f7c](https://github.com/mithalouni/system-one-open/blob/77f1f7cccf8aa752e0ed7edcc8d2094bac707bdc/README.md)

[^unsloth-head]: [Qwen3.5-0.8B Typed Decisions model card at 1746874](https://huggingface.co/SnowGemma/Qwen3.5-0.8B-Typed-Decisions/blob/1746874469d7535c90dd01181d010e514b7e5585/README.md)

[^arize]: [Arize: decision model benchmark](https://arize.com/blog/decision-model-benchmark/)

[^ddods-rag]: [RAG vs Jev + RAG](https://blog.dailydoseofds.com/p/rag-vs-jev-rag-clearly-explained)

[^ddods-build]: [Build a Jev-powered Agentic RAG](https://blog.dailydoseofds.com/p/build-a-jev-powered-agentic-rag)

[^bbgo]: [ByteByteGo EP230: RAG vs Agentic RAG](https://blog.bytebytego.com/p/ep230-rag-vs-agentic-rag)

[^decision-apis]: [Decision APIs](./2026-10-08-decision-apis.md)

[^jev-report]: [System One and Jev report](./2026-09-23-system-one-jev/report.md)

[^objective-rerank]: [Objective-ranked results with offloaded artifacts](./2026-11-02-objective-rerank-engine.md)

[^extraction]: [System One extraction models](./2026-10-27-system-one-extraction.md)

[^vision]: [llame VISION.md at 8efba5ac06d2](https://github.com/leon0399/llame/blob/8efba5ac06d2/VISION.md)

[^available-models]: [available-models spec at 8efba5ac06d2](https://github.com/leon0399/llame/blob/8efba5ac06d2/openspec/specs/available-models/spec.md)

[^usage-accounting]: [run-usage-accounting spec at 8efba5ac06d2](https://github.com/leon0399/llame/blob/8efba5ac06d2/openspec/specs/run-usage-accounting/spec.md)

[^issue-1521]: [#1521 Objective-ranked grep: kernel and stage 1](https://github.com/leon0399/llame/issues/1521)

[^issue-1433]: [#1433 web_search objective ranking](https://github.com/leon0399/llame/issues/1433)
