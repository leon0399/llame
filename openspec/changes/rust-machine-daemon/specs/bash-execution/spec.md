## ADDED Requirements

### Requirement: Bash runs as a job of the current Machine's daemon

Every `bash` call MUST start a daemon job on the current Machine, including
the host. A foreground call MUST wait for the job's settlement up to its
bound. When the bound passes, a steer arrives, or the connection drops, the
call MUST become a background job with the cause `time`, `message`, or
`disconnect`, and the command MUST keep running.

#### Scenario: A dropped connection backgrounds the command

- **WHEN** the connection to the Machine drops during a foreground command
- **THEN** the call returns a backgrounded result with cause `disconnect` and the job keeps running

### Requirement: A command can start in the background on every Machine

`async` and `unlimited` MUST be accepted on every configured Machine.
`ssh://` locators MUST stay foreground-only.

#### Scenario: A background command on a remote Machine

- **WHEN** a call with `async` runs on `machine://box`
- **THEN** the call returns a job locator at once

## REMOVED Requirements

### Requirement: One bound limits the commands of a worker process

**Reason**: Each Machine owns its running-job limit.
**Migration**: Delete `tools.bash.maxProcesses`; set `limits.max_running_jobs` on the Machine.

### Requirement: Bash on the host Machine of the worker runs in the worker

**Reason**: Host commands run as jobs of the host Machine daemon.
**Migration**: None.

### Requirement: A host command can start in the background

**Reason**: Background commands run on every Machine.
**Migration**: See "A command can start in the background on every Machine".
