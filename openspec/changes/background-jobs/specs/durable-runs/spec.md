## MODIFIED Requirements

### Requirement: One in-flight run per chat (single-flight)

At most one non-terminal Run MUST exist for each Chat. The datastore MUST enforce this with a
partial unique index over non-terminal Runs, not with application checks only. When a Chat has an
in-flight Run, a different message for that Chat MUST get a conflict (409) when the send names no
`delivery` mode. A send that names a `delivery` mode MUST become a pending item under
`run-steering`, and it MUST NOT create a Run. A chat send that names a message id that already has
a Run MUST get a conflict as a duplicate. The id of an item of `run-steering` is the one exception,
and that capability answers it. A chat send never makes a second Run for one message.
Only a follow-up Run from `turn-actions` can add a Run to a message that has a Run. A follow-up
request MUST pass the same admission as a new message. When a worker stops during execution, the
`job-queue` substrate MUST recover or expire its Run (worker-death recovery or dead-letter).

The first queue job of a Run MUST have the Run's own id (per `job-queue`'s named-job
requirement). A Run that enters or leaves `awaiting_jobs` MUST record the id of its next queue
job. The current job of a Run is the job that the Run records, or the job with the Run's own id
when it records none. Thus the single-flight admission path judges a blocker Run from the state
of its current job, not from the age of the Run. A blocker Run whose current job is `queued`,
`retrying`, or `active` is live. Admission MUST reject the new message or follow-up request with
409, however old that Run is. A blocker Run whose current job is absent, `completed`, `failed`,
or `cancelled` is **stuck**, because the queue cannot execute it. A crash before the enqueue, or
a job that settled before its Run settled, can cause this. The admission path MUST expire a
stuck Run on the next message or follow-up request, so a stuck Run cannot block a Chat
permanently. A Run younger than one liveness window (`runs.heartbeatSeconds`) whose current job
is absent MUST count as live, because its enqueue can still be in progress. For a recorded job,
that window starts when the Run records the job. A job state that admission cannot read in a
bounded wait, or cannot read at all, MUST count as live, never as stuck. Admission MUST read only
the current job of the blocker Run. It MUST read it only for a Run in the tenant scope of the
owner that sends the request. It MUST NOT scan the queue. It MUST NOT read the Run or the job of
another owner.

#### Scenario: Concurrent different message is refused

- **WHEN** a Chat has a non-terminal Run whose job is `queued`, `retrying`, or `active`
- **AND** a different message with no `delivery` mode arrives for that Chat
- **THEN** admission rejects the second message with 409, and the first Run does not change

#### Scenario: A message with a delivery mode becomes a pending item

- **WHEN** a Chat has a live Run, and a different message with `delivery: "queue"` arrives for that Chat
- **THEN** admission stores a pending item and creates no Run
- **AND** the first Run does not change

#### Scenario: A long-running live blocker is never expired by age

- **WHEN** a Run of a Chat executes for hours with an `active` job, and a different message with no `delivery` mode arrives
- **THEN** admission rejects the message with 409, and the Run continues

#### Scenario: A duplicate message id is rejected

- **WHEN** a chat send names a message id that already has a Run
- **THEN** admission rejects it as a duplicate
- **AND** the chat send makes no second Run for that message

#### Scenario: Only a follow-up Run adds a Run to a message

- **WHEN** the owner sends a follow-up request for the latest user message of a Chat with no live Run
- **THEN** admission creates another Run for that message
- **AND** a chat send with the same message id still gets 409

#### Scenario: A stuck blocker cannot wedge a chat forever

- **WHEN** a non-terminal Run older than one liveness window has no job, or its job is `completed`, `failed`, or `cancelled`
- **AND** a different message arrives
- **THEN** the admission path expires the stuck Run with a terminal `run.expired` and admits the new message
- **AND** the Chat does not get 409 answers without end

#### Scenario: An unreadable job state never expires a run

- **WHEN** a Run of a Chat is old enough to be stuck, and admission cannot read its job state in time or at all
- **THEN** admission rejects a submission with no `delivery` mode with 409, and the Run does not expire or change

#### Scenario: A queued run blocks during a worker outage

- **WHEN** no worker consumes the runs queue, a Run of a Chat is still `queued`, and a different message with no `delivery` mode arrives
- **THEN** admission rejects the message with 409, and the queued Run executes when a worker returns

#### Scenario: Another owner's run is never judged

- **WHEN** a caller sends a message or a follow-up request that names the Chat of another owner, whose Run is live or stuck
- **THEN** the API rejects the request as not found and reads no job state
- **AND** that Run does not expire, and the answer does not reveal it

#### Scenario: A Run that waits blocks a plain send

- **WHEN** a Run is in `awaiting_jobs` with a `queued` deadline job, and a message with no `delivery` mode arrives
- **THEN** admission rejects the message with 409, and the Run does not expire

#### Scenario: A woken Run is judged by its recorded job

- **WHEN** a Run left `awaiting_jobs` two minutes ago, its first job is `completed`, and its recorded job is `active`
- **THEN** admission counts the Run as live

### Requirement: A run never stays stuck, enforced without a cross-tenant reaper

A Run MUST NOT stay non-terminal without end. Its liveness MUST be enforced with **no
cross-tenant scan**. Each liveness action runs in process on the worker of the Run or in the tenant
scope of the Run owner. A Run that keeps its progress MUST have **no default limit** on its
duration or step count. It ends when the model answers, when the owner cancels it, or by one of
the mechanisms below. These mechanisms cover the failure modes:

- **Optional in-process time budget**: the operator can configure `runs.timeoutSeconds`. A Run
  that exceeds that wall-clock budget while its worker is alive MUST be aborted in process. It
  MUST be recorded as a terminal `run.expired`, which is different from a `run.cancelled` that the
  user requests. Without a configured budget, no wall-clock budget applies.
- **Execution ceiling**: the worker of the Run MUST end a Run that still executes 23 hours 55
  minutes after the worker claimed it. It MUST record a terminal `run.expired` whose message names
  the execution ceiling, not a configured budget. The ceiling MUST come before the declared job
  duration of the `runs` queue (per `job-queue`). Thus the queue never fails a live Run because of
  its age, and never executes it again from its start. A delivery of `run-steering` starts a new
  attempt but does not restart the budget or the ceiling. A Run that leaves `awaiting_jobs` is
  claimed again, and the ceiling counts from that claim. The time in `awaiting_jobs` MUST count
  for the budget. A Run that passed its budget while it waited MUST expire when it wakes.
- **Model stream idle watchdog**: the worker reads the streamed response of a model. A request can
  give no streamed part for 300 seconds after it is sent, or for 300 seconds after its previous
  part. The worker MUST then abort it and record the Run as terminally failed. The error code
  `model_stream_idle` MUST be on the error of the Run and in its `run.failed` event. The watchdog
  MUST measure only the time that the worker waits on the response of the model. The time of tool
  execution MUST never count. The watchdog MUST NOT send the request again.
- **Worker-death recovery**: the worker of the Run can die or hang and stop its liveness signal.
  The `job-queue` substrate MUST then detect the job of the Run as stalled (see its native
  worker-liveness requirement) and retry it. Thus a healthy worker executes the Run again, and the
  Run is not orphaned. A second execution is safe, because claim and completion are crash-safe
  (single-flight, first-writer-wins).
- **Tenant-scoped terminal expiry**: the job of a Run can use all its retries. The Run MUST then
  be settled to a terminal `run.expired` state in the tenant scope of the Run owner. The dead-letter path of the
  queue does this with no cross-tenant scan.

There MUST be no application-level liveness poll and no "deadman" job per Run. The native queue
heartbeat drives the detection of a dead worker. The deadline job of an open `wait` is not a
liveness job. It is one delayed job of the `runs` queue that ends that `wait` at its timeout.

#### Scenario: A progressing run has no default time limit

- **WHEN** no wall-clock budget is configured
- **AND** a Run keeps its model and tool progress for longer than the default job expiry of the substrate
- **THEN** the Run continues until the model answers
- **AND** it does not expire, and it does not execute again from its start

#### Scenario: An overrunning run is aborted in-process

- **WHEN** the operator configured a wall-clock budget, and a Run exceeds it while its worker is alive
- **THEN** the worker aborts it in process and records a terminal `run.expired`
- **AND** no separate liveness job takes part

#### Scenario: A run reaching the execution ceiling ends before the queue expires it

- **WHEN** a Run still executes 23 hours 55 minutes after the worker claimed it
- **THEN** the worker records a terminal `run.expired` whose message names the execution ceiling
- **AND** the queue does not fail or retry the job

#### Scenario: A stalled model stream fails the run

- **WHEN** a model request gives no streamed part for 300 seconds, before its first part or between two parts
- **THEN** the worker aborts the request and records the Run as terminally failed with error code `model_stream_idle`
- **AND** the parts observed before the stall stay in the record of the Run, and the request is not sent again

#### Scenario: A long tool call does not trip the stream watchdog

- **WHEN** a tool call executes for longer than 300 seconds between two model requests
- **THEN** the stream watchdog does not fire, and the next model request starts with a new 300-second window

#### Scenario: A dead worker's run is recovered, not orphaned

- **WHEN** the worker that executes a Run dies during the Run
- **THEN** the queue detects the stalled job and retries it, and a healthy worker executes the Run again
- **AND** the Run does not stay non-terminal without end

#### Scenario: Retry exhaustion expires the run in-tenant

- **WHEN** the job of a Run uses all its retries, for example because it kills its worker each time
- **THEN** the dead-letter path settles it to a terminal `run.expired` in the tenant scope of the owner
- **AND** the path makes no cross-tenant scan

#### Scenario: A delivery does not restart the execution ceiling

- **WHEN** a Run claimed 23 hours ago delivers a steer
- **THEN** the worker ends the Run 23 hours 55 minutes after the claim, during the new segment

#### Scenario: A Run that waits ends its wait at the deadline

- **WHEN** a Run enters `awaiting_jobs` for a `wait` with a timeout of 600 seconds, and no job settles
- **THEN** the deadline job starts after 600 seconds, and a worker claims the Run again
- **AND** no process polls the Run in those 600 seconds

## ADDED Requirements

### Requirement: A Run that waits holds no worker

`awaiting_jobs` MUST be a non-terminal Run status. A Run MUST enter it when a `wait` of
`background-jobs` opens and none of its jobs is settled. The queue job of the Run MUST then end,
and no worker MUST execute the Run while it waits. The Run MUST stay the in-flight Run of its
Chat.

#### Scenario: A wait frees the worker

- **WHEN** a Run calls `wait` on a build that takes 30 minutes, and the worker concurrency is 1
- **THEN** the Run is in `awaiting_jobs`, and the worker executes a Run of another Chat in those 30 minutes

#### Scenario: A Run that waits survives a worker restart

- **WHEN** every worker restarts while a Run is in `awaiting_jobs`
- **THEN** the Run stays in `awaiting_jobs`, and a later waker resumes it

### Requirement: A Run starts to wait only when nothing is pending

The move to `awaiting_jobs` MUST be one transaction, fenced by the attempt of the Run. That
transaction MUST check that each listed job is `running` and that no cancellation is recorded.
It MUST also check that the Chat has no pending `steer`, `interrupt`, or `notice` item. When a
check fails, the Run MUST NOT wait, and the `wait` MUST return in the same attempt.

#### Scenario: A job settles just before the wait

- **WHEN** a listed job settles after the model calls `wait` and before the Run records the wait
- **THEN** the Run does not enter `awaiting_jobs`, and the `wait` returns the settlement

### Requirement: One waker resumes a Run that waits

A waker is a settlement of a job of the Chat, an admitted `steer`, `interrupt`, or `notice`
item, a recorded cancellation, or the deadline job. Each waker MUST move the Run from
`awaiting_jobs` to `queued` with one conditional update on the wake generation of the Run. Only
the waker whose update changes the Run MUST enqueue the next queue job. Each wait MUST have a new
wake generation.

#### Scenario: A settlement and a steer arrive together

- **WHEN** a listed job settles in the same moment in which the owner sends a steer
- **THEN** one queue job resumes the Run
- **AND** the resumed step holds the `wait` result, and the steer is delivered at that boundary

#### Scenario: A late deadline job does nothing

- **WHEN** a settlement woke a Run, the Run then waits again, and the deadline job of the first wait starts
- **THEN** that job changes nothing, because its wake generation is not the current one

### Requirement: The deadline job recovers a lost wake

The Run MUST enqueue one deadline job when it enters `awaiting_jobs`, delayed by the timeout of
the `wait`. When that job starts and the Run still waits with the same wake generation, the job
MUST resume the Run. When the Run left `awaiting_jobs` with that generation and its current job
is absent, the deadline job MUST execute the Run. In every other case it MUST do nothing.

#### Scenario: The wake enqueue is lost

- **WHEN** a waker moves a Run to `queued`, and its process stops before it enqueues the next job
- **THEN** the deadline job executes the Run at the deadline

### Requirement: A wait and a wake are Run events

The Run MUST append one event when it enters `awaiting_jobs`. That event MUST name the open
`wait` call and its jobs. The Run MUST append one event when it wakes. That event MUST name the
cause: `settled`, `timeout`, `interrupted`, or `cancelled`. A client that reads the event stream
of the Run MUST get both events, and the stream MUST stay open between them.

#### Scenario: A reload during a wait

- **WHEN** the owner reloads the Chat while its Run is in `awaiting_jobs`
- **THEN** the event stream replays the Run through the event that names the open `wait` call
