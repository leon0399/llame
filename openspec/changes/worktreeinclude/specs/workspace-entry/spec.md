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

## MODIFIED Requirements

### Requirement: Worktree creation failure leaves the binding unchanged

A worktree failure MUST NOT record a repository, a checkout, or a lease. The
bound root and its generation MUST NOT change. A source that is not a git
repository MUST fail as `worktree_failed`. A git failure or timeout MUST fail as
`worktree_failed` with the redacted git standard error. A failed environment copy
MUST fail as `worktree_failed` with a `message` that is a fixed reason phrase plus
at most one bounded relative path, never standard error, OS error text, manifest
lines, or file bytes. `path_not_registered` MUST be its only separate code. An offline Machine MUST fail as
`machine_unavailable`, and a daemon that reports another protocol version or
answers a git method with UNIMPLEMENTED MUST fail as
`machine_update_required`.

#### Scenario: A failed creation keeps the previous binding

- **WHEN** a bound Chat calls `enter_workspace` with `worktree` and git cannot
  create the directory
- **THEN** the call returns `worktree_failed` with the git standard error
- **AND** the Chat stays bound to its previous root with the same generation

#### Scenario: A failed creation records no row

- **WHEN** worktree creation fails
- **THEN** the owner has no new repository, no worktree checkout, and no lease
  for that directory

#### Scenario: Adoption followed by a failed creation records nothing

- **WHEN** an unregistered clone is adopted and the worktree creation that
  follows fails
- **THEN** the owner has no new repository and no new checkout
- **AND** the Chat stays bound to its previous root with the same generation

#### Scenario: A non-repository source fails

- **WHEN** a Chat calls `enter_workspace` with `worktree` and the source is not a
  git repository
- **THEN** the call returns `worktree_failed`
- **AND** no directory, repository, checkout, or lease is recorded

#### Scenario: An offline Machine fails

- **WHEN** a Chat calls `enter_workspace` with a Machine source and `worktree`,
  and the Machine is offline
- **THEN** the call returns `machine_unavailable`
- **AND** the bound root and its generation are unchanged

#### Scenario: An outdated daemon fails

- **WHEN** the Machine daemon reports another protocol version at the handshake
- **THEN** the call returns `machine_update_required`
- **AND** no git call runs, and the bound root and its generation are
  unchanged

#### Scenario: A daemon without the git method fails

- **WHEN** the Machine daemon answers a git request with UNIMPLEMENTED
- **THEN** the call returns `machine_update_required`
- **AND** no further git call runs, and the bound root and its generation are
  unchanged

#### Scenario: A timeout fails

- **WHEN** the worktree operation exceeds its timeout
- **THEN** the call returns `worktree_failed`
- **AND** the bound root and its generation are unchanged

#### Scenario: A retry after a fixed failure succeeds

- **WHEN** a later Run repeats the call after the owner fixes the directory
  permission
- **THEN** the call creates the worktree
- **AND** the bound root is the new directory

#### Scenario: A copy failure carries a fixed message

- **WHEN** the environment copy fails on `config/secret.env` after git creates the directory
- **THEN** the call returns `worktree_failed` with no `code`
- **AND** `message` is a fixed reason phrase plus `config/secret.env`, with no standard error, OS error text, manifest line, or file bytes
- **AND** the Chat stays bound to its previous root with the same generation
