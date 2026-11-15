## ADDED Requirements

### Requirement: A producer may enqueue a job inside its own transaction

The queue MUST accept a producer's database transaction for an enqueue. The job MUST exist
only when that transaction commits. A rollback MUST leave no job. A delayed job MUST keep its
requested start time, and a reused identifier MUST NOT create a second job.

#### Scenario: A rolled-back enqueue leaves no job

- **WHEN** a producer enqueues a job in its transaction and then rolls back
- **THEN** that job is absent

#### Scenario: A committed delayed enqueue keeps its start time

- **WHEN** a producer commits a delayed enqueue in its transaction
- **THEN** the job exists and cannot start before its requested start time
