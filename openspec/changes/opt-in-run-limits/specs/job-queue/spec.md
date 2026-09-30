## MODIFIED Requirements

### Requirement: Native worker liveness — a stalled job is failed and retried

A queue MAY require an in-flight job to signal **liveness**: the consuming worker SHALL signal it **automatically** while its handler runs (no application heartbeat code), and if the signal lapses beyond a bounded interval — the worker crashed, was killed, hung, or shut down without draining — the substrate SHALL fail and retry the job under the queue's retry/dead-letter policy. A long-running handler SHALL keep the job alive for its full duration without application code; detection SHALL require **no external reaper or per-job liveness-poll**. This makes worker-death recovery a property of the substrate, available to any consumer that opts into it.

A queue MAY declare the longest a single job may stay active. When it does, the substrate SHALL NOT fail a live, liveness-signalling job for its age before that declared duration elapses, and its own default job expiry SHALL NOT apply in its place. A queue that declares none keeps the substrate's default.

#### Scenario: A dead worker's job is retried

- **WHEN** a worker holding an in-flight job dies or hangs past the liveness interval
- **THEN** the substrate fails the job and retries it (a healthy worker picks it up); on retry exhaustion it dead-letters — with no external reaper

#### Scenario: A long handler stays alive without application heartbeats

- **WHEN** a handler legitimately runs for far longer than the liveness interval, and for longer than the substrate's default job expiry, but within its queue's declared duration
- **THEN** the job is not failed — the worker's automatic liveness signal keeps it claimed for the handler's full duration

## ADDED Requirements

### Requirement: A producer may name a job and read its state by that name

A producer SHALL be able to enqueue a job under an identifier it chooses, unique within the queue, and later read that job's lifecycle state by the same identifier: queued, retrying, active, completed, failed, cancelled, or absent. Enqueuing a second job under an identifier the queue already holds SHALL NOT create a second job. Reading a state SHALL address exactly one job by queue and identifier; it SHALL NOT scan or return other jobs, and it SHALL NOT expose job payloads.

#### Scenario: A named job's state is readable

- **WHEN** a producer enqueues a job under an identifier and a worker later claims it
- **THEN** reading that identifier returns queued before the claim and active while the handler runs

#### Scenario: An unknown identifier reads as absent

- **WHEN** a producer reads an identifier under which no job was enqueued in that queue
- **THEN** the result is absent, and no other job's state is returned

#### Scenario: A reused identifier does not duplicate work

- **WHEN** a producer enqueues a second job under an identifier the queue already holds
- **THEN** no second job is created, the enqueue reports that nothing was created, and the existing job's state and payload are unchanged
