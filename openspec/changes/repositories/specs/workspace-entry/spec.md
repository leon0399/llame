## ADDED Requirements

### Requirement: Workspace entry can create a worktree of the source clone

`enter_workspace` MUST accept a `worktree` argument that holds optional `name`
and `baseRef` fields. The submitted `path` names the source clone, on the local
executor or on a Machine. The call MUST create a worktree at
`<parent of source clone>/.llame-worktrees/<repository display name>/<name>`, or
under the worktree base of the main checkout. A successful call MUST bind the
new directory as the Workspace and MUST record the worktree checkout and its
lease.

#### Scenario: A local clone produces a worktree binding

- **WHEN** a Chat calls `enter_workspace` with `path` `/home/dev/src/llame` and
  `worktree: {}`
- **THEN** the call creates a directory under
  `/home/dev/src/.llame-worktrees/llame/`, starts a branch for it, and binds that
  directory as the Workspace root
- **AND** the result narrates the new root

#### Scenario: A worktree base replaces the worktree directory

- **WHEN** the main checkout of `/srv/work/llame` stores the worktree base
  `/srv/trees` and a Chat calls `enter_workspace` with that `path` and `worktree`
- **THEN** the worktree is created under `/srv/trees/llame/`
- **AND** no directory is created under `/srv/work/.llame-worktrees`

#### Scenario: A successful call records the checkout and the lease

- **WHEN** a Chat calls `enter_workspace` with a source clone and the name
  `calm-otter-9f2c`
- **THEN** the owner has a worktree checkout at the new directory with branch
  `llame/calm-otter-9f2c`, whose parent is the main checkout of the source clone
- **AND** a lease for that checkout names the Chat

### Requirement: Worktree names and branches follow one naming rule

An omitted `name` MUST generate a name in the form
`<adjective>-<noun>-<4 hex>`. A supplied `name` MUST be used as written. The
directory slug MUST replace each `/` in the name with `-`. The branch MUST be
`llame/<name>`. If the name contains `/`, the branch MUST be the name. An
omitted `baseRef` MUST use the current HEAD of the source clone. The call MUST
NOT fetch and MUST NOT use the network.

#### Scenario: An omitted name is generated

- **WHEN** a Chat calls `enter_workspace` with a source clone and no `worktree.name`
- **THEN** the call uses a generated name of the form `<adjective>-<noun>-<4 hex>`
- **AND** the branch is `llame/<generated name>`

#### Scenario: Generated names do not collide

- **WHEN** two worktree calls omit `name` for the same source clone
- **THEN** the second call generates a name different from the first
- **AND** the branch created by the second call does not exist before that call

#### Scenario: A name with a slash is a full branch

- **WHEN** a Chat calls `enter_workspace` with `worktree: { name: "feature/login" }`
- **THEN** the branch is `feature/login`
- **AND** the directory slug is `feature-login`

#### Scenario: An omitted base ref uses the source HEAD

- **WHEN** the source clone HEAD is `abc1234` and the call omits `baseRef`
- **THEN** the worktree starts at `abc1234`
- **AND** the call runs no fetch

### Requirement: An unregistered source clone is adopted on worktree entry

When the source clone has no recorded checkout, a `worktree` call MUST adopt it.
The call MUST record a repository for the canonical remote of the source clone.
A clone without a remote MUST record a repository without a remote. The call
MUST record a main checkout for the source clone with origin `adopted`. Adoption
MUST NOT create a project link. The worktree checkout MUST refer to that main
checkout.

#### Scenario: An unregistered clone is adopted

- **WHEN** a Chat calls `enter_workspace` with `worktree` and the path
  `/home/dev/src/llame`, whose remote is `git@github.com:leon0399/llame.git`,
  and the owner has no record of that remote
- **THEN** the owner has a repository for `github.com/leon0399/llame`
- **AND** the owner has a main checkout for `/home/dev/src/llame` with origin
  `adopted`
- **AND** the worktree checkout refers to that main checkout

#### Scenario: A remote-less clone is adopted

- **WHEN** the source clone has no remote and the owner has no record of it
- **THEN** the call records a repository without a remote
- **AND** the main checkout has origin `adopted`

#### Scenario: A recorded remote is reused

- **WHEN** the owner already records the canonical remote of the source clone
- **THEN** the call uses that repository
- **AND** the call records no second repository for the same remote

#### Scenario: Adoption creates no project link

- **WHEN** adoption completes for a source clone
- **THEN** no project links the repository
- **AND** the owner's project list does not change

### Requirement: Worktree creation failure leaves the binding unchanged

When the git operation for the worktree fails, the call MUST return
`worktree_failed` with the git standard error. The error text MUST be redacted
like other tool errors. The binding and its generation MUST NOT change. The call
MUST NOT record a worktree checkout or a lease. A later call with the same
arguments MUST start a new attempt.

#### Scenario: A failed creation keeps the previous binding

- **WHEN** a bound Chat calls `enter_workspace` with `worktree` and git cannot
  create the directory
- **THEN** the call returns `worktree_failed` with the git standard error
- **AND** the Chat stays bound to its previous root with the same generation

#### Scenario: A failed creation records no worktree row

- **WHEN** worktree creation fails
- **THEN** the owner has no worktree checkout and no lease for that directory

#### Scenario: A retry after a fixed failure succeeds

- **WHEN** a failed call repeats after the owner fixes the directory permission
- **THEN** the call creates the worktree
- **AND** the binding root is the new directory
