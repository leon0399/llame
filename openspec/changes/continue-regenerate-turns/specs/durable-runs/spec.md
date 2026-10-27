## MODIFIED Requirements

### Requirement: One in-flight run per chat (single-flight)

At most one non-terminal Run MUST exist for each Chat. The datastore MUST enforce this with a
partial unique index over non-terminal Runs, not with application checks only. When a Chat has an
in-flight Run, a different message for that Chat MUST get a conflict (409). A chat send that
names a message id that already has a Run MUST get a conflict as a duplicate. A chat send never
makes a second Run for one message. Only a follow-up Run from `turn-actions` can add a Run to a
message that has a Run. A follow-up request MUST pass the same admission as a new message.
When a worker stops during execution, the `job-queue` substrate MUST recover or expire its Run
(worker-death recovery or dead-letter).

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

- **WHEN** a Chat has a non-terminal Run whose job is `queued`, `retrying`, or `active`, and a different message arrives for that Chat
- **THEN** admission rejects the second message with 409, and the first Run does not change

#### Scenario: A long-running live blocker is never expired by age

- **WHEN** a Run of a Chat executes for hours with an `active` job, and a different message arrives
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

- **WHEN** a non-terminal Run older than one liveness window has no job, or its job is `completed`, `failed`, or `cancelled`, and a different message arrives
- **THEN** the admission path expires the stuck Run with a terminal `run.expired` and admits the new message
- **AND** the Chat does not get 409 answers without end

#### Scenario: An unreadable job state never expires a run

- **WHEN** a Run of a Chat is old enough to be stuck, and admission cannot read its job state in time or at all
- **THEN** admission rejects the submission with 409, and the Run does not expire or change

#### Scenario: A queued run blocks during a worker outage

- **WHEN** no worker consumes the runs queue, a Run of a Chat is still `queued`, and a different message arrives
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
place a second copy of a kept context item. When the Run has an assistant message, the finalizer
MUST write a terminal usage, also with no parts. That usage carries the status (`completed`,
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
assistant message and no usage. No assistant message MUST stay `running` after its Run is terminal.

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
other committed turn. A later attempt of the same Run MUST instead reset that assistant message to
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
- **THEN** the dispatch transaction of B resets that assistant message to `running` for B, and removes the output and the in-Run item of A together
- **AND** the request of B carries neither the output nor the in-Run item of A
- **AND** the accepted-turn items on the triggering user message do not change, and B stores only the items that its comparison newly yields after them

#### Scenario: A settler that never dispatched finalizes the dispatched attempt's reply

- **WHEN** attempt A dispatches, streams output, admits a native mutation, and stores an in-Run item before its worker dies
- **AND** redelivered attempt B finds the admitted effect with no recorded result, and settles the Run `outcome_unknown` without a dispatch
- **THEN** the assistant message of the Run keeps the output and the in-Run item of A, and has status `error`
- **AND** its parts are rebuilt from the events of A
- **AND** its usage names the attempt of A with `complete: false` and no token counts, and no assistant message of that Run stays `running`

#### Scenario: A retry that fails before dispatch leaves the earlier reply

- **WHEN** attempt A dispatched, streamed output, and stored an in-Run item, and attempt B of the same Run fails during preparation before its first request
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
- **THEN** the reply holds the kept parts of `run.continued` once, then the rebuilt parts of the attempt, with its own in-Run item in its step position
