## ADDED Requirements

### Requirement: Job locators match as their logical text

For `read`, a `job://` locator MUST match with its scheme in lower case and with any read
selector removed. Policy matching MUST NOT see a host path or a process identity for it.
Workspace projection MUST NOT change a job locator. `wait` and `stop` MUST be evaluated by their
own groups, as each other tool is.

#### Scenario: An upper-case scheme does not pass a reject

- **WHEN** the `read` group rejects `^job://`, and the model reads `JOB://bash-4/stdout:1-5`
- **THEN** the policy matches `job://bash-4/stdout` and rejects the call

#### Scenario: A stop needs its own group

- **WHEN** `tools.permissions` has no group for `stop`, and the model calls `stop`
- **THEN** the call is rejected with no allow, and the job does not change
