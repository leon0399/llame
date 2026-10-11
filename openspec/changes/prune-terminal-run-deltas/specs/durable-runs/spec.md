## ADDED Requirements

### Requirement: Delta events of finished Runs are pruned after a retention window

A scheduled job SHALL delete the `model.delta` and `reasoning.delta` events of
a Run that is terminal, finished longer ago than `runs.deltaRetentionDays`, and
has an assistant reply. Every other event SHALL be kept. A terminal Run with no
assistant reply SHALL keep its deltas. No owner-facing request SHALL delete any
event.

#### Scenario: An old finished Run loses only its deltas

- **WHEN** a Run completed eight days ago with an assistant reply and the window is seven days
- **THEN** its delta events are deleted on the next run of the job
- **AND** its lifecycle, tool, and native events remain

#### Scenario: A Run without an assistant reply keeps its deltas

- **WHEN** a Run expired eight days ago with recorded deltas and no assistant reply
- **THEN** none of its events are deleted

#### Scenario: Recent and active Runs are untouched

- **WHEN** a Run completed two days ago, or is still running
- **THEN** none of its events are deleted

#### Scenario: An owner cannot delete events

- **WHEN** an authenticated owner's request path attempts to delete one of their own Run events
- **THEN** no row is deleted

## MODIFIED Requirements

### Requirement: Every message executes as a durable, resumable run

A user message SHALL become a worker-processed **run** whose progress is an append-only, replayable event log; a client SHALL be a subscriber to that log, not the holder of run state, so a page refresh or reconnect resumes an in-flight run and replays a completed one without loss while its delta events are retained ("Delta events of finished Runs are pruned after a retention window"); the completed Run's answer remains readable from its assistant message after that. There SHALL be no inline (request-thread) execution path — the worker is the sole executor.

#### Scenario: Refresh mid-run resumes from the event log

- **WHEN** a client refreshes or reconnects while a run is streaming
- **THEN** it resubscribes to the run's event log and continues without losing prior deltas or the final result

#### Scenario: A completed Run past retention replays without deltas

- **WHEN** a client replays a Run that completed longer ago than the delta retention window
- **THEN** the replay carries its lifecycle and tool events and no `model.delta` or `reasoning.delta` event
- **AND** the Run's answer is read from its assistant message
