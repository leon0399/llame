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
  events of the attempt that produced a finished Run's finalized reply, once
  the Run is older than a retention window, in bounded batches. An earlier
  attempt's deltas are kept: a retry resets the reply, so they exist only in
  the event log.
- Every other event is kept forever: lifecycle (`run.*`, `model.requested`,
  `model.completed`), tool activity (`tool.*`), native attempts and results,
  and the step-cap event.
- Only deltas that the Run's own finalized reply holds are deleted: those of
  the attempt the reply names. Deltas of a superseded Run, of an earlier
  attempt, or of a Run whose reply is not finalized are their only copy and are
  kept. The reply's usage names both the Run and the attempt that finalized it.
- `runs.deltaRetentionDays` enables pruning with a window in days. Unset, the
  default, prunes nothing.
- Replay of a finished Run older than the window carries its lifecycle and tool
  events and any earlier attempt's deltas, but not the finalizing attempt's;
  its answer is read from the assistant message.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `durable-runs`: "Every message executes as a durable, resumable run" scopes
  lossless replay of a finished Run to the retention window; "Received
  reasoning is durable before browser delivery" retains a terminal Run's
  reasoning as its reply's parts once projected; a new requirement defines the
  pruning.
- `instance-config`: a new requirement for `runs.deltaRetentionDays`.

## Impact

- `apps/api/src/runs` (the maintenance job, a repository method), the
  `run_events` RLS policy set and a migration, `apps/api/src/instance-config`,
  the JSON Schema, `llame.config.jsonc.example`, and the scaling runbook, which
  lists #119 as an open design constraint.
- A new worker-profile consumer, following `sessions-cleanup`.

## Acceptance

- A finished Run older than the window loses its finalizing attempt's delta
  events and keeps every other event, including an earlier attempt's deltas.
- A Run inside the window, a non-terminal Run, and a finished Run without its
  own finalized reply keep their deltas.
- An unset `runs.deltaRetentionDays` deletes nothing.
- No request can delete an individual event; deleting a Chat still removes its
  Runs' events.

## Decisions for approval

- **E1 Delete through a narrow tenant DELETE policy, not a cross-tenant
  function.** `run_events` is append-only at the datastore today (SELECT and
  INSERT policies only; Chat deletion removes rows through the foreign-key
  cascade, which bypasses policies), and after this change it stays append-only
  for everything except the retention job's delta deletes, and `apps/api/src/db/AGENTS.md` P3 limits cross-tenant
  `SECURITY DEFINER` functions to returning identifiers. The job therefore
  discovers prunable Runs with a P3-conformant function returning
  `(run id, owner id)`, then deletes under each owner's tenant identity through
  a new DELETE policy that admits only delta events of that owner's finished Runs past the cutoff, inside the window of the attempt that produced the Run's own finalized reply. No application path deletes
  events other than this job. The alternative, a cross-tenant delete function,
  breaks P3.
- **E2 Opt-in, no default window.** Every nullable `runs.*` setting is unset by
  default, and the canonical configuration rule makes an explicit `null` equal
  to an absent key, so a `null` cannot mean "off" while absence means "seven
  days". Pruning is therefore enabled by setting a window; the example config
  suggests `7`. The trade-off: instances that never set it keep growing, as
  today.
- **E3 Key prunability on the Run's own finalized reply.** Every terminal
  path now finalizes the reply with usage naming its Run (`SPEC.md` §9.3), so
  the job deletes only the deltas of the attempt that reply names, whose content
  it holds; the finalizer rebuilds a reply from exactly that attempt's window.
  Earlier attempts of the same Run, a Run superseded on the same message, and a
  Run whose reply is still `running` keep their deltas.

## Non-goals

- Pruning lifecycle, tool, or native events, or whole Runs.
- Changing what live or reconnect replay returns for a Run inside the window.
