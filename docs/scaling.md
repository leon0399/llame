# Horizontal scaling

How llame's runtime topology scales, what each layer's ceiling is, and the
constraints the durable-run pipeline (#48/#50) must respect to keep horizontal
scaling true. Written against the v0.1→v0.2 architecture (SPEC §9, §23.1,
§24.0.1); update when the worker split lands.

## Topology

```
            ┌────────────┐         ┌────────────┐
  clients → │  api × N   │         │ worker × M │   (M = 0 until #50;
            │ (NestJS,   │         │ (pg-boss   │    the chat loop runs
            │  HTTP+SSE) │         │  consumers)│    on the api thread)
            └─────┬──────┘         └─────┬──────┘
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
- **worker replicas (M)** are pg-boss consumers. pg-boss claims jobs with
  `SELECT … FOR UPDATE SKIP LOCKED`, so adding workers needs no coordination:
  M processes polling one queue never double-claim a job. This is the same
  mechanism behind Oban, Solid Queue, River, and Graphile Worker — the
  industry-standard Postgres-backed queue design.
- **Postgres** is the deliberate single point of coordination (SPEC §24.0.1:
  no Redis, no separate scheduler). Self-hosted deployments scale it
  vertically; the queue pattern's practical ceiling (thousands of jobs/sec on
  a modest instance) is orders of magnitude above llame's target load.

## What scales by adding replicas

| Load                          | Scale by                   | Mechanism                                                        |
| ----------------------------- | -------------------------- | ---------------------------------------------------------------- |
| HTTP request throughput       | api replicas               | stateless handlers, DB-backed sessions                           |
| Concurrent SSE replay streams | api replicas               | cursor reads; any replica serves any run                         |
| Run execution throughput      | worker replicas (#50)      | SKIP LOCKED job claiming                                         |
| Scheduled jobs (cron)         | nothing to do              | pg-boss elects a single scheduler internally                     |
| Per-worker run concurrency    | `ConsumeOptions` (planned) | LLM runs are IO-bound; a worker must hold many streams in flight |

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

## Design constraints for the worker split (#48/#50)

Decided up front so the worker slice doesn't default into shapes that cap
scaling later:

1. **Transactional enqueue.** pg-boss connects through its own pool, so a
   naive `tx.insert(runs)` + `queue.enqueue()` is a split-brain risk (run row
   with no job = stuck run; job with no row = worker crash). pg-boss supports
   participating in an external transaction (a `db` executor passed to
   `send`); the `Queue` interface grows an enqueue variant that accepts the
   caller's transaction, with a reconciler sweep (queued runs with no job →
   re-enqueue) as the backstop.
2. **Per-chat ordering, not just mutual exclusion.** A partial unique index on
   `runs` (at most one non-terminal run per chat) is the engine-agnostic
   authority; pg-boss's `key_strict_fifo` policy with `singletonKey = chatId`
   is the queue-level mechanism that also preserves FIFO per chat (naive
   retry-with-backoff can reorder a chat's queued turns).
3. **Worker concurrency.** `consume()` currently settles one job at a time.
   LLM runs are IO-bound (a 60s model stream is ~99% waiting), so a worker
   must run many jobs concurrently — `ConsumeOptions` grows a concurrency
   knob with per-job settlement.
4. **Live deltas are pushed, not polled.** The 500ms `run_events` poll is the
   _resume_ path. When the live stream moves behind the worker, api replicas
   get woken by Postgres `LISTEN/NOTIFY` (per-run channel) rather than
   polling — polling the live path would add up to 500ms of token latency and
   2 queries/sec per open stream. Redis pub/sub is the fall-forward if
   LISTEN/NOTIFY ever becomes the bottleneck; it is deliberately not a v0.2
   dependency.
5. **Event-log retention.** `model.delta` rows are transport buffer, not
   audit — the final text lives in `messages`. A pg-boss cron prunes delta
   events for terminal runs after a retention window; lifecycle events are
   kept. Without this the append-only log grows without bound.
6. **Deadman sweep.** A pg-boss cron expires runs whose heartbeat went stale,
   appending `run.expired` (per invariant 2). This also bounds the blast
   radius of a lost terminal dual-write and is the prerequisite for enforcing
   per-chat single-flight (without it, a crashed run deadlocks its chat).

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
