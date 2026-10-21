## ADDED Requirements

### Requirement: The bash description tells the model to use cwd

The `bash` description MUST tell the model to set the directory of the command with `cwd`, and not with a `cd` in `command`. In an entered Workspace, the model gives no `cwd` or a path relative to the Workspace root. If no Workspace is entered, the model gives an absolute `cwd`. This text MUST NOT have an effect on how the hub resolves `cwd` or how permissions match `command`.

#### Scenario: Description has the directory instructions

- **WHEN** `bash` is available to the model
- **THEN** its description tells the model to use `cwd` and not `cd` in `command`
- **AND** it tells the model to give no `cwd` or a relative `cwd` in a Workspace, and an absolute `cwd` if no Workspace is entered

#### Scenario: A cd in command runs as written

- **WHEN** the model calls `bash` with `command: "cd /srv && ls"`
- **THEN** the command runs as the model wrote it, and permissions match the submitted `command` text
