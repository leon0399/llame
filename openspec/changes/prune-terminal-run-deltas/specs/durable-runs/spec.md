## ADDED Requirements

### Requirement: Delta events of finished Runs are pruned after a retention window

When `runs.deltaRetentionDays` is set, a scheduled job SHALL delete the
`model.delta` and `reasoning.delta` events of a terminal Run that finished
longer ago than that window and whose own finalized assistant reply exists.
Every other event SHALL be kept. No request SHALL delete an individual event;
deleting a Chat still removes its Runs' events.

#### Scenario: An old finished Run loses only its deltas

- **WHEN** a Run finished eight days ago with its finalized reply and the window is seven days
- **THEN** its delta events are deleted on the next run of the job
- **AND** its lifecycle, tool, and native events remain

#### Scenario: A Run without its own finalized reply keeps its deltas

- **WHEN** a terminal Run finished eight days ago with recorded deltas, and no assistant reply names it as its finalized producer
- **THEN** none of its events are deleted

#### Scenario: Recent and active Runs are untouched

- **WHEN** a Run finished two days ago, or is still running
- **THEN** none of its events are deleted

#### Scenario: Pruning is off by default

- **WHEN** `runs.deltaRetentionDays` is absent or `null`
- **THEN** no event is deleted

#### Scenario: An owner cannot delete individual events

- **WHEN** an authenticated request attempts to delete one of the owner's Run events directly
- **THEN** no row is deleted

## MODIFIED Requirements

### Requirement: Every message executes as a durable, resumable run

A user message SHALL become a worker-processed **run** whose progress is an append-only, replayable event log; a client SHALL be a subscriber to that log, not the holder of run state, so a page refresh or reconnect resumes an in-flight run and replays a completed one without loss while its delta events are retained ("Delta events of finished Runs are pruned after a retention window"); the finished Run's answer remains readable from its assistant message after that. There SHALL be no inline (request-thread) execution path — the worker is the sole executor.

#### Scenario: Refresh mid-run resumes from the event log

- **WHEN** a client refreshes or reconnects while a run is streaming
- **THEN** it resubscribes to the run's event log and continues without losing prior deltas or the final result

#### Scenario: A finished Run past retention replays without deltas

- **WHEN** a client replays a terminal Run whose delta events the retention job deleted
- **THEN** the replay carries its lifecycle and tool events and no `model.delta` or `reasoning.delta` event
- **AND** the Run's answer is read from its assistant message

### Requirement: Received reasoning is durable before browser delivery

Each normalized reasoning delta received by llame SHALL be durably recorded before it is forwarded to a browser stream. The run transcript SHALL retain deltas received before either a worker failure or an upstream provider failure, and SHALL project them on both successful and failed terminal runs; once projected, a terminal Run's reasoning is retained as the reasoning parts of its assistant message, and its reasoning delta events may be pruned under "Delta events of finished Runs are pruned after a retention window".

#### Scenario: Successful run retains streamed reasoning

- **WHEN** llame receives reasoning deltas and the run subsequently succeeds
- **THEN** the final assistant message contains the received reasoning in durable event order

#### Scenario: Provider failure retains received reasoning

- **WHEN** llame receives reasoning deltas and the upstream provider subsequently fails
- **THEN** the terminal failed run's assistant message retains the reasoning of every delta durably recorded before that failure

#### Scenario: Worker failure never contradicts prior browser output

- **WHEN** llame has forwarded a reasoning delta to the browser and the worker subsequently fails
- **THEN** reconnect replay includes that delta
