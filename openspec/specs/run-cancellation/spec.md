# run-cancellation

## Purpose

Defines how the owner of a durable Run cancels it, when a recorded cancellation takes effect and what the cancelled Run persists, and how the owner's Run stream identifies the Run early enough that a client can cancel it from the moment the Run is accepted.

## Requirements

### Requirement: The owner requests cancellation of a Run

An authenticated owner SHALL request cancellation of their own Run by submitting an update with `status: cancelled`. This records the cancellation request; settlement later sets the Run status to `cancelled`. This SHALL be the only cancellation request a client can write; a request carrying any other status SHALL be rejected as invalid and SHALL NOT change the Run.

The request SHALL act only on a Run owned by the authenticated identity. A Run that does not exist and a Run owned by someone else SHALL produce the same not-found response, and the other owner's Run SHALL NOT be changed.

For a non-terminal Run, the request SHALL durably record the cancellation and return the Run. A repeated request for a non-terminal Run whose cancellation is already recorded SHALL succeed and return the Run without recording it again. A request for a terminal Run SHALL be rejected as a conflict and SHALL NOT change the terminal state.

#### Scenario: Cancelling an active Run records the request

- **WHEN** the owner requests cancellation of their queued or executing Run
- **THEN** the cancellation is durably recorded and the response returns the Run

#### Scenario: Repeating the request is idempotent

- **WHEN** the owner requests cancellation of a non-terminal Run whose cancellation is already recorded
- **THEN** the request succeeds and the Run's recorded cancellation is unchanged

#### Scenario: A finished Run cannot be cancelled

- **WHEN** the owner requests cancellation of a Run that is `completed`, `failed`, `cancelled`, or `expired`
- **THEN** the request is rejected as a conflict
- **AND** the Run keeps its terminal state

#### Scenario: Only cancellation is writable

- **WHEN** a client updates a Run with any status other than `cancelled`
- **THEN** the request is rejected as invalid and the Run is unchanged

#### Scenario: Another owner's Run is indistinguishable from a missing one

- **WHEN** an authenticated user requests cancellation of a Run owned by another user
- **THEN** the response is the same not-found response as for a Run id that does not exist
- **AND** the other owner's Run records no cancellation and continues executing

### Requirement: A recorded cancellation settles the Run as cancelled

A worker claims a Run when it assigns an attempt and moves a non-terminal Run into execution. For
a `queued` Run, that move is `queued` → `running_model`. For a crash-recovery reclaim, it is
`running_model` → `running_model` with a new attempt. A Run whose cancellation is recorded before
that claim MUST NOT be claimed. It MUST be settled `cancelled` without a model request, in every
deployment topology.

After the claim, the cancellation MUST reach the worker that executes the Run, in the same process
or in another process. Attempt preparation then continues to its next abort checkpoint and makes no
further model request. The worker MUST abort an in-flight model request or compaction request. It
MUST settle the Run `cancelled`. The recorded cancellation stays the source of truth when the
signal to the worker is lost. The worker MUST then observe it before its next model request.

Settlement MUST append the terminal `run.cancelled` event. It MUST follow the first-writer-wins
terminal rule of `durable-runs`, so a Run that reached another terminal state first keeps it. A
Run that is deleted together with its Chat leaves no Run to settle, and this requirement does not
apply to it.

A Run settled `cancelled` before its model request is recorded as sent (`model.requested`) MUST
persist no assistant message. After a delivery of `run-steering`, this applies to the current
segment: the delivered message then gets no reply, and earlier replies do not change. A Run cancelled after that point MUST persist its assistant turn
with the output observed before the cancellation, as `durable-runs` specifies for partial output.
When the Run observed no output, that turn MUST have no parts. The Run MUST settle the tool calls
that are open at the cancellation as `tool-calling` specifies. This capability does not specify
the usage that a cancelled turn records.

#### Scenario: A queued Run is settled without a model request

- **WHEN** a cancellation is recorded while the Run is still queued
- **THEN** the worker that picks it up settles it `cancelled` without a model request
- **AND** the event log of the Run ends with `run.cancelled`
- **AND** no assistant message is persisted for its user message

#### Scenario: A cancellation racing pickup is still honored

- **WHEN** a cancellation is recorded after a worker read the Run as not cancelled and before that worker claimed it
- **THEN** the worker does not claim the Run and settles it `cancelled` without a model request

#### Scenario: Cancellation during preparation prevents the model request

- **WHEN** a cancellation is recorded after the claim, while the attempt prepares its model request
- **THEN** the attempt makes no further model request, and the Run is settled `cancelled`
- **AND** no assistant message is persisted for its user message

#### Scenario: Cancellation during a model request with no output records an empty turn

- **WHEN** a cancellation is recorded after `model.requested` and before model output
- **THEN** the worker aborts the in-flight model request and settles the Run `cancelled`
- **AND** the persisted assistant turn has no parts

#### Scenario: Cancellation after output keeps the partial turn

- **WHEN** a cancellation is recorded after the Run observed model output
- **THEN** the Run is settled `cancelled`
- **AND** the persisted assistant turn holds the observed output

#### Scenario: A Run that finished first keeps its outcome

- **WHEN** the Run reaches `completed` before the worker observes its recorded cancellation
- **THEN** the Run stays `completed`, and no `run.cancelled` event is appended

#### Scenario: A cancellation reaches a worker in another process

- **WHEN** the API and the worker run in different processes, and the owner cancels a Run during a model request
- **THEN** the worker aborts that model request and settles the Run `cancelled`

#### Scenario: A lost signal still cancels the Run

- **WHEN** the signal to the worker of the Run is lost after the cancellation is recorded
- **THEN** the worker observes the recorded cancellation before its next model request
- **AND** the Run is settled `cancelled`

### Requirement: The Run stream identifies its Run at acceptance

The API can accept an owner message and answer with its UI message stream. The first frame of that
stream MUST then be a UI message stream `start` frame. Its `messageId` MUST be the id of the
accepted Run, the same id that the cancellation request accepts. The API MUST send the frame when
the Run is accepted and enqueued. It MUST NOT wait for a Run event or model output.

A stream MUST cover one segment of the Run, as `run-steering` defines segments. The resume
stream of the active Run of a Chat MUST start with the same frame. It MUST then replay the events
of the current segment. Each stream MUST carry exactly one `start` frame.

The API MUST send the frame only on streams in the scope of the authenticated owner. A resume
request for a Chat that has no active Run of the authenticated owner MUST keep its no-content
answer and carry no frame. This applies also to the Chat of another owner.

#### Scenario: The Run id arrives before any model output

- **WHEN** the owner sends a message, and the accepted Run has no events after its creation
- **THEN** the first frame of the answer is a `start` frame whose `messageId` is the Run id
- **AND** the client receives that frame while the Run has no model output

#### Scenario: The early id cancels the Run

- **WHEN** a client cancels the Run that the `start` frame names before a worker claims it
- **THEN** the Run is settled `cancelled` without a model request
- **AND** no assistant message is persisted for the user message

#### Scenario: Resume identifies the active Run first

- **WHEN** the owner resumes a Chat whose Run is active
- **THEN** the first frame of the resume stream is a `start` frame whose `messageId` is the id of that Run
- **AND** the replayed events of the current segment follow it

#### Scenario: The start frame is not repeated

- **WHEN** model output, tool activity, or the terminal event of a Run arrives on a stream that already carried its `start` frame
- **THEN** the stream carries no second `start` frame

#### Scenario: Another owner's chat yields no frame

- **WHEN** an authenticated user resumes a Chat of another user that has an active Run
- **THEN** the answer is the no-content answer and carries no frame that names that Run

#### Scenario: A resume after a delivery replays only the current segment

- **WHEN** a Run delivered one steer, and the owner then resumes the Chat
- **THEN** the resume stream replays only the events after that delivery
- **AND** the transcript shows the first segment from the history of the Chat

#### Scenario: A cancellation after a delivery leaves the earlier reply

- **WHEN** a Run delivers a steer, and a cancellation is recorded before the first request of the next segment
- **THEN** the Run is settled `cancelled`, and the delivered message gets no reply
- **AND** the reply of the first segment does not change

### Requirement: A cancellation ends a Run that waits

A cancellation of a Run in `awaiting_jobs` MUST wake the Run as `durable-runs` defines. The next
claim MUST settle the Run `cancelled` without a model request. The open `wait` call MUST settle
as `tool-calling` requires for a cancellation. The jobs of the Chat MUST NOT stop.

#### Scenario: The owner cancels a Run that waits

- **WHEN** the owner cancels a Run that waits on a build
- **THEN** the Run becomes `cancelled`, and the `wait` call shows as cancelled
- **AND** the build stays `running`
