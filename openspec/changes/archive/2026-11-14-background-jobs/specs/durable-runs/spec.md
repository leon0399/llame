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
requirement). A Run that enters or leaves `awaiting_jobs` MUST record its next queue job id.
That job MUST exist at commit: inserted in the transaction, or the current deadline job that
wakes the Run. The current job is that recorded job, or the job with the Run's own id
when it records none. Thus the single-flight admission path judges a blocker Run from the state
of its current job, not from the age of the Run. A blocker Run whose current job is `queued`,
`retrying`, or `active` is live. Admission MUST reject the new message or follow-up request with
409, however old that Run is. A blocker Run whose current job is absent, `completed`, `failed`,
or `cancelled` is **stuck**, because the queue cannot execute it. A crash before the enqueue, or
a job that settled before its Run settled, can cause this. The admission path MUST expire a
stuck Run on the next message or follow-up request, so a stuck Run cannot block a Chat
permanently. A Run with no recorded job, younger than one liveness window
(`runs.heartbeatSeconds`), MUST count as live when its first job is absent, because its enqueue
can still be in progress. A job state that admission cannot read in a
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

#### Scenario: A recorded job that is absent is stuck at once

- **WHEN** a Run records a job, that job is absent, and a different message arrives less than one liveness window after the Run recorded it
- **THEN** the admission path expires the stuck Run with a terminal `run.expired` and admits the new message

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
  claimed again, and the ceiling counts from that claim. The budget counts from the first claim
  of the Run, so the time in `awaiting_jobs` counts for it. A Run that passed its budget while
  it waited MUST expire when it wakes.
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

An expiry MUST first arbitrate any unresolved host bash promotion under the durable result fence
of `bash-execution`. The Run cannot become terminal until that outcome is recorded. A database
outage can delay terminal settlement beyond the budget or execution ceiling; a queue redelivery
MUST use the same fence and MUST NOT execute the command again.

There MUST be no application-level liveness poll and no "deadman" job per Run. The native queue
heartbeat drives the detection of a dead worker. The deadline job of an open `wait` is one
delayed job for each `wait`, and it is not a deadman job for the Run. It ends that `wait` at its
timeout.

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

#### Scenario: A Run passes its budget while it waits

- **WHEN** `runs.timeoutSeconds` is 1,800, and a Run wakes 2,400 seconds after it started
- **THEN** the claim records a terminal `run.expired`, and no model request is sent

### Requirement: Enqueue is fail-fast and self-healing

For an owner-started Run, the system MUST NOT assume transactional enqueue with the Run row. An
enqueue failure MUST fail the run at once and free the single-flight slot of the Chat. A residual
`queued` Run with no job MUST heal without manual cleanup: a same-message retry supersedes it, and
a different message expires it through single-flight admission once the Run has no job and is older
than one liveness window.

That owner-started rule applies to the first job only. A new deadline or wake job MUST be
inserted in the transaction that records it. A host-started Run's first job MUST be inserted
with the Run and its job settlement. A deadline job that wakes the Run uses its existing id and
inserts no job. A failed insert MUST roll the transaction back, leaving the Run as it was.

#### Scenario: Enqueue failure frees the slot and self-heals

- **WHEN** an owner-started Run row is written but its enqueue then fails
- **THEN** the run is failed (freeing the chat's single-flight slot), and no orphaned `queued` state persists beyond one liveness window once a different message arrives

#### Scenario: A failed wake insert leaves the Run waiting

- **WHEN** a waker's insert of the next job fails
- **THEN** the wake rolls back, and the Run stays in `awaiting_jobs`

## ADDED Requirements

### Requirement: A Run that waits holds no worker

`awaiting_jobs` MUST be a non-terminal Run status. A Run MUST enter it when a `wait` of
`background-jobs` opens and none of its jobs is settled. The queue job of the Run MUST then end,
and no worker MUST execute the Run while it waits. The Run MUST stay the in-flight Run of its
Chat.

#### Scenario: A wait frees the worker

- **WHEN** a Run calls `wait` on a build that takes 30 minutes, and the worker concurrency is 1
- **THEN** the Run is in `awaiting_jobs`, and the worker executes a Run of another Chat in those 30 minutes

#### Scenario: A Run that waits survives a worker crash

- **WHEN** every worker crashes while a Run is in `awaiting_jobs`, and new workers start
- **THEN** the Run stays in `awaiting_jobs` until a waker resumes it

### Requirement: A Run starts to wait only when nothing is pending

The move to `awaiting_jobs` MUST be one attempt-fenced transaction. Its checks MUST serialize
with settlement through the Chat row lock. Each listed job MUST still be `running`, with no
cancellation or pending `steer`, `interrupt`, or `notice`. A failed check MUST return `wait`
in the same attempt without suspension.

#### Scenario: A job settles just before the wait

- **WHEN** a listed job settles after the model calls `wait` and before the Run records the wait
- **THEN** the Run does not enter `awaiting_jobs`, and the `wait` returns the settlement

### Requirement: One waker resumes a Run that waits

A waker is a job settlement, an admitted `steer` or `interrupt`, cancellation, or the deadline
job. A pending `queue` item is not a waker. One conditional update of the wake generation MUST
move the Run from `awaiting_jobs` to `queued`. Only its winner MUST insert the next job in that
transaction, unless the winner is the existing deadline job. Each wait MUST have a new generation.

#### Scenario: A settlement and a steer arrive together

- **WHEN** a listed job settles in the same moment in which the owner sends a steer
- **THEN** one queue job resumes the Run
- **AND** the resumed step holds the `wait` result, and the steer is delivered at that boundary

#### Scenario: A late deadline job does nothing

- **WHEN** a settlement woke a Run, the Run then waits again, and the deadline job of the first wait starts
- **THEN** that job changes nothing, because its wake generation is not the current one

### Requirement: The deadline job ends a wait

The Run MUST insert one deadline job, delayed by the timeout of the `wait`, in the transaction
in which it enters `awaiting_jobs`. When that job starts and the Run still waits with the same
wake generation, the job MUST resume the Run. A job that is not the current job MUST do nothing.

#### Scenario: A worker crashes right after a wait starts

- **WHEN** a Run enters `awaiting_jobs`, and its worker stops before the queue job ends
- **THEN** the deadline job is queued, and it resumes the Run at the deadline

#### Scenario: A waker crashes after its commit

- **WHEN** a waker moves a Run to `queued`, and its process stops at once
- **THEN** the next queue job of the Run exists, and a worker executes the Run

### Requirement: A redelivered deadline job recovers its Run

A deadline job can start again after its own wake, for example when the queue redelivers it.
Such a job is still the current job of the Run. It MUST proceed as a normal claim of the Run.
It MUST follow the rules for a retried job.

#### Scenario: The deadline job is redelivered after its wake

- **WHEN** the deadline job woke its Run, its worker stopped, and the queue delivers the same job again
- **THEN** the job is the current job of the Run, and the Run is recovered under the rules for a retried job

### Requirement: A wait and a wake are Run events

The Run MUST append one event when it enters `awaiting_jobs`. That event MUST name the open
`wait` call and its jobs. The Run MUST append one event when it wakes. That event MUST name the
cause: `settled`, `timeout`, `interrupted`, or `cancelled`. For each cause but `cancelled`, the
cause MUST be the `ended` value of the `wait` result. A client that reads the event stream of the
Run MUST get both events, and the stream MUST stay open between them.

#### Scenario: A reload during a wait

- **WHEN** the owner reloads the Chat while its Run is in `awaiting_jobs`
- **THEN** the event stream replays the Run through the event that names the open `wait` call
