# Proposal: opt-in Run limits

## Why

A Run cannot do long agentic work. Every Run is aborted when it reaches `runs.timeoutSeconds`, measured from Run start, and at most 100 tool steps are allowed. Raising the budget does not help, because pg-boss independently fails any `runs` job older than its default 900 s expiry and retries it from scratch. Admission also treats a blocker as stuck from its age alone. [#1038](https://github.com/leon0399/llame/issues/1038) records a self-review Run that was still making progress when it expired at 298.7 s, after 38 tool calls.

None of the nine reference harnesses surveyed for #1038 caps a turn at minutes. Six have no whole-turn wall clock, oh-my-pi and Hermes Agent make one opt-in, and OpenClaw defaults to a 48 h backstop. All nine bound each model request with a stream-idle or read timeout of 2–10 minutes. The evidence is in the issue and the [decision record](#decision-record).

## What Changes

- **BREAKING (operator defaults):** `runs.timeoutSeconds` and `tools.maxStepsPerRun` are unlimited by default. Each accepts `null` (unlimited) or a positive integer. An operator who relied on the old 900 s or 100-step defaults now sets them explicitly. Explicitly configured values keep working unchanged.
- The `runs` queue declares a job expiry just under pg-boss's 24 h ceiling. The worker ends a Run at a fixed ceiling below that expiry, recording `run.expired` with a message that names the ceiling. The queue substrate therefore never fails and retries a live Run from scratch. A configured `runs.timeoutSeconds` above the ceiling fails startup.
- Admission decides whether a blocking Run is dead from its queue job's state, not from the Run's age. Each Run is enqueued as the job whose id is the Run id. A new message gets 409 while that job is queued, retrying, or active. The blocking Run is expired only when its job is absent or already settled, beyond a short enqueue grace window.
- Each model request gets a stream-idle watchdog: 300 s before the first streamed part and 300 s between parts, measured only while the provider response is being read. When it fires, the provider request is aborted and the Run fails with a named `model-stream-idle` error. There is no automatic retry.
- A system-origin read (skill activation, accepted-turn instructions) takes its deadline from `tools.callTimeoutSeconds`, like every other tool call, instead of from the Run budget.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `durable-runs`: single-flight admission detects a dead blocker from its job state. The in-process time budget becomes opt-in, the worker enforces the substrate ceiling, and a model-stream idle watchdog is added. Enqueue self-healing uses the job-state path.
- `job-queue`: a queue declares the longest a live handler may run, and the substrate never fails a live, heartbeating handler before that. A producer may choose a job's id and read that job's state by id.
- `instance-config`: `runs.timeoutSeconds` and `tools.maxStepsPerRun` default to unlimited, and `null` is an explicit unlimited value.
- `tool-calling`: the step cap applies only when an operator configures one.

## Impact

- **Config:** `apps/api/src/instance-config/` (types, defaults, loader bounds, `llame.config.schema.json`), `apps/api/llame.config.json.example`, `apps/api/.env.example`.
- **Queue:** `apps/api/src/queue/` gains `expireInSeconds` on `QueueOptions`, a caller-chosen job id on enqueue, and a job-state read by id. Both use the installed pg-boss 12.25 API; no new dependency.
- **Runs:** `run-queues.ts`, `runs-worker.service.ts`, `run-dispatch.service.ts`, `run-execution.service.ts`, and `chat-loop.service.ts` admission. There is no schema migration, because the job id is the Run id.
- **Models:** the per-request idle watchdog wraps the provider stream.
- **Docs:** `docs/scaling.md`, `CHANGELOG.md`, and the removal of the #1038 entry from `ROADMAP.md`.
- **Operators:** a Run is no longer ended by a time or step limit unless one is configured. A provider that stalls for 5 minutes fails the Run visibly. During a worker outage, a queued Run keeps its Chat blocked until a worker picks it up, instead of being expired by the next message.

## Non-goals

These are tracked as follow-ups:

- Continuing a failed Run from its failure point: #1047.
- Continuing one turn past the 24 h job expiry: #1048, blocked by #1047.
- Automatic retry of a stalled or failed model request: #1049, blocked by #1047.
- Tool-call time and concurrency limits (`tools.callTimeoutSeconds`, `bash` `maxProcesses`): #1050.
- Background `bash` execution: #1051.
- Token or cost budgets, and an idle (no-progress) Run budget.

## Decision record

Leo's grilling decisions on 2026-09-30, source-read against oh-my-pi, pi-mono, OpenClaw, Codex CLI, OpenCode, Claude Code, Hermes Agent, goose, and Gemini CLI:

- Q1: no default Run limits at all, neither wall clock nor step cap.
- Q2: a 24 h substrate ceiling now. Same-turn continuation beyond it is tracked in #1048.
- Q3: dead-versus-slow is decided by queue liveness, not by age or by an application heartbeat.
- Q4: a total budget only, and opt-in. No idle budget.
- Q5: a 300 s stream-idle watchdog that fails the Run. Retries are tracked in #1049.
- Q6: tool timeouts are out of scope and tracked in #1050.

The change is delivered as a single PR holding the proposal, implementation, and finalize (spec sync and archive). This is Leo's explicit exception to the linear-stack rule, recorded in `tasks.md`.
