## Context

See proposal.md for motivation. Observed at `master` 9a958cee with `pg-boss` 12.25.0 and `postgres` (postgres.js) 3.4.7:

- `RunsController.updateRun` stamps `cancel_requested_at` through `RunsRepository.requestCancel` (`runs-repository.ts:379`), an owner-scoped update guarded on a non-terminal, not-yet-requested Run, then calls `RunAbortRegistry.abort(id)` (`runs.controller.ts:152`). The registry is a per-process `Map` of `AbortController`s (`run-abort-registry.ts:23-44`); in another process it finds nothing and returns `false`.
- Two other paths stop a Run through the same registry. `ChatsService.deleteChat` stamps `cancel_requested_at` and aborts before deleting the Chat (`chats.service.ts:413-432`). A same-message retry sets superseded Runs to `cancelled` directly, appending `run.cancelled` with reason `superseded by retry` and without stamping `cancel_requested_at` (`chat-loop.service.ts:426-441`, `runs-repository.ts:351-371`), then aborts them after commit (`chat-loop.service.ts:235-237`).
- `RunsWorkerService.executeJob` (`runs-worker.service.ts:156`) reads the Run at pickup, registers the controller (`:207`), re-reads `cancel_requested_at` to close the pickup race (`:209-227`), and arms one `setTimeout` for the wall-clock budget or execution ceiling (`:229-249`). Its `finally` clears the timer and unregisters (`:299-302`). After that re-read, nothing reads the Run's cancellation state again; `markStarted` refuses a stamped Run (`runs-repository.ts:311-342`), but the attempt's later fences (`updateForAttempt`, `:426-450`) check only the attempt and terminal status.
- A reasonless `abort()` is classified `cancelled` by `classifyAbortedRun` (`run-execution.service.ts:553-561`); only the timeout, ceiling, and native-mutation reasons classify otherwise. The first abort's reason wins on an `AbortController`, so a second abort never reclassifies a Run.
- pg-boss 12.25.0 gives a handler `job.signal`, which aborts only on handler expiry (`resolveWithinSeconds`) or worker shutdown (`failWip`, `dist/manager.js:397-401,518-526`). `boss.cancel` is a SQL state change that never reaches an active handler (`:1288-1296`). The heartbeat is a `setInterval` calling `touch` with no hook and no read of application tables (`:403-414`).
- `durable-runs` forbids "an application-level liveness poll or per-run 'deadman' job" and `job-queue` requires liveness with "no application heartbeat code" and no "per-job liveness-poll". Both govern detecting a dead or hung worker.
- pg-boss has an opt-in `useListenNotify` with a supervised listener that reconnects with backoff up to 30 s and calls `onReconnect` (`dist/db.js:45-118`); llame does not enable it, and the listener is internal to pg-boss. postgres.js 3.4.7 `sql.listen` opens one dedicated connection and re-listens on close, but a failed re-listen is swallowed (`.catch(() => {})`, `postgres/src/index.js:156-160`), which drops the listener silently.
- The pool is `db.poolSize` connections per process (default 10, `core-infra.module.ts:43`); `TenantDbService.runAs` is one transaction with a `set_config` before the callback (`tenant-db.service.ts:55-77`).

## Goals / Non-Goals

**Goals:**

- A cancellation recorded after the claim stops the executing attempt within 5 seconds in every topology, with the same settlement as a co-located Stop.
- No new endpoint, schema, configuration key, dependency, or connection type in the chosen option.
- Worker-death detection stays with the queue's native heartbeat.

**Non-Goals:**

- Making the co-located path faster or replacing the in-process registry.
- Live-delta push (#118).
- Guaranteeing that an attempt already dispatching a model request when the cancellation is recorded never sends it. Within the bound the request is aborted and the shipped "no output, empty turn" persistence applies.

## Decisions

### D1 (open for Leo): how the executing process learns of the cancellation

| Concern                   | A: per-Run read of the Run's cancellation state                                                                                  | B: `pg_notify` with the cancellation, worker `LISTEN`                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Latency                   | at most the interval plus two reads; 4 s interval, 5 s bound                                                                     | sub-second while the listener is connected                                                                                                                                  |
| Latency during DB trouble | a failed read retries at the next tick; met again at the first successful read                                                   | lost until the listener reconnects and reconciles; pg-boss's own listener backs off to 30 s, postgres.js can drop it silently                                               |
| Steady cost               | one owner-scoped primary-key read transaction per executing Run every 4 s: 2 per second per worker at concurrency 8, on the pool | zero reads; one notification per cancellation, supersede, and Chat deletion                                                                                                 |
| Connections               | none added; each read borrows a pool connection briefly                                                                          | one dedicated connection per worker process outside `db.poolSize`; incompatible with a transaction-mode pooler                                                              |
| Code                      | about 40 lines in `executeJob` plus a narrow repository read                                                                     | notify in three write paths, a supervised listener service with reconnect and a reconcile read of every locally registered Run, shutdown wiring, and the same per-Run abort |
| Relation to #118          | independent; #118 can later add push for cancellation, and A's read becomes its reconcile path                                   | builds the first listener #118 would reuse, before #118 has a proposal or a channel design                                                                                  |
| Spec text                 | as in the delta                                                                                                                  | the 5-second bound needs a fallback read during listener outages (which is A) or a clause relaxing it until reconnection                                                    |
| Liveness rules            | must be framed as a cancellation check (D2)                                                                                      | no tension                                                                                                                                                                  |

Recommendation: A. It meets a bound that does not depend on a long-lived connection, and B's complete form needs a reconcile read anyway, which A already is. Choose B only if #118 is scheduled next and the listener should land once for both.

If Leo picks B:

- The delta's 5-second sentence gains "while the executing process holds its notification connection, and otherwise at its reconnection", or B keeps A's read as its fallback. Without that fallback, the unreadable-cancellation sentence and scenario are restated for a lost notification connection; the other scenarios stay.
- Layer `worker-check` becomes `cancel-notify` (estimated 900 authored lines): `pg_notify` inside the transactions of `requestCancel`'s two callers and `cancelSupersededRuns`, on one fixed channel carrying only the Run id (delivered on commit, so a rolled-back cancellation never aborts); a worker listener on a dedicated, supervised connection that aborts the registry entry for a received id; a reconcile read of every locally registered Run after each (re)connect; and its closure on shutdown.
- Its tests add: no notification on rollback, a notification for an id the worker is not executing is ignored, and an abort after a forced listener disconnect via the reconcile read.
- `scaling.md` additionally documents the extra connection per worker in pool sizing and the pooler constraint.

D2–D4 below describe A; D3 and D4 hold under B with the read replaced by the notification and the reconcile read.

### D2: The cancellation check is a cancellation read, not a liveness signal

After the post-registration re-read, `executeJob` schedules a chain of `setTimeout`s with a 4-second interval, each scheduled after the previous read settles so reads never overlap. Each tick reads the Run by id in the owner's tenant scope (`tenantDb.runAs(job.userId, …)`), selecting only `cancel_requested_at` and `status`. A non-terminal Run with a recorded cancellation aborts the registered controller with no reason, so `classifyAbortedRun` records `cancelled` and every downstream path (preparation checkpoint, compaction abort, open-tool settlement, partial turn) is the one a co-located Stop already takes. The chain stops in the existing `finally` before the controller is unregistered and when the signal is already aborted.

A read that throws is logged and retried at the next tick. It never aborts, settles, or fails the job: the database outage that caused it blocks settlement too, and the queue's liveness and retry rules already cover a worker that cannot reach the database.

The interval and the bound are module constants, not configuration. On a healthy database a read takes milliseconds, so the worst case (cancellation committed just after a read's snapshot, then the rest of that read, one interval, and the next read) stays under 5 seconds. A pool exhausted by long transactions delays a read; the first successful read then applies, as the spec's failure clause states.

This is not liveness. The read writes nothing, signals nothing to the queue, detects no dead or hung worker, and expires nothing; a dead worker's Run is still recovered only by pg-boss's heartbeat, and its recorded cancellation is honored at the reclaim's pickup gate. Neither `durable-runs` nor `job-queue` is modified. A code comment at the check states this distinction so a later reader does not mistake it for the deleted app heartbeat.

Alternatives: one batched read per worker of all locally executing Runs saves transactions but crosses tenants, which the tenant-scoped liveness rule and RLS forbid, or needs one owner-scoped read per owner anyway. Reusing pg-boss's `touch` interval has no hook (Context). A read inside the model stream's chunk loop does not run while a model waits silently, which is the case that matters.

### D3: The check also stops an attempt whose Run another path already ended

A tick that finds the Run `cancelled` or missing aborts with no reason as well. `cancelled` with no stamp covers a same-message retry superseding the Run in another process; missing covers a Chat deleted in another process. Today both rely on the process-local abort and keep spending elsewhere for the same reason as Stop. First-writer-wins keeps the superseded Run's `cancelled` state and its single `run.cancelled` event; a deleted Run has nothing to settle. The read already returns both facts, so this adds a condition, not a mechanism.

Other terminal states do not abort, with or without a recorded cancellation. `completed` and `failed` are written by the executing attempt itself, so a tick landing between that commit and the `finally` would otherwise abort a finished attempt during its stream drain; a Stop that lost that race leaves the Run `completed`, as the spec's "finished first" scenario requires. `expired` while another process executes is unreachable: admission expiry needs the Run's job absent or settled, and dead-letter expiry follows retry exhaustion. When this attempt's own timeout or a co-located Stop wrote the terminal state, its signal is already aborted and the chain has stopped.

The superseding retry is specified in the delta. Chat deletion stays outside `run-cancellation` as before; the worker test pins only that the hanging model request is aborted and no further model request follows. What the worker does with the job after aborting a deleted Run is today's co-located deletion behavior and is not changed here.

### D4: Proof

- Unit (`runs-worker.service.test.ts`, fake timers): a stamped Run aborts at the next tick with no reason; an unstamped running Run is not aborted; a `cancelled` or missing Run aborts; a `completed` or `failed` Run does not; a throwing read neither aborts nor rejects and the following tick still aborts; a read slower than the interval never overlaps the next; the chain stops once the signal is aborted and no read happens after `executeJob` settles; and a worst-case cancellation lands within 5 seconds of being recorded.
- Integration (`worker-liveness.integration.test.ts`, whose harness boots the worker graph without the API controller, so its registry never sees the cancel): stamping `cancel_requested_at` with `requestCancel` and **not** calling the registry settles a hanging Run `cancelled` with `run.cancelled` last and no `run.expired`; two hanging Runs of different owners, one cancelled, leave the other `running_model` across two intervals with no stamp; a supersede written with `cancelActiveRunsForMessage` and its event aborts the hanging model request and leaves exactly one `run.cancelled`; deleting the Chat of a hanging Run aborts its model request. The existing co-located test that calls the registry stays. These cases wait on real 4-second ticks and add roughly 20 seconds to the file.

## Risks / Trade-offs

- [A reintroduces a per-Run timer, which a reader may take for the removed heartbeat] → D2's comment and this design state it is cancellation only; the liveness requirements are untouched and still hold.
- [Up to about 5 seconds of extra spend after Stop in another process] → specified and bounded, against unbounded today.
- [Extra pool load: one short transaction per executing Run every 4 seconds, in every topology, including a single co-located process where the registry alone would suffice] → at concurrency 8 that is 2 transactions per second per worker; detecting the topology is not reliable (multi-replica co-located deployments need the check too), so the check always runs, and `scaling.md` names its cost.
- [A paused-but-alive worker whose job was redelivered keeps executing its stale attempt] → unchanged by this proposal; the attempt fences and first-writer-wins bound it as `durable-runs` already states.
- [A cancellation recorded during the attempt's dispatch transaction can still send the request] → it is aborted within the bound and persists the shipped empty or partial turn; a cancellation fence at dispatch would need its own settlement path and is not proposed.
- [Rollback] → no data, schema, or API change. Reverting the layer restores process-local cancellation; Runs already cancelled keep their state.

## Migration Plan

None. The check applies to attempts that start after deployment; a worker of the previous revision keeps today's behavior until it drains.
