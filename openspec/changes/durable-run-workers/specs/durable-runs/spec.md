# Delta: durable-runs

## ADDED Requirements

### Requirement: Every message executes as a durable, resumable run

A user message SHALL become a worker-processed **run** whose progress is an append-only, replayable event log; a client SHALL be a subscriber to that log, not the holder of run state, so a page refresh or reconnect resumes an in-flight run and replays a completed one without loss. There SHALL be no inline (request-thread) execution path — the worker is the sole executor.

#### Scenario: Refresh mid-run resumes from the event log

- **WHEN** a client refreshes or reconnects while a run is streaming
- **THEN** it resubscribes to the run's event log and continues without losing prior deltas or the final result

### Requirement: One in-flight run per chat (single-flight)

At most one non-terminal run SHALL exist per chat, enforced **at the datastore** (a partial unique index over non-terminal runs), not by application checks alone. A second message for a chat that already has an in-flight run SHALL be rejected with a conflict (409); a retry of the SAME message SHALL supersede the prior non-terminal attempt rather than create a second run.

#### Scenario: Concurrent different message is refused

- **WHEN** a chat has a non-terminal run and a different message is submitted for it
- **THEN** the second submission is rejected (409), and the first run is unaffected

#### Scenario: Same-message retry supersedes

- **WHEN** the same message is retried while its prior attempt is non-terminal (e.g. after a lost response)
- **THEN** the prior attempt is superseded (cancelled) and a single run proceeds — never two

### Requirement: Run claiming and completion are crash-safe

A worker SHALL claim a run only if it is non-terminal; a run already marked running SHALL be re-executed only after the queue substrate has determined its prior holder is no longer alive (redelivering the job per the native worker-liveness path), so two live workers racing the same run cannot both execute it. Completion SHALL be first-writer-wins: once a run is terminal, no later writer may change its outcome — this is the safety net that keeps even a transient two-worker overlap (a paused-but-not-dead worker) to a single terminal result.

#### Scenario: Two workers race one run

- **WHEN** two workers attempt to claim/execute the same run
- **THEN** exactly one executes it; the other's claim is refused (not stale) and it does not double-run

#### Scenario: Terminal run is immutable

- **WHEN** a late writer (a lagging worker, a deadman check) tries to mutate a run that has already reached a terminal state
- **THEN** the write is rejected and the recorded terminal outcome stands

### Requirement: A run never stays stuck, enforced without a cross-tenant reaper

A run SHALL NOT remain non-terminal indefinitely, and its liveness SHALL be enforced with **no cross-tenant scan** — every liveness action runs either in-process on the executing worker or in the run owner's tenant scope. Three mechanisms cover the failure modes:

- **In-process time budget** — while its worker is alive, a run that exceeds a configured wall-clock budget SHALL be aborted in-process and recorded as a terminal `run.expired` (distinct from a user-requested `run.cancelled`).
- **Worker-death recovery** — if the executing worker dies or hangs (stops signalling liveness), the run's job SHALL be detected as stalled by the `job-queue` substrate (see its native worker-liveness requirement) and retried, so a healthy worker re-executes the run rather than leaving it orphaned. Re-execution is safe because claiming and completion are crash-safe (single-flight, first-writer-wins).
- **Tenant-scoped terminal expiry** — a run whose job exhausts its retries SHALL be settled to a terminal `run.expired` state in the run owner's tenant scope, via the queue's dead-letter path, with no cross-tenant scan.

There SHALL be no application-level liveness poll or per-run "deadman" job; native queue heartbeat drives worker-death detection.

#### Scenario: An overrunning run is aborted in-process

- **WHEN** a run exceeds its wall-clock budget while its worker is alive
- **THEN** the worker aborts it in-process and records a terminal `run.expired` — no separate liveness job is involved

#### Scenario: A dead worker's run is recovered, not orphaned

- **WHEN** the worker executing a run dies mid-run
- **THEN** the queue detects the stalled job and retries it, and a healthy worker re-executes the run — the run does not sit non-terminal forever

#### Scenario: Retry exhaustion expires the run in-tenant

- **WHEN** a run's job exhausts its retries (e.g. it keeps killing its worker)
- **THEN** it is settled to a terminal `run.expired` in the owner's tenant scope via the dead-letter path — without any cross-tenant scan

### Requirement: Enqueue is fail-fast and self-healing

Enqueuing a run SHALL NOT be assumed transactional with the run row. An enqueue failure SHALL immediately fail the run (freeing the chat's single-flight slot); any residual `queued`-but-orphaned state SHALL self-heal — a same-message retry supersedes it, a different message expires it via the stale-liveness path — with no manual cleanup.

#### Scenario: Enqueue failure frees the slot and self-heals

- **WHEN** the run row is written but the enqueue then fails
- **THEN** the run is failed (freeing the chat's single-flight slot), and no orphaned `queued` state persists beyond the self-heal window

### Requirement: Run failures are classified — infra retries, model failure is terminal

Runs SHALL execute on the `job-queue` substrate. An **infrastructure** failure (credential resolution, DB unavailability, a thrown handler) SHALL be retried by the queue's retry/dead-letter policy (see the `job-queue` capability). A **run-level** failure (e.g. a model error) SHALL instead be recorded durably as the run's terminal state, and the queue job SHALL still succeed — re-running a turn whose failure is already the source of truth is never correct.

#### Scenario: Model-error run is terminal and the job succeeds

- **WHEN** a run fails at the model level (durably recorded as the run's terminal state)
- **THEN** the queue job completes successfully and is not retried

#### Scenario: Infra failure retries via the queue

- **WHEN** a run's execution throws for an infrastructure reason
- **THEN** the queue retries the job (per `job-queue`'s retry policy), rather than the run being left terminally failed on a transient cause

### Requirement: Runs execute in parallel across chats

A worker SHALL execute up to an **operator-configured concurrency** of runs in parallel (via the `job-queue` per-consumer concurrency) — an IO-bound model stream MUST NOT serialize the others behind it. Because `job-queue` settles each job independently, one run's failure or retry never affects a sibling run executing alongside it.

#### Scenario: Concurrent runs of different chats execute in parallel

- **WHEN** several chats each have a run enqueued and a worker's concurrency is greater than one
- **THEN** those runs execute in parallel, and a long IO-bound run does not block the others

### Requirement: Single-flight holds under concurrency

Even with a worker executing many runs in parallel, two runs of the **same chat** SHALL NEVER execute concurrently — guaranteed by single-flight at enqueue (the queue never offers two claimable runs for one chat), so parallelism is inherently across distinct chats.

#### Scenario: Same-chat runs never overlap

- **WHEN** a worker runs at concurrency greater than one
- **THEN** no two runs belonging to the same chat are ever executing at the same instant

### Requirement: The worker can run as a dedicated process, scaled independently

Run execution SHALL be bootable as a **standalone process with no HTTP surface**, composed from the same image as the api, so worker processes scale independently of api replicas. The process SHALL run runs by subscribing to the runs queue through a **worker profile** (per the `job-queue` capability); run throughput SHALL scale as per-queue concurrency × the number of processes subscribed to the runs queue. Co-locating run execution in the api process and running it in a dedicated worker SHALL be the *same* profile mechanism applied to different processes — not two separate execution code paths — so a single-process (co-located) deployment and a `worker × M` deployment share one boot path.

#### Scenario: Headless worker scales separately from the api

- **WHEN** the deployment runs the worker entrypoint (subscribed to the runs queue) with N replicas alongside the api's own replicas
- **THEN** run throughput scales with the worker replicas independent of api replicas, and the worker serves no HTTP

#### Scenario: Co-located and dedicated execution are one mechanism

- **WHEN** run execution is co-located in the api process (single-process/dev) and, separately, run in a dedicated worker (production)
- **THEN** both are the same worker profile applied to different processes, with no divergent execution path between them

### Requirement: Workers drain gracefully on shutdown

On shutdown, a worker SHALL stop claiming new jobs and finish (drain) in-flight runs before exiting, so a deploy or rollout does not abandon a mid-stream run (which would otherwise be recovered only later via the stale-liveness/deadman path).

#### Scenario: Shutdown drains in-flight runs

- **WHEN** a worker receives a shutdown signal while runs are in flight
- **THEN** it stops accepting new jobs and lets the in-flight runs finish (or reach a safe point) before the process exits
