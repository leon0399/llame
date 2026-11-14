## ADDED Requirements

### Requirement: Operator configuration bounds host commands

`tools.bash.backgroundAfterSeconds` MUST accept an integer of at least 1, and its default is 120.
`tools.bash.maxProcesses` MUST accept an integer of at least 1, and its default is 64. Each
value can be a whole-value interpolation token. A smaller value, a fraction, an unsafe integer,
or an unknown key in `tools.bash` MUST fail startup and name the path.

#### Scenario: The defaults apply

- **WHEN** the configuration has no `tools.bash` object and no `tools.callTimeoutSeconds`
- **THEN** a host command that still runs after 120 seconds moves to the background, and one worker process runs at most 64 commands

#### Scenario: An unknown key fails startup

- **WHEN** `tools.bash.timeoutSeconds` is set
- **THEN** startup fails and names `tools.bash.timeoutSeconds`

### Requirement: Operator configuration bounds background jobs

`tools.jobs.maxSeconds` MUST accept an integer of at least 60, and its default is 7,200.
`tools.jobs.allowUnlimited` MUST accept a boolean, and its default is `false`. A smaller value, a
fraction, or an unknown key in `tools.jobs` MUST fail startup and name the path. The API MUST
NOT return these values to a client.

#### Scenario: A lifetime below the floor fails startup

- **WHEN** `tools.jobs.maxSeconds` is 10
- **THEN** startup fails and names `tools.jobs.maxSeconds`

### Requirement: The call timeout caps the foreground bound of host bash

The foreground bound of a host `bash` call MUST be the lesser of
`tools.bash.backgroundAfterSeconds` and `tools.callTimeoutSeconds`. At that bound the command
MUST move to the background, and it MUST NOT stop. `tools.callTimeoutSeconds` MUST still stop a
`bash` call on an `ssh://` directory and a `bash` call on a `machine://` directory.
The call timeout MUST NOT abort a host command. Its final result follows the durable promotion
settlement rules of `bash-execution`.

#### Scenario: A higher call timeout does not delay the background move

- **WHEN** `tools.callTimeoutSeconds` is 600 and `tools.bash.backgroundAfterSeconds` is 120
- **THEN** a host command moves to the background after 120 seconds

#### Scenario: A lower call timeout moves the command earlier

- **WHEN** `tools.callTimeoutSeconds` is 30 and `tools.bash.backgroundAfterSeconds` is 120
- **THEN** a host command moves to the background after 30 seconds, and it is not stopped
