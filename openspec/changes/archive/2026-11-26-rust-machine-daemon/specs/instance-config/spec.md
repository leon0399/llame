## MODIFIED Requirements

### Requirement: Operator configuration bounds host commands

`tools.bash.backgroundAfterSeconds` MUST accept an integer of at least 1, and its default is 120.
The value can be a whole-value interpolation token. A smaller value, a fraction, an unsafe integer,
a set `tools.bash.maxProcesses`, or an unknown key in `tools.bash` MUST fail startup and name the path.
The running-command limit MUST come from the Machine's `limits.max_running_jobs`, not worker configuration.

#### Scenario: The defaults apply

- **WHEN** the configuration has no `tools.bash` object and no `tools.callTimeoutSeconds`
- **THEN** a command on a configured Machine that still runs after 120 seconds moves to the background

#### Scenario: An unknown key fails startup

- **WHEN** `tools.bash.timeoutSeconds` is set
- **THEN** startup fails and names `tools.bash.timeoutSeconds`

#### Scenario: The removed worker limit fails startup

- **WHEN** the configuration sets `tools.bash.maxProcesses`
- **THEN** startup fails and names the removed key

### Requirement: The call timeout caps the foreground bound of host bash

The foreground bound of a `bash` call on any configured Machine MUST be the lesser of
`tools.bash.backgroundAfterSeconds` and `tools.callTimeoutSeconds`. At that bound the command
MUST move to the background, and it MUST NOT stop. `tools.callTimeoutSeconds` MUST still stop a
`bash` call on an `ssh://` directory. The call timeout MUST NOT abort a configured Machine's command.
Its final result follows the durable daemon-job settlement rules of `background-jobs`.

#### Scenario: A higher call timeout does not delay the background move

- **WHEN** `tools.callTimeoutSeconds` is 600 and `tools.bash.backgroundAfterSeconds` is 120
- **THEN** a host command moves to the background after 120 seconds

#### Scenario: A lower call timeout moves the command earlier

- **WHEN** `tools.callTimeoutSeconds` is 30 and `tools.bash.backgroundAfterSeconds` is 120
- **THEN** a host command moves to the background after 30 seconds, and it is not stopped
