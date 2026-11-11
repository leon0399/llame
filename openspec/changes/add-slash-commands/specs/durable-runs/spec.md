## ADDED Requirements

### Requirement: A compaction Run is a durable Run with no user message

A compaction Run MUST have kind `compaction` and no user message. It MUST execute in the worker
through the job queue, as a turn Run does. It MUST hold the single-flight slot of its Chat until it
is terminal. Its events MUST replay after a refresh. It MUST publish at most one checkpoint and MUST
NOT write an assistant message.

#### Scenario: A send during a compaction Run

- **WHEN** a compaction Run is live and the owner sends a message with no `delivery`
- **THEN** the API answers 409, as for a live turn Run

#### Scenario: A compaction Run survives a worker restart

- **WHEN** the worker stops after it claims a compaction Run and before the checkpoint is published
- **THEN** a later claim executes the Run again and publishes one checkpoint

#### Scenario: A compaction Run writes no reply

- **WHEN** a compaction Run completes
- **THEN** the Chat has one new checkpoint and no new user or assistant message

### Requirement: A cancelled compaction Run publishes nothing

The owner MUST be able to cancel a live compaction Run as a turn Run. A cancelled or failed
compaction Run MUST NOT publish a checkpoint, and it MUST NOT start a pending queue item.

#### Scenario: Stop during a compaction

- **WHEN** the owner cancels a compaction Run before its summary request returns
- **THEN** the Run is `cancelled`, and the Chat has no new checkpoint
