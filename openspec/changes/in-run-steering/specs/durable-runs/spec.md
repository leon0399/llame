## MODIFIED Requirements

### Requirement: Every message executes as a durable, resumable run

A user message MUST execute in a worker-processed **run**. That is its own Run, or the active Run
that delivers it under `run-steering`. The progress of a Run MUST be an append-only, replayable
event log. A client MUST be a subscriber to that log, not the holder of Run state. Thus a page
refresh or a reconnect resumes an in-flight Run and replays a completed Run without loss. There
MUST be no inline (request-thread) execution path. The worker is the sole executor.

#### Scenario: Refresh mid-run resumes from the event log

- **WHEN** a client refreshes or reconnects while a Run streams its output
- **THEN** it subscribes to the event log of the Run again and continues without a loss of earlier deltas or of the final result

#### Scenario: A delivered message executes in the active Run

- **WHEN** the active Run of a Chat delivers a steer of the owner
- **THEN** the delivered message executes in that Run
- **AND** the Chat gets no second Run for it

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

Each Run MUST go into the queue as the job that has the Run's own id (per `job-queue`'s
named-job requirement). Thus the single-flight admission path judges a blocker Run from the
state of its own job, not from the age of the Run. A blocker Run whose job is `queued`,
`retrying`, or `active` is live. Admission MUST reject the new message or follow-up request with
409, however old that Run is. A blocker Run whose job is absent, `completed`, `failed`, or
`cancelled` is **stuck**, because the queue cannot execute it. A crash before the enqueue, or a
job that settled before its Run settled, can cause this. The admission path MUST expire a stuck
Run on the next message or follow-up request, so a stuck Run cannot block a Chat permanently. A
Run younger than one liveness window (`runs.heartbeatSeconds`) whose job is absent MUST count as
live, because its enqueue can still be in progress. A job state that admission cannot read in a
bounded wait, or cannot read at all, MUST count as live, never as stuck. Admission MUST read only
the job that has the id of the blocker Run. It MUST read it only for a Run in the tenant scope of
the owner that sends the request. It MUST NOT scan the queue. It MUST NOT read the Run or the job
of another owner.

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

### Requirement: Final assistant-message projection preserves replay order

The final assistant message of a Run MUST be an ordered projection of the reasoning, text, and tool
activity that the durable run-event log holds. It MUST NOT put all reasoning before the tools or
all text after the tools. A partial message persisted after a model error MUST keep the same order
for each part observed before the failure.

The assistant message of a Run MUST exist from the first model request of the Run. The dispatch
transaction of the first request of an attempt MUST create that message with no parts. When the
message exists from an earlier attempt or an earlier Run, it MUST reset it with no parts. Its usage MUST be the non-completed
`{ status: 'running', complete: false, runId, attemptId, modelId, effort }` of that attempt. The
usage omits `effort` when the Run has none, and adds `permissionMode: 'bypass'` when the effective
permission mode of the attempt is bypass. Each `model.requested` event MUST carry the id of the
attempt that dispatches it. The system MUST store each in-Run context item in the fenced
transaction that dispatches the first request that carries it. That transaction MUST also store
the current part snapshot of the attempt: its reasoning, text, and tool parts so far, then the new
item.

Each terminal path MUST finalize the assistant message of the Run through one shared finalizer.
These paths are completion, failure, cancellation, expiry by the worker, retry exhaustion (dead
letter), and cancellation before start. They are also the native-recovery `outcome_unknown`
settlement, pickup failure, the claim-time terminal transitions, and expiry by a new message. A
lost settlement persists the turn of its attempt through the same ownership rule, without that
finalizer. Some settlers hold the live part collector of the attempt: completion, in-process
failure, cancellation, expiry by the worker, and a lost settlement. Such a settler MUST persist the
reasoning, text, and tool parts of the collector, which already hold the in-Run items of that
attempt in position. Other settlers do not hold that collector: retry exhaustion, the
native-recovery settlement, and the claim-time terminal transitions. Cancellation before start,
pickup failure, and expiry by a new message are also such settlers. A later attempt that fails, is cancelled, or expires before
its own dispatch is also such a settler. Such a settler MUST rebuild the reasoning, text, and tool
parts only from the events of the attempt that the usage of the message names. That window starts
at the `model.requested` of that attempt and ends at the `run.started` of the next attempt. Thus a
settler that never dispatched finalizes the message of the attempt that did. For a Continue Run
from `turn-actions`, the rebuild MUST start with the kept parts of its `run.continued` event, then
add the parts of the window. Such a rebuild MUST place each stored in-Run item of the Run itself
after a rebuilt part. That part is the last one whose toolCallId occurs before the item in the
stored snapshot. It
MUST place the item at the start only when none of those toolCallIds is in the rebuild. Thus the
item stays after the last tool part of the step that triggered it. A Continue rebuild MUST NOT
place a second copy of a kept context item. When the reply usage names the Run, the finalizer
MUST write a terminal usage, also with no parts. A follow-up Run that ends before its own dispatch
MUST leave the reply of the earlier Run unchanged. That usage carries the status (`completed`,
`error`, or `aborted`), `complete`, the Run id, the attempt id, the model id, and the effort. Some
finalizers do not belong to the attempt that the reply usage names. Examples are an out-of-attempt
settler, and a later attempt that ends before its own dispatch. Such a finalizer MUST write `complete: false`
with the `runId`, `attemptId`, `modelId`, `effort`, and `permissionMode` of the current usage. It
writes no token counts, latency, or measured size. A finalizer that finds no assistant message for
the Run MUST use the event log of the Run to decide. When the log has a `model.requested` event, the
Run dispatched before the system created replies at dispatch. The finalizer MUST then create the
reply from the full event log of the Run, with no in-Run items, and write terminal usage per
`run-usage-accounting`. When the log has no such event, the Run never dispatched: cancellation
before start, or a pickup or claim failure before dispatch. The finalizer MUST then write no
assistant message and no usage. An assistant message MUST NOT stay `running` after its Run is terminal.

A delivery of `run-steering` makes the delivered message the message of the Run and starts a new
attempt. From then on, the assistant message of the Run is the reply to the delivered message. The
dispatch transaction of the first request of that attempt MUST create it. A finalizer MUST act
only on that reply. It MUST NOT change the reply of an earlier segment. Its rebuild window, and the
full event log of the Run in the rules above, MUST start after the latest `run.delivered` event.
The kept parts of a Continue Run belong only to its first segment.

Owner-facing reads are chat history, public share, the sources of shared-Chat and owner forks, and
the chat-list preview. They MUST omit an assistant message whose usage status is `running`. The
live stream shows it, and it becomes visible after finalization.

#### Scenario: Completed run projects event order into message parts

- **WHEN** a completed Run emits reasoning, text, tool activity, reasoning, and text in that order
- **THEN** its assistant message stores the parts in that same order

#### Scenario: Failed run projects observed part order

- **WHEN** a Run emits reasoning and text before a model error
- **THEN** its partial assistant message keeps the observed order of reasoning before text

The prospective cutover boundary in `context-injection` MUST govern these publication rules. The
system MUST NOT filter or rebuild the current conversation state retrospectively.

Operational and UI replay MUST keep the observed part order of a failed attempt, and that persisted
record MUST become model history. A failed, cancelled, expired, or superseded attempt keeps the
partial assistant turn that the user saw. It also keeps the rail context items that its dispatched
requests carried. These enter later model context, model-facing recall, and compaction like any
other committed turn. Their reasoning parts and provider metadata follow the model rule of `reasoning-output`. A later attempt of the same Run MUST instead reset that assistant message to
`running` for itself, in the transaction that dispatches its first request. That reset removes the
output and the in-Run items of the earlier attempt together. Its preparation MUST read history only
through the triggering user message, so its own assistant message never enters its request. A
later attempt can fail, be cancelled, or settle before its own dispatch. It MUST then leave the
message, output, and items of the earlier attempt unchanged. The finalizer then uses the attempt
that the usage names. A follow-up Run from `turn-actions` replaces the record in the same way: its
dispatch resets the reply of the earlier Run. A Continue Run puts back the kept parts and drops the
unfinished step. A Regenerate Run drops the whole earlier reply. Inside a successful attempt, a
single failed tool call stays a normal paired observation.

A compaction checkpoint can come before the first model request of a Run, and it publishes before
that request. The checkpoint row and the re-baked epoch state that it names MUST commit in one
transaction before the model request. They MUST stay when that attempt later fails, is cancelled,
or expires, because a checkpoint describes only committed history. A checkpoint row is committed
history, and the outcome of the attempt MUST NOT hold it back or retract it. A later attempt of the
same Run MUST use the published checkpoint again and MUST NOT pay for a second summary call.

#### Scenario: Failed attempt output stays visible and is model history

- **WHEN** an attempt streams reasoning, text, or tool results and then fails
- **THEN** operational and UI replay keep the observed order
- **AND** that partial output stays part of the record, with the rail context items that its dispatched requests carried
- **AND** it enters later model context, recall, and compaction like any other committed turn, until a follow-up Run replaces it
- **AND** later turns omit its reasoning parts, under the model rule of `reasoning-output`

#### Scenario: A checkpoint published before a failed attempt survives it

- **WHEN** an attempt publishes a compaction checkpoint and its re-baked epoch state before its first model request, and that request then fails
- **THEN** the checkpoint row and the epoch state that it names stay committed
- **AND** the next attempt of the Run replays the same checkpoint and does not summarize the same prefix again

#### Scenario: Fresh retry succeeds after an earlier failure

- **WHEN** attempt B succeeds after attempt A failed
- **THEN** the committed assistant turn comes only from the events of B
- **AND** the events of A cannot merge into the assistant projection of B
- **AND** the reminders on the triggering user message are those of A, then any that B appended after them
- **AND** the id and state availability record of the Run is the observation of B, as the last attempt that dispatched

#### Scenario: A Run expired by a new message leaves no running reply

- **WHEN** a Run dispatched a model request, and a different message expires it through single-flight admission
- **THEN** the system finalizes the assistant message of that Run with a terminal status
- **AND** its parts are rebuilt from the events of the attempt that its usage names, around its stored in-Run items
- **AND** no assistant message of that Run stays `running`

#### Scenario: A retry drops the dead attempt's output and in-Run items

- **WHEN** attempt A streamed output and stored an in-Run item on the assistant message of the Run before its worker died
- **AND** attempt B of the same Run dispatches its first request
- **THEN** the dispatch transaction of B resets that assistant message to `running` for B
- **AND** it removes the output and the in-Run item of A together
- **AND** the request of B carries neither the output nor the in-Run item of A
- **AND** the accepted-turn items on the triggering user message do not change
- **AND** B stores only the new items of its comparison, after them

#### Scenario: A settler that never dispatched finalizes the dispatched attempt's reply

- **WHEN** attempt A dispatches, streams output, admits a native mutation, and stores an in-Run item before its worker dies
- **AND** redelivered attempt B finds the admitted effect with no recorded result, and settles the Run `outcome_unknown` without a dispatch
- **THEN** the assistant message of the Run keeps the output and the in-Run item of A, and has status `error`
- **AND** its parts are rebuilt from the events of A
- **AND** its usage names the attempt of A with `complete: false` and no token counts, and no assistant message of that Run stays `running`

#### Scenario: A retry that fails before dispatch leaves the earlier reply

- **WHEN** attempt A dispatched, streamed output, and stored an in-Run item
- **AND** attempt B of the same Run fails in preparation before its first request
- **THEN** B does not reset the assistant message of the Run, which keeps the output and the in-Run item of A
- **AND** the terminal settlement of the Run finalizes that message from the events of A, with usage that names the attempt of A

#### Scenario: A Run that never dispatched gets no reply

- **WHEN** a Run is cancelled before start, or fails at pickup or claim, before any attempt dispatched a model request
- **AND** thus its event log has no `model.requested` event
- **THEN** the finalizer creates no assistant message for that Run and records no usage

#### Scenario: An in-Run item keeps its step position

- **WHEN** the tool call `t1` of an attempt completes, the next request first carries an in-Run item, and the attempt later completes
- **THEN** the dispatch transaction of the item stores a part snapshot that puts the item after the tool part of `t1`
- **AND** the completion settler persists the live collector parts of the attempt, which keep the item directly after the tool part of `t1`

#### Scenario: A rebuilt reply keeps an in-Run item after its step's tool parts

- **WHEN** the stored snapshot of an attempt is `t1`, `t2`, then an in-Run item, and its worker dies
- **AND** a settler without the collector rebuilds the parts from the events of that attempt as `t2`, `t1`
- **THEN** the finalized message puts the item after `t1`, the last rebuilt part whose toolCallId occurs before the item in the snapshot
- **AND** an item none of whose earlier toolCallIds survives in the rebuild goes first

#### Scenario: A running reply stays out of owner-facing reads

- **WHEN** a Run has dispatched and its assistant message is still `running`
- **THEN** chat history, public share, fork sources, and the chat-list preview omit that message, and the live stream shows it
- **AND** the message appears in those reads after a terminal path finalizes it

#### Scenario: A follow-up dispatch replaces the earlier Run's reply

- **WHEN** a Regenerate Run dispatches its first request for a turn whose reply belongs to an earlier Run
- **THEN** its dispatch transaction resets that reply to `running` for the Regenerate Run, with no parts
- **AND** a Regenerate that fails before its dispatch leaves that reply unchanged

#### Scenario: A Continue rebuild starts with the kept parts

- **WHEN** the worker of a Continue Run dies after it stored an in-Run item, and a settler without the collector finalizes the Run
- **THEN** the reply holds the kept parts of `run.continued` once, then the rebuilt parts of the attempt
- **AND** its own in-Run item is in its step position

#### Scenario: A finalizer leaves the reply of an earlier segment

- **WHEN** a Run delivers an interrupt, and its worker dies before the first request of the next segment
- **AND** a settler without the collector expires the Run
- **THEN** the reply of the first segment keeps its parts and its `aborted` usage
- **AND** the delivered message gets no reply, because no request of its attempt was sent

#### Scenario: A rebuild covers only the current segment

- **WHEN** the worker dies in the second segment after one tool step, and a settler without the collector finalizes the Run
- **THEN** the reply of the second segment holds only the parts of the events after the latest `run.delivered`

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
  attempt but does not restart the budget or the ceiling.
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
heartbeat drives the detection of a dead worker.

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
