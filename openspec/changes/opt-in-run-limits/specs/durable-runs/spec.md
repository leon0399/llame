## MODIFIED Requirements

### Requirement: One in-flight run per chat (single-flight)

At most one non-terminal run SHALL exist per chat, enforced **at the datastore** (a partial unique index over non-terminal runs), not by application checks alone. A second, _different_ message for a chat that already has an in-flight run SHALL be rejected with a conflict (409). Re-submitting an already-accepted message id SHALL be rejected as a duplicate — a message never produces two runs. A run whose worker has died mid-execution SHALL be recovered or expired by the `job-queue` substrate (worker-death recovery / dead-letter).

Each run SHALL be enqueued as the job named by the run's own id (per `job-queue`'s named-job requirement), so the single-flight admission path can judge a blocking run from its own job's state rather than from the run's age. A blocking run whose job is queued, retrying, or active SHALL be treated as live: the new message is rejected (409), however long the run has existed. A blocking run whose job is absent, completed, failed, or cancelled SHALL be treated as **stuck** — the queue can no longer execute it (a job never enqueued after a crash, or a job that settled without settling its run) — and SHALL be expired by the admission path on the next message, so a stuck run can never wedge a chat permanently. A run younger than one liveness window (`runs.heartbeatSeconds`) whose job is absent SHALL be treated as live, because its enqueue may still be in flight. Admission SHALL read only the job named by the blocking run's id, and only for a run visible in the requesting owner's tenant scope; it SHALL NOT scan the queue or read another owner's run or job.

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

#### Scenario: A queued run blocks during a worker outage

- **WHEN** no worker is consuming the runs queue, a chat's run is still queued, and a different message is submitted
- **THEN** the submission is rejected (409) and the queued run executes once a worker returns

#### Scenario: Admission judges only the requesting owner's run

- **WHEN** an owner submits a message to a chat they own
- **THEN** admission reads the job state of at most that chat's blocking run, and never reads, expires, or reveals another owner's run or job

### Requirement: A run never stays stuck, enforced without a cross-tenant reaper

A run SHALL NOT remain non-terminal indefinitely, and its liveness SHALL be enforced with **no cross-tenant scan** — every liveness action runs either in-process on the executing worker or in the run owner's tenant scope. A run that keeps making progress SHALL have **no default limit** on its duration or step count: it ends when the model answers, when the owner cancels it, or by one of the mechanisms below. These mechanisms cover the failure modes:

- **Optional in-process time budget** — when the operator configures `runs.timeoutSeconds`, a run that exceeds that wall-clock budget while its worker is alive SHALL be aborted in-process and recorded as a terminal `run.expired` (distinct from a user-requested `run.cancelled`). Without a configured budget, no wall-clock budget applies.
- **Execution ceiling** — the executing worker SHALL end any run still executing 23 hours 55 minutes after it started, recording a terminal `run.expired` whose message names the execution ceiling rather than a configured budget. The ceiling SHALL fall before the `runs` queue's declared job duration (per `job-queue`), so the queue never fails and re-executes a live run from its beginning because of its age.
- **Model stream idle watchdog** — while the worker reads a model's streamed response, a request that yields no streamed part for 300 seconds after it is sent, or for 300 seconds after its previous part, SHALL be aborted, and the run SHALL be recorded as terminally failed with the error code `model-stream-idle`. The watchdog SHALL measure only time spent waiting on the model's response; time spent executing tools SHALL never count toward it. It SHALL NOT retry the request.
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

- **WHEN** a run is still executing 23 hours 55 minutes after it started
- **THEN** the worker records a terminal `run.expired` whose message names the execution ceiling
- **AND** the queue does not fail or retry the job

#### Scenario: A stalled model stream fails the run

- **WHEN** a model request yields no streamed part for 300 seconds, before its first part or between two parts
- **THEN** the request is aborted and the run is recorded as terminally failed with error code `model-stream-idle`
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
