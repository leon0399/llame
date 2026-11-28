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
`leftDirectory`. The durable result of a known failure MUST preserve
`leftDirectory`, so a redelivered Run keeps it.

#### Scenario: A crash during copy does not replay its effects

- **WHEN** the worker crashes after the Worktree native attempt and during a partial copy
- **THEN** redelivery follows the existing unknown-outcome recovery contract
- **AND** it repeats neither checkout nor file copy

#### Scenario: A lost connection preserves the leftover locator

- **WHEN** the Machine connection ends after checkout but before the copy result arrives
- **THEN** entry returns `outcome_unknown` with the known `leftDirectory`
- **AND** it commits no successful binding or Checkout

#### Scenario: The durable result keeps the leftover locator

- **WHEN** a known failure returns a `leftDirectory` and the attempt settles
- **THEN** the durable `native.result` holds that `leftDirectory`
- **AND** a redelivered Run returns it

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
lines, or file bytes. A `worktreeAdd` timeout MUST name the plan directory as a
possible `leftDirectory`, because the API cannot tell an add timeout from a copy
timeout. `path_not_registered` MUST be its only separate code. An offline Machine MUST fail as
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
- **THEN** the call returns `worktree_failed` with the plan directory as a possible `leftDirectory`
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

### Requirement: Worktree placement follows the source clone and its worktree base

The worktree directory MUST be
`<parent>/.llame-worktrees/<display name>/<slug>`. `<parent>` MUST be the parent
of the real path of the source clone. A `worktree_base` on the main checkout MUST replace
`<parent>/.llame-worktrees`. The call MUST canonicalize the directory by its
deepest ancestor that exists. The daemon MUST confirm that the real path of the
new directory equals the decided directory before any copy. A difference MUST
keep the new worktree and MUST fail as `copy_failed`, which the call reports as
`worktree_failed` with the known `leftDirectory`. When the daemon reports
success at a path whose real path differs from the decided directory, the call
MUST remove the new worktree and MUST fail as `worktree_failed`.

#### Scenario: The default placement uses the clone parent

- **WHEN** the source clone's main tree is `/home/dev/src/llame` and a
  Chat calls `enter_workspace` with that path and `worktree`
- **THEN** the worktree directory is
  `/home/dev/src/.llame-worktrees/llame/<slug>`
- **AND** no directory is created inside `/home/dev/src/llame`

#### Scenario: A worktree base replaces the worktree directory

- **WHEN** the main checkout of `/srv/work/llame` stores the `worktree_base`
  `/srv/trees` and a Chat calls `enter_workspace` with that `path` and `worktree`
- **THEN** the worktree is created under `/srv/trees/llame/`
- **AND** no directory is created under `/srv/work/.llame-worktrees`

#### Scenario: A subdirectory path places the worktree beside the clone

- **WHEN** a Chat calls `enter_workspace` with `path`
  `/home/dev/src/llame/apps/web` and `worktree`
- **THEN** the source clone is `/home/dev/src/llame`
- **AND** the worktree directory is under
  `/home/dev/src/.llame-worktrees/llame/`

#### Scenario: A symlinked worktree parent is decided on its canonical form

- **WHEN** `/home/operator/src/.llame-worktrees` is a symlink to
  `/tmp/elsewhere`, and a Chat calls `enter_workspace` with
  `/home/operator/src/llame` and `worktree: { name: "clear-field-0192" }`
- **THEN** the call decides `/tmp/elsewhere/llame/clear-field-0192` as the
  worktree directory
- **AND** the real path of the new directory equals that decided directory

#### Scenario: A moved root keeps the Worktree and reports the leftover

- **WHEN** the daemon finds that the real path of the new directory differs
  from the decided directory
- **THEN** it copies nothing and fails as `copy_failed`
- **AND** the call returns `worktree_failed` with the known `leftDirectory`
- **AND** the new worktree is retained and the Chat stays bound to its previous
  root

#### Scenario: A success at another path is removed

- **WHEN** the daemon reports success at a path whose real path differs from
  the decided directory
- **THEN** the call removes the new worktree
- **AND** the call fails as `worktree_failed`
