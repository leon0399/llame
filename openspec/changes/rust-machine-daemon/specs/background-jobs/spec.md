## ADDED Requirements

### Requirement: A job is bound to its Machine daemon

A job MUST bind to the Machine name, the daemon instance id, and the daemon
job id. It MUST NOT bind to a worker. A daemon fact MUST NOT overwrite a settled row.

#### Scenario: Another worker settles the job

- **WHEN** the worker that started a job exits and another worker attaches to the Machine
- **THEN** that worker settles the job from the daemon's record

### Requirement: A job is lost only when its daemon does not know it

A job MUST settle as `lost`, with its outcome unknown, when its daemon reports
it `lost`, when the daemon does not know the job, or when the daemon instance
id changed. The read MUST name the cause and tell the model to check the
environment.

#### Scenario: A restarted daemon loses a running job

- **WHEN** the daemon restarts while a job runs
- **THEN** the job settles `lost` with the cause that the Machine daemon restarted

### Requirement: Job output lives on the Machine

A running job's output MUST be read from the Machine by byte offset. At
settlement the installation MUST store one bounded copy as the job's artifact
and then release the job on the Machine.

#### Scenario: Output of a settled job

- **WHEN** a job settles
- **THEN** its artifact holds the bounded output and the daemon deletes the job directory

### Requirement: A job on an unreachable Machine shows as unknown

While a Machine is unreachable its unsettled jobs MUST show their last known
state as unknown. Unknown MUST NOT settle a job. A stop MUST be delivered when
the Machine is reachable again.

#### Scenario: A stop waits for the Machine

- **WHEN** the owner stops a job on an unreachable Machine
- **THEN** the stop is delivered on the next connection

## REMOVED Requirements

### Requirement: The worker stores the output of a live job in increments

**Reason**: Output lives in files on the Machine.
**Migration**: `chat_job_chunks` is dropped with its rows.

### Requirement: A job is bound to the worker that started it

**Reason**: Jobs bind to the Machine daemon.
**Migration**: See "A job is bound to its Machine daemon".

### Requirement: A worker that shuts down ends its jobs

**Reason**: Jobs outlive workers while their daemon runs.
**Migration**: None.

### Requirement: A job on a dead worker settles as lost

**Reason**: Worker liveness no longer decides a job's fate.
**Migration**: See "A job is lost only when its daemon does not know it".

### Requirement: A stop request reaches the worker of the job

**Reason**: Any worker attached to the Machine stops the job.
**Migration**: See "A job on an unreachable Machine shows as unknown".
