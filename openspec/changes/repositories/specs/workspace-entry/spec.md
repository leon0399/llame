# Spec Delta

## MODIFIED Requirements

### Requirement: The Workspace binding is Chat-scoped and persists across Runs

A successful entry MUST bind one Chat to the canonical root and to the native
executor identity from its trusted Run context. The binding MUST persist across
Runs until an authorized exit, a successful switch, or a detach. A binding
change MUST apply only to the current attempt of the Run. A superseded attempt
MUST NOT change the binding. Its fence MUST be checked before any filesystem
probe, client stop, client start, declaration change, or other side effect. Only
the owner's Run context changes the binding, through `enter_workspace`,
`exit_workspace`, or a detach. An owner fork copies the binding, subject to the
fork's first-Run re-check. Only the owner's Chat API reads the binding. The
owner's Chat API response MUST expose the current canonical `workspace_root`, or
`null` for an unbound Chat. A non-owner MUST receive `404` for that Chat. Public
share projections and visitor forks MUST omit the binding. Owner-scoped data
access MUST NOT let one owner read or change another owner's binding. Model
input to `enter_workspace` MUST contain only `path` and an optional `worktree`
object. That object MUST contain only `name` and `baseRef`. `exit_workspace`
MUST accept no model-supplied arguments. Model input MUST NOT select an owner, a
Chat, an executor, or a permission mode.

#### Scenario: Binding persists into a later Run

- **WHEN** a later Run for the same owner and Chat starts on the bound native
  executor, with no exit, switch, or detach between the Runs
- **THEN** the Chat's Workspace root stays bound across the Run boundary
- **AND** the later Run re-checks that binding before it uses it

#### Scenario: A superseded attempt has no side effect

- **WHEN** a newer delivery of the same Run supersedes an attempt, and that
  attempt calls `enter_workspace` or `exit_workspace`
- **THEN** the fence rejects the call before it probes the path, changes the
  binding, changes the generation, or changes Workspace clients or declarations
- **AND** the binding reflects only the current attempt's effects

#### Scenario: Retry after a committed binding reaches the same state

- **WHEN** a queue retry repeats an `enter_workspace` call after the binding
  commit for that canonical root succeeded
- **THEN** the retry succeeds idempotently and keeps the same canonical root,
  executor identity, and effective Workspace state
- **AND** it creates no second binding and no duplicate Workspace clients

#### Scenario: Owner API exposes the canonical root or null

- **WHEN** the owner requests the Chat API response for a bound Chat, then for
  an unbound Chat
- **THEN** `workspace_root` holds the canonical absolute root for the bound Chat
  and `null` for the unbound Chat
- **AND** no submitted alias replaces the canonical value

#### Scenario: Non-owner API access returns not found

- **WHEN** another owner requests the Chat API response for a Chat they do not
  own
- **THEN** the response is `404`
- **AND** it discloses neither the Chat's Workspace root nor its binding state

#### Scenario: Owner-scoped binding access rejects cross-owner reads and writes

- **WHEN** owner-scoped data access tries to read or update another owner's Chat
  binding
- **THEN** it sees no binding and cannot change the other owner's binding
- **AND** the other owner's current binding stays unchanged

#### Scenario: Shared projections omit the Workspace binding

- **WHEN** a public share projection or a visitor fork comes from a Chat with a
  Workspace binding
- **THEN** the projection and the fork expose neither `workspace_root` nor the
  binding state
- **AND** the share grants no access to the owner's binding

#### Scenario: Model input cannot select binding authority

- **WHEN** a model supplies owner, Chat, executor, or permission-mode fields in
  addition to `path` or `worktree` to `enter_workspace`, supplies a `worktree`
  field other than `name` or `baseRef`, or supplies arguments to
  `exit_workspace`
- **THEN** the extra fields or arguments are rejected as invalid input
- **AND** binding authority comes only from the owning Chat's trusted Run context

## ADDED Requirements

### Requirement: Workspace entry can create a worktree of the source clone

`enter_workspace` MUST accept an optional `worktree` object with only `name` and
`baseRef`. The submitted `path` names the source clone, on the local executor or
on a Machine. The source clone MUST be the main working tree that `git.inspect`
reports. A successful call MUST create a worktree of the source clone. It MUST
bind the new directory as the Workspace and MUST record the worktree checkout
and its lease. The result MUST name the worktree root, the branch, and the base
commit.

#### Scenario: A local clone produces a worktree binding

- **WHEN** a Chat calls `enter_workspace` with `path` `/home/dev/src/llame` and
  `worktree: {}`
- **THEN** the call creates a directory under
  `/home/dev/src/.llame-worktrees/llame/`, starts a branch for it, and binds that
  directory as the Workspace root
- **AND** the result names the worktree root, the generated branch, and the base
  commit

#### Scenario: A successful call records the checkout and the lease

- **WHEN** a Chat calls `enter_workspace` with a source clone and the name
  `calm-otter-9f2c`
- **THEN** the owner has a worktree checkout at the new directory with branch
  `llame/calm-otter-9f2c`, whose parent is the main checkout of the source clone
- **AND** a lease for that checkout names the Chat

#### Scenario: A same-root call with a worktree switches to the new root

- **WHEN** a Chat bound to `/home/dev/src/llame` calls `enter_workspace` with
  that path and `worktree`
- **THEN** the call creates a worktree of that clone and binds the new directory
- **AND** the Workspace generation increases by one

### Requirement: Worktree names, branches, and base refs follow one rule

An omitted `name` MUST generate `<adjective>-<noun>-<4 hex>`. A supplied `name`
MUST be used as written. A `name` MUST NOT start with `-`, MUST NOT contain a
`.` or `..` segment, and MUST pass the git branch-name rules. The directory slug
MUST replace each `/` in the name with `-`. The branch MUST be `llame/<name>`,
or the name itself when it contains `/`. An omitted `baseRef` MUST use the
source HEAD. A `baseRef` MUST NOT start with `-`. The call MUST NOT fetch or use
the network.

#### Scenario: An omitted name is generated

- **WHEN** a Chat calls `enter_workspace` with a source clone and no
  `worktree.name`
- **THEN** the call uses a generated name in the form
  `<adjective>-<noun>-<4 hex>`
- **AND** the branch is `llame/<generated name>`

#### Scenario: Generated names do not collide

- **WHEN** two worktree calls omit `name` for the same source clone
- **THEN** the second call generates a name different from the first
- **AND** the branch created by the second call does not exist before that call

#### Scenario: A name with a slash is a full branch

- **WHEN** a Chat calls `enter_workspace` with
  `worktree: { name: "feature/login" }`
- **THEN** the branch is `feature/login`
- **AND** the directory slug is `feature-login`

#### Scenario: An omitted base ref uses the source HEAD

- **WHEN** the source clone HEAD is `abc1234` and the call omits `baseRef`
- **THEN** the worktree starts at `abc1234`
- **AND** the call runs no fetch

#### Scenario: A base ref that looks like an option is rejected

- **WHEN** a Chat calls `enter_workspace` with `worktree: { baseRef: "--force" }`
- **THEN** the call returns `invalid_input`
- **AND** no git command starts

#### Scenario: A name that escapes the directory is rejected

- **WHEN** a Chat calls `enter_workspace` with `worktree: { name: ".." }`
- **THEN** the call returns `invalid_input`
- **AND** no directory and no branch is created

#### Scenario: A name that starts with a hyphen is rejected

- **WHEN** a Chat calls `enter_workspace` with `worktree: { name: "-upload" }`
- **THEN** the call returns `invalid_input`
- **AND** no git command starts

### Requirement: Worktree placement follows the source clone and its worktree base

The worktree directory MUST be
`<parent>/.llame-worktrees/<display name>/<slug>`. `<parent>` MUST be the parent
of the real path of the source clone. A `worktree_base` on the main checkout
MUST replace `<parent>/.llame-worktrees`. The call MUST canonicalize the
directory by its deepest existing ancestor. The real path of the new directory
MUST equal the decided directory. A difference MUST remove the new worktree and
MUST fail as `worktree_failed`.

#### Scenario: The default placement uses the clone parent

- **WHEN** the source clone's main working tree is `/home/dev/src/llame` and a
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

### Requirement: An unregistered source clone is adopted on worktree entry

A `worktree` call MUST adopt a source clone that has no recorded checkout. The
call MUST record a repository for the canonical remote of the clone, or a
repository without a remote. The call MUST record a main checkout with origin
`adopted`. Adoption MUST NOT create a project link. The worktree checkout MUST
refer to that main checkout. A linked-worktree source MUST use its main clone as
the source and the parent.

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

#### Scenario: A linked-worktree source uses its main clone

- **WHEN** the submitted `path` is a linked worktree of
  `/home/dev/src/llame`, and a Chat calls `enter_workspace` with it and
  `worktree`
- **THEN** the call uses `/home/dev/src/llame` as the source and the parent
- **AND** the new worktree directory is under
  `/home/dev/src/.llame-worktrees/llame/`

### Requirement: Worktree creation failure leaves the binding unchanged

A worktree failure MUST NOT record a repository, a checkout, or a lease. The
binding and its generation MUST NOT change. A source that is not a git
repository MUST fail as `worktree_failed`. A git failure or a timeout MUST fail
as `worktree_failed` with the git standard error. That text MUST be redacted
like other tool errors. An offline Machine MUST fail as `machine_unavailable`. A
Machine without the git methods MUST fail as `machine_update_required`. A later
call MUST start a new attempt.

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

- **WHEN** an unregistered clone is adopted and the following worktree creation
  fails
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
- **AND** the binding and its generation are unchanged

#### Scenario: An outdated daemon fails

- **WHEN** the Machine daemon reports no git methods
- **THEN** the call returns `machine_update_required`
- **AND** no git call runs and the binding and its generation are unchanged

#### Scenario: A timeout fails

- **WHEN** the worktree operation exceeds its timeout
- **THEN** the call returns `worktree_failed`
- **AND** the binding and its generation are unchanged

#### Scenario: A retry after a fixed failure succeeds

- **WHEN** a failed call repeats after the owner fixes the directory permission
- **THEN** the call creates the worktree
- **AND** the binding root is the new directory

### Requirement: Worktree entry is fenced and atomic

The checkout row, the lease row, adopted rows, and the binding MUST commit in
one fenced transaction. The call MUST check the fence and the transition slot
immediately before `git.worktreeAdd`. The worktree effect MUST be a fenced
native attempt keyed by the tool call id, with a `worktree` operation. A failure
after the add MUST keep the binding and its generation, record no row, and
report a directory that remains. A retry after a committed worktree entry MUST
replay the recorded result.

#### Scenario: A queue retry replays the recorded result

- **WHEN** a queue retry repeats a `worktree` call whose effect committed
- **THEN** the retry returns the recorded result with the same worktree root and
  branch
- **AND** no second worktree is created, and the binding names the same root

#### Scenario: A fence loss after the add records no row

- **WHEN** the fence is lost after `git.worktreeAdd` succeeds
- **THEN** the call records no checkout, lease, or binding change
- **AND** the result reports the directory that remains

#### Scenario: A lost Machine link reports an unknown outcome

- **WHEN** the Machine link drops after the daemon received `git.worktreeAdd`
- **THEN** the call returns `outcome_unknown` and records no row
- **AND** the binding and its generation are unchanged, and the result reports
  that the directory may exist

#### Scenario: A superseded attempt creates no worktree

- **WHEN** the attempt is superseded before `git.worktreeAdd`
- **THEN** the fence check refuses the call
- **AND** no directory, checkout, lease, or binding change results
