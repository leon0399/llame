# durable-runs

## Purpose

**durable-runs** is the worker-processed execution of chat runs _on_ the `job-queue` substrate: every user message becomes a run whose progress is an append-only, replayable event log a client subscribes to (refresh-safe), with the worker as the sole executor (no inline request-thread path). It owns the run lifecycle contract — per-chat single-flight (one non-terminal run per chat, enforced at the datastore) with job-state recovery of a stuck run whose queue job can no longer execute it; crash-safe claim/finish (claim-if-non-terminal, first-writer-wins completion); liveness enforced with no cross-tenant reaper (no default time or step limit; an opt-in in-process wall-clock budget, a worker-side execution ceiling below the queue's job duration, and a model-stream idle watchdog + native queue-heartbeat worker-death recovery + dead-letter terminal expiry in the owner's tenant scope); fail-fast + self-healing enqueue; failure classification (infra retries, model failure is terminal-but-job-succeeds); parallel execution across chats via the queue's per-consumer concurrency; and a dedicated no-HTTP worker process that scales independently of the api via the same worker-profile mechanism, draining gracefully on shutdown.

## Requirements

### Requirement: Every message executes as a durable, resumable run

A user message SHALL become a worker-processed **run** whose progress is an append-only, replayable event log; a client SHALL be a subscriber to that log, not the holder of run state, so a page refresh or reconnect resumes an in-flight run and replays a completed one without loss. There SHALL be no inline (request-thread) execution path — the worker is the sole executor.

#### Scenario: Refresh mid-run resumes from the event log

- **WHEN** a client refreshes or reconnects while a run is streaming
- **THEN** it resubscribes to the run's event log and continues without losing prior deltas or the final result

### Requirement: One in-flight run per chat (single-flight)

At most one non-terminal run SHALL exist per chat, enforced **at the datastore** (a partial unique index over non-terminal runs), not by application checks alone. A second, _different_ message for a chat that already has an in-flight run SHALL be rejected with a conflict (409). Re-submitting an already-accepted message id SHALL be rejected as a duplicate — a message never produces two runs. A run whose worker has died mid-execution SHALL be recovered or expired by the `job-queue` substrate (worker-death recovery / dead-letter).

Each run SHALL be enqueued as the job named by the run's own id (per `job-queue`'s named-job requirement), so the single-flight admission path can judge a blocking run from its own job's state rather than from the run's age. A blocking run whose job is queued, retrying, or active SHALL be treated as live: the new message is rejected (409), however long the run has existed. A blocking run whose job is absent, completed, failed, or cancelled SHALL be treated as **stuck** — the queue can no longer execute it (a job never enqueued after a crash, or a job that settled without settling its run) — and SHALL be expired by the admission path on the next message, so a stuck run can never wedge a chat permanently. A run younger than one liveness window (`runs.heartbeatSeconds`) whose job is absent SHALL be treated as live, because its enqueue may still be in flight. A job state admission cannot read within a bounded wait, or at all, SHALL be treated as live, never as stuck. Admission SHALL read only the job named by the blocking run's id, and only for a run visible in the requesting owner's tenant scope; it SHALL NOT scan the queue or read another owner's run or job.

#### Scenario: Concurrent different message is refused

- **WHEN** a chat has a non-terminal run whose job is queued, retrying, or active, and a different message is submitted for it
- **THEN** the second submission is rejected (409), and the first run is unaffected

#### Scenario: A long-running live blocker is never expired by age

- **WHEN** a chat's run has been executing for hours with its job active, and a different message is submitted
- **THEN** the submission is rejected (409) and the running run continues

#### Scenario: A duplicate message id is rejected

- **WHEN** a message id that already has a run is submitted again
- **THEN** it is rejected as a duplicate; a second run is never created for the same message

#### Scenario: A stuck blocker cannot wedge a chat forever

- **WHEN** a non-terminal run older than one liveness window has no job, or its job is completed, failed, or cancelled, and a new different message arrives
- **THEN** the admission path expires the stuck run with a terminal `run.expired` and admits the new message, rather than 409-ing the chat indefinitely

#### Scenario: An unreadable job state never expires a run

- **WHEN** a chat's run is old enough to be stuck and admission cannot read its job state, because the read fails or does not answer in time
- **THEN** the submission is rejected (409) and the run is neither expired nor otherwise changed

#### Scenario: A queued run blocks during a worker outage

- **WHEN** no worker is consuming the runs queue, a chat's run is still queued, and a different message is submitted
- **THEN** the submission is rejected (409) and the queued run executes once a worker returns

#### Scenario: Another owner's run is never judged

- **WHEN** a caller submits a message naming another owner's chat whose run is live or stuck
- **THEN** the request is rejected as not found, no job state is read, and that run is neither expired nor revealed

### Requirement: Run claiming and completion are crash-safe

A worker SHALL claim a run only if it is non-terminal; a run already marked running SHALL be re-executed only after the queue substrate has determined its prior holder is no longer alive (redelivering the job per the native worker-liveness path), so two live workers racing the same run cannot both execute it. Completion SHALL be first-writer-wins: once a run is terminal, no later writer may change its outcome — this is the safety net that keeps even a transient two-worker overlap (a paused-but-not-dead worker) to a single terminal result.

#### Scenario: Two workers race one run

- **WHEN** two workers attempt to claim/execute the same run
- **THEN** exactly one executes it; the other's claim is refused (not stale) and it does not double-run

#### Scenario: Terminal run is immutable

- **WHEN** a late writer (a lagging worker, a deadman check) tries to mutate a run that has already reached a terminal state
- **THEN** the write is rejected and the recorded terminal outcome stands

Every queue-authorized claim or reclaim SHALL atomically assign a fresh trusted `activeAttemptId` persisted on the Run. Successful completion SHALL record `completedAttemptId`. These identifiers SHALL not reuse or overwrite `workerId`, which remains native executor authority. Attempt-owned events SHALL carry their attempt id so projections can select the winner; Run-level queue/cancellation events need no fabricated attempt. Context preparation, receipt publication, new invocation admission, and successful finalization SHALL verify their expected attempt id against the Run's current attempt. A superseded worker SHALL not start new admitted effects or publish an answer, attempt context, or availability baseline. Already admitted native effects retain their existing settlement/unknown-outcome rules, including when dispatch has not yet been observed. The native executor identity and durable native effect-recovery fence SHALL remain authoritative before starting a fresh model loop.

Native effect admission SHALL check the trusted owner, non-terminal uncancelled Run state, and expected `activeAttemptId` atomically with recording the existing durable native effect fence, before dispatch. An earlier preparation-time identity check SHALL not authorize that admission. After admission, an effect without a recorded result SHALL be treated as potentially executed during reclaim, even if the old worker paused before dispatch. Recovery SHALL apply the existing native unknown-outcome rules before any fresh model loop and SHALL NOT authorize duplicate execution; recording a new attempt id does not clear the effect fence.

#### Scenario: Reclaim precedes native effect admission

- **WHEN** attempt A pauses after preparation and attempt B reclaims the Run before A admits a native mutation
- **THEN** A's conditional admission is refused and it dispatches no mutation
- **AND** no stale effect record is admitted

#### Scenario: Reclaim follows admission but precedes observed dispatch

- **WHEN** A records native effect admission and pauses before dispatch, then B reclaims the Run without a recorded effect result
- **THEN** B treats the admitted operation as potentially executed and applies the existing unknown-outcome recovery rules
- **AND** B starts no fresh model loop or duplicate mutation while that effect is unsettled, even if A later resumes dispatch

#### Scenario: Superseded worker attempts late publication

- **WHEN** queue recovery starts attempt B and attempt A later tries to publish context or complete the Run
- **THEN** A's stale write is refused even if the Run is still non-terminal
- **AND** only the active attempt can publish a successful turn and availability record

#### Scenario: Successful context publication is atomic

- **WHEN** the active attempt commits a successful assistant turn
- **THEN** the assistant message, exact attempt-owned context text, context-derived chat-state updates, minimal availability record, and terminal completion commit atomically
- **AND** a transaction failure publishes none of those updates

### Requirement: A run never stays stuck, enforced without a cross-tenant reaper

A run SHALL NOT remain non-terminal indefinitely, and its liveness SHALL be enforced with **no cross-tenant scan** — every liveness action runs either in-process on the executing worker or in the run owner's tenant scope. A run that keeps making progress SHALL have **no default limit** on its duration or step count: it ends when the model answers, when the owner cancels it, or by one of the mechanisms below. These mechanisms cover the failure modes:

- **Optional in-process time budget** — when the operator configures `runs.timeoutSeconds`, a run that exceeds that wall-clock budget while its worker is alive SHALL be aborted in-process and recorded as a terminal `run.expired` (distinct from a user-requested `run.cancelled`). Without a configured budget, no wall-clock budget applies.
- **Execution ceiling** — the executing worker SHALL end any run still executing 23 hours 55 minutes after its current execution attempt started, recording a terminal `run.expired` whose message names the execution ceiling rather than a configured budget. The ceiling SHALL fall before the `runs` queue's declared job duration (per `job-queue`), so the queue never fails and re-executes a live run from its beginning because of its age.
- **Model stream idle watchdog** — while the worker reads a model's streamed response, a request that yields no streamed part for 300 seconds after it is sent, or for 300 seconds after its previous part, SHALL be aborted, and the run SHALL be recorded as terminally failed with the error code `model_stream_idle` on the run's error and in its `run.failed` event. The watchdog SHALL measure only time spent waiting on the model's response; time spent executing tools SHALL never count toward it. It SHALL NOT retry the request.
- **Worker-death recovery** — if the executing worker dies or hangs (stops signalling liveness), the run's job SHALL be detected as stalled by the `job-queue` substrate (see its native worker-liveness requirement) and retried, so a healthy worker re-executes the run rather than leaving it orphaned. Re-execution is safe because claiming and completion are crash-safe (single-flight, first-writer-wins).
- **Tenant-scoped terminal expiry** — a run whose job exhausts its retries SHALL be settled to a terminal `run.expired` state in the run owner's tenant scope, via the queue's dead-letter path, with no cross-tenant scan.

There SHALL be no application-level liveness poll or per-run "deadman" job; native queue heartbeat drives worker-death detection.

#### Scenario: A progressing run has no default time limit

- **WHEN** no wall-clock budget is configured and a run keeps making model and tool progress for longer than the substrate's default job expiry
- **THEN** the run continues until the model answers, and it is neither expired nor re-executed from its beginning

#### Scenario: An overrunning run is aborted in-process

- **WHEN** the operator configured a wall-clock budget and a run exceeds it while its worker is alive
- **THEN** the worker aborts it in-process and records a terminal `run.expired` — no separate liveness job is involved

#### Scenario: A run reaching the execution ceiling ends before the queue expires it

- **WHEN** a run is still executing 23 hours 55 minutes after its current execution attempt started
- **THEN** the worker records a terminal `run.expired` whose message names the execution ceiling
- **AND** the queue does not fail or retry the job

#### Scenario: A stalled model stream fails the run

- **WHEN** a model request yields no streamed part for 300 seconds, before its first part or between two parts
- **THEN** the request is aborted and the run is recorded as terminally failed with error code `model_stream_idle`
- **AND** the parts observed before the stall remain in the run's record and the request is not retried

#### Scenario: A long tool call does not trip the stream watchdog

- **WHEN** a tool call executes for longer than 300 seconds between two model requests
- **THEN** the stream watchdog does not fire, and the next model request starts with a fresh 300-second window

#### Scenario: A dead worker's run is recovered, not orphaned

- **WHEN** the worker executing a run dies mid-run
- **THEN** the queue detects the stalled job and retries it, and a healthy worker re-executes the run — the run does not sit non-terminal forever

#### Scenario: Retry exhaustion expires the run in-tenant

- **WHEN** a run's job exhausts its retries (e.g. it keeps killing its worker)
- **THEN** it is settled to a terminal `run.expired` in the owner's tenant scope via the dead-letter path — without any cross-tenant scan

### Requirement: Enqueue is fail-fast and self-healing

Enqueuing a run SHALL NOT be assumed transactional with the run row. An enqueue failure SHALL immediately fail the run (freeing the chat's single-flight slot); any residual `queued`-but-orphaned state SHALL self-heal — a same-message retry supersedes it, and a different message expires it through single-flight admission once the run has no job and is older than one liveness window — with no manual cleanup.

#### Scenario: Enqueue failure frees the slot and self-heals

- **WHEN** the run row is written but the enqueue then fails
- **THEN** the run is failed (freeing the chat's single-flight slot), and no orphaned `queued` state persists beyond one liveness window once a different message arrives

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

Run execution SHALL be bootable as a **standalone process with no HTTP surface**, composed from the same image as the api, so worker processes scale independently of api replicas. The process SHALL run runs by subscribing to the runs queue through a **worker profile** (per the `job-queue` capability); run throughput SHALL scale as per-queue concurrency × the number of processes subscribed to the runs queue. Co-locating run execution in the api process and running it in a dedicated worker SHALL be the _same_ profile mechanism applied to different processes — not two separate execution code paths — so a single-process (co-located) deployment and a `worker × M` deployment share one boot path.

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

### Requirement: Final assistant-message projection preserves replay order

The final assistant message written for a run SHALL be an ordered projection of the same reasoning, text, and tool activity represented by the durable run-event log. It SHALL not regroup all reasoning before tools or all text after tools. A partial message persisted after a model error SHALL retain the same ordering rule for every part observed before failure.

#### Scenario: Completed run projects event order into message parts

- **WHEN** a completed run emits reasoning, text, tool activity, reasoning, and text in that order
- **THEN** its assistant message stores parts in that same order

#### Scenario: Failed run projects observed part order

- **WHEN** a run emits reasoning and text before a model error
- **THEN** its partial assistant message retains the observed reasoning-before-text order

The prospective cutover boundary in `context-injection` SHALL govern these publication rules; existing conversation state SHALL not be retrospectively filtered or rebuilt.

Operational and UI replay SHALL retain a failed attempt's observed part order, and that persisted record SHALL become model history. A failed, cancelled, expired, or superseded attempt keeps the partial assistant turn the user saw, entering later model context, model-facing recall, and compaction like any other committed turn. Only attempt-owned staged rail context withholds until a successful turn publishes it. Within a successful attempt, an individually failed tool call remains a normal paired observation.

A Run's first model request MAY be preceded by a compaction checkpoint that publishes before that request. The checkpoint row and the re-baked epoch state it names SHALL commit in one transaction before the model request, and SHALL be retained when that attempt later fails, cancelled, or expires: a checkpoint describes committed history only, so it is correct regardless of the attempt's outcome. A checkpoint row is committed history, not attempt-owned staged rail context, and SHALL NOT be withheld or retracted on the attempt's outcome. A later attempt of the same Run SHALL reuse the published checkpoint rather than pay a second summary call.

#### Scenario: Failed attempt output stays visible and is model history

- **WHEN** an attempt streams reasoning, text, or tool results and then fails
- **THEN** operational/UI replay retains the observed order
- **AND** that partial output remains part of the record and enters later model context, recall, and compaction like any other committed turn, while its staged rail items never publish

#### Scenario: A checkpoint published before a failed attempt survives it

- **WHEN** an attempt publishes a compaction checkpoint and its re-baked epoch state before its first model request and that request then fails
- **THEN** the checkpoint row and the epoch state it names remain committed
- **AND** the Run's next attempt replays the same checkpoint instead of summarizing the same prefix again

#### Scenario: Fresh retry succeeds after an earlier failure

- **WHEN** attempt B succeeds after attempt A failed
- **THEN** the committed assistant turn and availability baseline derive only from B
- **AND** A's events cannot be merged into B's assistant projection

### Requirement: Received reasoning is durable before browser delivery

Each normalized reasoning delta received by llame SHALL be durably recorded before it is forwarded to a browser stream. The run transcript SHALL retain deltas received before either a worker failure or an upstream provider failure, and SHALL project them on both successful and failed terminal runs.

#### Scenario: Successful run retains streamed reasoning

- **WHEN** llame receives reasoning deltas and the run subsequently succeeds
- **THEN** the final assistant message contains the received reasoning in durable event order

#### Scenario: Provider failure retains received reasoning

- **WHEN** llame receives reasoning deltas and the upstream provider subsequently fails
- **THEN** the terminal failed run retains every reasoning delta durably recorded before that failure

#### Scenario: Worker failure never contradicts prior browser output

- **WHEN** llame has forwarded a reasoning delta to the browser and the worker subsequently fails
- **THEN** reconnect replay includes that delta
