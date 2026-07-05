# Horizontal scaling

How llame's runtime topology scales, what each layer's ceiling is, and the
constraints the durable-run pipeline (#48/#50) must respect to keep horizontal
scaling true. Written against the v0.1→v0.2 architecture (SPEC §9, §23.1,
§24.0.1); update when the worker split lands.

## Topology

```text
            ┌────────────┐         ┌────────────┐
  clients → │  api × N   │         │ worker × M │   (every run executes via
            │ (NestJS,   │         │ (pg-boss   │    consumers co-located in
            │  HTTP+SSE) │         │  consumers)│    the api process for now;
            └─────┬──────┘         └─────┬──────┘    the split entrypoint is #116)
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
  execution path (inline request-thread execution was removed): every api
  replica also consumes runs (co-located for v0.2); the dedicated worker
  entrypoint that makes M independent of N is #116. pg-boss claims jobs with
  `SELECT … FOR UPDATE SKIP LOCKED`, so adding workers needs no coordination:
  M processes polling one queue never double-claim a job. This is the same
  mechanism behind Oban, Solid Queue, River, and Graphile Worker — the
  industry-standard Postgres-backed queue design.
- **Postgres** is the deliberate single point of coordination (SPEC §24.0.1:
  no Redis, no separate scheduler). Self-hosted deployments scale it
  vertically; the queue pattern's practical ceiling (thousands of jobs/sec on
  a modest instance) is orders of magnitude above llame's target load.

## What scales by adding replicas

| Load                          | Scale by                                            | Mechanism                                                        |
| ----------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| HTTP request throughput       | api replicas                                        | stateless handlers, DB-backed sessions                           |
| Concurrent SSE replay streams | api replicas                                        | cursor reads; any replica serves any run                         |
| Run execution throughput      | flagged api replicas (#116 for independent workers) | SKIP LOCKED job claiming                                         |
| Scheduled jobs (cron)         | nothing to do                                       | pg-boss elects a single scheduler internally                     |
| Per-worker run concurrency    | `ConsumeOptions` (#117)                             | LLM runs are IO-bound; a worker must hold many streams in flight |
| Rate-limit fairness           | shared ThrottlerStorage (with #116)                  | throttle counters are per-process in-memory today — N replicas ⇒ N× the ceiling |

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
   run in a best-effort transaction (freeing the chat's single-flight slot)
   and every residual stuck-`queued` state self-heals — a same-message retry
   supersedes it; a different message expires it via the stale-heartbeat
   unwedge (`createdAt` counts as last sign of life for a never-started run).
   pg-boss's external-transaction `db` option remains the upgrade if those
   windows ever matter.
2. **Per-chat ordering → implemented as exclusivity, not queueing.** The
   partial unique index (`runs_chat_inflight_unique`) admits one non-terminal
   run per chat; a concurrent different message gets **409** (with a
   zombie-expiry unwedge), a same-message retry supersedes. There is no
   per-chat job queue to reorder, so `key_strict_fifo` was unnecessary —
   ordering is client-driven by design.
3. **Worker concurrency — open (#117).** The worker still settles one job at
   a time; IO-bound LLM runs need many in flight per process.
4. **Live deltas pushed, not polled — open (#118).** The stream bridge polls
   `run_events` at 200ms for the LIVE path today — and with inline execution
   removed this is now EVERY turn's path, which raises #118's priority.
   LISTEN/NOTIFY per-run channels are the planned fix; polling stays for
   resume.
5. **Event-log retention — open (#119).** `model.delta` rows still accumulate
   without bound; a pg-boss cron prunes them for terminal runs.
6. **Deadman → implemented (per-run, tenant-scoped).** Not a cron sweep: each
   run gets a delayed timeout job at enqueue time that re-checks liveness in
   the owner's tenant context (no cross-tenant reaper) and expires stale runs
   with `run.expired` (invariant 2 holds). markFinished's first-writer-wins
   guard makes it race-safe, and markStarted's stale-heartbeat CAS prevents a
   reclaim from double-running a live run.

Independent worker scaling (a dedicated no-HTTP entrypoint, `worker × M`
separate from `api × N`) is #116 — until then, "worker replicas" means
"flagged api replicas".

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
