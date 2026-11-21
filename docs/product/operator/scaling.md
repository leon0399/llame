---
summary: "API and worker topology around one Postgres: profiles, capacity, and limits"
behavior:
  - ../reference/locators/job.md
read_when:
  - you are sizing API and worker replicas or choosing a worker profile
  - you are planning the database pool and job-group coverage
---

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

`workers` in `llame.config.jsonc` maps profile names to consumer-group
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

Both commands run from `apps/api`, so deploy `apps/api/package.json` beside
`dist/`: boot reads llame's version from that manifest and fails startup when
it is absent.

To isolate a job class, define a profile containing only that group and remove
the group from general profiles. pg-boss queue subscription is the router; add
no parallel routing layer.

## Host commands

A foreground host `bash` command that passes `tools.bash.backgroundAfterSeconds`
becomes a job on the worker that runs it, and that worker keeps it until it
ends. Count each such job in `tools.bash.maxProcesses`, and see
[background jobs](background-jobs.md) before a deploy.

## Drizzle v1 RC5 migration upgrade

The RC5 migration runner converts the existing legacy Drizzle ledger to named
migration entries before applying pending migrations. It matches legacy rows
against the complete local migration history by their exact historical
millisecond timestamps. If history is incomplete, ambiguous, out of sequence,
or inconsistent with an existing named ledger, migration stops rather than
guessing or replaying entries. The runner holds a PostgreSQL advisory lock
while preparing the ledger and applying migrations.

RC5 executes ordinary queries without preparing them. Parameterized queries
require an additional protocol round trip compared with the previous driver's
cached prepared statements. This also affects the tenant identity statement
at the start of each request transaction. Keep database network latency in
the deployment's performance checks; a local database measurement does not
predict a remote database's cost.

Treat this as a coordinated maintenance operation:

1. Take a restorable backup of the database before changing the release or
   schema. Include the migration ledger in that backup.
2. Stop all API instances and workers running the old release. Quiesce new
   requests and drain accepted Runs before stopping workers; do not run old and
   new binaries against the database together.
3. With every API and worker stopped, run `pnpm db:migrate` once against the
   target database.
4. Run the RLS provisioning step before serving traffic. In the local
   Docker-based setup this is `pnpm db:provision-rls`; deployments that do not
   use that compose service must run the equivalent provisioning SQL with the
   required superuser privileges. Keep tenant tables' RLS enabled and forced;
   do not weaken `FORCE ROW LEVEL SECURITY` to work around migration errors.
5. Start the API and every worker on the same new release.

The old release is not an automatic rollback target after this ledger-format
upgrade. If migration or provisioning fails, keep the old API and workers
stopped, retain the backup, and stop the rollout. Record the complete error and
investigate the database schema and ledger against the matching migration
history before deciding how to recover. Do not delete or re-stamp ledger rows,
rename applied migration directories, retry by guessing, or restart the old
release against the upgraded ledger. Restore from the pre-upgrade backup only
through the deployment's reviewed recovery procedure.

`pnpm db:provision-rls` runs the repository's SQL that transfers selected
cross-tenant discovery functions to `app_rls` and restores their execute grants;
it does not replace the migration's `ENABLE`/`FORCE ROW LEVEL SECURITY`
statements or grant `app` membership in `app_rls`. See
[`apps/api/src/db/AGENTS.md`](../../../apps/api/src/db/AGENTS.md) for the
migration and provisioning invariants.

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
cancellation before it ships. Owner-facing Stop from acceptance (start frame,
held Stop, settlement) is specified in
[`run-cancellation`](../../../openspec/specs/run-cancellation/spec.md);
issue 207 tracks cross-process abort.

A Run has no default time or step limit: `runs.timeoutSeconds` and
`tools.maxStepsPerRun` are `null` (unlimited) unless the operator sets them.
Liveness uses pg-boss heartbeat/retry and dead-letter terminalization. The
first queue job uses the Run id; later wake jobs use the Run's recorded
`current_job_id` and generation. The `runs` queue declares a job duration of
86,399 s, so pg-boss never expires a live Run at its 900 s default. Without an
operator budget, the worker ends an executing attempt after 23 h 55 m. With
`runs.timeoutSeconds`, the budget starts at the first claim and includes jobs
waits but excludes quota waits. Model requests have separate stream windows:
the first-token timeout is 300 s by default and covers response headers and metadata until
content starts; after content starts, 300 s without a stream part fails the
request. These are model-request timeouts, not a Run-wide execution ceiling.
Set `models[].firstTokenTimeoutSeconds` to a positive integer to override the
300 s first-content window. This server-only setting is not returned in the
owner's model catalog.

Eligible model requests can be retried up to 10 times after the initial send,
using full jitter from 500 ms with exponential backoff capped at 8 s. Short
provider delay hints and authoritative reset times up to 60 s are honored.
Long rate-limit hints fail the request; long non-rate-limit delay hints are
ignored. An eligible step request with a long authoritative reset enters the
quota wait described below. A retry does not replay a completed tool call. Buffered title and summary requests
discard failed output before retrying. `model.retrying` events record the
failure class, retry number, and delay, and the owner sees a retry line.
Failed first-token windows use `first_token_timeout`; broken streams use
`stream_broken`. The removed `model_stream_idle` code is not emitted.

A transient failure after live output restarts that step on the same model when
no complete tool call has streamed. Its `model.superseded` event removes the
broken send's text and reasoning from the live transcript, stored Reply, and
later model input; the append-only event log retains them. Completed earlier
steps and committed context items remain in order. Hidden retries and step
restarts share the same ten-retry allowance, and discarded sends make usage
incomplete while retaining known token and cost totals as lower bounds.

Admission judges a blocking Run by its current queue job: queued, retrying, or
active blocks with 409. An absent recorded wake job is stuck immediately; the
first job retains its one-heartbeat enqueue grace. Owner-started first enqueue
is not transactional with the Run row: failure marks the Run failed
best-effort, and a crash between row commit and enqueue leaves a job-less Run
that the next message expires. Host-started first enqueue is transactional.
A deploy stops workers after a 30 s drain, and pg-boss retries their Runs.

The internal suspension service persists `awaiting_jobs` and its delayed
deadline job together, then releases the Run worker slot. Suspension keeps the
Chat's single-flight slot. Settlement, steering, cancellation, or the deadline
can queue one generation-fenced wake; a replacement worker reads its state
from Postgres. This layer prepares that lifecycle but exposes no `wait` tool.

A step request that fails with `quota_exhausted` or `rate_limited` and an
authoritative reset more than 60 seconds away enters `awaiting_quota`, provided
the reset is no more than `runs.quotaWaitMaxSeconds` away (default 691,200,
eight days), no tool call has started, and this logical request has waited
fewer than four times. The setting must be a positive integer. A missing
reset, one beyond the cap, a started tool call outside a Run step, or an
exhausted wait allowance ends the request with its failure class. Completed
tool calls are never replayed. The checkpoint omits failed-send output, retains
completed steps and context, and releases the worker while keeping the Chat in
single-flight. The deadline job sends again after reset plus 60 seconds and
0-18 seconds of jitter. Each logical request can wait once and re-wait three
times; recovery and redelivery retain that count until the request succeeds.

A Run step that streamed a complete tool call before it failed parks the same
way, after each started call settles. The entry transaction stores the kept
parts of that send and its `provider-failure` notice, and names the cut. The
failed step counts as one completed step against the cap, and the wait count
carries to it because the failed step records no recovery.

Quota wait time does not count toward `runs.timeoutSeconds`; each claim keeps
its own execution ceiling. Only the deadline or Stop wakes a quota wait.
Steers, interrupts, queued deliveries, and job notices remain pending; a plain
send still gets 409. After the wake, the failed request is sent before pending
items reach its next step boundary. A send that started a tool call instead
delivers pending items at the boundary, and only then sends the next step from
its checkpoint, so the steer reaches the model before that request. Stop
cancels rather than promoting a pending steer. The API stream stays open,
polling every two seconds while the Run waits and sending a keepalive comment
after 15 quiet seconds.

Compaction summaries on the Run's own model use the same quota wait, including
pre-dispatch, step-boundary, final-answer, and manual compaction Runs. This
includes a context-window summary when it selects that same configured model
entry. A wake replans the summary with its existing wait count, original
automatic or owner-requested mode, original command set and focus, and remaining
segment step allowance. Commands queued during the summary wait remain for the
next boundary; final-answer settlement still consumes commands pending at its
terminal lock. Successful checkpoint publication ends that request's allowance
in the same transaction; a later request starts a new allowance.

A final-answer wake summarizes and settles the stored reply without sending
or admitting its main request again. Its first-epoch baselines remain those the
answering request received. Resumed step-boundary summaries use stored replay,
not items the wake staged but never dispatched, reuse the original system-prompt
receipt, and require matching tool declarations. An unavailable or changed
prefix records a compaction failure without sending a substituted summary
request or publishing a checkpoint.
An in-Run summary whose reset exceeds the cap still continues without a
checkpoint. A context-window summary that selects another configured model
remains a side call: it fails `context_incompatible` rather than waiting on
that other model.

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
remote connections and stdio child processes, and each worker composes its
attempt's admitted catalog from its own discovery. An execution-time declaration
mismatch settles that tool unavailable. See [mcp-tools.md](mcp-tools.md) for
configuration and deployment.

## Live updates

Every API process holds one dedicated LISTEN connection for live updates
(`/api/v1/live`). Workers hold none.

- LISTEN needs a persistent session. Point `POSTGRES_URL` at Postgres directly
  or at a session-mode pooler. Through a transaction-mode pooler (PgBouncer
  `pool_mode = transaction`) the API starts and accepts sockets, but updates
  can stop arriving without an error.
- Count one extra connection per API replica toward `max_connections`.
- Postgres serializes the commit of every transaction that sends a NOTIFY. Run
  event inserts notify, so concurrent streaming Runs share that lock (#1304).
- A listener that stops reading can fill the notification queue, after which
  every notifying write fails. The API only parses and enqueues each
  notification, so this needs a stalled process, not load.

## Open scaling work

- #118: replace 200 ms live-event polling and add cross-process cancellation
  signaling; cursor polling remains for resume.
- #119: prune unbounded terminal `model.delta` history.
- #116: production image/compose for independent workers.
- #1304: stop notifying on streamed delta inserts once commit contention is
  measured.

If Postgres becomes the measured limit, swap at existing seams: queue interface
to Redis-backed queue, LISTEN/NOTIFY to pub/sub, then SSE/read paths to replicas.
None is justified inside the current self-hosted envelope.

## Background jobs

Each worker process that consumes runs records a heartbeat every
`runs.heartbeatSeconds`. A worker with no heartbeat for four intervals is dead,
and its running jobs settle as `lost` at their next touch. The Chat list and
the live Chat record count only the jobs on a worker that is not dead.

Job-row changes push the owner's full Chat record after commit. While an owner
has sockets on an API process, that process also refreshes the job counts on the
`runs.heartbeatSeconds` cadence. Each period adds one owner-scoped grouped read
per connected owner with stored running jobs, plus full-record reads for changed
counts. Several sockets of one owner share that process's loop; connections to
different API processes each incur their own reads.

The loop starts at subscription, reconnect and a job change. It continues while
stored running rows remain, even when every worker lease expired and the live
count is zero, so a late heartbeat restores the count. It stops when no running
row remains, the last socket leaves, or the API shuts down. These display reads
settle no job and start no Run.

At each heartbeat the hosting worker retries pending job settlements and then
checks each hosted job under its owner's identity. A recorded stop request,
a deleted row, or a row already settled elsewhere ends the hosted command.
One failed lookup does not delay the checks of other jobs. A completed job's
stored state and result never change when its old worker resumes.

The owner lists the jobs of a Chat with `GET /api/v1/chats/:chatId/jobs`, the
running jobs first. `PATCH /api/v1/chats/:chatId/jobs/:jobId` with
`{ "state": "cancelled" }` records a stop request from the owner. A repeat for a
job that the owner stopped answers 200, a job in any other settled state answers
409, and a Chat or job of another owner answers 404. The reader behind these
rows is documented under [job://](../reference/locators/job.md).

Each job response includes `truncated`, the names of outputs cut by their byte
bound. An uncut output is absent from that list;
no cut outputs means `[]`. Both the list and stop response retain this detail.
