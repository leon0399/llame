## MODIFIED Requirements

### Requirement: A recorded cancellation settles the Run as cancelled

A worker claims a Run when it assigns an attempt by transitioning a non-terminal Run into execution: for a `queued` Run that is `queued` → `running_model`, and for crash-recovery reclaim that is `running_model` → `running_model` with a new attempt. A Run whose cancellation is recorded before that claim SHALL NOT be claimed and SHALL be settled `cancelled` without any model request, in every deployment topology.

After the claim, the process executing the Run SHALL act on a recorded cancellation in every deployment topology: at once when that process received the cancellation request, and otherwise within 5 seconds of the cancellation being recorded. When it acts, attempt preparation continues to its next abort checkpoint (no further model request), any in-flight compaction request SHALL be aborted, and the Run SHALL be settled `cancelled`. When that process cannot read the Run's recorded cancellation within that bound, the cancellation SHALL take effect at its first successful read. An attempt whose Run a same-message retry superseded SHALL stop within the same bound, at once when the process that accepted the retry is executing it, and the Run SHALL keep its terminal state.

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

- **WHEN** the process executing the Run acts on a cancellation recorded after the claim while the attempt is preparing its model request
- **THEN** the attempt makes no further model request and the Run is settled `cancelled`
- **AND** no assistant message is persisted for its user message

#### Scenario: Cancellation during a model request with no output records an empty turn

- **WHEN** the process executing the Run acts on a recorded cancellation after `model.requested` and before any model output
- **THEN** the in-flight model request is aborted and the Run is settled `cancelled`
- **AND** the persisted assistant turn has no parts

#### Scenario: Cancellation after output keeps the partial turn

- **WHEN** the process executing the Run acts on a recorded cancellation after model output was observed
- **THEN** the Run is settled `cancelled`
- **AND** the persisted assistant turn holds the observed output

#### Scenario: A Run that finished first keeps its outcome

- **WHEN** the Run reaches `completed` before its recorded cancellation is observed
- **THEN** the Run stays `completed` and no `run.cancelled` event is appended

#### Scenario: A cancellation received by another process stops the executing Run

- **WHEN** the Run's model request is in flight in one process and its cancellation is recorded through a different process
- **THEN** the in-flight model request is aborted within 5 seconds of the cancellation being recorded
- **AND** the Run is settled `cancelled` and its event log ends with `run.cancelled`
- **AND** the persisted assistant turn holds the output observed before the abort

#### Scenario: An unreadable cancellation takes effect at the next successful read

- **WHEN** cancellation is recorded after the claim while the process executing the Run cannot read the Run
- **THEN** the failed read neither settles nor aborts the Run
- **AND** the Run is settled `cancelled` once that process reads the recorded cancellation

#### Scenario: A superseded Run executing elsewhere stops

- **WHEN** a same-message retry supersedes a Run whose model request is in flight in a different process
- **THEN** that process aborts the superseded Run's model request within 5 seconds and makes no further model request for it
- **AND** the superseded Run stays `cancelled` with no second terminal event

#### Scenario: Cancelling one owner's Run does not stop another owner's Run

- **WHEN** Runs of two different owners execute in the same process and one owner's Run has its cancellation recorded
- **THEN** only that Run is settled `cancelled`
- **AND** the other owner's Run continues to its own outcome and records no cancellation
