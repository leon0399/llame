## Why

An owner's Stop records the cancellation durably, but after a worker claims the Run, only an abort in the process that received the request stops it. When the Run executes in another process, the model request keeps running and billing until the Run finishes, and it can still complete despite the accepted cancellation ([#207](https://github.com/leon0399/llame/issues/207)). That covers every split deployment (`dist/worker.js` workers beside a `web` API, shipped with #116) and every co-located deployment with more than one replica, where the request can land on a replica that is not executing the Run.

`run-cancellation` sanctions the gap today: a cancellation recorded after the claim in a different process "is outside this requirement until cross-process cancellation ships", and its three mid-flight scenarios are each scoped "in the process executing the Run". [`docs/product/operator/scaling.md`](../../../docs/product/operator/scaling.md) tells operators not to rely on Stop in split topology. The issue's latest comment re-checked this against `master`; this proposal re-checked it at 9a958cee.

## What Changes

- D1 (**open decision for Leo**): how the executing process learns of a cancellation recorded elsewhere. The options are (A) a periodic owner-scoped read of the Run's cancellation state by the executing worker, and (B) a Postgres notification sent with the cancellation and received by the worker on a dedicated listening connection. The design compares them; the delta and tasks are written for A, the smaller change, and the design lists exactly which parts change if Leo picks B.
- The `run-cancellation` settlement requirement covers every deployment topology after the claim. The process executing the Run acts on a recorded cancellation at once when it received the request itself, and otherwise within 5 seconds of the cancellation being recorded; a read failure defers it to the first successful read. It then settles the Run exactly as a co-located Stop does today: no further model request during preparation, the in-flight model or compaction request aborted, the observed output kept, and `run.cancelled` appended. The three mid-flight scenarios are conditioned on when the executing process acts instead of on which process received the request, and new scenarios pin the cross-process case, the read-failure case, a Chat deleted through another process, and isolation between owners.
- D2 (option A): the executing worker reads its Run's cancellation state every 3 seconds in the owner's tenant scope, each read bounded by a 1-second deadline, and aborts the attempt the way a co-located Stop does. The read is a cancellation check, not a liveness signal; worker-death detection stays with the queue's native heartbeat.
- D3: the same check also stops an attempt whose Chat was deleted in another process, which calls the same process-local abort today and keeps spending elsewhere for the same reason. `run-cancellation` now specifies it in place of its "outside this requirement" sentence for deleted Runs. A Run already `cancelled` without a stamp also aborts, as defensive handling of legacy data: same-message supersede cannot leave a Run executing, because accepting a new turn first refuses (409) or expires the Chat's active Run, so it is not specified.
- `docs/product/operator/scaling.md` drops the process-local limitation and the "add cross-process cancellation signaling" half of the #118 bullet. The code comments that describe cancellation as process-local are corrected.

No endpoint, request or response body, OpenAPI document, database schema, or configuration key changes. The cancellation request, its scoping, idempotency, conflict on a terminal Run, and the pre-claim rule are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-cancellation`: "A recorded cancellation settles the Run as cancelled" extends post-claim cancellation from the receiving process to every deployment topology within a 5-second bound, extends the same bound to stopping a Run whose Chat was deleted, and adds scenarios for both.

`durable-runs` and `job-queue` are unchanged. Their rule against an application liveness poll or heartbeat concerns detecting a dead worker; option A's read neither signals liveness nor detects a stalled worker, and worker-death recovery stays with the queue's native heartbeat (design D2).

## Non-goals

- Push-based live Run deltas ([#118](https://github.com/leon0399/llame/issues/118)). Under option A, #118 stays independent and can later add a notification path for cancellation beside the read; under option B, this change builds the first listener #118 would reuse.
- Faster co-located Stop. The process that receives the request still aborts its own controller immediately.
- A pending-cancel state for a request the server has not accepted, cancellation keyed by Chat, or any change to what a cancelled Run persists or the usage recorded on it.
- An operator setting for the check interval or the latency bound.
- Stopping work outside the Run's attempt, such as a queued reindex, or cancelling a dead-lettered job.

## Assumptions

- A Run executing in another process is reachable only through the database: no API-to-worker channel exists, and the queue's own cancellation does not reach an active handler (pg-boss 12.25.0 aborts a handler's signal only on expiry or shutdown).
- The 5-second bound and option A's 3-second interval and 1-second read deadline are proposed values, not measured requirements. Changing them edits the spec's bound and the module constants.
- The bound applies while the executing process can read the Run. A worker that cannot reach the database cannot settle the Run either; it keeps executing and the queue's liveness and retry rules apply as today.

## Impact

API worker only: `RunsWorkerService.executeJob` gains the cancellation check beside its wall-clock timer, and the abort it issues is the reasonless abort `classifyAbortedRun` already settles as `cancelled`. Comments in `run-abort-registry.ts`, `runs-worker.service.ts`, `runs.controller.ts`, and `chats.service.ts` change. Each executing Run adds one owner-scoped primary-key read every 3 seconds, on the existing pool (design D2). Under option B, the API's cancellation transactions also send a notification and each worker holds one extra database connection. No tenancy boundary moves: the read runs in the Run owner's tenant scope by the Run id the queue job carries, and no worker reads another owner's Run.
