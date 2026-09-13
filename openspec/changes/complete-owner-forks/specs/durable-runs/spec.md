## MODIFIED Requirements

### Requirement: Every message executes as a durable, resumable run

A newly submitted user message SHALL become a worker-processed **run** whose progress is an append-only, replayable event log; a client SHALL be a subscriber to that log, not the holder of run state, so a page refresh or reconnect resumes an in-flight run and replays a completed one without loss. There SHALL be no inline (request-thread) execution path: the worker is the sole executor.

Copying historical messages into a fork SHALL NOT be treated as submitting those messages for execution. Fork creation SHALL enqueue no chat Run and SHALL create no synthetic completed Run. Historical execution evidence SHALL confer no claim, retry, cancellation, or tool-effect authority over the original Run. The new Chat SHALL remain idle until an explicit subsequent user action submits work through ordinary Run admission.

#### Scenario: Refresh mid-run resumes from the event log

- **WHEN** a client refreshes or reconnects while a run is streaming
- **THEN** it resubscribes to the run's event log and continues without losing prior deltas or the final result

#### Scenario: Fork ends on a historical user message

- **WHEN** the owner forks completed history at a user message before its assistant reply
- **THEN** that user message is copied without creating or replaying its Run
- **AND** the fork stays idle until a subsequent explicit user action

#### Scenario: Source Run finishes after the fork

- **WHEN** an unfinished source Run settles after a whole-chat fork selected the preceding completed turn
- **THEN** its settlement and events belong only to the source Chat
- **AND** no message, event, or execution state is appended to the fork

#### Scenario: A new message continues the fork

- **WHEN** the owner submits a new message to the fork
- **THEN** ordinary admission creates a new Run owned by that Chat
- **AND** source Runs and inherited historical evidence do not occupy its single-flight slot
