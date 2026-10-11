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
usage naming this Run (`usage->>'runId' = runs.id::text` and a status other
than `running`), and that still have at least one delta event. The job deletes each Run's delta events
under `runAs(owner)`, in bounded batches per tick.

### D2. A DELETE policy scoped to prunable deltas

A new `run_events_owner_delete_delta` policy admits `DELETE` only for rows whose
`event_type` is `model.delta` or `reasoning.delta`, of a Run owned by the
current identity, terminal, finished before the configured cutoff, whose own
finalized reply exists by the same test as D1. The cutoff reaches the policy
through a transaction-local setting the job sets, read as
`NULLIF(current_setting('app.delta_prune_cutoff', true), '')::timestamptz` so
an unset or pooled-empty value denies rather than errors; no application path
that does not set it can delete anything. The database enforces the shape of a
prunable row; the window itself is the job's input. Every other event type stays undeletable.

- Alternative: a cross-tenant delete function. Rejected: it breaks P3, which
  limits such functions to returning identifiers.

### D3. The job follows the session-cleanup shape

A `RunEventRetentionService` registers a `run-event-retention` queue and an
hourly cron off the hour, gated by a new `run-event-retention` worker profile
consumer, and logs counts only. An unset `runs.deltaRetentionDays` registers
nothing.

## Risks / Trade-offs

- [A deleted delta was needed] → Only finished Runs with an assistant reply
  past the window qualify; their answer and tool activity remain. Raw-stream
  debugging is limited to the window, documented in the scaling runbook.
- [The DELETE policy is a new write path] → It admits only delta rows of the
  owner's own prunable Runs and only inside a transaction that set the cutoff;
  an integration test proves another owner's rows and every non-delta event are
  undeletable.
- [Long deletes hold locks] → Batches are bounded per tick; a backlog drains
  over successive ticks.
