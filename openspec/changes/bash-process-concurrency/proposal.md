# Proposal

## Why

A managed bash process bound of one per worker process makes any step that issues
more than one `bash` call fail the excess deterministically, and because the
counter is module-global, concurrent Runs in one worker compete for the same
slot: #1050 measured 6 of 38 tool calls rejected in the Run that motivated #1038,
and the refusal reproduces on every same-step pair. The refusal is also
indistinguishable from a missing capability, because it reuses `unavailable` —
the result the bash spec reserves for an unset `tools.nativeExecutorId` — so
neither the model nor the owner can tell a busy worker from an absent one.

## What Changes

- Raise the worker's managed-process bound above one, so a step's parallel
  `bash` calls are admitted while the host can run them, and keep refusing
  beyond the bound rather than queueing.
- Make the per-worker-process scope the bound's documented meaning: the bound
  belongs to the worker process and every Run that worker executes shares it.
- Give an exhausted bound its own result classification instead of
  `unavailable`, so the refusal names the cause and states that a retry may
  succeed.
- Remove `maxProcesses` from the per-call `BashExecutorContext`, so no caller
  can attribute a different bound to a process-global resource, and drop the
  `maxProcesses <= 0` sanitize rule with it.
- **BREAKING** (internal only): `BashExecutorContext.maxProcesses` is deleted;
  internal callers and tests move atomically. No operator-visible configuration
  changes and no compatibility shim is added.
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
- Operator tuning of the bound; see design D4.

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
- No durable data, schema, API, dependency, or configuration change.
