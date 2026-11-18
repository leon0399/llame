## ADDED Requirements

### Requirement: A compaction Run is a durable Run with no user message

A compaction Run MUST have kind `compaction` and no user message. It MUST execute in the worker
through the job queue, as a turn Run does. It MUST hold the single-flight slot of its Chat until it
is terminal. It MUST publish at most one checkpoint and MUST NOT write a user or assistant message.

#### Scenario: A send during a compaction Run

- **WHEN** a compaction Run is live and the owner sends a message with no `delivery`
- **THEN** the API answers 409, as for a live turn Run

#### Scenario: A compaction Run survives a worker restart

- **WHEN** the worker stops after it claims a compaction Run and before the checkpoint is published
- **THEN** a later claim executes the Run again and publishes one checkpoint

#### Scenario: A compaction Run writes no reply

- **WHEN** a compaction Run with rows to absorb completes
- **THEN** the Chat has one new checkpoint and no new user or assistant message

### Requirement: A compaction Run with nothing left to absorb completes

A compaction Run can start when the Chat has no user or assistant row above the active checkpoint.
Then the Run MUST complete with no checkpoint and no model request.

#### Scenario: Two queued compacts in a row

- **WHEN** two `/compact` items are queued, and the first compaction Run publishes a checkpoint
- **THEN** the second compaction Run completes with no checkpoint and no model request

### Requirement: A cancelled compaction Run publishes nothing

The owner MUST be able to cancel a live compaction Run as a turn Run. A cancelled or failed
compaction Run MUST NOT publish a checkpoint, and it MUST NOT start a pending queue item. The
checkpoint and the completion of the Run MUST commit together, after a check for a recorded
cancellation.

#### Scenario: Stop during a compaction

- **WHEN** the owner cancels a compaction Run before its summary request returns
- **THEN** the Run is `cancelled`, and the Chat has no new checkpoint

#### Scenario: A cancellation after the summary returns

- **WHEN** the summary request of a compaction Run returns, and a cancellation is recorded before the checkpoint commits
- **THEN** the Run is `cancelled`, and the Chat has no new checkpoint
