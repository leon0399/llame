---
type: Research
title: "Semantic find, jegrep and the JUDGE role"
description: "Source-level retrieval and typed-judgment analysis, reference benchmark audit, executable mechanics and llame applications beyond Knowledge search."
tags: [semantic-search, find, jegrep, jev, judgment, retrieval]
status: stable
canonical: false
generated: { by: omp/openai-codex-gpt-6-astra, at: 2026-09-24T09:48:32Z }
sources:
  - id: "0794414eb48aa348"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/docs/tools/find.md"
    title: "OMP find tool documentation"
  - id: "544f31fd884d939e"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/cascade.ts"
    title: "OMP find cascade implementation"
  - id: "df41d4c158ba669e"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/lexical.ts"
    title: "OMP lexical grep and ranking"
  - id: "76fadc9a4e92a3b3"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/passages.ts"
    title: "OMP passage windows, sketches and range merging"
  - id: "34a46989cf376c63"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/text.ts"
    title: "OMP bounded source reads and text primitives"
  - id: "02cf22f4d4181f58"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/questions.ts"
    title: "OMP three phase judgment request shapes"
  - id: "199f6b071e6b846c"
    resource: "https://docs.typesafe.ai/api.md"
    title: "TypeSafe evaluation API"
  - id: "3b9396096fc7b4f4"
    resource: "https://docs.typesafe.ai/models.md"
    title: "TypeSafe Jev models and limits"
  - id: "64154f4aee021df4"
    resource: "https://docs.typesafe.ai/confidence.md"
    title: "TypeSafe probability and confidence semantics"
  - id: "8292ab9cae884594"
    resource: "./probes/omp-find-result.json"
    title: "Executed OMP source mechanics probe"
  - id: "af2e1934463a3c96"
    resource: "./session-observation.json"
    title: "Single session find observation"
  - id: "d56356fd3f07670a"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/keywords.ts"
    title: "OMP lexical keyword normalization"
  - id: "d4c73524e8a1e175"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/tree.ts"
    title: "OMP eligible file listing"
  - id: "4221361e4882f086"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/index.ts"
    title: "OMP find tool boundary"
  - id: "0e0bebb0a6934582"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/judgment/index.ts"
    title: "OMP judge role routing and usage"
  - id: "b03d33ece1a36dee"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/config/model-registry.ts"
    title: "OMP available-model authentication precheck"
  - id: "066012848c7be74f"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/ai/src/judgment/typesafe.ts"
    title: "OMP native System One client"
  - id: "9d5ca3f68fb608a7"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/ai/src/judgment/text.ts"
    title: "OMP prompted typed judgment bridge"
  - id: "3b853e939c1d5b70"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/ai/src/judgment/chat.ts"
    title: "OMP chat judgment backend"
  - id: "2b365d96c6975590"
    resource: "https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/strategies/cascade.rs"
    title: "jegrep cascade reference implementation"
  - id: "a65094cb5230adfd"
    resource: "https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/questions.rs"
    title: "jegrep filename request formats"
  - id: "daf2c9fa62e30dae"
    resource: "https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/strategies/window.rs"
    title: "jegrep compact passage verification"
  - id: "a799faa8daa4f62c"
    resource: "https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/grep.rs"
    title: "jegrep Unicode keyword normalization"
  - id: "2df88d5e2f7772eb"
    resource: "https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/jev.rs"
    title: "jegrep endpoint and retry policy"
  - id: "e95ce8ae5824464b"
    resource: "https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/strategies/mod.rs"
    title: "jegrep strategy family registry"
  - id: "23e81ada73b98d76"
    resource: "https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/benches/RESULTS.md"
    title: "jegrep reported cascade results"
  - id: "2b6659e65f04c23a"
    resource: "https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/benches/run.py"
    title: "jegrep benchmark scoring and runner"
  - id: "52b275ecc0c07648"
    resource: "./probes/jegrep-metrics-result.json"
    title: "Executed jegrep scorer and evidence inventory"
  - id: "2b5e0f8a055fdc20"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/chat-search/spec.md"
    title: "llame canonical chat retrieval contract"
  - id: "3625dc1afe52ad01"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/knowledge/knowledge-tools.ts"
    title: "llame owner-scoped Knowledge search"
  - id: "8473ecc35456bc61"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/tools/turn-tool-catalog.ts"
    title: "llame deterministic tool catalog admission"
  - id: "64a2fd31fa659970"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/agent-skills/spec.md"
    title: "llame skill eligibility and activation"
  - id: "03aec42edc684f81"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/SPEC.md"
    title: "llame current runtime product boundary"
  - id: "feebba74cfb5ab96"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/models/model-client-factory.ts"
    title: "llame explicit provider transport dispatch"
  - id: "bc1d5b4cc983d594"
    resource: "../2026-09-23-question-directed-read/report.md"
    title: "Question-directed read follow-on research"
  - id: "5738c57ec7674ead"
    resource: "https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/README.md"
    title: "jegrep CLI operation and strategy reference"
  - id: "eff6dfe6e1cc0818"
    resource: "https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/auto-thinking/classifier.ts"
    title: "OMP automatic effort classification consumer"
  - id: "6b3e943cd1fe085f"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/conversation-reads/spec.md"
    title: "llame canonical conversation-read boundary"
  - id: "53bc20bcb6729c65"
    resource: "https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/runs/run-execution.service.ts"
    title: "llame durable Run and tool orchestration"
---

# Semantic find, jegrep and the JUDGE role

Research date: 2026-09-24. Revision: v2. Noncanonical research; no implementation or product-scope approval.

## Executive Summary

OMP `find` is a host-controlled retrieval pipeline, not a small autonomous agent. Deterministic code enumerates sources, computes a lexical prior, constructs bounded candidate representations and schedules three judgment phases. The model returns typed relevance values; host code decides what to read next and which original-source ranges to return. `jegrep` is the standalone Rust reference and a useful strategy laboratory. Neither program supplies a generated answer to the original question. [^544f31fd884d939e][^2b365d96c6975590]

`JUDGE` is OMP's role label. Native Jev/System One inference is one backend, not the definition of that role. The native wire returns probabilities. OMP's ordinary chat/local bridge parses answer words into exactly zero or one, and its fixed thresholds therefore become hard Boolean gates. This distinction explains why automatic `find` enablement requires a native-first role chain. High confidence in the implementation trace; calibration on llame tasks remains unknown. [^0e0bebb0a6934582][^066012848c7be74f][^9d5ca3f68fb608a7]

The reference results support investigating staged retrieval, not copying its defaults as validated llame policy. jegrep reports 37.5% lower estimated API cost across 30 code-search queries while retaining 49/49 labeled file targets and 93/94 regions. Its labels are positive-only, region success needs only an overlap, and the linked raw comparison artifacts are absent from the pinned checkout. These are reported jegrep results, not reproduced OMP or llame results. [^23e81ada73b98d76][^52b275ecc0c07648]

For llame, use the pattern first on an already authorized candidate set: chat evidence, admitted tool descriptors, proactively eligible skill descriptions, selected documents or explicitly granted host files. Keep source authorization, provider egress, budgeting and execution in deterministic code. Add a generative `read?q=` worker only when an answer is needed; use a bounded judge when the output is a selection or classification. The two compose, but they solve different problems. [^2b5e0f8a055fdc20][^8473ecc35456bc61][^64a2fd31fa659970][^bc1d5b4cc983d594]

## Introduction and authority

This is the third layer after [System One/Jev](../2026-09-23-system-one-jev/report.md) and [question-directed reads](../2026-09-23-question-directed-read/report.md). It examines the supplied OMP page, its implementation, and the explicitly requested [jegrep repository](https://github.com/can1357/jegrep). The source pins are OMP `5fccbd0deee820049afa492dc3112272b163126f` and jegrep `e6d5b842e5e88e576c3fcab9e2aa25081cb643af`. llame code references use `e70228485042967fd9545ad0cb133faae1be2268`; existing uncommitted prompts are not treated as shipped contracts. [^0794414eb48aa348][^5738c57ec7674ead][^03aec42edc684f81]

Evidence is separated into inspected source, executed offline mechanics, upstream benchmark reports and recommendations. One ordinary session `find` call was observed during repository exploration; its backend was not exposed. No controlled live relevance benchmark, private-Knowledge query, upstream Rust build or model download was performed. The research does not change an OpenSpec requirement or approve a new tool. [^af2e1934463a3c96][^8292ab9cae884594][^52b275ecc0c07648]

## Main Analysis

### F6 — The host does the search; the judge evaluates bounded candidates

The entry point is `FindTool.execute`, orchestration is `runCascade`, and representations live in `keywords`, `lexical`, `tree`, `text`, `passages` and `questions`. The input is a natural-language query, required `grep_keywords` array and optional directory or `omp://` scope. An extra keyword is a lexical hint, not a hard filter. The ordinary tool fixes hidden files off; the CLI has a hidden-file option. Returned ordinary paths are relative to the session cwd, not the narrowed search directory. [^4221361e4882f086][^0794414eb48aa348]

| Stage                       | Host work                                                                                                                | Model exposure and default bound                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| P1 — Enumerate and index    | Run native file listing and native keyword grep concurrently; no persistent semantic index                               | No model call yet; local scan can touch far more than the eventual 20 content-read candidates           |
| P2 — Rank filenames         | Lexically rank all eligible files; keep 128; split into 64-file batches                                                  | Filename, size, folded tree, project basename, query and rubric; at most two logical requests           |
| P3 — Read and make sketches | Force the two strongest lexical files into a 20-file budget; fill by name score then lexical rank; read up to 4 MiB/file | Keep up to 24 windows/file, each 8 KiB including generated line tags; make 384-byte extractive sketches |
| P4 — Score sketches         | Mix cards across files, 46 per request; score at most 480 cards                                                          | One shared state with file labels and sketches; up to 11 logical requests                               |
| P5 — Verify windows         | Keep sketch scores at least 0.45, then the best 40 globally; group up to three windows from each file                    | Retained source-window text, not only its sketch; at most 26 logical requests under these caps          |
| P6 — Return evidence        | Keep verified ranges at least 0.20; merge touching/overlapping spans; sort strongest first                               | No new generation; show at most three ranges/file, scores and source-derived previews                   |

Each model phase drains with at most 16 requests in flight before the next phase. The exact default upper bound is 39 **logical judgment calls**, not 39 HTTP attempts: 2 filename, 11 sketch and at most 26 verification calls. The last bound accounts for packing 40 passages across at most 20 files, rather than pretending every passage creates its own request. The probe derives this bound independently. Payload labels, questions, paths and rubrics add bytes beyond the nominal 18,000-byte sketch/24 KiB verification grouping arithmetic; those are not hard serialized-request limits. [^544f31fd884d939e][^52b275ecc0c07648]

**Lexical prior.** Query extraction preserves quoted phrases, removes a stopword set, ASCII integers and terms shorter than three UTF-8 bytes, then cheaply stems `ing`, `ed`, `es` and `s`. Explicit keywords are only trimmed/lowercased/deduplicated, so they can rescue a short identifier removed from the query. This is neither a tokenizer trained on the repository nor a language-aware stemmer. Negation removed from the lexical prior remains present in the full semantic query. [^d56356fd3f07670a]

For keyword `k`, the weight is `clamp(ln((filesScanned + 1)/(df[k] + 1)), 0.5, 6)`. A file's score sums `weight[k] * (ln(1 + occurrences[k]) + 2 * pathContains[k])`. Counts come from matching lines; common terms are logarithmically damped and rare terms are bounded. Zero lexical ties fall back to path ordering before the 128-file cutoff. A semantic judge cannot rescue a file that never enters that shortlist. The offline fixture has 151 eligible files, judges 128 names, reads 20 and never shows the late-sorted target to the judge. [^df41d4c158ba669e][^544f31fd884d939e][^8292ab9cae884594]

**Passage routing.** Windows are contiguous source lines. An oversized line is clipped rather than split into additional windows. If every window has zero lexical score, selection spreads across the file; otherwise only the highest-scoring 24 survive. The sketch ranks every nonblank verbatim line by keyword weight plus a 0.1 nudge for call-like lines, fills the byte budget in rank order, trims selected lines, caps each at 180 bytes and restores source order. Keyword-free lines are included; a zero-match window can still produce a sketch. It is an extract, not a model-written summary. Relevant text can disappear at the file, window or sketch stage before verification. [^76fadc9a4e92a3b3][^34a46989cf376c63]

**Evidence, not an answer.** Verification expands a sketch back to its retained window, which can itself be clipped. Only verified windows create result ranges. File relevance is the maximum verified passage score, not an estimate that the whole file answers the query. Adjacent ranges merge with the maximum score and retain the first range's preview; the preview is the first nonblank source line, not a generated explanation or necessarily the line responsible for the strongest score. Exact follow-up `read` remains necessary. [^544f31fd884d939e][^76fadc9a4e92a3b3]

### F7 — What crosses the JUDGE boundary

All three phases call the same `Judge.judge({ state, questions }, { signal })` interface. A question key associates an answer with a candidate. On the native API the map key itself is not an inference input, so OMP's instructions explicitly name the corresponding `e017` or `p00` tag inside the state. There is no model-issued filesystem action and no free-form agent loop. [^02cf22f4d4181f58][^199f6b071e6b846c]

| Phase        | Shared state                                                   | Per-candidate question                                                                                                                       |
| ------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Filename     | `criteria`, tree format, project, search, task, folded tree    | Does the tagged file plausibly contain the requested content?                                                                                |
| Sketch       | `criteria`, file-key/path map, passage-key/sketch map, search  | Could this extract implement a requested step? Favor recall.                                                                                 |
| Verification | `criteria`, one file path, passage-key/source-text map, search | Does this window substantively implement, define or explain an important part? Reject mere mentions, imports, calls, tests or configuration. |

Each is a `noul`: a yes/no probability, not a Choice normalized across candidate files. Multiple candidates may all score highly. The event being judged changes between stages: plausible filename, useful sketch and substantive source window are different predicates. Their numbers are not interchangeable correctness estimates. Questions share the same state, including other candidates; independent answer slots do not prove statistically independent errors or invariance to batch composition. [^02cf22f4d4181f58][^199f6b071e6b846c][^64154f4aee021df4]

**Native transport.** `TypeSafeJudge` posts `{ state, model, questions }` to `/v1/systemone` for API `typesafe`, or `/decisions` under the configured OpenRouter alpha base for API `openrouter-decisions`. It attaches the resolved bearer credential and configured headers. The response supplies model identity, answers and usage. The client checks requested keys and answer types, but not the numeric `noul` range; `find` separately rejects non-finite/out-of-range values. The executed probe captures both routes without network calls and proves that a numeric `2` can pass the native client before the cascade rejects it. [^066012848c7be74f][^8292ab9cae884594]

**Role resolution.** `JUDGE` is a UI tag for the `judge` role. Backend kind follows the model's API: recognized System One API, `local-inference`, or ordinary chat. Native kind therefore denotes the configured protocol, not independent proof of Jev identity or calibration. Once a native candidate occurs, later non-native candidates are removed; explicitly earlier text candidates remain possible. A session-model fallback exists for wholly non-native chains only when the caller supplies one; `find` does not pass `sessionModel`. [^0e0bebb0a6934582][^4221361e4882f086]

`find.enabled:auto` checks whether the first resolved candidate is native. Candidate construction already filters disabled providers and configured credential/keyless availability. This is not a live account-health check: keys can fail to resolve later, OAuth can require refresh and an account can reject billing. Explicit `on` permits non-native judging; `off` disables the tool. The role is not a permission grant or an accepted-provider-egress policy for llame. [^4221361e4882f086][^0e0bebb0a6934582][^b03d33ece1a36dee]

**Prompted and local backends change the contract.** `TextJudge` asks for answer words, then maps a parsed yes/true to `1` and no/false to `0`; Choice/Score similarly become one-hot distributions with confidence `1`. The parser accepts the earliest whole-word label, so the synthetic reply `Not yes, actually no` becomes `1`. These are parser outputs, not calibrated probabilities. At `find`'s 0.45 and 0.20 cutoffs, a successful text verdict is a hard Boolean pass/fail. Batched chat answers are one autoregressive completion, unlike the native provider's claimed parallel question evaluation. [^9d5ca3f68fb608a7][^3b9396096fc7b4f4][^8292ab9cae884594]

The chat backend requests 4,096 output tokens, temperature zero and reasoning suppression, with two format-correction retries; a correction forces a `submit_judgment` tool. The local worker uses 16 output tokens, or 1,024 for a reasoning model, with no scaling by the number of question IDs. Large batched replies therefore need explicit backend-fit evaluation; local execution does not automatically preserve either the native ranking resolution or the capacity of a 64-question filename batch. No local model was run here. [^3b853e939c1d5b70][^0e0bebb0a6934582]

**Cost and service limits.** TypeSafe currently documents `jev-latest` as `jev-1.13.0`, $0.042/M input tokens with output free, 64k total request tokens and a separate 32k `state + longest question` limit. Its published 250k tokens/s and 1,200 requests/min are explicitly dynamic. The model is text-only and English is its strongest language. A stable alias is not an immutable revision; retain the reported model version when evaluating thresholds. No-training terms do not establish blanket zero retention. [^3b9396096fc7b4f4]

### F8 — Failure, coverage and accounting need stronger treatment than a score

**E1 — A scan filter is not authorization.** OMP's listing excludes common build, binary and credential names, but its separate native grep call does not receive that eligibility filter. Matches for paths rejected by the listing affect local scanning and IDF statistics, not the candidate tree, sketches or verification state: the cascade builds candidates from eligible `entries`, not from grep's keys. The probe exercises that JavaScript bridge with an excluded synthetic filename; it does not open a credential file or execute the native scanner. Exact credential names are also case-sensitive: `credentials.json` is excluded, `Credentials.json` is eligible. Ordinary files can contain secrets. A llame port must authorize its corpus before local scanning as well as before provider exposure. [^d4c73524e8a1e175][^df41d4c158ba669e][^544f31fd884d939e][^8292ab9cae884594]

**E2 — Unknown is handled asymmetrically.** Failed or unusable filename judgments remain undefined but rank as `0` when filling the read budget, behind any positive name score; only the two forced lexical leaders are exempt. Failed sketch judgments instead become a routing score of `1`, avoiding an automatic negative, but still compete under the global 40-window cap. In the 80-card fixture, one failed batch still results in only 40 verified windows and 40 pruned cards. Unknown cards can outrank valid 0.9 cards and consume the budget. Failed verification never creates a hit. A one-file verification outage produces zero hits with one error out of three logical calls; the tool's all-failed condition is false, so the output is a no-hit/useless result with a failure footer, not an exhaustive negative. [^544f31fd884d939e][^4221361e4882f086][^8292ab9cae884594]

**E3 — Line coverage can conceal byte clipping.** A 20,011-byte single-line fixture loses its tail before verification, yet a scripted positive verdict yields `linesSeen: 1` and `truncated: false`: all counted lines were visited even though the line was incomplete. This proves a metadata limitation, not model accuracy. List/grep can observe a different version from the subsequent single content read; sketches and verification then reuse that same in-memory read. A caller's later exact `read` can observe another version. There is no source-revision receipt binding those observations. Preserve byte/representation coverage and re-read exact sources before edits or authoritative answers. [^34a46989cf376c63][^76fadc9a4e92a3b3][^544f31fd884d939e][^8292ab9cae884594]

**E4 — Counters have different denominators.** `stats.requests` counts logical `judge()` calls; `errors` counts failed calls and unusable individual answer values. A malformed but correctly typed native response yields six errors for four requests, no failure messages and no all-failed error because the equality check fails. This is exercised through the actual native client with intercepted HTTP. It is a malformed-response diagnostic case, not a claim that Jev normally emits invalid probabilities. [^066012848c7be74f][^544f31fd884d939e][^4221361e4882f086][^8292ab9cae884594]

**E5 — A displayed bill is not complete attempt accounting.** Cascade totals add usage from successful returned judgments. Native session journaling wraps a logical call, not each inner HTTP attempt; failed native calls receive zero-token error records. A returned native cost of zero triggers catalog pricing, so explicit billed zero is not distinguished from absent cost. Chat attempt hooks expose more completed attempts, but `TextJudge` returns only the parsed success's usage. Local completions omit usage and produce zero-valued returned usage. `fileBytes` counts sketch plus accepted-response verification source bytes, not all filesystem I/O or complete serialized network bodies. [^0e0bebb0a6934582][^9d5ca3f68fb608a7][^544f31fd884d939e]

Native HTTP attempts time out after 10 seconds, with at most three attempts for transport/408/429/5xx errors. Backoff is 500/1,000 ms or a bounded server hint; the fixture verifies a 60-second hint becomes two requested 5-second sleeps. Credential resolution/rotation is a separate layer. Role candidate lists cache for one second and 401/402/403 rejections cool down for five minutes; abort/timeout errors propagate rather than falling through the candidate chain. These are not a single end-to-end query budget. Reads have no signal parameter, and retry sleeps do not themselves take the caller signal. [^066012848c7be74f][^0e0bebb0a6934582][^34a46989cf376c63][^8292ab9cae884594]

One routine `find` call in this research reported 729 listed files, 128 name judgments, 20 reads, 26 logical requests, 25K displayed input tokens, $0.2585, 10.0 seconds wall and 35.3 seconds summed API time. Its model, endpoint and exact runtime revision were not exposed. At the quoted native rate, exactly 25,000 billable input tokens would instead be $0.00105; these are not measurements of the same identified route and must not be compared as Jev performance. The observation demonstrates why backend identity and cost basis must accompany metrics. Summed API time exceeds wall time under concurrency. [^af2e1934463a3c96][^52b275ecc0c07648][^3b9396096fc7b4f4]

Ordinary workspace search does not modify source files. `omp://` is an exception to a literal no-writes description: the entry point materializes virtual documentation into temporary files, remaps results to canonical URLs and cleans up afterward. A database/document adapter for llame should not copy private sources to a temporary tree merely to imitate this filesystem implementation. [^4221361e4882f086]

### F9 — jegrep is the reference program, not a bundled local Jev model

jegrep owns a CLI, a lazy file tree, lexical scanning, a request pool, question builders, a Jev HTTP client and interchangeable exploration strategies. Sixteen registered names cover frontier/beam, cheap-prefix sniffing, deeper or paged exploration, inline reading, budget policies, lexical windows, hybrid discovery and cascade. OMP exposes one chosen cascade as an essential agent tool. `--endpoint local` points at an externally supplied System One-shaped server; it neither ships Jev weights nor creates a local inference engine. [^5738c57ec7674ead][^e95ce8ae5824464b][^2df88d5e2f7772eb]

The shared default design is real: two forced lexical files, 128/20/24/8-KiB/384-B/40 budgets, 46-card sketch packing, three-window verification packing, and 0.45/0.20 thresholds. Inspection also confirms that default Lean filename wording, sketch wording and compact verification wording/state fields match. Merely using Rust builders versus TypeScript template files is not evidence of different prompts. A preliminary research claim to that effect was rejected. Full end-to-end byte/conformance parity was not executed. [^2b365d96c6975590][^a65094cb5230adfd][^daf2c9fa62e30dae][^02cf22f4d4181f58]

| Boundary             | jegrep                                                                                                                                          | OMP / consequence                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Configuration        | CLI parallelism/batch/thresholds, cascade environment knobs and optional filename formats                                                       | Fixed tool cascade constants; an explicit non-default jegrep run is not the port's default                                           |
| Preparation          | Grep, then tree expansion; selected file reads sequentially                                                                                     | Concurrent list/grep and concurrent selected reads; runtime/I/O timing differs                                                       |
| Unicode stem cutoff  | Rust `base.len()` counts UTF-8 bytes                                                                                                            | JavaScript `base.length` counts UTF-16 units; `étés` becomes `été` under the Rust rule but stays `étés` in the executed OMP function |
| Transport            | Direct Jev/System One HTTP; OpenRouter preferred by default, optional TypeSafe fallback, explicit local endpoint                                | Session role resolution; native, local or chat semantics with a native-only boundary after the first native candidate                |
| Retry/failover       | 120-second ureq HTTP timeout; retry-enabled send allows six retries; with both providers first send is tried once before retry-enabled fallback | 10-second native attempt timeout, three attempts, registry auth handling and rejection cooldown                                      |
| Physical concurrency | Optional Noul chunking creates `ceil(N/chunk)` initial physical requests, at most two in flight per logical call; retries add attempts          | No matching `find` knob; 16 logical in-flight requests is not a universal HTTP/attempt limit                                         |
| Output               | CLI human/compact/tree/JSON; extra strategy/preparation statistics                                                                              | Agent tool details, progress, cwd-relative/`omp://` locators and session usage integration                                           |

A hosted `--endpoint` preference in jegrep does not forbid cross-provider failover when both keys exist; local mode adds no hosted fallback or Authorization header. Do not import this ambient-key policy into llame. The source-defined Unicode difference is a concrete reason not to assert identical candidate streams for every input. Shared defaults and inspected matching request fields make jegrep a strong reference, but the supplied page's blanket inference that benchmark results carry over is unproved. [^2df88d5e2f7772eb][^a799faa8daa4f62c][^d56356fd3f07670a][^8292ab9cae884594][^0794414eb48aa348]

### F10 — What jegrep's benchmarks establish, and what they do not

The repository contains 40 query cases: ten each for PostgreSQL, CPython, Kubernetes and Linux, with target repository revisions. The headline cascade comparison uses 30 queries from the first three, not all 40. Each suite has positive path/span labels; the inventory finds no explicit-negative or exhaustive-label cases. The runner is present, but the linked `comparison-evidence.json`, `cascade-evidence.json`, recommended preset and raw-run directories are absent at this pin. We can inspect the scorer and check published arithmetic; we cannot reconstruct the published run from committed rows. [^52b275ecc0c07648][^23e81ada73b98d76][^2b6659e65f04c23a]

| Ten-query suite      | Window control → Cascade40 file targets | Regions       | Annotated-line recall | Estimated USD/query | Median process wall time |
| -------------------- | --------------------------------------- | ------------- | --------------------- | ------------------- | ------------------------ |
| PostgreSQL           | 16/16 → 16/16                           | 27/29 → 29/29 | 95.9% → 98.3%         | 0.009204 → 0.005057 | 2.15 s → 1.87 s          |
| CPython              | 15/16 → 16/16                           | 30/31 → 31/31 | 90.7% → 91.1%         | 0.006377 → 0.004927 | 1.95 s → 1.87 s          |
| Kubernetes, held out | 17/17 → 17/17                           | 34/34 → 33/34 | 99.7% → 94.8%         | 0.007635 → 0.004526 | 3.52 s → 3.30 s          |

These are the upstream report's figures, not this study's executions. Its aggregate is 49/49 file targets and 93/94 regions for estimated $0.145097 versus $0.232162; recomputing the ratio gives 37.5018% less estimated API cost. Target counts sum per-query labels, not independent queries or necessarily distinct repository paths. Kubernetes loses one region and 4.9 percentage points of scored line coverage. The generated CPython bytecode case has about 9.9% scored line coverage in the development run and 10.9% in the final parent run despite finding its labeled regions. Those refer to different reported runs, not one interchangeable measurement. [^23e81ada73b98d76][^2b6659e65f04c23a][^52b275ecc0c07648]

**E6 — Metric interpretation is executable.** The unchanged scorer selects the top three positive ranges per file for both region and annotated-line recall. A region succeeds on any overlap; line recall counts the gold lines covered by that same selected set. Low scored coverage can reflect omitted lower-ranked output ranges as well as unread or unverified source, so it does not measure every byte the judge saw. Our synthetic one-line hit against a 100-line gold region scores 100% file recall, 100% region recall and 1% line recall. An extra unlabeled file yields `precision: null`, one unjudged hit and no established false positive; marking the same labels exhaustive instead yields precision 0.5. A correct fourth-ranked range does not count under the default top-three metric. This is discovery evaluation, not proof of comprehensive evidence delivery or answer quality. [^2b6659e65f04c23a][^52b275ecc0c07648]

The benchmark report records one repeat per full-suite configuration, development on PostgreSQL/CPython and a held-out Kubernetes check. Fresh CLI startup is timed; builds, runner-lock wait and report generation are not; OS disk caches were not flushed. The runner keeps failures and incomplete costs visible. It uses a mutable `jev-latest` alias and reports that its provider rejected a versioned ID, whereas today's direct TypeSafe docs say versioned IDs are accepted. That historical observation does not identify the endpoint or prove today's direct API rejects pinning. No independent model-calibration curve or general false-positive rate is established. [^23e81ada73b98d76][^2b6659e65f04c23a][^3b9396096fc7b4f4]

Counterevidence matters: a cheaper 24-passage variant retained development file/region recall but lost CPython line coverage and lacked the same held-out validation. The Sieve alternative fell to 14/17 files and 28/34 regions on held-out Kubernetes. The useful transferable lesson is to retain multiple quality measures and an untouched domain, not to conclude that one sketch budget is universally optimal. [^23e81ada73b98d76]

## Synthesis: concrete uses across llame

A reusable principle emerges: deterministic code admits a bounded source set; typed judgments prioritize attention within it; exact sources and execution policy remain authoritative. Reuse this separation, not jegrep's CLI tree, OMP's entire model registry or a new universal search framework. The present model-client switch has no System One transport; setting a TypeSafe URL on an OpenAI-completions entry would not implement that protocol. A native judgment adapter and an ordinary configured text-model classifier are separate, explicit alternatives. [^feebba74cfb5ab96][^066012848c7be74f][^8473ecc35456bc61]

| Application                                 | Current seam and useful proposed output                                                                                                    | Boundary and adoption test                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U13 — Prior-decision/chat evidence          | Rerank already reauthorized canonical excerpts for a concrete question; return existing message/offset locators                            | Preserve current shared-ranking and score-omission contract until explicitly changed. Compare with current RRF/vector retrieval at the same evidence budget; do not claim recall beyond the admitted candidate set                                                                  |
| U14 — Code or host-file localization        | Apply staged selection to an explicitly granted directory; return file/range evidence for exact follow-up reads                            | Existing native host authority is not owner-isolated Workspace authority. An operator-host experiment can use an explicit host grant; a Project is never that grant. Measure known-location recall and outside-scope/secret-decoy rejection                                         |
| U15 — Tool selection hints                  | Shadow-rank names/descriptions against today's full admitted catalog; separately implement and compare an explicit-name selection baseline | Never alter allowlists, safety classification or invocation permission. llame-owned `tool_search` is not shipped; narrowing advertised schemas needs a separately implemented discover-more path. Hints alone save no schema tokens; evaluate task success and prefix-cache effects |
| U16 — Skill suggestions                     | Judge current request against proactively eligible descriptions; return suggestion IDs or abstention                                       | Explicit mentions and manual-only rules stay deterministic; no hidden body loads. Compare with current catalog/main-model selection and measure unwanted instruction/context cost                                                                                                   |
| U17 — Selected document/Knowledge bundles   | Candidate retrieval plus source-appropriate sketches, then passage verification; return canonical locators                                 | Rewrite the code-centric rubric for document evidence. Preserve owner/Space or host scope and live-source caveats; compare with literal search plus exact reads, including mixed-language and unanswerable cases                                                                    |
| U18 — Run incident evidence                 | Future search over an admitted event/tool-observation projection, using structured status/time/call IDs before judging ambiguous text      | `conversation_read` is not this source. Cleared/missing payloads must remain missing, not reconstructed as evidence; define reader, retention, owner and provider scope first                                                                                                       |
| U19 — Change-impact review candidates       | Rank an explicitly selected change against permitted code, policy and documentation; return a review list                                  | Keep deterministic path/symbol/dependency checks and false-negative tests. No automatic edits, approval or claim that every affected source was found                                                                                                                               |
| U20 — Small control hints outside retrieval | Typed intent/effort/result-usability/citation-support judgments over narrow state                                                          | OMP already uses the role for effort classification; llame still owns user-selected limits, state transitions and effects. Do not spend inference on structured status checks, exact IDs or authorization predicates                                                                |

These are proposals, not shipped APIs. Chat retrieval already has owner filtering, canonical hydration and reusable coordinates. Knowledge has a live owner-scoped search/read seam. Tool admission and skill eligibility are separate deterministic policies. Workspace/Artifact terminology does not create present runtime objects. The table therefore separates ready candidate sources from future collections rather than treating every domain as a directory. [^2b5e0f8a055fdc20][^3625dc1afe52ad01][^8473ecc35456bc61][^64a2fd31fa659970][^03aec42edc684f81][^6b3e943cd1fe085f][^eff6dfe6e1cc0818]

For the earlier Jev-research example, staged `find` would select relevant notes or authorized chat passages; exact `read` would expose the needed evidence; a generative reader or the main model would synthesize the answer. A `noul` score cannot answer what the research concluded. Nearby-document and episodic expansion still require the explicitly broader scope from the previous layer. For tools/skills, only metadata may be needed; sending entire histories or skill bodies merely to choose an identifier is avoidable exposure. [^bc1d5b4cc983d594][^64a2fd31fa659970][^02cf22f4d4181f58]

**Proposed evidence-intent extension:** implementation, callers/usage,
configuration, tests and design rationale require different relevance
predicates; the current implementation-oriented rubric must not be universal.
The [source-aware investigation companion](../2026-09-23-question-directed-read/source-aware-investigation.md)
develops these intents, OKF-guided navigation and bounded workers returning
original evidence plus unresolved leads. It keeps source access specialized and
separates inspected test source from observed execution.

## Recommendations

- **D11 — Start with one consumer and a source-specific rubric.** First compare a judge against the existing candidate order in shadow evaluation. Chat evidence reranking is a close shipped seam; an explicitly permitted host-code fixture is the closest match to OMP's benchmark domain. Do not add a general index or strategy registry before a second real consumer needs it.
- **D12 — Preserve authority and provenance.** Admit sources before local scanning and before provider exposure; bind owner, purpose, accepted provider/model route, source locators, observed representation/hash where available, rubric/version and coverage. Existing prompt receipts and tool events do not automatically record an internal helper call. Keep parent Run lifecycle and cancellation; do not invent another Chat identity for a stateless judgment.
- **D13 — Make uncertainty and cost explicit.** Distinguish no-match, no eligible candidates, partial/unjudged coverage, unavailable judge and failed verification. Record physical attempts and reported versus estimated/unknown cost separately from logical requests. Bind probability semantics: native distribution versus parsed label. No silent cross-provider fallback or classifier-based permission grant.
- **D14 — Measure the actual alternative before tuning.** Include current lexical/RRF retrieval, no-sketch/full-window reranking and the cascade, at matched source/context budgets. Charge all helper calls and actual post-projection primary context. Preserve a deterministic baseline if the optional reranker fails; this does not mean silently replacing an explicitly requested semantic result with an unlabeled lexical answer.

These recommendations extend llame's existing transport-neutral Run and admission seams; they do not assert those helper contracts already exist. Source-specific retrieval and allowed tool execution remain distinct from relevance. [^53bc20bcb6729c65][^8473ecc35456bc61][^feebba74cfb5ab96][^bc1d5b4cc983d594]

## Evaluation plan

Use owner-consented fixtures and later consented real transcripts. **V1** freezes source snapshots, query labels, admitted scope, prompts, model/version and provider route before looking at held-out results. **V2** includes positive, explicitly irrelevant, unanswerable, misleading-name, Unicode, long-line, stale-source, partial-failure and prompt-injection cases. **V3** measures candidate recall separately from verified-passage recall, annotated coverage, final answer support, false positives and calibration. **V4** records all attempts, bytes, tokens, price basis and paired latency/cost distributions across repeated runs. **V5** evaluates tool/skill omission and cache churn separately from document search. No threshold transfers merely because both adapters return a number called probability. [^2b6659e65f04c23a][^23e81ada73b98d76][^8292ab9cae884594][^64154f4aee021df4]

## Limitations and counterevidence

Failure cases in the executed probes are structural counterexamples, not a model-quality comparison. The 39-call bound assumes the inspected fixed defaults and excludes retries, authentication rotation and other application work. The mathematical price example assumes exactly 25,000 billable native input tokens; it does not reinterpret the session's unattributed cost. Hosted aliases/limits/terms can change. No claim of llame speedup, quality non-inferiority, hardware fit, invoice savings or universal calibration is established. [^52b275ecc0c07648][^af2e1934463a3c96][^3b9396096fc7b4f4]

## Appendix: Methodology and reproduction

Five independent read-only investigations covered OMP cascade, judgment integration, llame applications, jegrep parity and benchmark methodology. Main analysis checked consequential claims against pinned source, rejected incorrect auth/prompt-parity interpretations and ran the two offline probes. `git-ai` found no author conversation for the cascade; design intent is inferred from source/comments and benchmark records, not an invented author account. [^544f31fd884d939e][^b03d33ece1a36dee][^a65094cb5230adfd]

From the repository root after installing llame's pinned Node/pnpm dependencies:

```bash
pnpm exec tsx docs/research/tool-harness/2026-09-24-semantic-find-judge/probes/omp-find.mjs /path/to/oh-my-pi
python3 docs/research/tool-harness/2026-09-24-semantic-find-judge/probes/jegrep-metrics.py /path/to/jegrep
```

The first verifies the OMP HEAD, reads pinned Git blobs, transpiles unchanged TypeScript using the esbuild already supplied by tsx and records source hashes. Filesystem/native scan, provider responses, credential resolution and sleep are controlled doubles; only find's simple template interpolation is supplied, not the complete prompt engine. It does not run the complete CLI, native scanner, local worker or live model. The second requires Python 3.10+ and Git, extracts unchanged pure scoring functions with Python AST, inventories benchmark metadata and computes stated arithmetic; it does not clone the four target repositories or rerun upstream benchmarks. [^8292ab9cae884594][^52b275ecc0c07648]

Canonical evidence is in [sources](./sources.jsonl), [evidence](./evidence.jsonl) and [claims](./claims.jsonl). The [session observation](./session-observation.json) is separately qualified. [Verification](./verification.json) records actual checks and [review](./review.json) records independently checked findings. This is documentation-only research; no application tests or unrelated CI monitoring are needed for its handoff.

## Revision history

- v2 (2026-09-24): Corrected keyword-free sketch selection, filename/sketch unknown asymmetry, scan-versus-model exposure, in-memory read reuse, chunk concurrency, top-three line metrics and the unimplemented tool-discovery prerequisite; added direct parallel-evaluation evidence and ranked jegrep discovery.

- v1 (2026-09-24): Added pinned OMP and jegrep implementation traces, backend-semantic distinctions, benchmark audit, offline counterexamples and llame applications beyond Knowledge search.

## Sources

[^0794414eb48aa348]: [OMP find tool documentation](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/docs/tools/find.md)

[^544f31fd884d939e]: [OMP find cascade implementation](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/cascade.ts)

[^df41d4c158ba669e]: [OMP lexical grep and ranking](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/lexical.ts)

[^76fadc9a4e92a3b3]: [OMP passage windows, sketches and range merging](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/passages.ts)

[^34a46989cf376c63]: [OMP bounded source reads and text primitives](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/text.ts)

[^02cf22f4d4181f58]: [OMP three phase judgment request shapes](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/questions.ts)

[^199f6b071e6b846c]: [TypeSafe evaluation API](https://docs.typesafe.ai/api.md)

[^3b9396096fc7b4f4]: [TypeSafe Jev models and limits](https://docs.typesafe.ai/models.md)

[^64154f4aee021df4]: [TypeSafe probability and confidence semantics](https://docs.typesafe.ai/confidence.md)

[^8292ab9cae884594]: [Executed OMP source mechanics probe](./probes/omp-find-result.json)

[^af2e1934463a3c96]: [Single session find observation](./session-observation.json)

[^d56356fd3f07670a]: [OMP lexical keyword normalization](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/keywords.ts)

[^d4c73524e8a1e175]: [OMP eligible file listing](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/tree.ts)

[^4221361e4882f086]: [OMP find tool boundary](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/tools/jfind/index.ts)

[^0e0bebb0a6934582]: [OMP judge role routing and usage](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/judgment/index.ts)

[^b03d33ece1a36dee]: [OMP available-model authentication precheck](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/config/model-registry.ts)

[^066012848c7be74f]: [OMP native System One client](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/ai/src/judgment/typesafe.ts)

[^9d5ca3f68fb608a7]: [OMP prompted typed judgment bridge](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/ai/src/judgment/text.ts)

[^3b853e939c1d5b70]: [OMP chat judgment backend](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/ai/src/judgment/chat.ts)

[^2b365d96c6975590]: [jegrep cascade reference implementation](https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/strategies/cascade.rs)

[^a65094cb5230adfd]: [jegrep filename request formats](https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/questions.rs)

[^daf2c9fa62e30dae]: [jegrep compact passage verification](https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/strategies/window.rs)

[^a799faa8daa4f62c]: [jegrep Unicode keyword normalization](https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/grep.rs)

[^2df88d5e2f7772eb]: [jegrep endpoint and retry policy](https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/jev.rs)

[^e95ce8ae5824464b]: [jegrep strategy family registry](https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/src/strategies/mod.rs)

[^23e81ada73b98d76]: [jegrep reported cascade results](https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/benches/RESULTS.md)

[^2b6659e65f04c23a]: [jegrep benchmark scoring and runner](https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/benches/run.py)

[^52b275ecc0c07648]: [Executed jegrep scorer and evidence inventory](./probes/jegrep-metrics-result.json)

[^2b5e0f8a055fdc20]: [llame canonical chat retrieval contract](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/chat-search/spec.md)

[^3625dc1afe52ad01]: [llame owner-scoped Knowledge search](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/knowledge/knowledge-tools.ts)

[^8473ecc35456bc61]: [llame deterministic tool catalog admission](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/tools/turn-tool-catalog.ts)

[^64a2fd31fa659970]: [llame skill eligibility and activation](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/agent-skills/spec.md)

[^03aec42edc684f81]: [llame current runtime product boundary](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/SPEC.md)

[^feebba74cfb5ab96]: [llame explicit provider transport dispatch](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/models/model-client-factory.ts)

[^bc1d5b4cc983d594]: [Question-directed read follow-on research](../2026-09-23-question-directed-read/report.md)

[^5738c57ec7674ead]: [jegrep CLI operation and strategy reference](https://github.com/can1357/jegrep/blob/e6d5b842e5e88e576c3fcab9e2aa25081cb643af/README.md)

[^eff6dfe6e1cc0818]: [OMP automatic effort classification consumer](https://github.com/can1357/oh-my-pi/blob/5fccbd0deee820049afa492dc3112272b163126f/packages/coding-agent/src/auto-thinking/classifier.ts)

[^6b3e943cd1fe085f]: [llame canonical conversation-read boundary](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/openspec/specs/conversation-reads/spec.md)

[^53bc20bcb6729c65]: [llame durable Run and tool orchestration](https://github.com/leon0399/llame/blob/e70228485042967fd9545ad0cb133faae1be2268/apps/api/src/runs/run-execution.service.ts)
