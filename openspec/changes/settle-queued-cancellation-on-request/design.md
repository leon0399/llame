# Design

## Context

- `RunsController.updateRun` calls `RunsRepository.requestCancel`, which sets
  `cancel_requested_at` on a non-terminal Run, then aborts a same-process
  executor through `RunAbortRegistry`.
- `RunsRepository.markStarted` claims only a Run whose `cancel_requested_at`
  is null, so a recorded cancellation already prevents every later claim.
- `RunExecutionService.executeRun` settles a Run it could not claim because of
  a recorded cancellation through `settleTerminalRun` (`run.cancelled`, no
  assistant message), and `RunsWorkerService`'s pickup gate skips a terminal
  Run when its job arrives.

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
call the worker makes for the same case, and the controller returns the
settled Run. Because the recorded request blocks `markStarted`, nothing can
claim the Run in between. A worker that read the Run before the request and is
about to settle it through its own pickup path competes under first-writer-wins,
and both writers produce the same `cancelled` outcome.

- Alternative: one SQL statement that records and settles together. Rejected:
  it duplicates `finishRun`'s event and telemetry writes outside the shared
  settlement path.

### D2. The controller depends on the settlement capability, not the service

The controller receives a narrow capability with `settleTerminalRun`, as other
callers receive `CompactionCapability`, so its test double implements one
method.

## Risks / Trade-offs

- [A settlement failure after recording] → The Run stays queued with its
  cancellation recorded, which is today's state; the worker's pickup path
  still settles it. The request returns the Run as recorded.
- [The API process now writes a terminal Run] → The write goes through the same
  owner-scoped settlement transaction the worker uses.
