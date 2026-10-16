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
message: "Managed process limit reached." }`. This is a generic package
admission classification, not an exact tag assigned by the spec to executor
absence; the API's missing native identity path returns `executor_unavailable`.
Current master includes #1293: a live `outcome_unknown` is an observation, the
Run may continue, and later approved calls are not quarantined. Durable recovery
still never re-executes an unresolved attempt (`openspec/specs/bash-execution/spec.md`,
"Unknown command effects are never replayed automatically"). This change must
preserve both behaviors, not restore the pre-#1293 worker quarantine.

## Goals / Non-Goals

Goals: a step's parallel `bash` calls are admitted while the worker can run
them; the per-worker-process scope is stated wherever the bound is described; an
exhausted bound is a legible, retryable refusal.

Design-level non-goals: a bound shared across replicas, waiting or queueing at
admission, background execution, and the long-command timeout contract.

## Decisions

### D1. The bound belongs to the worker, not to the call

Replace `BashExecutorContext.maxProcesses` and the module-global counter with
one `BashProcessLimiter` holding immutable capacity and active reservations.
The API's singleton worker composition creates it once from resolved instance
configuration and passes the same object through every Run's trusted
`ToolContext` to the executor. Do not construct it per call or per Run. The
co-located and dedicated worker entrypoints use the same composition; each
worker process has its own instance. Tests may construct isolated limiters.

Admission synchronously acquires a reservation before any asynchronous durable
attempt write. Its release is idempotent. Before execution begins, abort,
existing-attempt recovery, or a failed attempt write releases the reservation;
after execution starts, only the executor completion path releases it. A settled
live `outcome_unknown` releases its reservation like other settled results; it
does not quarantine the worker, matching #1293. Capacity bounds admitted managed
executions, not all surviving descendants: an unproven stop can leave host
processes alive after the slot is freed. Durable unresolved-attempt recovery
still prevents replay. No queue or timer is introduced.

Alternatives: raise the per-call number (rejected — capacity can still disagree
for one shared counter); a host-wide semaphore across replicas (rejected — it
needs a cross-process primitive and a separate failure policy). A small concrete
class is justified by coupled state and behavior; no interface, registry, or
limiter factory is needed.

### D2. Refuse rather than wait or queue

The refusal stays immediate. Waiting replaces a deterministic error with a
timing-dependent one, and FIFO queueing makes a step of three 120 s commands
take up to 360 s, so the failure surfaces as a call-deadline timeout instead of
a named cause. Background execution is #1051's concern.

### D3. The refusal gets its own result member

`process_limit` is added to the refusal union in `BashUnavailableResult`. The
executor supplies a message naming the actual capacity and saying a fresh call
may succeed; `apps/api/src/tools/bash.ts` preserves both type and message through
its existing generic error mapping. No specialized mapping is needed.

The API currently returns `executor_unavailable` for missing Run/executor/call
identity, whereas the package uses `unavailable` for several admission failures,
including process pressure. Preserve those other classifications. The current
spec calls a missing executor unavailable in prose, not an exact result tag;
this change gives process pressure a dedicated tag rather than claiming that
`unavailable` was exclusively reserved for executor absence.

Alternatives: keep `unavailable` (rejected — it is the ambiguity this change
exists to remove); reuse `boundary_missing` (rejected — it names a different
cause).

### D4. Operator-tunable capacity, default four

`tools.bashMaxProcesses` is a positive safe integer resolved at startup using the
existing numeric configuration machinery, with a default of four. Reject zero,
negative, fractional, non-finite, unsafe-integer, and wrong-type values with a
field-specific startup error. Match existing whole-value interpolation behavior
and validate the resolved value. This is server configuration, never a model
argument, per-Run preference, or live mutable setting. Restart every affected
worker after changing it. A value of one intentionally restores serial admission.

Four is a proposed conservative default, not a measured host capacity: it admits
the reproduced pair with spare capacity when otherwise idle. Contention or larger
batches may still refuse calls. No claim of host load detection, fairness, or
cross-owner reservation is made. With N replicas the total ceiling is the sum
of their configured capacities, N times the bound only when all are equal.

The reference and packaged description state the operator-selected per-worker
scope without hardcoding a tunable number; refusal text names the actual capacity
and says a fresh call may succeed after capacity frees. No automatic retry or
replay is added. The operator page owns the key, default, validation, and restart
instructions. A hardcoded four is rejected because it contradicts Q2-A.

## Risks / Trade-offs

- [Managed execution concurrency rises from one to the bound per worker] →
  admission remains bounded, but this is not an OS-process ceiling: shells may
  spawn children and #1293 allows survivors after unknown settlement.
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

No durable data, database schema, or HTTP API change. Configuration gains
`tools.bashMaxProcesses`; existing configurations use four without edits. Roll
out API and workers together because the executor context shape changes. To
rollback, remove the new setting from configuration before deploying the old
revision, then restart the affected processes; that revision restores a bound
of one and the old process-limit classification. No compatibility shim is added.
