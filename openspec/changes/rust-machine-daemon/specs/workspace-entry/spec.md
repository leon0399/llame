## MODIFIED Requirements

### Requirement: Worktree creation failure leaves the binding unchanged

A worktree failure MUST NOT record a repository, a checkout, or a lease. The
bound root and its generation MUST NOT change. A source that is not a git
repository MUST fail as `worktree_failed`. A git failure or timeout MUST fail as
`worktree_failed` with the redacted git standard error. `path_not_registered`
MUST be its only separate code. An offline Machine MUST fail as
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

- **WHEN** the Machine daemon reports another protocol version
- **THEN** the call returns `machine_update_required`
- **AND** no git call runs, and the bound root and its generation are
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
