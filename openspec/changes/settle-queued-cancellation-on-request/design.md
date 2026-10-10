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
  claim transaction by `markFinished` plus `run.cancelled`. Every terminal
  writer goes through `markFinished`'s first-writer-wins predicate and appends
  its event only when it wins. The pickup gate skips a terminal Run.
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
call the worker's pickup gate makes for the same case, and the handler returns
the settled Run. A repeated request that finds the Run still `queued` with its
cancellation already recorded settles it the same way, so a Run recorded before
this change, or one whose first settlement failed, is freed by retrying the
cancel. Because the recorded request blocks `markStarted`, nothing can
claim the Run in between. A worker that read the Run before the request and is
about to settle it through its own pickup path competes under first-writer-wins,
and both writers produce the same `cancelled` outcome.

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

- [A settlement failure after recording] → The Run stays queued with its
  cancellation recorded, which is today's state; the worker's pickup path
  still settles it. The request returns the Run as recorded.
- [The API process now writes a terminal Run] → The write goes through the same
  owner-scoped settlement transaction the worker uses.
