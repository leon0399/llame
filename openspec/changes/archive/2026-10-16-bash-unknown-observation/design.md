## Context

Issue 1290: long Runs die on `outcome_unknown` from bash process-group teardown races. Evidence points at `settleExit` treating a 50 ms pre-kill survivor as fatal unknown and discarding the post-SIGKILL proof that abort/deadline already use. Spec also terminates the Run and quarantines the worker for later bash.

## Goals / Non-Goals

**Goals:**

- Live bash/MCP unknown → structured tool error; Run continues; instruct the model to inspect state before retrying.
- No bash admission refusal after unknown.
- Exit path uses one kill-then-prove settle, like abort/deadline.
- Crash recovery without a durable result stays terminal.

**Non-Goals:**

- Softening native `edit`/`write` unknown abort.
- Softening crash/redelivery recovery termination.
- Durable instrumentation fields on unknown results (follow-up).
- Reloading stored Run error into the live alert UI (follow-up / #1284 adjacent).

## Decisions

1. **Observation, not fence, for live bash/MCP unknown.** Drop `onNativeMutationUnknown` from `notifyUnknownOutcome`, MCP unknown helpers, and MCP result-persist failure. File-tool unknown keeps the abort callback.
2. **Delete quarantine.** `completeAttemptUnknown` records the result only; remove `rejectQuarantinedGroups` from admission. Best-effort kill still runs inside settlement/`stopProcessGroup`.
3. **Exit settle = prove after kill.** If `close` sees survivors within the short quiescence wait, call `stopProcessGroup`; empty → `knownCloseResult(code)`; still alive → `outcome_unknown` observation.
4. **Model copy.** Unknown bash/MCP messages tell the model to inspect current state before retrying and that the attempt is not replayed automatically.

## Risks / Trade-offs

- A live descendant can race the next bash call (accepted; matches peer best-effort continue).
- MCP unknown no longer stops the Run; model must notice the observation (same as ordinary tool errors).
- Background `sleep & exit 0` that formerly always unknowned may become known success after kill proves the group empty — correct under prove-empty.

## Migration Plan

None. Pre-launch; update callers and tests atomically.
