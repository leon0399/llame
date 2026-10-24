# repositories Specification

## Purpose

The capability gives an owner a catalog of git repositories, and of the
checkouts where each repository exists on an executor. A chat can start from a
known clone or worktree, and the records never own the files.

## Requirements

### Requirement: Repositories are owner-scoped records with a display name

A repository MUST belong to one owner and MUST store a display name. The display
name MUST be one path segment without `/` or NUL, and MUST NOT be `.` or `..`.
Adoption MUST derive the name from the last segment of the canonical remote,
else from the toplevel basename, sanitized to that rule. An alias MUST map one
declared alternate remote to one repository of that owner.

#### Scenario: A display name cannot leave its segment

- **WHEN** the owner submits the display name `team/llame`
- **THEN** the request fails with status 422 and stores no repository

#### Scenario: Adoption derives the display name

- **WHEN** adoption inspects a clone whose canonical remote is
  `github.com/leon0399/llame`
- **THEN** the repository display name is `llame`

#### Scenario: A declared alias selects one repository

- **WHEN** the owner declares an alias for a renamed remote and then registers a
  checkout of that remote
- **THEN** the checkout joins the repository that the alias names

#### Scenario: One remote names one repository

- **WHEN** the owner declares an alias for a remote that already names another
  of their repositories, or stores that alias's remote as a repository's
  canonical remote
- **THEN** the request fails with status 409 and stores nothing

### Requirement: The canonical remote comes from the `origin` remote

The canonical remote MUST come from the remote named `origin`. The canonical
form MUST drop the scheme, the credentials, the `.git` suffix, and the slash at
the end, and MUST lowercase the host. URLs that differ only in those parts MUST
map to one repository. A clone without an `origin` remote MUST count as a clone
without a remote, and MUST take its identity from its first checkout.

#### Scenario: Equivalent origin URLs are one repository

- **WHEN** the owner registers a checkout of
  `git@github.com:leon0399/llame.git` and then a checkout of
  `https://github.com/leon0399/llame`
- **THEN** both checkouts belong to one repository with the canonical remote
  `github.com/leon0399/llame`

#### Scenario: A clone without an `origin` remote has no canonical remote

- **WHEN** the clone holds only the remote `upstream` and the owner registers it
- **THEN** the repository stores no canonical remote

#### Scenario: A repository without a remote takes its first checkout as identity

- **WHEN** the owner registers a local clone that has no remote
- **THEN** the repository stores no canonical remote and lists the new checkout

### Requirement: Checkouts record one repository on one executor

A checkout MUST store its repository, its owner, an executor identifier, a
canonical path, and an origin of `registered`, `adopted`, or `created`. One
owner, executor, and path triple MUST hold at most one checkout. The stored path
MUST be the canonical form that the executor reports.

#### Scenario: One repository holds a checkout on each executor

- **WHEN** the owner registers the same repository on the local executor and on
  `machine://nas`
- **THEN** the repository lists two checkouts, one for each executor

#### Scenario: A duplicate executor and path pair is refused

- **WHEN** the owner registers a path that a checkout of that executor already
  holds
- **THEN** the request fails with status 409 and the stored row is unchanged

### Requirement: A Machine checkout stores the canonical Machine locator

A checkout on a Machine MUST store the canonical Machine locator
`machine://<name>/<absolute path>`. The form MUST be the same as the stored
Workspace root of a chat. A checkout on the local executor MUST store the
canonical absolute path.

#### Scenario: A Machine checkout names its Machine

- **WHEN** the owner registers the path `machine://nas/srv/app`
- **THEN** the checkout records the executor identifier `machine:nas` and the
  path `machine://nas/srv/app`

#### Scenario: A Machine checkout path equals a binding root

- **WHEN** a chat binds `machine://nas/srv/app` and the owner registers
  `machine://nas/srv/app`
- **THEN** the checkout path is `machine://nas/srv/app`
- **AND** the checkout lists that chat as bound to it

### Requirement: Worktree checkouts are children of a main checkout

Each checkout MUST have the kind `main` or `worktree`. A `worktree` checkout
MUST store its parent `main` checkout and the branch that inspection reports.
The parent MUST belong to the same repository and the same executor. A
`worktree` checkout MUST NOT exist without a parent. A detached HEAD MUST store
a null branch, and a worktree that llame creates MUST store its branch. A `main`
checkout can store a worktree base directory.

#### Scenario: Worktrees name one main parent

- **WHEN** the owner lists a repository that holds one `main` checkout and two
  worktrees
- **THEN** each worktree names that `main` checkout as its parent

#### Scenario: A worktree parent on another executor is refused

- **WHEN** a worktree record names a parent `main` checkout on another executor
- **THEN** the system refuses the record and stores nothing

#### Scenario: A detached worktree stores no branch

- **WHEN** the owner registers a linked worktree whose HEAD is detached
- **THEN** the worktree row stores no branch and the request succeeds

### Requirement: A main checkout can carry a worktree base directory

A `main` checkout can carry a worktree base directory. The owner MUST set it
with `PATCH /api/v1/checkouts/:id` and a `worktreeBase` field. The value MUST
use the executor of that main checkout. A local checkout MUST use an absolute
local path, and a Machine checkout MUST use a `machine://<same name>/` locator.
Another executor MUST fail with status 422. A `worktree` row MUST refuse
`worktreeBase`.

#### Scenario: A main checkout can set a worktree base directory

- **WHEN** the owner sets a worktree base directory on a `main` checkout
- **THEN** a new worktree of that checkout is created under that directory

#### Scenario: A relative worktree base is refused

- **WHEN** the owner submits `worktreeBase` `trees/llame`
- **THEN** the request fails with status 422 and changes no row

#### Scenario: A worktree base on another executor is refused

- **WHEN** the owner submits `worktreeBase` `machine://nas/srv/trees` for a
  local `main` checkout
- **THEN** the request fails with status 422 and changes no row

#### Scenario: A worktree row refuses a worktree base

- **WHEN** the owner submits `worktreeBase` for a `worktree` checkout
- **THEN** the request fails with status 422 and changes no row

### Requirement: Worktree leases are informational ownership receipts

A lease MUST record the chat, the worktree checkout, the base reference, the
base commit, and the creation time. The base commit MUST be the HEAD of the new
worktree after its creation. A lease MUST NOT reserve the path and MUST NOT
refuse a second chat. A second chat that binds a leased path MUST succeed. A
lease MUST NOT change how a fork copies the bound Workspace root.

#### Scenario: A second chat binds a leased path

- **WHEN** a second chat enters the path of a leased worktree
- **THEN** entry succeeds and the worktree lists both chats

#### Scenario: A fork copies the binding without a new lease

- **WHEN** the owner forks a chat that holds a leased path
- **THEN** the fork copies the bound Workspace root and the system writes no
  lease

### Requirement: Checkout lists report the lease chat and every bound chat

`GET /api/v1/checkouts?repositoryId=` MUST list the identifiers of the owner's
chats whose Workspace root equals the path of each row, for `main` and
`worktree` rows. It MUST list the lease chat of each `worktree` row. A row
without a lease MUST report no lease chat.

#### Scenario: Two chats on one leased worktree are listed

- **WHEN** two chats bind one leased worktree
- **THEN** the list names the lease chat and both chat identifiers for that row

#### Scenario: A worktree without a lease lists no lease chat

- **WHEN** the owner lists a worktree that no lease records
- **THEN** the row reports no lease chat

### Requirement: Checkout registration inspects the path on its executor

Registration MUST submit one `path` field. The value MUST be one absolute local
path or one `machine://<name>/<absolute path>` locator. The system MUST derive
the executor from that form. Before it stores a row, registration MUST inspect
the path on that executor, and the inspected origin MUST be the authority. A
declared repository that disagrees with it MUST fail with status 422. For a
clone without a remote, the optional repository input MUST select one owner
repository.

#### Scenario: A declared repository that disagrees with the origin is refused

- **WHEN** the owner declares repository A and the inspected origin is the
  origin of repository B
- **THEN** the request fails with status 422 and the system stores no row

#### Scenario: An offline executor refuses registration

- **WHEN** the owner registers the path `machine://nas/srv/app` and that Machine
  is offline
- **THEN** the request fails with `machine_unavailable` and the system stores no
  row

#### Scenario: A clone without a remote joins a named repository

- **WHEN** the owner registers a clone without a remote and names a repository
  that exists
- **THEN** the checkout joins that repository and inspection records the
  canonical path

### Requirement: Registration and removal need a configured executor

Registration and removal MUST derive a configured executor. A local path MUST
use the `tools.nativeExecutorId` of the process that serves the API. A local
path on a process without that identifier MUST fail with `executor_unavailable`
and status 503. A locator MUST name a configured Machine. A locator that names
no configured Machine MUST fail with `executor_unavailable` and status 503. No
git method MUST start, and the system MUST store no row.

#### Scenario: A Machine that is not configured is refused

- **WHEN** the owner registers `machine://ghost/srv/app` and no Machine named
  `ghost` is configured
- **THEN** the request fails with `executor_unavailable` and stores no row

#### Scenario: A process without a native executor refuses a local path

- **WHEN** the owner registers the absolute local path `/srv/app` and the
  process that serves the API holds no `tools.nativeExecutorId`
- **THEN** the request fails with `executor_unavailable` and status 503
- **AND** no git method starts and the system stores no row

### Requirement: Registration and removal obey the host access policy

`enter_workspace` MUST be present in `tools.allowed`. A missing allow MUST fail
with status 403 and `tool_not_allowed` before any git call. The
`enter_workspace` group MUST evaluate the submitted `path` and its canonical
form in `default` mode. A rejected value, or no allow, MUST fail with status 403
and `permission_denied`. The group MUST evaluate a locator in its `machine://`
form. After `git.inspect`, the group MUST evaluate the inspected main clone the
same way, as a `main_clone` decision.

#### Scenario: A missing allowlist entry is refused before any git call

- **WHEN** `enter_workspace` is absent from `tools.allowed` and the owner
  registers a path
- **THEN** the request fails with status 403 and `tool_not_allowed`
- **AND** the executor starts no git method

#### Scenario: An unallowed path is refused before any git call

- **WHEN** the owner registers a path that the `enter_workspace` group rejects
- **THEN** the request fails with status 403 and `permission_denied`
- **AND** the executor starts no git method

#### Scenario: A removal on an unallowed path starts no git call

- **WHEN** the owner removes a worktree whose path no allow covers
- **THEN** the request fails with status 403 and `permission_denied`
- **AND** the executor starts no git method

#### Scenario: A rejected main clone behind an allowed subdirectory is refused

- **WHEN** the group allows `/home/dev/src/llame/apps/` and rejects
  `/home/dev/src/llame`, and the owner registers
  `/home/dev/src/llame/apps/web`
- **THEN** the main-clone decision uses `/home/dev/src/llame` and returns reject
- **AND** the request fails with status 403 and `permission_denied` before any
  row is stored

#### Scenario: A Machine locator is evaluated in its locator form

- **WHEN** the group rejects `^machine://nas/srv/` and the owner registers
  `machine://nas/srv/app`
- **THEN** the request fails with status 403 and `permission_denied`
- **AND** the executor starts no git method

### Requirement: Registration and removal map failures to typed statuses

An unknown or foreign identifier MUST answer 404. A duplicate owner path MUST
answer 409. A validation failure MUST answer 422. A path without a repository
MUST answer 422 `not_a_repository`.

A missing allow MUST answer 403 `tool_not_allowed`. A refused path MUST answer
403 `permission_denied`. An executor failure MUST answer 503. Another git
failure or a timeout MUST answer 502 `git_failed` with the redacted standard
error.

#### Scenario: A git failure answers 502

- **WHEN** inspection fails with a git error
- **THEN** the request answers 502 with `git_failed` and the redacted standard
  error
- **AND** the system stores no row

#### Scenario: A git timeout answers 502

- **WHEN** inspection does not end within its timeout
- **THEN** the request answers 502 with `git_failed` and stores no row

#### Scenario: A path that is not a repository answers 422

- **WHEN** the owner registers an absolute path that holds no git repository
- **THEN** the request answers 422 with `not_a_repository` and stores no row

#### Scenario: An outdated daemon answers 503

- **WHEN** registration targets a Machine whose daemon lists no git methods
- **THEN** the request answers 503 with `machine_update_required` and stores no
  row

#### Scenario: An unknown repository identifier answers 404

- **WHEN** the owner registers a checkout that names an unknown repository
  identifier
- **THEN** the request answers 404 and stores no row

### Requirement: Git calls cannot run repository hooks or monitors

Every git call MUST set `core.hooksPath` to an empty directory and MUST set
`core.fsmonitor` to `false`. A repository configuration MUST NOT start a hook or
a monitor command through the hub.

#### Scenario: A configured hook does not run

- **WHEN** a repository sets a `post-checkout` hook and the owner registers its
  path
- **THEN** inspection succeeds and the hook starts no process

#### Scenario: A configured file-system monitor does not run

- **WHEN** a repository sets a `core.fsmonitor` command and the owner removes a
  worktree
- **THEN** the guard reads the state without the monitor command

### Requirement: Executors expose typed git operations

Each executor MUST offer `git.inspect`, `git.worktreeAdd`, `git.worktreeList`,
`git.worktreeRemove`, and `git.status`. The local executor MUST offer the same
methods. Each call MUST take typed input, MUST pass git an argument vector, and
MUST use a fixed environment and a timeout. Each failure MUST return a typed
result with the git standard error.

#### Scenario: Owner input reaches git as one argument

- **WHEN** the owner registers a path that holds a `;` character
- **THEN** the executor receives one argument and starts no shell

#### Scenario: A slow operation stops at the timeout

- **WHEN** a git operation does not end within its timeout
- **THEN** the call ends and returns a typed failure, and no row is stored

### Requirement: Git calls refuse option-like caller values

A `name`, a branch, or a `baseRef` that starts with `-` MUST fail as
`invalid_input` before any git process starts. Every other caller value MUST
follow `--end-of-options` or `--`, where the subcommand accepts one. A path MUST
be absolute. A `name` MUST pass the git branch-name rules and MUST NOT hold a
`.` or `..` segment.

#### Scenario: A base ref that looks like an option is refused

- **WHEN** the caller submits `baseRef` `--force`
- **THEN** the call fails as `invalid_input` and no git process starts

#### Scenario: A name with a parent segment is refused

- **WHEN** the caller submits the worktree name `..`
- **THEN** the call fails as `invalid_input` and no directory is created

#### Scenario: A name that starts with a dash is refused

- **WHEN** the caller submits the worktree name `-b`
- **THEN** the call fails as `invalid_input` and no branch is created

#### Scenario: A path with a separator is one absolute argument

- **WHEN** the caller submits the path `/home/dev/src/llame;rm`
- **THEN** git receives that absolute path after the separator as one argument
- **AND** no shell runs

### Requirement: Worktree removal is owner-initiated and guarded

Removal MUST start from an owner action and MUST NOT be available to a Run. The
owner MUST remove a worktree through `DELETE /api/v1/checkouts/:id/worktree`.
The system MUST refuse removal when the worktree holds uncommitted changes or
commits that are not pushed. It MUST fail closed when the upstream is unknown,
unless HEAD equals the base commit recorded at creation. When all checks pass,
the executor MUST remove the directory, the system MUST delete the row, and the
branch MUST remain.

#### Scenario: A dirty worktree is kept

- **WHEN** the owner asks to remove a worktree with uncommitted changes
- **THEN** the request fails, and the directory and the row remain

#### Scenario: A worktree with unpushed commits is kept

- **WHEN** the worktree has commits that its upstream does not have
- **THEN** the request fails, and the directory and the row remain

#### Scenario: An unknown upstream fails closed

- **WHEN** the worktree branch has no upstream and has commits after its base,
  or it has no recorded base
- **THEN** the request fails, and the directory and the row remain

#### Scenario: A fresh worktree with no upstream is removed

- **WHEN** the worktree is clean, it has no upstream, and its HEAD equals the
  base commit recorded at creation
- **THEN** the executor removes the directory and the system deletes the row
- **AND** the branch remains

#### Scenario: A clean worktree is removed

- **WHEN** the worktree has no changes and no unpushed commits
- **THEN** the executor removes the directory and the system deletes the row

#### Scenario: A Run cannot remove a worktree

- **WHEN** a Run tries to remove a worktree
- **THEN** no tool or route offers that action to the Run

### Requirement: Repository and checkout deletion cascades records and never files

Deletion MUST affect records only. Deletion of a repository MUST delete its
checkout rows and their leases. Deletion of a `main` checkout MUST delete its
`worktree` rows. The system MUST NOT delete a directory on an executor. A chat
MUST keep its stored Workspace path. A later Run MUST re-check that bound root
as before.

#### Scenario: A repository deletion keeps its directories

- **WHEN** the owner deletes a repository that holds a `main` checkout and two
  worktrees
- **THEN** the checkout rows and the leases are gone and the directories remain

#### Scenario: A main checkout deletion keeps its worktree directories

- **WHEN** the owner deletes a `main` checkout
- **THEN** its `worktree` rows are gone and every directory remains

#### Scenario: A chat keeps a path whose row is gone

- **WHEN** a chat binds a worktree and the owner deletes that checkout row
- **THEN** the chat keeps the stored path and the next Run attempt re-checks the
  bound root

### Requirement: Repository records are isolated per owner

The datastore MUST enforce owner isolation for repositories, aliases, checkouts,
and leases. A request for another owner's repository or checkout identifier MUST
return not found. A list MUST contain only the caller's records. A request
without an authenticated identity MUST fail closed.

#### Scenario: Another user's repository is not found

- **WHEN** a user requests, updates, or deletes another user's repository
- **THEN** the system returns not found and changes no row

#### Scenario: Another user's checkout is not found

- **WHEN** a user requests or deletes another user's checkout
- **THEN** the system returns not found and changes no row

#### Scenario: Two owners hold the same path on one executor

- **WHEN** two owners register the same path on one executor
- **THEN** both requests succeed and each list holds only that owner's checkout

#### Scenario: A foreign repository selector is not found

- **WHEN** a user registers a checkout that names another user's repository
  identifier
- **THEN** the system returns not found and stores no row

#### Scenario: An alias on a foreign repository is not found

- **WHEN** a user declares an alias on another user's repository
- **THEN** the system returns not found and stores no row

#### Scenario: A worktree parent on a foreign checkout is not found

- **WHEN** a user records a worktree whose parent belongs to another user
- **THEN** the system refuses the record and stores no row

#### Scenario: A lease on a foreign chat is not found

- **WHEN** a lease record names a chat of another user
- **THEN** the system refuses the record and stores no row

#### Scenario: A list holds only the caller's records

- **WHEN** a user lists repositories or checkouts
- **THEN** the response contains only that user's records

#### Scenario: A request without identity fails closed

- **WHEN** a request arrives without an authenticated identity
- **THEN** the system refuses the request and reads no row
