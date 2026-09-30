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

OMP `find` is a host-controlled retrieval pipeline and `jegrep` its Rust reference; neither generates an answer (F6). `JUDGE` is a role label, not a model: the native wire returns probabilities, while the chat/local bridge parses answer words into 0/1, turning thresholds into Boolean gates (F7). Failure, coverage and accounting need stronger treatment than a score (F8), and reported jegrep savings are unreproduced at this pin (F10).

For llame, apply the pattern to an already authorized candidate set, chat evidence, admitted tool descriptors, eligible skill descriptions, selected documents or explicitly granted host files, with authorization, egress, budgeting and execution deterministic. Add a generative `read?q=` worker when an answer is needed; use a bounded judge for selection or classification. Implementation trace: high confidence; calibration on llame tasks: unknown. [^2b5e0f8a055fdc20][^8473ecc35456bc61][^64a2fd31fa659970][^bc1d5b4cc983d594]

## Introduction and authority

Third layer after [System One/Jev](../2026-09-23-system-one-jev/report.md) and [question-directed reads](../2026-09-23-question-directed-read/report.md). It examines the supplied OMP page, its implementation and the requested [jegrep repository](https://github.com/can1357/jegrep). Pins: OMP `5fccbd0deee820049afa492dc3112272b163126f`, jegrep `e6d5b842e5e88e576c3fcab9e2aa25081cb643af`; llame code references use `e70228485042967fd9545ad0cb133faae1be2268`. Uncommitted prompts are not treated as shipped contracts. [^0794414eb48aa348][^5738c57ec7674ead][^03aec42edc684f81]

Evidence separates inspected source, executed offline mechanics, upstream benchmark reports and recommendations. One ordinary session `find` call was observed during exploration; its backend was not exposed. No live relevance benchmark, private-Knowledge query, Rust build or model download was run; no OpenSpec requirement changes and no tool is approved. [^af2e1934463a3c96][^8292ab9cae884594][^52b275ecc0c07648]

## Main Analysis

### F6 — The host does the search; the judge evaluates bounded candidates

Entry point `FindTool.execute`; orchestration `runCascade`; representations in `keywords`, `lexical`, `tree`, `text`, `passages` and `questions`. Input: natural-language query, required `grep_keywords`, optional directory or `omp://` scope. Extra keywords are hints, not filters. Hidden files stay off in the tool (the CLI has an option), and returned paths are relative to the session cwd, not the search directory. [^4221361e4882f086][^0794414eb48aa348]

| Stage                       | Host work                                                                                                                | Model exposure and default bound                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| P1 — Enumerate and index    | Run native file listing and native keyword grep concurrently; no persistent semantic index                               | No model call yet; local scan can touch far more than the eventual 20 content-read candidates           |
| P2 — Rank filenames         | Lexically rank all eligible files; keep 128; split into 64-file batches                                                  | Filename, size, folded tree, project basename, query and rubric; at most two logical requests           |
| P3 — Read and make sketches | Force the two strongest lexical files into a 20-file budget; fill by name score then lexical rank; read up to 4 MiB/file | Keep up to 24 windows/file, each 8 KiB including generated line tags; make 384-byte extractive sketches |
| P4 — Score sketches         | Mix cards across files, 46 per request; score at most 480 cards                                                          | One shared state with file labels and sketches; up to 11 logical requests                               |
| P5 — Verify windows         | Keep sketch scores at least 0.45, then the best 40 globally; group up to three windows from each file                    | Retained source-window text, not only its sketch; at most 26 logical requests under these caps          |
| P6 — Return evidence        | Keep verified ranges at least 0.20; merge touching/overlapping spans; sort strongest first                               | No new generation; show at most three ranges/file, scores and source-derived previews                   |

Phases drain at most 16 requests in flight. The default bound is 39 **logical judgment calls**, not HTTP attempts: 2 filename, 11 sketch, at most 26 verification (packing 40 passages across at most 20 files; the probe derives it independently). Labels, questions, paths and rubrics add bytes beyond the nominal 18,000-byte sketch/24 KiB verification grouping, so those are not hard serialized-request limits. [^544f31fd884d939e][^52b275ecc0c07648]

**Lexical prior.** Extraction keeps quoted phrases, drops a stopword set, ASCII integers and terms under three UTF-8 bytes, then stems `ing`, `ed`, `es`, `s`. Explicit keywords are only trimmed/lowercased/deduplicated, so they can rescue a short identifier dropped from the query. Not a repository-trained tokenizer or language-aware stemmer. Negation dropped from the lexical prior remains in the full semantic query. [^d56356fd3f07670a]

- For keyword `k`: `clamp(ln((filesScanned + 1)/(df[k] + 1)), 0.5, 6)`; a file's score sums `weight[k] * (ln(1 + occurrences[k]) + 2 * pathContains[k])`. Counts come from matching lines; common terms are logarithmically damped, rare terms bounded. Zero ties fall back to path order before the 128-file cutoff, so a judge cannot rescue a file outside the shortlist. Offline fixture: 151 eligible files, 128 names judged, 20 reads, late-sorted target never shown. [^df41d4c158ba669e][^544f31fd884d939e][^8292ab9cae884594]
- **Passage routing.** Windows are contiguous source lines; oversized lines are clipped, not split. If all windows score zero, selection spreads across the file; otherwise the top 24 survive. The sketch ranks nonblank verbatim lines by keyword weight plus a 0.1 call-like nudge, fills the byte budget in rank order, trims selected lines, caps each at 180 bytes, restores source order. Keyword-free lines are included, so a zero-match window still yields a sketch (an extract, not a model summary). Relevant text can vanish at file, window or sketch stage. [^76fadc9a4e92a3b3][^34a46989cf376c63]
- **Evidence, not an answer.** Verification expands a sketch to its retained window, itself possibly clipped; only verified windows become result ranges. File relevance is the maximum verified passage score, not proof the file answers the query. Merging keeps the maximum score and the first range's preview (first nonblank source line, possibly not the strongest-score line). Exact follow-up `read` remains necessary. [^544f31fd884d939e][^76fadc9a4e92a3b3]

### F7 — What crosses the JUDGE boundary

All phases call `Judge.judge({ state, questions }, { signal })`; a question key maps an answer to a candidate. The native API ignores the map key, so instructions name the `e017`/`p00` tag inside the state. No model-issued filesystem action; no free-form loop. [^02cf22f4d4181f58][^199f6b071e6b846c]

| Phase        | Shared state                                                   | Per-candidate question                                                                                                                       |
| ------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Filename     | `criteria`, tree format, project, search, task, folded tree    | Does the tagged file plausibly contain the requested content?                                                                                |
| Sketch       | `criteria`, file-key/path map, passage-key/sketch map, search  | Could this extract implement a requested step? Favor recall.                                                                                 |
| Verification | `criteria`, one file path, passage-key/source-text map, search | Does this window substantively implement, define or explain an important part? Reject mere mentions, imports, calls, tests or configuration. |

Verdicts are `noul`s: yes/no probabilities, not Choices normalized across files; multiple candidates may score high. The predicate changes per stage, so numbers are not interchangeable correctness estimates. Questions share state; independent answer slots do not prove independent errors or batch invariance. [^02cf22f4d4181f58][^199f6b071e6b846c][^64154f4aee021df4]

- **Native transport.** `TypeSafeJudge` posts `{ state, model, questions }` to `/v1/systemone` (API `typesafe`) or `/decisions` under the OpenRouter alpha base (API `openrouter-decisions`), with the resolved bearer credential and configured headers. Responses carry model identity, answers, usage. The client checks keys and answer types but not the numeric `noul` range; `find` rejects non-finite/out-of-range values. The probe captures both routes without network and shows a numeric `2` passing the client before the cascade rejects it. [^066012848c7be74f][^8292ab9cae884594]
- **Role resolution.** `JUDGE` is a UI tag for the `judge` role; backend kind follows the model's API: System One API, `local-inference` or chat. Native kind denotes the configured protocol, not Jev identity or calibration. A native candidate removes later non-native ones (earlier explicit text candidates can survive). Session-model fallback applies only to caller-supplied, wholly non-native chains; `find` does not pass `sessionModel`. [^0e0bebb0a6934582][^4221361e4882f086]
- `find.enabled:auto` requires the first resolved candidate to be native; construction already filters disabled providers and credential/keyless availability. This is not live account health: keys can fail later, OAuth can need refresh, billing can be rejected. `on` allows non-native judging; `off` disables. The role is not a permission grant or accepted-provider-egress policy. [^4221361e4882f086][^0e0bebb0a6934582][^b03d33ece1a36dee]
- **Prompted and local backends change the contract.** `TextJudge` maps parsed yes/true to `1`, no/false to `0` (Choice/Score to one-hot, confidence `1`), taking the earliest whole-word label, so `Not yes, actually no` becomes `1`. These are parser outputs, not calibrated probabilities; at `find`'s 0.45/0.20 cutoffs a text verdict is a Boolean pass/fail. Batched chat answers are one autoregressive completion, unlike the native claim of parallel question evaluation. [^9d5ca3f68fb608a7][^3b9396096fc7b4f4][^8292ab9cae884594]
- The chat backend uses 4,096 output tokens, temperature zero, reasoning suppression and two format-correction retries (a correction forces `submit_judgment`). The local worker uses 16 output tokens (1,024 for a reasoning model) with no scaling by question count. Large batches need explicit backend-fit evaluation: local execution preserves neither native ranking resolution nor a 64-question filename batch automatically. No local model was run. [^3b853e939c1d5b70][^0e0bebb0a6934582]
- **Cost and service limits.** TypeSafe documents `jev-latest` as `jev-1.13.0`: $0.042/M input, output free, 64k request tokens, separate 32k `state + longest question` limit; published 250k tokens/s and 1,200 requests/min are dynamic. Text-only, strongest in English. A stable alias is not an immutable revision; retain the reported version when evaluating thresholds. No-training terms do not establish zero retention. [^3b9396096fc7b4f4]

### F8 — Failure, coverage and accounting need stronger treatment than a score

- **E1 — A scan filter is not authorization.** The listing excludes common build, binary and credential names, but native grep does not get that filter: listing-rejected paths affect local scanning and IDF statistics only, not the candidate tree, sketches or verification (candidates come from eligible `entries`, not grep keys). The probe exercises that JavaScript bridge with an excluded synthetic filename; it opens no credential file and runs no native scanner. Credential names are case-sensitive (`credentials.json` excluded, `Credentials.json` eligible), and ordinary files can contain secrets. Authorize the corpus before local scanning and before provider exposure. [^d4c73524e8a1e175][^df41d4c158ba669e][^544f31fd884d939e][^8292ab9cae884594]
- **E2 — Unknown is handled asymmetrically.** Failed or unusable filename judgments rank as `0` when filling the read budget, behind positive scores except the two forced lexical leaders. Failed sketch judgments become routing score `1`, avoiding an automatic negative but still competing under the 40-window cap; one failed batch in the 80-card fixture still gives only 40 verified windows and 40 pruned cards, and unknown cards can outrank valid 0.9 cards and consume budget. Failed verification never creates a hit: a one-file outage yields zero hits with one error in three logical calls, the all-failed flag stays false, and the output is a no-hit/useless result with a failure footer, not an exhaustive negative. [^544f31fd884d939e][^4221361e4882f086][^8292ab9cae884594]
- **E3 — Line coverage can conceal byte clipping.** A 20,011-byte single-line fixture loses its tail before verification, yet a scripted positive verdict yields `linesSeen: 1` and `truncated: false`: every counted line was visited though incomplete. Metadata limitation, not model accuracy. List/grep can see a different version than the subsequent content read, which sketches and verification reuse in memory; a later exact `read` can see another version, with no revision receipt binding them. Preserve byte/representation coverage; re-read exact sources before edits or authoritative answers. [^34a46989cf376c63][^76fadc9a4e92a3b3][^544f31fd884d939e][^8292ab9cae884594]
- **E4 — Counters have different denominators.** `stats.requests` counts logical `judge()` calls; `errors` counts failed calls and unusable answer values. A malformed but correctly typed native response yields six errors for four requests, no failure messages and no all-failed error (the equality check fails). Exercise: the actual native client with intercepted HTTP; a diagnostic case, not a claim that Jev normally emits invalid probabilities. [^066012848c7be74f][^544f31fd884d939e][^4221361e4882f086][^8292ab9cae884594]
- **E5 — A displayed bill is not complete attempt accounting.** Cascade totals use successful judgments' usage. Native journaling wraps a logical call, not each HTTP attempt; failed native calls get zero-token error records, and returned cost zero triggers catalog pricing, so billed zero is indistinguishable from absent cost. Chat attempt hooks expose more completed attempts, but `TextJudge` returns only the parsed success's usage; local completions omit usage (zero-valued). `fileBytes` counts sketch plus accepted-response verification source bytes, not all filesystem I/O or serialized request bodies. [^0e0bebb0a6934582][^9d5ca3f68fb608a7][^544f31fd884d939e]
- Native HTTP: 10-second attempt timeout, at most three attempts for transport/408/429/5xx, backoff 500/1,000 ms or a bounded server hint (fixture: a 60-second hint becomes two requested 5-second sleeps). Credential resolution/rotation is separate. Role candidate lists cache one second; 401/402/403 cool down five minutes; abort/timeout errors propagate instead of falling through. Not one end-to-end query budget. Reads take no signal; retry sleeps do not either. [^066012848c7be74f][^0e0bebb0a6934582][^34a46989cf376c63][^8292ab9cae884594]
- One routine `find` call: 729 listed files, 128 name judgments, 20 reads, 26 logical requests, 25K displayed input tokens, $0.2585, 10.0 s wall, 35.3 s summed API time; model, endpoint and revision unexposed. At the quoted native rate, 25,000 billable input tokens would instead be $0.00105: not measurements of one route, not Jev performance. Backend identity and cost basis must accompany metrics; summed API time exceeds wall time under concurrency. [^af2e1934463a3c96][^52b275ecc0c07648][^3b9396096fc7b4f4]
- Ordinary workspace search writes nothing; `omp://` is the exception, materializing virtual documentation into temporary files, remapping results to canonical URLs and cleaning up. A llame adapter should not copy private sources to a temp tree to imitate this. [^4221361e4882f086]

### F9 — jegrep is the reference program, not a bundled local Jev model

jegrep owns a CLI, lazy file tree, lexical scanning, request pool, question builders, a Jev HTTP client and interchangeable strategies. Sixteen registered names cover frontier/beam, cheap-prefix sniffing, deeper or paged exploration, inline reading, budget policies, lexical windows, hybrid discovery and cascade; OMP exposes one chosen cascade as an essential tool. `--endpoint local` targets an externally supplied System One-shaped server; it ships no Jev weights and creates no local engine. [^5738c57ec7674ead][^e95ce8ae5824464b][^2df88d5e2f7772eb]

Shared defaults: two forced lexical files, 128/20/24/8-KiB/384-B/40 budgets, 46-card sketch packing, three-window verification packing, 0.45/0.20 thresholds. Default Lean filename wording, sketch wording and compact verification wording/state fields also match; Rust builders versus TypeScript templates are not prompt evidence (a preliminary claim to the contrary was rejected). Full byte/conformance parity was not executed. [^2b365d96c6975590][^a65094cb5230adfd][^daf2c9fa62e30dae][^02cf22f4d4181f58]

| Boundary             | jegrep                                                                                                                                          | OMP / consequence                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Configuration        | CLI parallelism/batch/thresholds, cascade environment knobs and optional filename formats                                                       | Fixed tool cascade constants; an explicit non-default jegrep run is not the port's default                                           |
| Preparation          | Grep, then tree expansion; selected file reads sequentially                                                                                     | Concurrent list/grep and concurrent selected reads; runtime/I/O timing differs                                                       |
| Unicode stem cutoff  | Rust `base.len()` counts UTF-8 bytes                                                                                                            | JavaScript `base.length` counts UTF-16 units; `étés` becomes `été` under the Rust rule but stays `étés` in the executed OMP function |
| Transport            | Direct Jev/System One HTTP; OpenRouter preferred by default, optional TypeSafe fallback, explicit local endpoint                                | Session role resolution; native, local or chat semantics with a native-only boundary after the first native candidate                |
| Retry/failover       | 120-second ureq HTTP timeout; retry-enabled send allows six retries; with both providers first send is tried once before retry-enabled fallback | 10-second native attempt timeout, three attempts, registry auth handling and rejection cooldown                                      |
| Physical concurrency | Optional Noul chunking creates `ceil(N/chunk)` initial physical requests, at most two in flight per logical call; retries add attempts          | No matching `find` knob; 16 logical in-flight requests is not a universal HTTP/attempt limit                                         |
| Output               | CLI human/compact/tree/JSON; extra strategy/preparation statistics                                                                              | Agent tool details, progress, cwd-relative/`omp://` locators and session usage integration                                           |

A hosted `--endpoint` preference does not forbid cross-provider failover with both keys; local mode adds no hosted fallback or Authorization header, so do not import that ambient-key policy. The source-defined Unicode difference means candidate streams cannot be asserted identical for every input. Shared defaults and matching inspected fields make jegrep a strong reference, but the supplied page's blanket transfer of benchmark results is unproved. [^2df88d5e2f7772eb][^a799faa8daa4f62c][^d56356fd3f07670a][^8292ab9cae884594][^0794414eb48aa348]

### F10 — What jegrep's benchmarks establish, and what they do not

40 query cases: ten each for PostgreSQL, CPython, Kubernetes and Linux, with target repository revisions. The headline comparison uses 30 queries (the first three). Suites hold positive path/span labels only; no explicit-negative or exhaustive-label cases. The runner is present, but linked `comparison-evidence.json`, `cascade-evidence.json`, recommended preset and raw-run directories are absent at this pin: the scorer and arithmetic can be inspected, the run cannot be reconstructed from committed rows. [^52b275ecc0c07648][^23e81ada73b98d76][^2b6659e65f04c23a]

| Ten-query suite      | Window control → Cascade40 file targets | Regions       | Annotated-line recall | Estimated USD/query | Median process wall time |
| -------------------- | --------------------------------------- | ------------- | --------------------- | ------------------- | ------------------------ |
| PostgreSQL           | 16/16 → 16/16                           | 27/29 → 29/29 | 95.9% → 98.3%         | 0.009204 → 0.005057 | 2.15 s → 1.87 s          |
| CPython              | 15/16 → 16/16                           | 30/31 → 31/31 | 90.7% → 91.1%         | 0.006377 → 0.004927 | 1.95 s → 1.87 s          |
| Kubernetes, held out | 17/17 → 17/17                           | 34/34 → 33/34 | 99.7% → 94.8%         | 0.007635 → 0.004526 | 3.52 s → 3.30 s          |

Upstream report figures, not this study's executions. Aggregate: 49/49 file targets, 93/94 regions, estimated $0.145097 versus $0.232162, i.e. 37.5% less estimated API cost (37.5018% by recomputation). Target counts sum per-query labels, not independent queries or distinct paths. Kubernetes loses one region and 4.9 percentage points of scored line coverage. The CPython bytecode case: about 9.9% scored line coverage in the development run, 10.9% in the final parent run, despite finding labeled regions (different runs, not interchangeable). [^23e81ada73b98d76][^2b6659e65f04c23a][^52b275ecc0c07648]

**E6 — Metric interpretation is executable.** The unchanged scorer takes the top three positive ranges per file for region and line recall; a region succeeds on any overlap, and line recall counts gold lines in that same selected set. Low scored coverage can reflect omitted lower-ranked ranges and unread or unverified source, so it is not every byte the judge saw. Synthetic one-line hit against a 100-line gold region: 100% file recall, 100% region recall, 1% line recall. An extra unlabeled file yields `precision: null`, one unjudged hit and no established false positive; marking labels exhaustive instead yields precision 0.5. A correct fourth-ranked range does not count. Discovery evaluation, not proof of comprehensive delivery or answer quality. [^2b6659e65f04c23a][^52b275ecc0c07648]

One repeat per full-suite configuration; development on PostgreSQL/CPython, held-out Kubernetes. Timed: fresh CLI startup only — not builds, runner-lock wait or report generation; OS disk caches not flushed. Failures and incomplete costs stay visible. The runner uses a mutable `jev-latest` alias and reports its provider rejected a versioned ID, while today's direct TypeSafe docs accept versioned IDs: that observation identifies no endpoint and does not prove the direct API rejects pinning today. No calibration curve or general false-positive rate is established. [^23e81ada73b98d76][^2b6659e65f04c23a][^3b9396096fc7b4f4]

Counterevidence: a cheaper 24-passage variant kept development file/region recall but lost CPython line coverage and had no matching held-out check; the Sieve alternative fell to 14/17 files and 28/34 regions on held-out Kubernetes. Keep multiple quality measures and an untouched domain; one sketch budget is not universally optimal. [^23e81ada73b98d76]

## Synthesis: concrete uses across llame

Deterministic code admits a bounded source set, typed judgments prioritize attention within it, and exact sources plus execution policy stay authoritative. Reuse that separation, not jegrep's CLI tree, OMP's model registry or a universal search framework. The model-client switch has no System One transport; a TypeSafe URL on an OpenAI-completions entry would not implement the protocol. A native judgment adapter and a configured text-model classifier are separate, explicit alternatives. [^feebba74cfb5ab96][^066012848c7be74f][^8473ecc35456bc61]

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

Proposals, not shipped APIs. Chat retrieval already has owner filtering, canonical hydration and reusable coordinates; Knowledge has a live owner-scoped search/read seam; tool admission and skill eligibility are separate deterministic policies; Workspace/Artifact terminology creates no runtime objects. The table separates ready candidate sources from future collections rather than treating each domain as a directory. [^2b5e0f8a055fdc20][^3625dc1afe52ad01][^8473ecc35456bc61][^64a2fd31fa659970][^03aec42edc684f81][^6b3e943cd1fe085f][^eff6dfe6e1cc0818]

Jev-research example: staged `find` selects relevant notes or authorized chat passages, exact `read` exposes the evidence, and a generative reader or the main model synthesizes the answer. A `noul` cannot answer what the research concluded. Nearby-document and episodic expansion need the previous layer's broader scope. For tools/skills, metadata alone may suffice; sending full histories or skill bodies to pick an identifier is avoidable exposure. [^bc1d5b4cc983d594][^64a2fd31fa659970][^02cf22f4d4181f58]

**Proposed evidence-intent extension:** implementation, callers/usage, configuration, tests and design rationale need different relevance predicates, so the implementation-oriented rubric must not be universal. The [source-aware investigation companion](../2026-09-23-question-directed-read/source-aware-investigation.md) develops these intents, OKF-guided navigation and bounded workers returning original evidence plus unresolved leads, keeping source access specialized and separating inspected test source from observed execution.

## Recommendations

- **D11 — Start with one consumer and a source-specific rubric.** Shadow-compare a judge against the existing candidate order. Chat evidence reranking is a close shipped seam; a permitted host-code fixture best matches OMP's benchmark domain. No general index or strategy registry before a second real consumer.
- **D12 — Preserve authority and provenance.** Admit sources before local scanning and provider exposure; bind owner, purpose, accepted provider/model route, locators, observed representation/hash, rubric/version and coverage. Prompt receipts and tool events do not automatically record an internal helper call. Keep parent Run lifecycle and cancellation; no new Chat identity for a stateless judgment.
- **D13 — Make uncertainty and cost explicit.** Distinguish no-match, no eligible candidates, partial/unjudged coverage, unavailable judge and failed verification. Record physical attempts and reported versus estimated/unknown cost separately from logical requests. Bind probability semantics (native distribution vs parsed label). No silent cross-provider fallback or classifier-based permission grant.
- **D14 — Measure the actual alternative before tuning.** Include lexical/RRF retrieval, no-sketch/full-window reranking and the cascade at matched source/context budgets; charge all helper calls and actual post-projection primary context. Keep a deterministic baseline if the optional reranker fails, without silently replacing a requested semantic result with an unlabeled lexical answer.

These extend llame's transport-neutral Run and admission seams; they do not assert those helper contracts exist. Retrieval and allowed execution remain distinct from relevance. [^53bc20bcb6729c65][^8473ecc35456bc61][^feebba74cfb5ab96][^bc1d5b4cc983d594]

## Evaluation plan

Owner-consented fixtures, then consented real transcripts. **V1** freezes source snapshots, query labels, admitted scope, prompts, model/version and provider route before held-out results. **V2** adds positive, explicitly irrelevant, unanswerable, misleading-name, Unicode, long-line, stale-source, partial-failure and prompt-injection cases. **V3** measures candidate recall separately from verified-passage recall, annotated coverage, final answer support, false positives and calibration. **V4** records all attempts, bytes, tokens, price basis and paired latency/cost distributions across repeated runs. **V5** evaluates tool/skill omission and cache churn separately from document search. No threshold transfers merely because both adapters return a number called probability. [^2b6659e65f04c23a][^23e81ada73b98d76][^8292ab9cae884594][^64154f4aee021df4]

## Limitations and counterevidence

Probe failures are structural counterexamples, not a model-quality comparison. The 39-call bound assumes inspected defaults and excludes retries, authentication rotation and other application work. The price example assumes exactly 25,000 billable native input tokens and does not reinterpret the session's unattributed cost. Hosted aliases/limits/terms can change. No speedup, quality non-inferiority, hardware fit, invoice saving or universal calibration is established. [^52b275ecc0c07648][^af2e1934463a3c96][^3b9396096fc7b4f4]

## Appendix: Methodology and reproduction

Five independent read-only investigations: OMP cascade, judgment integration, llame applications, jegrep parity and benchmark methodology. Main analysis checked consequential claims against pinned source, rejected incorrect auth/prompt-parity interpretations and ran the two offline probes. `git-ai` found no author conversation for the cascade; intent is inferred from source, comments and benchmark records. [^544f31fd884d939e][^b03d33ece1a36dee][^a65094cb5230adfd]

From the repository root after installing llame's pinned Node/pnpm dependencies:

```bash
pnpm exec tsx docs/research/tool-harness/2026-09-24-semantic-find-judge/probes/omp-find.mjs /path/to/oh-my-pi
python3 docs/research/tool-harness/2026-09-24-semantic-find-judge/probes/jegrep-metrics.py /path/to/jegrep
```

The first script verifies the OMP HEAD, reads pinned Git blobs and transpiles unchanged TypeScript with tsx's esbuild, recording source hashes; scan, provider responses, credential resolution and sleep are controlled doubles, with only simple template interpolation (not the full prompt engine). It runs no complete CLI, native scanner, local worker or live model. The second needs Python 3.10+ and Git, extracts unchanged pure scoring functions via Python AST, inventories benchmark metadata and computes stated arithmetic; it does not clone the target repositories or rerun upstream benchmarks. [^8292ab9cae884594][^52b275ecc0c07648]

The [session observation](./session-observation.json) is separately qualified. Documentation-only research; no application tests or unrelated CI monitoring are needed for handoff.

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
