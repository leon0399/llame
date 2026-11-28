## ADDED Requirements

### Requirement: Delta events of finished Runs are pruned after a retention window

When `runs.deltaRetentionDays` is set, a scheduled job SHALL delete the
`model.delta` and `reasoning.delta` events of the attempt that produced a
terminal Run's finalized reply, once the Run finished longer ago than that
window. Deltas of earlier attempts and every other event SHALL be kept. The
assistant message projected from the deleted deltas SHALL stay unchanged as
their record. No request SHALL delete an individual event; deleting a Chat
still removes its Runs' events.

#### Scenario: An old finished Run loses only its deltas

- **WHEN** a Run finished eight days ago with its finalized reply and the window is seven days
- **THEN** its delta events are deleted on the next run of the job
- **AND** its lifecycle, tool, and native events remain

#### Scenario: A partly pruned Run replays the deltas still retained

- **WHEN** the job has deleted only the lowest-`sequence` delta events of a Run's finalizing attempt, and the rest await a later run of the job
- **THEN** replay of that attempt carries the delta events still retained
- **AND** the Run's answer is read from its assistant message

#### Scenario: A Run without its own finalized reply keeps its deltas

- **WHEN** a terminal Run finished eight days ago with recorded deltas, and no assistant reply names it as its finalized producer
- **THEN** none of its events are deleted

#### Scenario: An earlier attempt's deltas are kept

- **WHEN** a Run's first attempt streamed deltas and stopped with its worker, and a second attempt produced the finalized reply eight days ago
- **THEN** only the second attempt's delta events are deleted
- **AND** reconnect replay still includes every delta of the first attempt

#### Scenario: Recent and active Runs are untouched

- **WHEN** a Run finished two days ago, or is still running
- **THEN** none of its events are deleted

#### Scenario: Pruning is off by default

- **WHEN** `runs.deltaRetentionDays` is absent or `null`
- **THEN** no event is deleted

#### Scenario: An owner cannot delete individual events

- **WHEN** an authenticated request attempts to delete one of the owner's Run events directly
- **THEN** no row is deleted

### Requirement: A reply that names no attempt is pruned only for a single-attempt Run

A finalized reply that names its Run but no attempt predates per-attempt
replies and may hold only the last attempt's parts. The retention job SHALL
prune such a Run only when its log holds exactly one `run.started`, and then
every delta event of the Run belongs to that attempt.

#### Scenario: A pre-attempt reply prunes a single-attempt Run

- **WHEN** a terminal Run finished eight days ago, its finalized reply names the Run but no attempt, and its log holds one `run.started`
- **THEN** its delta events are deleted

#### Scenario: A pre-attempt reply keeps a retried Run's deltas

- **WHEN** a terminal Run finished eight days ago, its finalized reply names the Run but no attempt, and its log holds two `run.started` events
- **THEN** none of its events are deleted

## MODIFIED Requirements

### Requirement: Every message executes as a durable, resumable run

A user message SHALL become a worker-processed **run** whose progress is an append-only, replayable event log, except that the retention job deletes the delta events "Delta events of finished Runs are pruned after a retention window" names; a client SHALL be a subscriber to that log, not the holder of run state, so a page refresh or reconnect resumes an in-flight run and replays a completed one without loss until the retention job starts deleting those delta events; the finished Run's answer remains readable from its assistant message after that. There SHALL be no inline (request-thread) execution path — the worker is the sole executor.

#### Scenario: Refresh mid-run resumes from the event log

- **WHEN** a client refreshes or reconnects while a run is streaming
- **THEN** it resubscribes to the run's event log and continues without losing prior deltas or the final result

#### Scenario: A finished Run past retention replays without deltas

- **WHEN** a client replays a terminal Run whose delta events the retention job deleted
- **THEN** the replay carries its lifecycle and tool events, any earlier attempt's deltas, and no delta event of the attempt that produced its reply
- **AND** the Run's answer is read from its assistant message

### Requirement: Received reasoning is durable before browser delivery

Each normalized reasoning delta received by llame SHALL be durably recorded before it is forwarded to a browser stream. The run transcript SHALL retain deltas received before either a worker failure or an upstream provider failure, and SHALL project them on both successful and failed terminal runs; once projected, a terminal Run's reasoning is retained as the reasoning parts of its assistant message, and the reasoning delta events of the attempt that produced that reply may be pruned under "Delta events of finished Runs are pruned after a retention window". Replay of a pruned attempt no longer reconstructs those parts, as `reasoning-output` records.

#### Scenario: Successful run retains streamed reasoning

- **WHEN** llame receives reasoning deltas and the run subsequently succeeds
- **THEN** the final assistant message contains the received reasoning in durable event order

#### Scenario: Provider failure retains received reasoning

- **WHEN** llame receives reasoning deltas and the upstream provider subsequently fails
- **THEN** the terminal failed run's assistant message retains the reasoning of every delta durably recorded before that failure

#### Scenario: Worker failure never contradicts prior browser output

- **WHEN** llame has forwarded a reasoning delta to the browser and the worker subsequently fails
- **THEN** reconnect replay includes that delta until the retention job prunes it with the reply that holds it
