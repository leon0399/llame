## Why

`run_events` grows without bound
([#119](https://github.com/leon0399/llame/issues/119)). Every streamed token is
a `model.delta` or `reasoning.delta` row, kept forever, although a finished
Run's answer lives in its assistant message and the deltas are only the
transport buffer that produced it. On a long-lived instance the table is
dominated by rows nothing reads again: the chat UI renders finished turns from
`messages`, and the web client never calls the raw run-events endpoint.

## What Changes

- A scheduled maintenance job deletes the `model.delta` and `reasoning.delta`
  events of Runs that finished more than a retention window ago and whose
  assistant message exists, in bounded batches.
- Every other event is kept forever: lifecycle (`run.*`, `model.requested`,
  `model.completed`), tool activity (`tool.*`), native attempts and results,
  and the step-cap event.
- A finished Run whose recorded output was never projected into an assistant
  message keeps its deltas, because they are then its only copy.
- `runs.deltaRetentionDays` sets the window, default 7; `null` disables
  pruning.
- Replay of a finished Run older than the window carries its lifecycle and tool
  events without deltas; its answer is read from the assistant message.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `durable-runs`: "Every message executes as a durable, resumable run" scopes
  lossless replay of a completed Run to the retention window, and a new
  requirement defines the pruning.
- `instance-config`: a new requirement for `runs.deltaRetentionDays`.

## Impact

- `apps/api/src/runs` (the maintenance job, a repository method), the
  `run_events` RLS policy set and a migration, `apps/api/src/instance-config`,
  the JSON Schema, `llame.config.jsonc.example`, and the scaling runbook, which
  lists #119 as an open design constraint.
- A new worker-profile consumer, following `sessions-cleanup`.

## Acceptance

- A finished Run older than the window, with an assistant message, loses its
  delta events and keeps every other event.
- A Run inside the window, a non-terminal Run, and a finished Run with no
  assistant message keep their deltas.
- `runs.deltaRetentionDays: null` deletes nothing.
- No owner can delete any event through the application.

## Decisions for approval

- **E1 Delete through a narrow tenant DELETE policy, not a cross-tenant
  function.** `run_events` is append-only today (SELECT and INSERT policies
  only), and `apps/api/src/db/AGENTS.md` P3 limits cross-tenant
  `SECURITY DEFINER` functions to returning identifiers. The job therefore
  discovers prunable Runs with a P3-conformant function returning
  `(run id, owner id)`, then deletes under each owner's tenant identity through
  a new DELETE policy that admits only delta events of that owner's finished
  Runs past the cutoff with an assistant message. No application path deletes
  events other than this job. The alternative, a cross-tenant delete function,
  breaks P3.
- **E2 Seven-day default, configurable.** Long enough to debug a recent Run
  from its raw stream, short enough to bound growth; `null` keeps today's
  behavior for an operator who wants the full log.
- **E3 Keep deltas when no assistant message exists.** A Run expired by
  admission of a new message (`SPEC.md` §9.3) can be terminal without its
  output projected; deleting its deltas would destroy its only record.

## Non-goals

- Pruning lifecycle, tool, or native events, or whole Runs.
- Changing what live or reconnect replay returns for a Run inside the window.
