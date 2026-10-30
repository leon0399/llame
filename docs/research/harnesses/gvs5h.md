---
type: Reference
title: "GVS5H"
description: "Benchmark scaffold for ledger-based fresh-context orchestration: the multiagent engine writes a workspace and runs public stdin samples; the model has no tools."
resource: "https://github.com/slee-persis/GVS5H"
tags: [harness, orchestration, ledger, benchmark]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-10-30"
observed:
  date: "2026-10-30"
  revision: "b4cc2f734a28fdab6c37af48e612c4d9e40a7a20"
sources:
  - id: gvs5h-notice-l7-l10
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/NOTICE.md#L7-L10"
    title: "MIT code and CC BY paper, figures, and run data"
  - id: gvs5h-notice-l16-l25
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/NOTICE.md#L16-L25"
    title: "LiveCodeBench fork and problem statements keep their own terms"
  - id: gvs5h-run-bench-l1
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/run_bench.py#L1"
    title: "Benchmark driver"
  - id: gvs5h-engine-l535-l551
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/run_bench.py#L535-L551"
    title: "escalate, multiagent, and single engines"
  - id: gvs5h-public-tests-l160-l161
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/run_bench.py#L160-L161"
    title: "The loop receives public LiveCodeBench cases"
  - id: gvs5h-fresh-l1-l4
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L1-L4"
    title: "Every role is the same model in a fresh context"
  - id: gvs5h-model-l17-l18
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L17-L18"
    title: "Model and iteration cap come from the environment"
  - id: gvs5h-ws-root-l35-l42
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L35-L42"
    title: "Workspace root and per-problem slug"
  - id: gvs5h-transcript-l61-l80
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L61-L80"
    title: "Each call appends request and response to transcript.jsonl"
  - id: gvs5h-ledger-init-l412-l419
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L412-L419"
    title: "The harness creates the ledger files and writes task.md"
  - id: gvs5h-worker-prompt-l326-l350
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L326-L350"
    title: "The worker sees ledger files; the harness writes solution and notes"
  - id: gvs5h-loop-l429-l450
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L429-L450"
    title: "Iteration cap, repeated-task stop, and sample-test override of done"
  - id: gvs5h-samples-l368-l382
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L368-L382"
    title: "Public samples run as a host Python subprocess"
  - id: gvs5h-escalate-l524-l534
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/orchestrator.py#L524-L534"
    title: "The default escalate engine accepts tests and does not read them"
  - id: gvs5h-grade-l174-l182
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/run_bench.py#L174-L182"
    title: "pass@1 is codegen_metrics on the evaluation sample"
  - id: gvs5h-eval-sample-l106-l117
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/livecodebench/lcb_runner/benchmarks/code_generation.py#L106-L117"
    title: "The graded sample concatenates public and private cases"
  - id: gvs5h-chat-prefixes-l336-l381
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/orchestrator.py#L336-L381"
    title: "Provider prefixes, with an unprefixed model sent to Ollama"
  - id: gvs5h-reliability-guard-l522-l531
    resource: "https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/livecodebench/lcb_runner/evaluation/testing_util.py#L522-L531"
    title: "The grader's reliability guard is not a security sandbox"
---

# GVS5H

- **Stack:** Python benchmark driver under `codebase/v2-current/escalation`. **License:** MIT for `codebase/v2-current/`, `codebase/v1-be9dfa2/`, and `paper_plot_script/`; CC BY 4.0 for `paper/`, `assets/`, and `runs/`.[^gvs5h-notice-l7-l10] The LiveCodeBench fork keeps its own MIT and Apache-2.0 notices. Each `task.md` in a run workspace is a third-party problem statement and is outside CC BY; the model-written files beside it are CC BY.[^gvs5h-notice-l16-l25]

GVS5H (Gorilla vs. 5 Humans) is a training-free coding scaffold from Persis Capital's research lab, not a session host. `run_bench.py` is a benchmark driver.[^gvs5h-run-bench-l1] `--engine` selects `escalate` (the default ladder), `multiagent` (the ledger), or `single`.[^gvs5h-engine-l535-l551] Source inspection only. README accuracy figures were not reproduced. The paper page [arXiv:2608.26480](https://arxiv.org/abs/2608.26480) is a live URL and is not pinned here.

**Study**

1. **Fresh context, shared files.** Every multiagent role is the same model invoked with a new message list.[^gvs5h-fresh-l1-l4] The harness creates `task.md`, `notes.md`, `transcript.jsonl`, `plan.md`, `solution.py`, `answer.md`, and `tasks.json`, then writes the problem into `task.md`.[^gvs5h-ledger-init-l412-l419] A worker prompt is system plus one user message that inlines `plan.md`, `notes.md`, and the current solution. The harness parses the reply and writes `solution.py` or `answer.md`, and replaces `notes.md` from the NOTES section.[^gvs5h-worker-prompt-l326-l350] `transcript.jsonl` records each call's request and response.[^gvs5h-transcript-l61-l80] The next role still starts from a new system and user message that inlines the ledger files, not that log.[^gvs5h-worker-prompt-l326-l350] That split is the useful part for llame: coordination state can live outside the model transcript, and the audit log is a different object from model context. [Runs stay the unit of execution](../../../VISION.md#runs-are-the-unit-of-execution); a ledger file is not a second Chat.
2. **The multiagent engine is the verifier.** The LiveCodeBench driver passes public tests into the selected solver.[^gvs5h-public-tests-l160-l161] The default engine is `escalate`, which accepts `tests` and does not read them.[^gvs5h-escalate-l524-l534] In the multiagent engine, after a code worker writes a solution, `_run_samples` executes `solution.py` with the host interpreter, a 10 second timeout, and stdin samples.[^gvs5h-samples-l368-l382] If those samples fail, the harness overrides a manager `done` back to `continue`. The same task text issued again stops the loop. The loop also stops at `MULTIAGENT_MAX_ITERS`, default 10.[^gvs5h-loop-l429-l450] The model has no shell tool. The host process does. The pass@1 grade calls `codegen_metrics` on `get_evaluation_sample()`, which concatenates public and private cases.[^gvs5h-grade-l174-l182][^gvs5h-eval-sample-l106-l117] Final grading uses LiveCodeBench's `reliability_guard`, whose own comment says it is not a security sandbox.[^gvs5h-reliability-guard-l522-l531]
3. **One model name, several transports.** `MULTIAGENT_MODEL` defaults to `groq:qwen/qwen3.6-27b`.[^gvs5h-model-l17-l18] `chat()` dispatches `groq:`, `claude:` (Claude Code CLI), `openai:`, `dashscope:`, `anthropic:`, and `openrouter:`. A name without a prefix goes to Ollama.[^gvs5h-chat-prefixes-l336-l381]
4. **A workspace is a hash of the problem text.** The default root is `runs/ws` from the repo root, overridable with `MULTIAGENT_WS`. The directory name is the first 12 hex characters of the MD5 of the problem.[^gvs5h-ws-root-l35-l42] Nothing in the multiagent loop reads another problem's ledger. There is no approval prompt and no MCP server in this driver.

**llame fit**

- High: item 1, if a future child Run needs a bounded artifact the parent reads back instead of a shared growing transcript.
- Moderate: item 2's explicit override when a check fails. The check has to be host-owned, and the code it runs needs a real sandbox. [Local Sandbox execution](../../../ROADMAP.md#then-local-sandbox-execution) is the relevant later stage.
- Low: items 3 and 4. Provider prefixes and per-problem directories are benchmark machinery.
- Avoid: importing the host-Python sample runner, or treating README pass rates as measured here.

**Caution:** Sample execution and final grading run model-written Python on the machine that launched the benchmark, and the grader says its guard is not a sandbox.[^gvs5h-samples-l368-l382][^gvs5h-reliability-guard-l522-l531] There is no tenant boundary. `codebase/v1-be9dfa2/` is an earlier code snapshot under the same MIT grant; this note describes `v2-current` only.[^gvs5h-notice-l7-l10]

[^gvs5h-notice-l7-l10]: [MIT code and CC BY paper, figures, and run data](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/NOTICE.md#L7-L10)

[^gvs5h-notice-l16-l25]: [LiveCodeBench fork and problem statements keep their own terms](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/NOTICE.md#L16-L25)

[^gvs5h-run-bench-l1]: [Benchmark driver](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/run_bench.py#L1)

[^gvs5h-engine-l535-l551]: [escalate, multiagent, and single engines](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/run_bench.py#L535-L551)

[^gvs5h-public-tests-l160-l161]: [The loop receives public LiveCodeBench cases](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/run_bench.py#L160-L161)

[^gvs5h-fresh-l1-l4]: [Every role is the same model in a fresh context](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L1-L4)

[^gvs5h-model-l17-l18]: [Model and iteration cap come from the environment](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L17-L18)

[^gvs5h-ws-root-l35-l42]: [Workspace root and per-problem slug](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L35-L42)

[^gvs5h-transcript-l61-l80]: [Each call appends request and response to transcript.jsonl](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L61-L80)

[^gvs5h-ledger-init-l412-l419]: [The harness creates the ledger files and writes task.md](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L412-L419)

[^gvs5h-worker-prompt-l326-l350]: [The worker sees ledger files; the harness writes solution and notes](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L326-L350)

[^gvs5h-loop-l429-l450]: [Iteration cap, repeated-task stop, and sample-test override of done](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L429-L450)

[^gvs5h-samples-l368-l382]: [Public samples run as a host Python subprocess](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/multiagent.py#L368-L382)

[^gvs5h-chat-prefixes-l336-l381]: [Provider prefixes, with an unprefixed model sent to Ollama](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/orchestrator.py#L336-L381)

[^gvs5h-escalate-l524-l534]: [The default escalate engine accepts tests and does not read them](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/orchestrator.py#L524-L534)

[^gvs5h-grade-l174-l182]: [pass@1 is codegen_metrics on the evaluation sample](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/v2-current/escalation/run_bench.py#L174-L182)

[^gvs5h-eval-sample-l106-l117]: [The graded sample concatenates public and private cases](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/livecodebench/lcb_runner/benchmarks/code_generation.py#L106-L117)

[^gvs5h-reliability-guard-l522-l531]: [The grader's reliability guard is not a security sandbox](https://github.com/slee-persis/GVS5H/blob/b4cc2f734a28fdab6c37af48e612c4d9e40a7a20/codebase/livecodebench/lcb_runner/evaluation/testing_util.py#L522-L531)
