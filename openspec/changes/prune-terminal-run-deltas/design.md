# Design

## Context

- `run_events` carries `run_events_owner_select` and `run_events_owner_insert`
  policies only (`db/schema/chats.ts`), under forced RLS, so the log is
  append-only at the datastore.
- Delta events are read by the run stream bridge (live and reconnect replay),
  by `reconstructDurableAssistant` when a Run settles without a live turn, and
  by the raw `GET /api/v1/runs/:id/events` replay. Each of these reads a Run
  that is non-terminal or just settling, except the raw replay, which the web
  client never calls.
- `SessionCleanupService` is the precedent for a pg-boss cron consumer gated
  by a worker profile (`sessions-cleanup`); `SearchReindexWorker` is the
  precedent for a cross-tenant discovery function owned by `app_rls` that
  returns identifiers, followed by per-owner work under `runAs`.

## Goals / Non-Goals

**Goals:**

- Bound `run_events` growth by its dominant row type without weakening the
  append-only guarantee for any other event.
- Keep every cross-tenant step within `db/AGENTS.md` P3.

**Non-Goals:**

- Partitioning, archiving, or compressing events.

## Decisions

### D1. Discovery returns identifiers; deletion runs per owner

A migration adds `llame_prunable_delta_runs(cutoff timestamptz, max_rows
integer)`, `SECURITY DEFINER`, owned by `app_rls` after provisioning, returning
`(run_id, owner_user_id)` for Runs whose status is terminal, whose `finished_at`
is before the cutoff, whose triggering message's assistant reply has finalized
usage naming this Run (`usage->>'runId' = runs.id::text` and
`usage->>'status' IN ('completed', 'aborted', 'error')`), and that still have
a delta event in that reply's attempt window. The window is the one
`attemptWindow` uses: from the `model.requested` event whose payload names the
reply's `usage->>'attemptId'` up to the next `run.started`. A reply with no
`attemptId` predates per-attempt replies: it may hold only the last attempt's
live parts, so its Run qualifies only when its log has exactly one
`run.started`, and its window is then the whole log. The job deletes each Run's delta events
under `runAs(owner)`, in bounded batches per tick.

### D2. A DELETE policy scoped to prunable deltas

A new `run_events_owner_delete_delta` policy admits `DELETE` only for rows whose
`event_type` is `model.delta` or `reasoning.delta`, of a Run owned by the
current identity, terminal, finished before the configured cutoff, and inside the
finalizing attempt's window, by the same tests as D1. The cutoff reaches the policy
through a transaction-local setting the job sets, read as
`NULLIF(current_setting('app.delta_prune_cutoff', true), '')::timestamptz` so
an unset or pooled-empty value denies rather than errors; no application path
that does not set it can delete anything. The database enforces the shape of a
prunable row; the retention cutoff itself is the job's input, and the policy
applies the same one-day floor to it as the discovery function. Every other event type stays undeletable.

- Alternative: a cross-tenant delete function. Rejected: it breaks P3, which
  limits such functions to returning identifiers.

### D3. The job follows the session-cleanup shape

A `RunEventRetentionService` registers a `run-event-retention` queue and an
hourly cron off the hour, gated by a new `run-event-retention` worker profile
consumer, and logs counts only. An unset `runs.deltaRetentionDays` registers
nothing.

## Risks / Trade-offs

- [A deleted delta was needed] → Only the finalizing attempt's deltas of a Run past the window qualify, and its reply holds their content; earlier attempts keep theirs. Raw-stream
  debugging is limited to the window, documented in the scaling runbook.
- [The DELETE policy is a new write path] → It admits only delta rows of the
  owner's own prunable Runs and only inside a transaction that set the cutoff;
  an integration test proves another owner's rows and every non-delta event are
  undeletable.
- [Long deletes hold locks] → Batches are bounded per tick; a backlog drains
  over successive ticks.
- [The discovery function lists Runs across tenants] → It returns only
  identifiers, as P3 allows, and `app` holds EXECUTE; the cutoff is clamped to
  at least one day in the past inside the function, so a caller cannot widen
  it to recent Runs.
