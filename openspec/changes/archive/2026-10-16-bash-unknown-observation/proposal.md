## Why

Live bash (and MCP) `outcome_unknown` currently aborts the Run and can refuse later bash admission while a process group remains probeable. A 50 ms pre-kill race on normal exit makes that path common on long agentic Runs (~1% of bash calls), so owners lose turns to teardown flakiness rather than rare unproven stops. Peers settle shell unknowns as observations and continue; llame should match that for live settlement while keeping crash-recovery terminal.

## What Changes

- **BREAKING (behavior):** A live bash or MCP `outcome_unknown` result is a tool observation only: the Run continues and the model is told to inspect current state before retrying. It does not abort the model-execution signal.
- **BREAKING (behavior):** Remove worker-local bash quarantine that refuses later bash admission after an unknown with a surviving process group. Best-effort SIGKILL remains; the next call is admitted.
- Keep crash/redelivery recovery terminal: an attempt recorded without a durable result still fails the Run without re-execution.
- Keep uncertain native `edit` / `write` as a Run-aborting fence (unchanged).
- Simplify exit settlement: when the child closes with a still-probeable group, SIGKILL then settle from the post-kill proof (known with observed exit code if empty; `outcome_unknown` observation if not), matching abort/deadline.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `bash-execution`: live unknown is non-fatal; drop admission quarantine; retain recovery termination and prove-empty for known results.
- `tool-calling`: bash and MCP `outcome_unknown` continue the Run; edit/write unknown still aborts.

## Impact

- `packages/bash-executor` (attempt ledger, watch settlement, admission)
- `apps/api` tool runner and MCP result persistence (stop calling `onNativeMutationUnknown` for bash/MCP live unknowns)
- OpenSpec `bash-execution` and `tool-calling`
- Tests that pin Run abort or quarantine refusal after unknown
