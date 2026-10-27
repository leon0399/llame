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

#### Scenario: A follow-up Run is the only second Run of a message

- **WHEN** the owner sends a follow-up request for the latest user message of a Chat with no live Run
- **THEN** admission creates a second Run for that message
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
