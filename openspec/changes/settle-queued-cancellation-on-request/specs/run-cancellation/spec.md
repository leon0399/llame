## MODIFIED Requirements

### Requirement: The owner requests cancellation of a Run

An authenticated owner SHALL request cancellation of their own Run by submitting an update with `status: cancelled`. This records the cancellation request. When the Run is still `queued` after the request is recorded, or a repeated request finds it still `queued`, the request SHALL also settle it `cancelled` before responding; otherwise settlement later sets the Run status to `cancelled`. This SHALL be the only cancellation request a client can write; a request carrying any other status SHALL be rejected as invalid and SHALL NOT change the Run.

The request SHALL act only on a Run owned by the authenticated identity. A Run that does not exist and a Run owned by someone else SHALL produce the same not-found response, and the other owner's Run SHALL NOT be changed.

For a non-terminal Run, the request SHALL durably record the cancellation and return the Run. When the request settles the Run, the response SHALL return the Run as stored after that settlement: `cancelled`, or the terminal state another writer committed first. A repeated request for a non-terminal Run whose cancellation is already recorded SHALL succeed and return the Run without recording it again. A request for a terminal Run SHALL be rejected as a conflict and SHALL NOT change the terminal state.

#### Scenario: Cancelling an active Run records the request

- **WHEN** the owner requests cancellation of their executing Run
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

#### Scenario: Cancelling a queued Run settles it on the request

- **WHEN** the owner requests cancellation of their Run while it is still `queued`, and no other terminal writer settles it first
- **THEN** the response returns the Run with status `cancelled`
- **AND** the owner's next message to the same chat is accepted rather than rejected for an in-flight Run

#### Scenario: Repeating the request settles a Run still queued

- **WHEN** the owner repeats the cancellation request for a Run that is still `queued` with its cancellation already recorded
- **THEN** the response returns the Run with status `cancelled`

#### Scenario: A queued Run expired first is returned as expired

- **WHEN** the owner requests cancellation of their Run while it is still `queued`, and another writer settles it `expired` before the request's settlement commits
- **THEN** the request succeeds and the response returns the Run with status `expired`
- **AND** no `run.cancelled` event is appended

### Requirement: A recorded cancellation settles the Run as cancelled

A worker claims a Run when it assigns an attempt by transitioning a non-terminal Run into execution: for a `queued` Run that is `queued` → `running_model`, and for crash-recovery reclaim that is `running_model` → `running_model` with a new attempt. A Run whose cancellation is recorded before that claim SHALL NOT be claimed and SHALL be settled `cancelled` without any model request, in every deployment topology: by the cancellation request itself when the Run is `queued`, and otherwise by the worker that picks it up. When both the request and the worker settle it, whichever commits first decides, and the Run gets one `run.cancelled` event.

After the claim, when the Run executes in the process that receives the cancellation request, attempt preparation continues to its next abort checkpoint (no further model request), any in-flight compaction request SHALL be aborted, and the Run SHALL be settled `cancelled`. When the Run executes in a different process, a cancellation recorded after the claim is outside this requirement until cross-process cancellation ships ([#207](https://github.com/leon0399/llame/issues/207)).

Settlement SHALL append the terminal `run.cancelled` event and SHALL follow the first-writer-wins terminal rule of `durable-runs`, so a Run that reached another terminal state first keeps it. A Run deleted together with its Chat leaves no Run to settle and is outside this requirement.

A Run settled `cancelled` before its model request is recorded as sent (`model.requested`) SHALL persist no assistant message. A Run cancelled after that point SHALL persist its assistant turn with the output observed before cancellation, as `durable-runs` specifies for partial output; when no output was observed, that turn SHALL have no parts. Tool calls open at cancellation SHALL be settled as `tool-calling` specifies. The usage recorded on a cancelled turn is outside this capability.

#### Scenario: A queued Run is settled without a model request

- **WHEN** cancellation is recorded while the Run is still queued
- **THEN** the Run is settled `cancelled` before the cancellation response, without any model request
- **AND** the worker that later receives its job makes no model request and does not change it
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
