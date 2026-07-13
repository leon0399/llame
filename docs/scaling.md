# Horizontal scaling

How llame's runtime topology scales, what each layer's ceiling is, and the
constraints the durable-run pipeline (#48/#50) must respect to keep horizontal
scaling true. Written against the v0.1→v0.2 architecture (SPEC §9, §23.1,
§24.0.1); update when the worker split lands.

## Topology

```text
            ┌────────────┐         ┌────────────┐
  clients → │  api × N   │         │ worker × M │   (`api` = dist/main.js,
            │ (NestJS,   │         │ (dist/     │    `worker` = dist/worker.js
            │  HTTP+SSE) │         │  worker.js)│    — one image, two
            └─────┬──────┘         └─────┬──────┘    entrypoints, #116)
                  │                      │
                  └───────┬──────────────┘
                          ▼
                   ┌─────────────┐
                   │  Postgres   │  app schema (Drizzle) + `pgboss` schema
                   │  (single)   │  — one database, two connection pools
                   └─────────────┘
```

- **api replicas (N)** are stateless: sessions are DB rows, chat state is DB
  rows, SSE replay reads the DB by cursor. Any replica can serve any request;
  no sticky sessions required.
- **worker replicas (M)** are pg-boss consumers, and the queue is the ONLY
  execution path (inline request-thread execution was removed). Which
  consumers a given process runs — co-located inside `api`, split into a
  dedicated `worker`, or both — is a **worker profile** (below), not a
  hardcoded topology. pg-boss claims jobs with `SELECT … FOR UPDATE SKIP
LOCKED`, so adding workers needs no coordination: M processes polling one
  queue never double-claim a job. This is the same mechanism behind Oban,
  Solid Queue, River, and Graphile Worker — the industry-standard
  Postgres-backed queue design.
- **Postgres** is the deliberate single point of coordination (SPEC §24.0.1:
  no Redis, no separate scheduler). Self-hosted deployments scale it
  vertically; the queue pattern's practical ceiling (thousands of jobs/sec on
  a modest instance) is orders of magnitude above llame's target load.

## Worker profiles — the topology primitive (durable-run-workers D2/D4, #116)

A **worker profile** is a named `{ group → concurrency }` map: which of the
three fixed **consumer groups** — `runs` (RunsWorkerService + its `runs.dead`
DLQ), `search-reindex` (SearchReindexWorker + the 5-minute sweep), and
`sessions-cleanup` (SessionCleanupService) — a process consumes, and each
group's main-queue concurrency. A group absent from the active profile means
that process registers **nothing** for it, not even at concurrency 1.

Configured in `llame.config.json`'s `workers` map, selected at boot by the
`LLAME_WORKER_PROFILE` env var (default `all`). Two profiles are always
available as built-ins (no config file needed):

- **`all`** — every group at concurrency 1. This is today's co-located
  behavior exactly: `main.ts` (the api) with no `LLAME_WORKER_PROFILE` set
  runs all three groups in-process, one debugger target, no compose changes
  required for a small/dev install.
- **`web`** — no groups. An HTTP-only process that enqueues (chat messages,
  reindex jobs) but consumes nothing; pairs with a separate process running
  `all` (or a subset).

Both `apps/api/src/main.ts` (HTTP + whatever its profile covers) and
`apps/api/src/worker.ts` (`NestFactory.createApplicationContext` — no HTTP
server at all) resolve the SAME active profile through `WorkerProfileService`
— there is no separate co-location toggle (no `RUN_EXECUTION_MODE`).
`nest build` compiles the whole `src/` program, so one image produces both
`dist/main.js` and `dist/worker.js`; `pnpm --filter api start:worker:prod`
runs the dedicated entrypoint.

**Fail-closed misconfiguration guards**, enforced at boot:

- A profile referencing a group name that isn't one of the three fixed groups
  fails the JSON Schema validation (`llame.config.schema.json`'s closed
  per-profile shape) — never silently ignored.
- `LLAME_WORKER_PROFILE` naming a profile absent from the configured
  `workers` map throws out of `WorkerProfileService`'s constructor, aborting
  boot — a typo here must never silently run a process with zero consumers.
- **Operator responsibility, not enforced by code**: every group must be
  covered by _some_ deployed profile across the fleet. Running only a `web`
  api with no paired `worker` (or a `worker` profile that omits a group)
  means that group's jobs pile up unrun — the built-in `all` profile
  guarantees coverage by default; a custom split is the operator's choice to
  get right.

**Splitting api/worker in a real deployment** (illustrative — this repo ships
no Dockerfile/production `compose.yaml` yet; adapt to your own image build):

```yaml
services:
  api:
    build: .
    command: node dist/main.js
    environment:
      LLAME_WORKER_PROFILE: web # HTTP only — enqueues, consumes nothing
    ports: ["3001:3001"]

  worker:
    build: .
    command: node dist/worker.js
    environment:
      LLAME_WORKER_PROFILE: all # every group, concurrency 1
    deploy:
      replicas: 3 # `docker compose up --scale worker=3` works the same way
```

**Adding a taint profile** (a job-class pinned to a capable machine — the
first real candidate is the future `embeddings` group, #196): declare a new
named profile in `workers` subscribing to only that group (e.g.
`"heavy": { "embeddings": 2 }`), deploy a process with
`LLAME_WORKER_PROFILE=heavy` on that machine, and drop the group from `all`
(or whichever profile the rest of the fleet runs) so it isn't double-consumed.
No routing/tagging layer is needed — pg-boss's per-queue `work()` subscription
already is the router.

**Connection-pool sizing.** A run holds a database connection for each `runAs`
transaction, so per-process concurrency is bounded by the postgres pool
(`db.poolSize` in `llame.config.json`, default 10, `DB_POOL_SIZE` fallback):
set it **≥ the process's total run concurrency** (the sum of the active
profile's group concurrencies) plus headroom for HTTP requests on a co-located
api. Across the fleet, `Σ(poolSize × replicas)` must stay within Postgres
`max_connections`. The concurrency knob without a matching pool just moves the
bottleneck from the queue to the connection — raise them together.

Run-liveness config changed alongside this (durable-run-workers D7): the
queue's native `heartbeatSeconds` (set via `runs.heartbeatSeconds` in
`llame.config.json`) replaced the old application-level heartbeat +
stale-threshold settings — see `apps/api/src/runs/run-queues.ts`.

## What scales by adding replicas

| Load                          | Scale by                                      | Mechanism                                                                                                                                 |
| ----------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP request throughput       | api replicas                                  | stateless handlers, DB-backed sessions                                                                                                    |
| Concurrent SSE replay streams | api replicas                                  | cursor reads; any replica serves any run                                                                                                  |
| Run execution throughput      | `worker` replicas (`docker scale worker=N`)   | SKIP LOCKED job claiming — independent of api replica count                                                                               |
| Scheduled jobs (cron)         | nothing to do                                 | pg-boss elects a single scheduler internally                                                                                              |
| Per-worker run concurrency    | a profile's `runs` concurrency (design D1/D2) | LLM runs are IO-bound; a worker must hold many streams in flight — `concurrency × replicas` must stay within the Postgres connection pool |
| Job-class isolation (taints)  | a dedicated worker profile (design D2)        | a queue-subset profile on its own machine — no routing layer, see "Worker profiles" above                                                 |
| Rate-limit fairness           | shared ThrottlerStorage (future)              | throttle counters are per-process in-memory today — N api replicas ⇒ N× the ceiling                                                       |

## Invariants that keep this true

These are load-bearing; breaking any of them silently breaks horizontal
scaling correctness (not just performance):

1. **No in-process state that outlives a request.** A run's durable truth is
   the `runs` row + `run_events` log; a client reconnecting to a _different_
   api replica must observe the same stream via the cursor. Anything cached
   in-process (delta buffers, abort controllers) must be reconstructible from
   the DB or scoped to a single live connection.
2. **Terminal status transitions append their `run.<status>` event in the
   same transaction** (see `RunEventType` in `runs-repository.ts`). The SSE
   replay loop's poll-efficiency optimization depends on it.
3. **Tenant isolation is enforced in Postgres (FORCE RLS), not in app
   memory** — replicas can't disagree about authorization.

## Design constraints for the worker split — status after #107

Decided up front so the worker slice wouldn't default into shapes that cap
scaling later. What each became:

1. **Transactional enqueue → implemented as fail-fast + self-heal.** The
   enqueue is NOT transactional with the run row (pg-boss writes through its
   own pool). What ships instead: an enqueue failure immediately fails the
   run in a best-effort transaction (freeing the chat's single-flight slot),
   and residual stuck-`queued` state self-heals — a same-message retry
   supersedes it; a different message sees a 409 that clears once the
   crashed blocker is recovered or dead-lettered by the queue's own liveness
   (design D7 below), not by an app-level stale-heartbeat check at enqueue
   time (that check was deleted alongside the deadman collapse). pg-boss's
   external-transaction `db` option remains the upgrade if those windows
   ever matter.
2. **Per-chat ordering → implemented as exclusivity, not queueing.** The
   partial unique index (`runs_chat_inflight_unique`) admits one non-terminal
   run per chat; a concurrent different message gets **409** (with a
   zombie-expiry unwedge), a same-message retry supersedes. There is no
   per-chat job queue to reorder, so `key_strict_fifo` was unnecessary —
   ordering is client-driven by design.
3. **Worker concurrency — implemented (design D1/D2).** `ConsumeOptions.concurrency`
   maps to pg-boss's native `localConcurrency`: one `work()` registration
   spawns N per-process workers that each settle one job independently (a
   throw fails only that job). Concurrency is a per-**consumer-group** knob
   inside the active worker profile, applied to the group's main queue —
   see "Worker profiles" above.
4. **Live deltas pushed, not polled — open (#118).** The stream bridge polls
   `run_events` at 200ms for the LIVE path today — and with inline execution
   removed this is now EVERY turn's path, which raises #118's priority.
   LISTEN/NOTIFY per-run channels are the planned fix; polling stays for
   resume.
5. **Event-log retention — open (#119).** `model.delta` rows still accumulate
   without bound; a pg-boss cron prunes them for terminal runs.
6. **Deadman → collapsed onto the queue's native heartbeat (design D7).**
   The hand-rolled per-run deadman (app-level `setInterval` heartbeat +
   stale-threshold CAS) is deleted. Liveness is now three mechanisms: an
   in-process wall-clock abort for the alive-but-overrunning case, the
   `runs` queue's native `heartbeatSeconds` (worker death → pg-boss
   fails/retries the job → a healthy worker re-executes it), and a
   `runs.dead` consumer that writes a terminal `run.expired` in the owner's
   tenant scope on retry-exhaustion. `markFinished`'s first-writer-wins
   guard (invariant 2) still makes it race-safe.

Independent worker scaling (a dedicated no-HTTP entrypoint, `worker × M`
separate from `api × N`) is **implemented**: `apps/api/src/worker.ts` boots a
headless `NestFactory.createApplicationContext`, gated by the same worker
profile mechanism as the co-located api. `nest build` emits both
`dist/main.js` and `dist/worker.js` from one image. What's still open: this
repo ships no Dockerfile or production `compose.yaml` yet, so the compose
snippet above is illustrative, not a runnable service — #116's remaining
work is wiring that into whatever image build a deployment uses.

## When Postgres stops being enough

The seams to swap at, in order of likelihood:

- **Queue throughput**: `Queue` interface → BullMQ/Redis (the interface was
  shaped for this; note it does _not_ abstract over workflow engines like
  Temporal — that would be a rearchitecture, not a swap).
- **Delta fan-out**: LISTEN/NOTIFY → Redis pub/sub.
- **Read load**: Postgres read replicas for the SSE replay/read surface.

None of these are expected inside the self-hosted target envelope; the point
of this document is that reaching for them is a swap at a named seam, not a
rewrite.
