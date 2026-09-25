## Purpose

Defines how the owner of a durable Run cancels it, when a recorded cancellation takes effect and what the cancelled Run persists, and how the owner's Run stream identifies the Run early enough that a client can cancel it from the moment the Run is accepted.

## ADDED Requirements

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

A worker claims a Run when it assigns an attempt by transitioning a non-terminal Run into execution: for a `queued` Run that is `queued` → `running_model`, and for crash-recovery reclaim that is `running_model` → `running_model` with a new attempt. A Run whose cancellation is recorded before that claim SHALL NOT be claimed and SHALL be settled `cancelled` without any model request, in every deployment topology.

After the claim, when the Run executes in the process that receives the cancellation request, attempt preparation continues to its next abort checkpoint (no further model request), any in-flight compaction request SHALL be aborted, and the Run SHALL be settled `cancelled`. When the Run executes in a different process, a cancellation recorded after the claim is outside this requirement until cross-process cancellation ships ([#207](https://github.com/leon0399/llame/issues/207)).

Settlement SHALL append the terminal `run.cancelled` event and SHALL follow the first-writer-wins terminal rule of `durable-runs`, so a Run that reached another terminal state first keeps it. A Run deleted together with its Chat leaves no Run to settle and is outside this requirement.

A Run settled `cancelled` before its model request is recorded as sent (`model.requested`) SHALL persist no assistant message. A Run cancelled after that point SHALL persist its assistant turn with the output observed before cancellation, as `durable-runs` specifies for partial output; when no output was observed, that turn SHALL have no parts. Tool calls open at cancellation SHALL be settled as `tool-calling` specifies. The usage recorded on a cancelled turn is outside this capability.

#### Scenario: A queued Run is settled without a model request

- **WHEN** cancellation is recorded while the Run is still queued
- **THEN** the worker that picks it up settles it `cancelled` without making any model request
- **AND** the Run's event log ends with `run.cancelled`
- **AND** no assistant message is persisted for its user message

#### Scenario: A cancellation racing pickup is still honored

- **WHEN** cancellation is recorded after a worker read the Run as uncancelled but before that worker claimed it
- **THEN** the Run is not claimed and is settled `cancelled` without any model request

#### Scenario: Cancellation during preparation prevents the model request

- **WHEN** cancellation is recorded, in the process executing the Run, after the claim and while the attempt is preparing its model request
- **THEN** the attempt makes no further model request and the Run is settled `cancelled`
- **AND** no assistant message is persisted for its user message

#### Scenario: Cancellation during a model request with no output records an empty turn

- **WHEN** cancellation is recorded, in the process executing the Run, after `model.requested` and before any model output
- **THEN** the in-flight model request is aborted and the Run is settled `cancelled`
- **AND** the persisted assistant turn has no parts

#### Scenario: Cancellation after output keeps the partial turn

- **WHEN** cancellation is recorded, in the process executing the Run, after model output was observed
- **THEN** the Run is settled `cancelled`
- **AND** the persisted assistant turn holds the observed output

#### Scenario: A Run that finished first keeps its outcome

- **WHEN** the Run reaches `completed` before its recorded cancellation is observed
- **THEN** the Run stays `completed` and no `run.cancelled` event is appended

### Requirement: The Run stream identifies its Run at acceptance

When the API accepts an owner's message and answers with its UI message stream, the first frame of that stream SHALL be a UI message stream `start` frame whose `messageId` is the accepted Run's id, the same id the cancellation request accepts. The frame SHALL be delivered once the Run is accepted and enqueued, without waiting for any Run event or model output. The resume stream for a chat's active Run SHALL begin with the same frame before replaying the Run's events. Each stream SHALL carry exactly one `start` frame.

The frame SHALL be sent only on streams already scoped to the authenticated owner. A resume request for a chat that has no active Run of the authenticated owner, including another owner's chat, SHALL keep its existing no-content response and carry no frame.

#### Scenario: The Run id arrives before any model output

- **WHEN** the owner sends a message and the accepted Run has produced no events beyond its creation
- **THEN** the response's first frame is a `start` frame whose `messageId` is the Run id
- **AND** that frame is received while the Run has produced no model output

#### Scenario: The early id cancels the Run

- **WHEN** a client cancels the Run named by the `start` frame before any worker claims it
- **THEN** the Run is settled `cancelled` without any model request
- **AND** no assistant message is persisted for the user message

#### Scenario: Resume identifies the active Run first

- **WHEN** the owner resumes a chat whose Run is active
- **THEN** the resume stream's first frame is a `start` frame whose `messageId` is that Run's id, followed by its replayed events

#### Scenario: The start frame is not repeated

- **WHEN** a Run's model output, tool activity, or terminal event arrives on a stream that already carried its `start` frame
- **THEN** the stream carries no second `start` frame

#### Scenario: Another owner's chat yields no frame

- **WHEN** an authenticated user resumes a chat owned by another user that has an active Run
- **THEN** the response is the no-content response and carries no frame naming that Run
