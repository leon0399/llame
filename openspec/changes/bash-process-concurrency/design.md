# Design

## Context

See [`proposal.md`](proposal.md) — Why. Today the executor keeps one counter in
module scope — `let activeProcesses = 0`
(`packages/bash-executor/src/execute.ts:24`) — and compares it with a **per-call**
`BashExecutorContext.maxProcesses` (`packages/bash-executor/src/types.ts:17`)
that `apps/api/src/tools/bash.ts:41` sets to `1`. Admission reserves the slot
before the durable `native.attempt` write and `runAdmitted` releases it in a
`finally`, so a refused call records no attempt and never becomes
`outcome_unknown`. The refusal returns `{ status: "error", type: "unavailable",
message: "Managed process limit reached." }`, and `unavailable` is the member
the `bash-execution` spec assigns to an unset `tools.nativeExecutorId`. A
different, untouched refusal path already exists for a process group that
outlived an `outcome_unknown` Run (`openspec/specs/bash-execution/spec.md`,
"Unknown command effects are never replayed automatically").

## Goals / Non-Goals

Goals: a step's parallel `bash` calls are admitted while the worker can run
them; the per-worker-process scope is stated wherever the bound is described; an
exhausted bound is a legible, retryable refusal.

Design-level non-goals: a bound shared across replicas, waiting or queueing at
admission, background execution, and the long-command timeout contract.

## Decisions

### D1. The bound belongs to the worker, not to the call

`maxProcesses` is deleted from `BashExecutorContext`, and the executor owns the
bound as one named constant beside the other managed-executor limits that
`apps/api/src/tools/bash.ts` declares. A per-call field over a process-global
counter lets two callers bound the same resource differently, which is the shape
that made "the limit" ambiguous in #1050.

Alternatives: keep the field and raise its value (rejected — it preserves the
ambiguity and the ability to under-bound a shared resource); a host-wide
semaphore across replicas (rejected — it needs a cross-process primitive llame
does not have and adds a fail-open/fail-closed decision; see D4).

### D2. Refuse rather than wait or queue

The refusal stays immediate. Waiting replaces a deterministic error with a
timing-dependent one, and FIFO queueing makes a step of three 120 s commands
take up to 360 s, so the failure surfaces as a call-deadline timeout instead of
a named cause. Background execution is #1051's concern.

### D3. The refusal gets its own result member

`process_limit` is added to the refusal union in `BashUnavailableResult`, and
`apps/api/src/tools/bash.ts` maps it to a message that names the bound and states
that a retry may succeed. `unavailable` stays reserved for a missing executor, so
the model can tell "busy" from "absent" and the owner reads the cause in the
transcript.

Alternatives: keep `unavailable` (rejected — it is the ambiguity this change
exists to remove); reuse `boundary_missing` (rejected — it names a different
cause).

### D4. The bound is four, as a constant rather than configuration

The value is four: an observed step issues two or three parallel commands, so
four admits those with headroom while keeping a brake on a runaway loop. It is a
code constant with no new configuration key. Nothing yet shows
two boxes needing different values, and a key would cost instance-config
validation, an operator page, and a boot-failure path for a number an operator
cannot measure. Tunability can be added when a second deployment needs it; the
binding constraint is that the value belongs to the worker, which the constant
already expresses.

## Risks / Trade-offs

- [Worst-case concurrent host processes rise from one to the bound per worker] →
  the bound stays deliberately small and remains a hard refusal.
- [A step with more parallel calls than the bound still fails the excess] → the
  refusal now names the bound and permits a retry, and the tool description
  states that the bound is per worker and refuses rather than queues.
- [The counter stays per-process, so N replicas allow N × the bound] → stated in
  the reference page and the spec instead of implied; a host-wide bound needs a
  cross-process primitive.
- [Deleting a context field changes the package's exported shape] → internal
  only; callers and tests move in one commit, and no durable or operator-visible
  contract depends on the field.
- [A leaked reservation would starve the worker permanently] → unchanged in
  nature; release stays in `runAdmitted`'s `finally`, and the refusal is now
  legible rather than reading as a broken capability.

## Migration Plan

No durable data, schema, API, or configuration change. Rollback is reverting the
commit, which returns the bound to one and the refusal to `unavailable`. API and
workers deploy together because the executor context shape changes.
