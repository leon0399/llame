# Horizontal scaling

llame scales API and worker processes around one Postgres database containing
the application and pg-boss schemas.

```text
clients -> api x N ----+
                       +-> Postgres
          worker x M --+
```

- API replicas are stateless: sessions, Chat state, and SSE replay cursors live
  in Postgres; no sticky sessions.
- Worker replicas claim pg-boss jobs with `SKIP LOCKED`. Queue execution is the
  only Run path.
- Postgres is the deliberate coordination point; no Redis or separate
  scheduler.

`dist/main.js` starts HTTP plus the selected worker profile;
`dist/worker.js` starts a no-HTTP application context. One build/image emits
both.

## Worker profiles

`workers` in `llame.config.json` maps profile names to consumer-group
concurrency. `LLAME_WORKER_PROFILE` selects one at boot (default `all`). Fixed
groups:

- `runs`: Run worker plus dead-letter handling;
- `search-reindex`: reindex worker and sweep;
- `sessions-cleanup`: session cleanup;
- `search-embed`: network-bound embedding producer, registered only when a
  model is configured.

Built-ins:

- `all`: every group at concurrency 1; default co-located topology.
- `web`: no consumers; pair with dedicated workers.

Unknown group/profile names fail boot. Code cannot prove fleet coverage;
operators must deploy at least one consumer for every required group. A
web-only fleet accepts jobs that never run.

Illustrative split (the repository still ships no production image/compose):

```yaml
services:
  api:
    command: node dist/main.js
    environment: { LLAME_WORKER_PROFILE: web }
  worker:
    command: node dist/worker.js
    environment: { LLAME_WORKER_PROFILE: all }
    deploy: { replicas: 3 }
```

To isolate a job class, define a profile containing only that group and remove
the group from general profiles. pg-boss queue subscription is the router; add
no parallel routing layer.

## Capacity

A Run holds an application-pool connection during each `runAs` transaction.
Per-process `db.poolSize` must cover Run concurrency plus HTTP headroom.
Postgres capacity must also include pg-boss's separate pool and reserved
operator/migration connections; the fleet total stays below `max_connections`.

| Load           | Scale with                          | Limit                                |
| -------------- | ----------------------------------- | ------------------------------------ |
| HTTP/SSE       | API replicas                        | Postgres read/write capacity         |
| Run execution  | worker replicas/profile concurrency | DB pool and provider capacity        |
| Scheduled jobs | no action                           | pg-boss elects one scheduler         |
| Job isolation  | group-specific profile              | operator profile coverage            |
| Rate limiting  | shared storage (future)             | current counters are per API process |

## Runtime invariants and current limitation

1. Durable Run truth is `runs` plus `run_events`; process state must be
   reconstructable or live-connection-local.
2. Terminal status and `run.<status>` event append in one transaction.
3. Postgres forced RLS owns tenant isolation.

Mid-flight cancellation is process-local. Co-located `all` aborts immediately;
in split topology, API sets `cancel_requested_at` but a worker already streaming
does not receive a cross-process signal and may spend until completion. A
LISTEN/NOTIFY or control-queue channel is required; do not claim full split
cancellation before it ships.

Run liveness uses process wall-clock abort, pg-boss heartbeat/retry, dead-letter
terminalization, and age-based unwedge for queued rows with no active job.
Enqueue is not transactional with the Run row: failure marks the Run failed
best-effort; age unwedge covers a crash between row commit and enqueue.

Per-Chat ordering is exclusivity, not queueing: one nonterminal Run per Chat;
concurrent new messages get 409 and same-message retry supersedes.

## Knowledge mounts

Every Run-accepting API declares the logical `knowledge.root`; provisioning
needs child-create access and every `runs` consumer needs all relevant children.
Different absolute paths must expose the same stable IDs. Missing mounts fail
closed; subset mounts and owner-affinity routing are unsupported. See
[knowledge.md](knowledge.md).

## MCP process multiplication

Every API and worker owns clients and discovery state. Replica count multiplies
remote connections and stdio child processes, including `web` APIs that need a
catalog to author Run snapshots. Catalog divergence settles exact declaration
mismatches as unavailable. See [mcp-tools.md](mcp-tools.md) for configuration
and deployment.

## Open scaling work

- #118: replace 200 ms live-event polling and add cross-process cancellation
  signaling; cursor polling remains for resume.
- #119: prune unbounded terminal `model.delta` history.
- #116: production image/compose for independent workers.

If Postgres becomes the measured limit, swap at existing seams: queue interface
to Redis-backed queue, LISTEN/NOTIFY to pub/sub, then SSE/read paths to replicas.
None is justified inside the current self-hosted envelope.
