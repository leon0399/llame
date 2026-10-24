# Proposal

## Why

A managed bash process bound of one per worker process makes any step that issues
more than one `bash` call fail the excess deterministically, and because the
counter is module-global, concurrent Runs in one worker compete for the same
slot: #1050 measured 6 of 38 tool calls rejected in the Run that motivated #1038,
and both tested same-step pairs reproduced the refusal. Process pressure also
uses the package's generic `unavailable` classification, which covers multiple
admission failures. The API separately reports missing native identity as
`executor_unavailable`. A dedicated process-pressure classification and an
explanatory message make temporary saturation actionable without implying that
execution capability is missing.

## What Changes

- Raise the worker's managed-process bound above one, so a step's parallel
  `bash` calls are admitted while the host can run them, and keep refusing
  beyond the bound rather than queueing.
- Make the per-worker-process scope the bound's documented meaning: the bound
  belongs to the worker process and every Run that worker executes shares it.
- Give an exhausted bound its own result classification instead of
  `unavailable`, so the refusal names the cause and states that a retry may
  succeed.
- Add operator setting `tools.bashMaxProcesses`, default four, validated as a
  positive safe integer at startup. A value of one intentionally restores serial
  admission; changing the setting requires restarting each worker.
- Replace the module-global counter and per-call `maxProcesses` number with a
  worker-owned `BashProcessLimiter` shared by every Run in that worker. Its
  immutable capacity and active reservations belong to the same object.
- **BREAKING** (internal only): `BashExecutorContext.maxProcesses` is replaced
  by the shared limiter; internal callers and tests move atomically without a
  compatibility shim.
- Document the bound, its scope, and its refusal in the `bash` reference page
  and the tool description.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bash-execution`: the process bound becomes a documented per-worker-process
  bound that refuses before the attempt and before any process starts, with a
  distinct retryable result, and the tool description must state it.

## Non-Goals

- The 120 s `tools.callTimeoutSeconds` default and the per-call timeout
  contract, which is the other half of #1050 and is left to its own change.
- Background or queued `bash` execution (#1051).
- A bound shared across worker replicas: the counter stays per process, and N
  replicas allow N × the bound.
- Live resizing or per-Run/model-selected process limits.

## Assumptions

- The worker process is the intended unit. The archived
  `2026-09-09-host-bash-context` design introduced the counter to stop two calls
  admitting one slot, and `docs/product/operator/scaling.md` makes Run
  concurrency an operator choice per worker profile.
- The refusal stays attempt-free: no process starts, so nothing becomes
  `outcome_unknown` and no `native.attempt` or `native.result` is written.

## Impact

- `packages/bash-executor`: `types.ts` (context and result union), `execute.ts`
  (admission and release), `sanitize.ts`, `execute.test.ts`,
  `sanitize.test.ts`.
- `apps/api/src/tools/bash.ts` (context construction and result mapping),
  `apps/api/src/prompts/tools/bash.md`,
  `docs/product/reference/tools/bash.md`, `CHANGELOG.md`.
- `apps/api/src/instance-config`: configuration type, defaults, parser, schema,
  and focused validation tests; `apps/api/llame.config.jsonc.example`.
- `apps/api/src/runs/run-execution.service.ts`, `apps/api/src/tools/types.ts`:
  one worker-owned limiter supplied to all Run tool contexts.
- `docs/product/operator/native-files.md`: operator setting and restart scope;
  `docs/product/operator/scaling.md`: link to that setting's owning page.
- No durable data, database schema, HTTP API, or dependency change.

## Revision history

- **v3 (2026-10-16):** Rebase onto master `a128882` and reconcile merged #1293:
  live unknown outcomes release their slots without worker quarantine; durable
  unresolved-attempt recovery still never replays. Document that the bound limits
  admitted managed executions, not untracked surviving descendants. Two reviewers
  found no new substantive issue in v2, but this upstream change requires a new
  independent review round before handoff.
- **v2 (2026-10-16):** Restore approved operator tuning; couple capacity and
  reservations in one worker-owned limiter; require two free slots for the
  two-call scenario; distinguish fresh retry from automatic replay; add
  reservation-lifecycle proof and explicit delivery budgets. Independent review
  findings are checked against the executor and API admission paths. The finding
  that the timeout split contradicts issue ownership is rejected: this change
  deliberately leaves #1050 open for its remaining timeout acceptance.
- **v1:** Initial proposal, commit `48ff4107`.
