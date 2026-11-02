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

### Requirement: Artifact reads evaluate each served finding

The sixth named exception also covers each finding that an artifact read
serves. The system MUST evaluate the `read` group on the recorded source
locator of that finding. The system MUST NOT record these decisions one by
one. They MUST NOT count toward the refused-file count of the completion
audit. A `bypass` attempt MUST evaluate no finding.

#### Scenario: Finding decisions are not recorded

- **WHEN** an artifact read serves 30 findings and the `read` group refuses 2 of them
- **THEN** `tool.requested` carries one decision for the call
- **AND** the completion audit counts no refused file for those findings
