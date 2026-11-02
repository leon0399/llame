## ADDED Requirements

### Requirement: Artifact locators match as their logical text

For `read`, an `artifact://` locator MUST match as its submitted text with any
read selector removed. Policy matching MUST NOT see a host file path for it.
Each artifact read MUST also apply the `read` group to the source locators of
its findings, as `tool-artifacts` defines.

#### Scenario: A reject on an artifact locator refuses the read

- **WHEN** a `read` group rejects `path` with regex `^artifact://bash-` and the model reads `artifact://bash-3/stdout:1-50`
- **THEN** the matched text is `artifact://bash-3/stdout` and the reject refuses the call

#### Scenario: An allow on artifacts cannot reach another Chat

- **WHEN** a `read` group allows `^artifact://` and the model reads a locator that only another Chat has
- **THEN** the read returns `not_found`
