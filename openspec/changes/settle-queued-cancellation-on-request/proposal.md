## Why

Cancelling a Run that no worker has claimed yet only records the request; the
Run stays `queued` until a worker picks its job up and settles it
([#125](https://github.com/leon0399/llame/issues/125), queued-cancel item).
Single-flight admission counts a queued Run as live, so until that pickup the
owner's next message to the same chat is rejected with 409, although nothing
is running and nothing will run. Under queue backlog or with no worker
consuming, that wait is unbounded from the owner's side.

## What Changes

- A cancellation request for a Run still `queued` settles it `cancelled`
  before the response returns: terminal status, `run.cancelled` event, no
  model request, no assistant message.
- Recording the request already blocks every later claim (a worker claims only
  a Run with no recorded cancellation), so the Run read back as `queued` after
  recording can only be settled by this request or by a worker's pickup gate,
  and first-writer-wins decides. A Run a worker claimed before the request was
  recorded keeps today's behavior (recorded, settled by its executor).
- The worker's existing pickup gate skips the now-terminal Run when its job
  arrives, so the queued job needs no deletion.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-cancellation`: "The owner requests cancellation of a Run" settles a
  queued Run on the request; "A recorded cancellation settles the Run as
  cancelled" assigns the queued case to the request and keeps the worker path
  for a cancellation recorded on a Run that is no longer queued.

## Impact

- `apps/api/src/runs/runs-repository.ts` (conditional settle), the runs
  controller's cancel path, and their tests.
- No schema, API shape, or configuration change; `PATCH /api/v1/runs/:id`
  returns the Run as today, now already `cancelled` when it was queued.

## Acceptance

- Cancelling a queued Run returns it `cancelled`, its event log ends with
  `run.cancelled`, no assistant message exists, and the owner's next message to
  the chat is accepted without 409.
- A queued job for that Run, delivered later, makes no model request and
  changes nothing.
- Cancelling a Run a worker has already claimed records the request and leaves
  settlement to the executor, as today.

## Decisions for approval

- **Q1 Settle on the request instead of waiting for pickup.** The alternative,
  deleting the pg-boss job, does not free the slot by itself and couples the
  API to queue internals; settling the Run row frees the slot and the pickup
  gate already handles the orphaned job.

## Non-goals

- Cross-process cancellation of a claimed Run (#207).
- Removing the orphaned queue job.
