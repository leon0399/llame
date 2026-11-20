## MODIFIED Requirements

### Requirement: A Run that waits for a quota reset holds no worker

`awaiting_quota` MUST be a non-terminal Run status. A Run MUST enter it when a request to its own
model fails with a reset time more than 60 seconds away. That reset time MUST also be at most
`runs.quotaWaitMaxSeconds` away. The failure class MUST be `quota_exhausted` or `rate_limited`.
When a tool call of the failed send started, as `provider-failures` defines, the Run MUST enter it
only after each started call settles. The wait then applies to the next step. The queue job MUST
then end, and no worker MUST execute the Run while it waits. The Run MUST stay the in-flight Run of
its Chat.

#### Scenario: A weekly limit frees the worker

- **WHEN** a Codex step request fails with `usage_limit_reached` and a reset in two days, and the worker concurrency is 1
- **THEN** the Run is in `awaiting_quota`, and the worker executes a Run of another Chat

#### Scenario: A short reset does not park the Run

- **WHEN** a step request fails with a reset time 45 seconds away
- **THEN** the Run stays `running_model` and sends the request again after the wait

#### Scenario: A limit after a tool call parks the Run after the call settles

- **WHEN** a Codex step request streams a complete `bash` tool-call part, and then fails with `usage_limit_reached` and a reset in two days
- **THEN** the Run enters `awaiting_quota` only after the `bash` call settles

### Requirement: The entry to a quota wait is one fenced transaction

The move to `awaiting_quota` MUST be one attempt-fenced transaction. It MUST store the completed
steps and parts of the attempt, the failure class, the reset time, and the wake time. It MUST record
the deadline job as the next queue job of the Run, with a new wake generation. Before this move, a
`model.superseded` event MUST name each stored output part of the failed send that the Run does not
keep. When a tool call of the failed send started, the transaction MUST also store the kept parts
of that send. It MUST store the `provider-failure` notice of `provider-failures` with them.

#### Scenario: A worker crash after the entry

- **WHEN** a Run enters `awaiting_quota`, and its worker stops before the queue job ends
- **THEN** the deadline job is queued, and it resumes the Run at the wake time

#### Scenario: The kept parts of a failed send survive the wait

- **WHEN** a send streams text, a complete `bash` tool-call part, and more text, and then fails with a reset in two days
- **THEN** the stored parts hold the first text, the `bash` part with its result, and the notice
- **AND** a `model.superseded` event names the text after the `bash` part

### Requirement: A woken Run sends the same request again

When the deadline job wakes the Run, the next claim MUST rebuild the stored steps. It MUST then send
the request that waits, on the same model and effort. When no tool call of the failed send started,
that is the request that failed. It MUST NOT carry a part that the failed send streamed. When a
tool call of the failed send started, that is the next step, with the kept parts and the notice.
Pending steers and interrupts MUST then reach the Run at its first step boundary.

#### Scenario: A steer after the reset

- **WHEN** the owner sent a steer during a quota wait, and the deadline job wakes the Run
- **THEN** the Run sends the failed request again, and the steer is delivered at the next step boundary

#### Scenario: A woken Run continues after a tool call

- **WHEN** a Run waits after a send that streamed a complete `bash` tool-call part, and the deadline job wakes it
- **THEN** the Run sends the next step with the `bash` result and the notice
- **AND** the `bash` call does not execute again

### Requirement: A quota wait and its wake are Run events

The Run MUST append one `run.suspended` event when it enters `awaiting_quota`. It MUST carry
`kind: 'quota'`, `attemptId`, `generation`, `failureClass`, `resetsAt`, `wakeAt`, `resumeAt`,
`waitCount`, `parts`, and `steps`. Its checkpoint parts and steps MUST exclude each part of the
failed send that a `model.superseded` event names. They MUST include the kept parts of the failed
send and the `provider-failure` notice, when a tool call of that send started. The Run MUST append
one `run.resumed` event when it wakes. That event MUST carry `kind: 'quota'`, the `attemptId` of
the attempt that wakes the Run, the same `generation`, and the cause `timeout` or `cancelled`. A
`run.suspended` or `run.resumed` payload without `kind` MUST mean a job suspension or wake. The
event stream MUST stay open between suspension and wake.

On successful recovery of the request, `run.quota_recovered` MUST carry the generation and the
`resumeAt` of the suspension. It MUST end only the wait count of that request. A summary MUST write
it in the checkpoint publication transaction. A step MUST write it in ordered successful-step
settlement.

#### Scenario: A reload during a quota wait

- **WHEN** the owner reloads the Chat while its Run is in `awaiting_quota`
- **THEN** the event stream replays the `run.suspended` event with the reset time and the wake time

#### Scenario: A checkpoint holds the settled tool part

- **WHEN** a Run enters `awaiting_quota` after a send that streamed a complete `read` tool-call part
- **THEN** the `parts` of its `run.suspended` event hold the `read` part with its result, and then the notice
