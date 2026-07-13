# Design: durable-run-workers

## Context

Durable runs shipped as #48/#50/#107: every message is enqueued as a run on the pg-boss `runs` queue; `RunsWorkerService` (co-located in the api process, `OnApplicationBootstrap`) consumes it and drives `RunExecutionService`, which streams model output into an append-only `run_events` log that clients replay (refresh-safe). The invariants are real and shipped but **unspecced** — they live in `docs/scaling.md`'s "Design constraints" list, the runs code, and SPEC §9.5/§23.1. This change writes them down as the `durable-runs` capability spec (verify/refactor against it) and closes the two open constraints:

- **#117** — `PgBossQueueService.consume` calls `boss.work(name, { batchSize: 1 }, …)` and the handler loops `for … await`, so the worker settles **one run at a time**. A 60 s IO-bound model stream blocks every other run on that consumer.
- **#116** — `RunsWorkerService` only boots inside the api process, so "worker replicas" means "api replicas"; there is no independent `worker × M`.

Grounded facts (verified in code):

- **Single-flight is enforced at enqueue**, not in the worker: the partial unique index `runs_chat_inflight_unique` admits one non-terminal run per chat; a concurrent different message 409s, a same-message retry supersedes (`markStarted`). So the `runs` queue never holds two claimable jobs for one chat — **concurrency is inherently across chats**.
- **Reclaim/finish are already race-safe**: `markStarted` refuses terminal runs and reclaims only on a stale heartbeat (CAS on `COALESCE(heartbeat, started, created) < now() - window`); `markFinished` is first-writer-wins. Two consumers racing the same job cannot double-run it.
- **Liveness is currently hand-rolled** (being replaced by D7): each run runs an app-level `setInterval` heartbeat stamping `runs.heartbeatAt`, plus a delayed `runs.timeouts` job whose `checkRunLiveness` poll re-checks the stale threshold in the owner's `runAs` context and expires with `run.expired`. This reimplements a native pg-boss 12 primitive — `heartbeatSeconds` (per-queue/per-job) makes the worker auto-signal liveness while its handler runs and the monitor **fail/retries** the job when the beats stop (types `d.ts` L236–240/393–396/541–544). `RUNS_QUEUE` sets none of it today, which is *why* the deadman was built.
- The queue wrapper's `consume()` already exposes `ConsumeOptions` (currently just `pollingIntervalSeconds`); adding a concurrency knob extends an existing seam. pg-boss's per-queue `work()` model already means a process consumes only the queues it subscribes to — the routing primitive for worker profiles exists, unused.

## Goals / Non-Goals

**Goals:**

- Codify the durable-runs execution contract as a spec (lifecycle/event-stream, single-flight, reclaim/deadman, enqueue resilience, queue substrate) — the baseline implementation is verified/refactored against.
- Per-worker **parallel run execution** (#117) with **per-job settlement** — one run's failure never touches its siblings — and single-flight preserved.
- A **dedicated no-HTTP worker entrypoint** (#116) scalable independent of the api, one image, graceful drain.
- An **extensible worker topology** from one primitive — config-declared worker profiles (a queue-subset + per-queue concurrency) that scale a small install (one all-queues process), a horizontal fleet (`worker × M`), and job-class taints (a heavy queue pinned to a capable host) without a bespoke routing layer.
- **Liveness on the native primitive, not a hand-rolled deadman** — delete the app heartbeat loop, the `runs.timeouts` queue, and the heartbeat columns; use pg-boss's `heartbeatSeconds` (worker-death → fail/retry → healthy-worker re-execute), an in-process wall-clock abort for the alive-but-overrunning case, and a `runs.dead` consumer for tenant-scoped terminal expiry on retry-exhaustion.

**Non-Goals:**

- Push-based live deltas (#118) and `run_events` retention pruning (#119) — separate changes. The spec states the event-stream/retention behavior at the contract level; the mechanisms are theirs.
- Any API-contract change. The only DB-schema change is the liveness collapse's **drop** of the run heartbeat column (D7); the single-flight index and terminal-transition guard are unchanged. The only new run semantics is the liveness collapse's worker-death **recovery** (retry/re-execute) replacing immediate expiry (D7) — everything else (single-flight, first-writer-wins, enqueue self-heal) is codified as-is.
- Cross-worker global run scheduling/fairness beyond what SKIP-LOCKED claiming + single-flight already give.

## Decisions

### D0 — Two capabilities: `job-queue` (substrate) and `durable-runs` (execution)

The queue is **shared** — chat-search's reindex queue + 5-minute sweep cron consume it just as runs do — so it is codified as its own `job-queue` capability, not folded into `durable-runs` (folding shared infra into one consumer is the anti-pattern the projection-tables split avoided). **pg-boss is the engine** of `job-queue`, an implementation detail named here in the design, never a requirement (the spec says "durable queue with retry/DLQ/policy/cron"; pg-boss realizes it). The #117 concurrency work therefore splits: the generic **per-consumer concurrency knob + per-job settlement** is a `job-queue` change (D1); the **run behavior** — runs run in parallel, single-flight holds — is `durable-runs` (D3). **Cron lives in `job-queue`** (`schedule()`/`unschedule()` on the same interface, producing queue jobs) with the load-bearing guarantee that a schedule fires **exactly once per tick across all replicas** — pg-boss dedups per cron slot, unlike per-replica `@nestjs/schedule` timers. That guarantee is verified now precisely because #116 introduces multiple worker replicas that each assert the schedule on boot.

### D1 — Per-consumer concurrency: pg-boss native `localConcurrency`, default 1

`ConsumeOptions` gains `concurrency?: number` (default 1 = today's serial behavior), realized by pg-boss v12's native **`localConcurrency: N`** (verified in `pg-boss@12.25`'s `WorkConcurrencyOptions`): a single `boss.work()` registration spawns N per-process workers that each poll and settle **one job independently** — per-job settlement by construction (a throw fails only that job), no manual ack, no batch-fail footgun. This **supersedes** the change's original "N manual `work()` registrations vs `batchSize:N` + manual per-job ack" framing — both are obsolete now that the primitive exists natively; `batchSize` stays 1 and `stopConsumer` still drains via a single `offWork(wait:true)`. Concurrency is **one knob per consumer-group** inside the worker profile (D2), applied to the group's main queue — not a global worker scalar, so a heavy group and the runs group can carry different N in the same process. Per "multiple threads within one worker … not required", the default is 1. It still gets a DB-backed concurrency integration test (parallelism + independent settlement), not just a code read — the exact class of subtle-semantics footgun a prior review caught on the search REPEATABLE READ fix.

### D2 — Worker profiles: the topology primitive (routing, scaling, taints — one mechanism)

The worker's consumed-queue set is **configuration, not hardcoded**. A **worker profile** declares `{ queue → concurrency }` for the queues a process subscribes to; a process only polls — and thus can only run — queues in its profile. pg-boss's per-queue `work()` model **is** the router: SKIP-LOCKED shares a queue across every process polling it, and a process that never subscribes to a queue never touches it. No custom routing / job-tagging / taint layer is needed — that grounded fact is what makes the whole topology cheap.

This single primitive covers every axis the operator needs:

- **Small install / dev** — the default profile = *all queues* at concurrency 1; one process (co-located api or one `worker`) does everything.
- **Horizontal scale (#116)** — `docker scale worker=N`: N replicas share a profile; SKIP-LOCKED distributes across them.
- **Taint a job-class to a capable machine** — a `heavy` profile subscribing to only `embeddings`, deployed on the beefy host, with `embeddings` dropped from the default profile. **Zero code** — a config entry.
- **Vertical threads within one worker** — per-queue `localConcurrency` (D1).

Config shape: a profile is keyed by **consumer-group name** (a worker service — `runs`, `search-reindex`, …), not raw queue name, because a group encapsulates its own queues — `runs` owns the `runs` queue **and** its `runs.dead` DLQ; `search-reindex` owns the reindex queue **and** the sweep cron queue. The operator tunes a group's *main* concurrency; the group brings its internal/control queues itself, so no one can misconfigure a profile by forgetting an internal queue name. A `workers` map in `llame.config.json` keyed by profile name → `{ group: concurrency }`, selected at boot by `LLAME_WORKER_PROFILE` (default `all`); the underlying routing primitive is still per-queue subscription (`job-queue`), which each group resolves to. **Scope now:** ship the *mechanism* + the default all-groups profile only; **do not** pre-define a second named profile or a heavy-worker deployment — document how to add one and name the phase-2 embedding job (#196) as the first real candidate that will want its own group/profile. pg-boss's DB-coordinated **`groupConcurrency`** (a per-key concurrency cap across nodes) is a *different* axis — the future seam for per-tenant / per-provider (#37) rate caps — named here, deliberately **not built**.

### D3 — Single-flight holds under concurrency (no new locking)

Because single-flight is enforced at **enqueue** (`runs_chat_inflight_unique`), the queue never offers two claimable run-jobs for one chat, so N concurrent consumers physically cannot run two turns of the same chat at once — concurrency is across chats. No per-chat worker lock is added. This is a **spec invariant + a negative test** ("two runs of the same chat never execute concurrently"), not new code.

### D4 — Two entrypoints, one profile resolver (co-location is permanent)

Both `main.ts` (api) and a new `apps/api/src/worker.ts` (`NestFactory.createApplicationContext(WorkerModule)`, no HTTP server) resolve the **same** worker profile (D2) through a shared `resolveWorkerProfile()`; the consumers a process starts are exactly its profile's queues. `WorkerModule` composes `QueueModule` + the run-execution modules (already controller-free and importable post-#106/#107); both entrypoints build from one image (`main.js` / `worker.js`). **Co-location stays a first-class mode, not a footgun**: in dev / single-process the api runs the default all-queues profile in-process — one debugger target, today's behavior — while a multi-process prod compose gives the `worker` service the profile and the api process runs no consumers. This **resolves the prior `RUN_EXECUTION_MODE` open question**: there is no separate co-location toggle — co-located dev is the profile applied to the api process, dedicated prod is the profile applied to `worker × M`, and the same `resolveWorkerProfile()` decides both.

### D5 — Graceful drain on shutdown

`enableShutdownHooks` + an `onApplicationShutdown`/`onModuleDestroy` that calls `stopConsumer` for every registered consumer with `offWork(wait: true)` — draining in-flight runs before the process exits so a deploy/rollout doesn't abandon a mid-stream run (it would otherwise sit invisible until the deadman/stale-heartbeat reclaim). Applies to both the dedicated worker and a co-located worker.

### D6 — Composes with the search reindex (recent work)

The inline lexical reindex at assistant-finalize runs inside the run worker. Under concurrency, N finalizations can reindex concurrently — already safe: same-chat rebuilds are serialized by REPEATABLE READ + retry-on-40001 (chat-search-platform), and cross-chat rebuilds are independent. No change needed; noted so the interaction is on record.

### D7 — Liveness on pg-boss native heartbeat, not a hand-rolled deadman (folded in from grill)

Delete the bespoke deadman; use the native primitive. Three mechanisms, one per failure mode:

1. **Alive-but-overrunning** → an in-process `AbortController` wall-clock timeout in `executeJob` (budget = `runs.timeoutSeconds`; `executeRun` already takes `abortSignal`). The abort is **tagged** so the terminal write is `run.expired` (timeout), distinct from a user `run.cancelled`. No queue job — a healthy worker kills its own overrun.
2. **Worker death** → set `heartbeatSeconds` on `RUNS_QUEUE` (new `QueueOptions` field). pg-boss auto-refreshes the beat while `executeJob`'s promise is pending (the whole run) and its monitor **fails/retries** the job when the beats stop. The retry redelivers → `executeJob`'s existing crash-recovery branch (`runs-worker.service.ts:147–158`, "STALE running run … proceed") re-executes on a healthy worker → the user still gets a result. A **semantics improvement** over the old immediate-expire.
3. **Retry exhaustion** → a new **`runs.dead` consumer** (the DLQ the wrapper already provisions, `pgboss-queue.service.ts:58`) runs `runAs(payload.userId)` and writes terminal `run.expired` + event — tenant-scoped, no cross-tenant reaper, on the dead-letter machinery `job-queue` already specs.

**Deleted:** the `setInterval` heartbeat, `runs.heartbeatAt` (+ the stale-threshold config), the `runs.timeouts` queue, and `checkRunLiveness`. `markStarted`'s reclaim simplifies — pg-boss only redelivers a run whose prior holder stopped beating, so the claim guard is "not terminal + first-writer" rather than an app-level stale-heartbeat CAS; `markFinished` first-writer-wins stays the terminal-outcome safety net. The never-started `queued` special case disappears (an undelivered job is just a pending pg-boss job; a mid-pickup death is an unacked job pg-boss redelivers).

**Third heartbeat site (found in the §1 verify pass):** `chat-loop.service.ts`'s enqueue-time **unwedge** — on a single-flight index violation it reads the blocker's `heartbeatAt`, and if stale expires the blocker and retries the create — also depends on the deleted column/config. It is **deleted, not reimplemented**: with a native liveness monitor a crashed blocker is recovered (re-execute) or dead-lettered (expire) by the queue, freeing the slot at least as fast as the old stale-window did, so the enqueue path collapses to **409 + vanished-retry** (retry the create only if the blocker just finished and the slot is now free). A new message to a chat whose run just crashed sees a transient 409 until the queue frees the slot — comparable to the prior stale-window latency. This also settles a drift the verify surfaced: the spec's "same-message retry supersedes" scenario was never wired (`chat-loop.service.ts:137` rejects a re-used message id as a duplicate before any supersede path runs), so the durable-runs single-flight requirement is narrowed to the enforced reality (duplicate rejected; crashed-blocker recovery via the queue) and a real retry-and-supersede UX is deferred to a follow-up.

**Out of scope (noted, not touched):** `runs.workerId` is a dead column (no caller ever populates it via `markStarted`); dropping it is unrelated cleanup left for a follow-up, not folded into the liveness migration.

**Verify-before-lock:** confirm `heartbeatSeconds` auto-refresh covers a long-pending handler and its `>= 10s` floor, and that a dead-lettered runs job carries its original payload (so the DLQ handler can `runAs(userId)`) — a liveness integration test proves worker-death → re-execute and exhaustion → in-tenant terminal, not just a code read.

## Risks / Trade-offs

- **[pg-boss concurrency primitive]** → RESOLVED: native `localConcurrency` (verified in `pg-boss@12.25`) gives per-job settlement with no manual ack; a concurrency integration test still proves per-job settlement + parallelism before merge.
- **[Worker-profile misconfiguration silently drops a queue]** — a profile that omits a queue means *no* process consumes it (jobs pile up unrun). Mitigation: the default `all` profile consumes everything; a non-default profile is an explicit operator choice; document that every queue must be covered by some deployed profile, and (later) a startup warning if a known queue is unsubscribed anywhere.
- **[Paused-but-not-dead worker → transient double-run]** (D7) — heartbeat-based liveness (native or hand-rolled alike) can misjudge a long GC/stall as death and retry the job while the original worker is still alive, so two workers briefly execute one run (two model calls, double cost/deltas). This risk is **unchanged** from the old app-level `setInterval` heartbeat — inherent to any lease/liveness scheme. Mitigation: `markFinished` first-writer-wins guarantees a single terminal outcome, single-flight keeps it same-chat only, and `heartbeatSeconds` is set conservatively (≥ the longest plausible stall) to make it rare.
- **[Liveness collapse touches shipped #48/#50]** (D7) — deleting the deadman + heartbeat columns and changing worker-death to *recover* rather than *expire* is real surgery on tested code, stacked on the concurrency change that also stresses reclaim. Mitigation: it is codified as its own spec requirements with negative tests (worker-death → re-execute; exhaustion → in-tenant terminal; no double-terminal), and the reclaim path keeps `markFinished` first-writer-wins untouched.
- **[Concurrency × replicas can exhaust the DB pool]** — each in-flight run holds a `runAs` transaction/connection → `concurrency × worker_replicas` must stay within the pg pool. Mitigation: operator config (D2) + a documented sizing formula in `docs/scaling.md`; a conservative default.
- **[More concurrent model calls → provider rate limits / cost]** — parallelism multiplies concurrent provider requests (per-user BYOK limits later, #37). Mitigation: the concurrency dial is the operator's throttle; document it.
- **[Co-located worker still shares the api process's event loop]** until #116's split is deployed — concurrency helps, but true isolation needs `worker × M`. Both ship here; deployment is the operator's choice.
- **[Codifying-then-verifying may surface drift]** — the spec asserts current behavior; implementation may find the code diverges (e.g., an edge in reclaim). That's the point — the fix is to reconcile code to spec, logged as a task, not to weaken the spec.

## Migration Plan

1. Additive (concurrency + profiles): absent config, the default `all` profile runs every queue at concurrency 1 — today's co-located, serial behavior exactly. The `worker.ts` entrypoint + compose `worker` service are new and opt-in.
2. Liveness collapse (D7): set `heartbeatSeconds` on `RUNS_QUEUE` and add the `runs.dead` consumer + in-process abort **in the same deploy** that removes the `setInterval` heartbeat, `runs.timeouts` consumer, and `checkRunLiveness` — the new death-detection must be live before the old is gone. The `runs.heartbeatAt` column drop is a **trailing** migration (code stops reading/writing it first). Any in-flight `runs.timeouts` jobs at deploy time are harmless: their consumer is gone, so they sit until pg-boss retention deletes them (or drain them explicitly).
3. Roll out: deploy the `worker` service (replicas: N) with a profile and drop consumers from the api process; or stay co-located and just raise a queue's concurrency in the `all` profile.
4. Rollback: revert to the `all` profile at concurrency 1 and/or stop running the `worker` service — the co-located path is unchanged. The liveness collapse rolls back as a unit (restore the deadman code + re-add the column) — it is not independently revertible once the column is dropped, so the column drop lands only after the new path is proven.

## Open Questions

_All prior open questions resolved at grill (2026-07-13):_

- **pg-boss primitive** → RESOLVED: native `localConcurrency: N` (verified in `pg-boss@12.25`), a single `work()` registration with per-job settlement — supersedes the N-registrations/manual-ack framing (D1).
- **Concurrency default** → RESOLVED: `1` (behavior-preserving; concurrency is opt-in per subscribed queue, "threads not required") (D1/D2).
- **Co-location gating** → RESOLVED: no `RUN_EXECUTION_MODE` toggle — the worker-profile config subsumes it; both entrypoints share `resolveWorkerProfile()`, co-located dev is that profile on the api process (D4).
- **Job routing / taints** → RESOLVED: queue-subset worker profiles are the router (pg-boss per-queue `work()` + SKIP-LOCKED); ship the mechanism + default `all` profile, defer any second named profile to its first real consumer (#196 embeddings) (D2).
