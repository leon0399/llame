# Design

## Context

- `RunsController.updateRun` calls `RunsRepository.requestCancel`, which sets
  `cancel_requested_at` on a non-terminal Run, then aborts a same-process
  executor through `RunAbortRegistry`.
- `RunsRepository.markStarted` claims only a Run whose `cancel_requested_at`
  is null, so a recorded cancellation already prevents every later claim.
- A recorded cancellation is settled today by the worker: its pickup gate
  (`settleCancelledBeforeStart`) calls `settleTerminalRun`, and a cancellation
  landing between that re-check and the claim is settled inside `executeRun`'s
  claim transaction by `markFinished` plus `run.cancelled`. The pickup gate
  skips a terminal Run.
- Writers other than cancellation can also settle a still-`queued` Run:
  retry-exhaustion expiry (`RunsWorkerService.expireDeadLetteredRun`) and
  admission expiry (`ChatLoopService.clearActiveRunSlot`, in the API process)
  write `expired`, and enqueue failure (`failRunTransactionally`) writes
  `failed`. Every terminal writer updates only a non-terminal Run and appends
  its event only when it wins, so the first commit decides the Run's state.
- `settleTerminalRun` returns a `FinishRunResult` (`won`, or `lost` with the
  winner's status), not a Run row.
- `RunsController` lives in `RunsModule`, the read surface any client-serving
  process imports. `RunExecutionService` is provided only by `RunWorkerModule`,
  which imports `RunsModule` and is present in the API process through
  `ChatsModule`.

## Goals / Non-Goals

**Goals:**

- A queued Run cancelled by its owner is terminal when the request returns.
- One settlement path: the request reuses `settleTerminalRun`.

**Non-Goals:**

- Deleting the queued job; settling a claimed Run in another process (#207).

## Decisions

### D1. Settle through the existing terminal path after recording

After `requestCancel` records the request, a Run it returns with status
`queued` is settled with `settleTerminalRun({ status: 'cancelled' })`, the
call the worker's pickup gate makes for the same case. A repeated request that
finds the Run still `queued` with its cancellation already recorded settles it
the same way, so a Run recorded before this change, or one whose first
settlement failed, is freed by retrying the cancel. Because the recorded
request blocks `markStarted`, nothing can claim the Run in between.

The settlement can lose. A worker that read the Run before the request and
settles it through its own pickup path also writes `cancelled`; retry-exhaustion
or admission expiry writes `expired`; enqueue failure writes `failed`. Since
`settleTerminalRun` returns no Run, the handler then re-reads the Run
owner-scoped and returns that row, whatever its outcome: `cancelled` when
either cancellation writer won, otherwise the winner's terminal state, with
200 because this request recorded or found its cancellation (Q2). A Run
deleted with its Chat in between reads as not found.

- Alternative: map a lost settlement to the conflict response a terminal Run
  gets. Rejected: the request did record the cancellation, and a client that
  repeats it gets that conflict anyway.

- Alternative: one SQL statement that records and settles together. Rejected:
  it duplicates `finishRun`'s event and telemetry writes outside the shared
  settlement path.

### D2. The cancel route moves next to the settlement path

The `PATCH /api/v1/runs/:id` handler moves out of `RunsController` into a
`RunCancellationController` declared in `RunWorkerModule`, which already
imports `RunsModule` for `RunAbortRegistry` and provides `RunExecutionService`.
The route, DTO, and OpenAPI operation are unchanged. The handler takes a narrow
`settleTerminalRun` capability, as other callers take `CompactionCapability`, so
its test double implements one method.

- Alternative: inject the capability into `RunsController`. Rejected: it makes
  `RunsModule` import `RunWorkerModule`, a module cycle needing `forwardRef`.

## Risks / Trade-offs

- [A settlement failure after recording] → The request fails with a server
  error, leaving the Run queued with its cancellation recorded, which is
  today's state; a retried request settles it through the repeat path (D1),
  and the worker's pickup gate settles it otherwise.
- [The API process now writes a terminal Run] → The write goes through the same
  owner-scoped settlement transaction the worker uses.
- [Another terminal writer wins the settlement] → The owner sees the winner's
  state, normally `expired`, in the response and the event log. The slot is
  free either way, which is what the change is for.
- [Mixed API and worker revisions during a rolling deploy] → API
  (`dist/main.js`) and worker (`dist/worker.js`) processes deploy separately
  from one image, so revisions can coexist. The change adds no schema, event
  type, job payload, or response shape. A new API settles through the existing
  `markFinished` and `run.cancelled` writes, and an old worker's pickup gate
  already skips a terminal Run. An old API replica only records the request
  and returns the Run `queued`, which is today's behavior, and the worker
  settles it at pickup. The settled-on-request response holds once every
  process serving HTTP runs this revision; the web client ignores the response
  body. Rollback restores record-only cancellation, and Runs already settled
  `cancelled` stay ordinary terminal Runs that older code reads unchanged.
