## ADDED Requirements

### Requirement: The bash description directs working-directory use through cwd

The `bash` description SHALL tell the model to choose the working directory with `cwd` rather than a `cd` inside `command`: within an entered Workspace, to omit `cwd` or pass a path relative to the Workspace root; outside a Workspace, to pass an absolute `cwd`. This guidance SHALL NOT change how `cwd` is resolved or how `command` is matched.

#### Scenario: Description carries the working-directory guidance

- **WHEN** `bash` is offered
- **THEN** its description states to use `cwd` instead of `cd` in `command`, to omit `cwd` or pass a relative one within a Workspace, and to pass an absolute one outside a Workspace

#### Scenario: A cd in command still runs as written

- **WHEN** the model calls `bash` with `command: "cd /srv && ls"`
- **THEN** the command runs exactly as submitted and permissions match the submitted `command` text
