# Worktree entry environment

## ADDED Requirements

### Requirement: Worktree entry completes its environment copy before commit

A Worktree entry MUST complete the `worktree-includes` copy before it commits
the Checkout, lease, adopted rows, and bound root. It MUST preserve the selected
Checkout root separately from the main Checkout used for git creation and
parenting. A copy failure MUST leave the previous bound root and generation
unchanged.

#### Scenario: A linked source supplies files without a parent change

- **WHEN** entry creates a Worktree from a linked source with a different local `.env` from main
- **THEN** the new Worktree receives the linked source's selected `.env`
- **AND** the recorded parent and placement follow the existing main-Checkout rules

#### Scenario: A partial copy keeps the old Workspace

- **WHEN** an entry copy fails after git creates the destination
- **THEN** entry returns `worktree_failed` with the known `leftDirectory`
- **AND** the previous bound root and generation remain unchanged
- **AND** no new Checkout, lease, or adopted rows commit

### Requirement: The Worktree attempt covers checkout and environment copy

The existing Worktree native attempt MUST precede git checkout and environment
copy. The operation MUST preserve existing fence checks and durable results.
Recovery MUST NOT repeat checkout or copy after an uncertain recorded attempt.
A lost Machine connection MUST preserve `outcome_unknown` and the known
`leftDirectory`.

#### Scenario: A crash during copy does not replay its effects

- **WHEN** the worker crashes after the Worktree native attempt and during a partial copy
- **THEN** redelivery follows the existing unknown-outcome recovery contract
- **AND** it repeats neither checkout nor file copy

#### Scenario: A lost connection preserves the leftover locator

- **WHEN** the Machine connection ends after checkout but before the copy result arrives
- **THEN** entry returns `outcome_unknown` with the known `leftDirectory`
- **AND** it commits no successful binding or Checkout

#### Scenario: Plain entry does not copy files

- **WHEN** entry binds an existing directory without a `worktree` request
- **THEN** it does not process `.worktreeinclude`
