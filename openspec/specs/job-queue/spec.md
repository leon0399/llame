# job-queue

## Purpose

**job-queue** is the shared background-job substrate every worker-processed domain runs on — durable runs, chat-search reindexing, the search sweep cron, and session cleanup alike. It defines the contract for named typed durable queues (declare/enqueue/consume), per-job independent settlement, bounded retry + dead-lettering, native worker-liveness (a stalled/dead worker's job is failed and retried with no external reaper), admission policy + coalescing applied idempotently, per-consumer concurrency, **selective queue subscription as the routing primitive** (which process runs a job-class is entirely which queues it subscribes to — a worker profile), and scheduled (cron) + delayed jobs that fire exactly once per tick across all replicas. The engine (pg-boss over Postgres) is an implementation detail, not part of this contract.

## Requirements

### Requirement: Typed durable queues with per-job settlement

Background work SHALL run on named, typed durable job queues declared by the owning domain (a worker declares what it consumes; a producer declares what it publishes to). Each job SHALL settle **independently**: a handler resolving completes that job, a handler throwing fails it — and the settlement of one job SHALL NOT affect any other job. A malformed payload (e.g. written by an older deploy) SHALL fail its own job at the consume boundary (before the domain handler runs), not corrupt the consumer.

#### Scenario: One job's failure settles only that job

- **WHEN** a consumer processes jobs and one job's handler throws
- **THEN** only that job is failed (and enters the retry/dead-letter path); other jobs are unaffected

### Requirement: Bounded retry and dead-lettering

A failed job SHALL be retried under a bounded retry policy and, once retries are exhausted, routed to a **dead-letter queue** rather than dropped — losing failed work silently SHALL NOT be a default.

#### Scenario: Exhausted retries dead-letter, never drop

- **WHEN** a job exhausts its retry limit
- **THEN** it is routed to the queue's dead-letter queue, not silently discarded

### Requirement: Native worker liveness — a stalled job is failed and retried

A queue MAY require an in-flight job to signal **liveness**: the consuming worker SHALL signal it **automatically** while its handler runs (no application heartbeat code), and if the signal lapses beyond a bounded interval — the worker crashed, was killed, hung, or shut down without draining — the substrate SHALL fail and retry the job under the queue's retry/dead-letter policy. A long-running handler SHALL keep the job alive for its full duration without application code; detection SHALL require **no external reaper or per-job liveness-poll**. This makes worker-death recovery a property of the substrate, available to any consumer that opts into it.

#### Scenario: A dead worker's job is retried

- **WHEN** a worker holding an in-flight job dies or hangs past the liveness interval
- **THEN** the substrate fails the job and retries it (a healthy worker picks it up); on retry exhaustion it dead-letters — with no external reaper

#### Scenario: A long handler stays alive without application heartbeats

- **WHEN** a handler legitimately runs for far longer than the liveness interval
- **THEN** the job is not failed — the worker's automatic liveness signal keeps it claimed for the handler's full duration

### Requirement: Admission policy and coalescing, applied idempotently

A queue SHALL support an admission policy that, combined with a per-job coalescing key, bounds redundant work — e.g. a `stately` policy + a `singletonKey` admits at most one **pending** and one **active** job per key, so a burst of enqueues for one key collapses into a single pending job. Declaring a queue SHALL be idempotent (safe on every process boot: create-if-missing, then apply the mutable policy fields), so every producer/consumer can assert its queues at startup without coordination.

#### Scenario: A burst on one key coalesces

- **WHEN** many jobs are enqueued for the same coalescing key on a de-duplicating-policy queue while one is running
- **THEN** at most one additional job is queued (one pending + one active per key)

#### Scenario: Re-declaring a queue on boot is safe

- **WHEN** the same queue is declared on every process/replica boot
- **THEN** it is neither duplicated nor errored, and its mutable policy is re-applied

### Requirement: Per-consumer concurrency, per-job settled

A consumer SHALL process up to a configured **concurrency** of jobs in parallel; each job SHALL settle independently under concurrency, so one job's failure or retry MUST NOT complete, fail, or retry any other job the same consumer is running concurrently. A concurrency of one SHALL preserve the one-at-a-time behavior.

#### Scenario: Concurrent jobs run in parallel and settle independently

- **WHEN** a consumer's concurrency is greater than one and several jobs are available
- **THEN** they execute in parallel, and one job failing does not fail or retry the others running alongside it

### Requirement: Selective queue subscription is the routing primitive

A process SHALL consume only the queues it explicitly subscribes to, and SHALL NOT poll, claim, or run jobs on any queue it has not subscribed to — so _which process runs a given job-class_ is determined entirely by _which queues that process subscribes to_, with no separate routing, tagging, or affinity layer. Multiple processes subscribing to the same queue SHALL share its jobs (no job runs twice); a queue no deployed process subscribes to SHALL simply accumulate jobs until one does. A process's subscribed set and each queue's concurrency SHALL be operator configuration (a **worker profile**), with a default profile that subscribes to every queue.

#### Scenario: A job-class is confined to its subscribers

- **WHEN** one process subscribes to a queue and another process does not
- **THEN** only the subscribing process ever claims or runs that queue's jobs; the non-subscriber never touches them

#### Scenario: Replicas of one profile share a queue

- **WHEN** several processes subscribe to the same queue
- **THEN** its jobs are distributed across them and no job is executed more than once

#### Scenario: The default profile leaves no queue unserved

- **WHEN** no profile is configured
- **THEN** the process runs the default profile, which subscribes to every declared queue, so a single process serves all job-classes

### Requirement: Scheduled (cron) and delayed jobs, single-fire across replicas

The queue SHALL support **cron-scheduled** jobs (a schedule enqueues a job on a queue at each cron match) and **delayed** jobs (a job runs no earlier than a given time). A cron schedule SHALL enqueue **at most one job per scheduled tick regardless of the number of replicas or instances** — application-level scheduling with no per-replica duplication and no external scheduler.

#### Scenario: A cron fires once per tick across N replicas

- **WHEN** N processes/replicas each assert the same cron schedule and a tick occurs
- **THEN** exactly one job is enqueued for that tick — not N

#### Scenario: A delayed job does not run early

- **WHEN** a job is enqueued with a delay
- **THEN** no consumer executes it before its scheduled time
