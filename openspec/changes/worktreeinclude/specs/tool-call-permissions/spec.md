# Worktree copy authorization

## ADDED Requirements

### Requirement: Worktree creation authorizes the selected environment copy

The admitted Worktree creation MUST authorize the manifest read and selected
file copies as one operation. The system MUST NOT apply separate `read`,
`edit`, or `write` permission decisions to those files. Their groups and
allowlist entries MUST NOT cause a skip or refusal of the copy. Machine roots,
OS access, and Worktree creation gates MUST still apply.

#### Scenario: A read-rejected environment file still copies

- **WHEN** Worktree creation is admitted and the manifest selects `.env`
- **AND** the `read` group rejects the source `.env`
- **THEN** the copy includes `.env` without a separate read decision
- **AND** the operation returns no file contents

#### Scenario: No file-write tool is required

- **WHEN** Worktree creation is admitted and `write` is absent from the tool allowlist
- **THEN** selected file copies can complete without a `write` call

#### Scenario: Later reads use destination permissions

- **WHEN** a copied `.env` has a destination that the `read` group allows
- **AND** the source `.env` has a path that the `read` group rejects
- **THEN** a later admitted `read` can return the destination contents
- **AND** a read rejection that also covers the destination still refuses that later call

### Requirement: A derived copy source root needs Worktree entry admission

If inspection reports a selected Checkout root different from the admitted
source path, the system MUST admit that root through Worktree entry before the
copy accesses it. This MUST NOT substitute the main Checkout's root for the
selected Checkout's root. A rejection MUST prevent the copy and Worktree add.

#### Scenario: An allowed subdirectory does not authorize a rejected root

- **WHEN** a source subdirectory is admitted but its selected Checkout root is rejected
- **THEN** creation fails before manifest access and before Worktree add

### Requirement: Aggregate copy authority does not bypass creation refusal

A refused Worktree creation MUST NOT read its manifest or copy files. A model
attempt in `read-only` mode MUST still refuse Worktree creation. An
owner-started Chat creation in `read-only` mode MUST retain its existing entry
rules and can copy selected files after admission.

#### Scenario: A rejected destination prevents all copying

- **WHEN** the `enter_workspace` group rejects the new Worktree directory
- **THEN** no manifest read, file copy, or Worktree add starts

#### Scenario: Model read-only mode rejects the mutation

- **WHEN** a model in `read-only` mode requests a Worktree
- **THEN** the existing mode gate refuses the request before any copy

#### Scenario: Owner read-only creation seeds the environment

- **WHEN** the owner creates a Chat in enabled `read-only` mode with an admitted Worktree request
- **THEN** the Worktree receives its selected files before the first Run
