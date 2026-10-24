# Spec Delta

## Purpose

The capability gives an owner a catalog of git repositories, and of the
checkouts where each repository exists on an executor. A chat can start from a
known clone or worktree, and the records never own the files.

## ADDED Requirements

### Requirement: Repositories are owner-scoped and identified by their normalized remote

Each repository MUST store a display name and an optional canonical remote. The
canonical remote MUST be the origin URL without its scheme, credentials, `.git`
suffix, and trailing slash, with a lowercase host. Origin URLs that differ only
in those parts MUST map to one repository. A repository without a remote MUST
store no canonical remote and MUST take its identity from its first checkout. An
alias MUST map one declared alternate remote to one repository of that owner.

#### Scenario: Equivalent origin URLs are one repository

- **WHEN** the owner registers a checkout of
  `git@github.com:leon0399/llame.git` and then a checkout of
  `https://github.com/leon0399/llame`
- **THEN** both checkouts belong to one repository with the canonical remote
  `github.com/leon0399/llame`

#### Scenario: A repository without a remote takes its first checkout as identity

- **WHEN** the owner registers a local clone that has no remote
- **THEN** the repository stores no canonical remote and lists the new checkout

#### Scenario: A declared alias selects one repository

- **WHEN** the owner declares an alias for a renamed remote and then registers a
  checkout of that remote
- **THEN** the checkout joins the repository that the alias names

### Requirement: Checkouts record where a repository exists on an executor

The catalog MUST store each checkout with its repository, its owner, an
executor identifier, a canonical absolute path on that executor, and an origin.
The origin MUST be `registered`, `adopted`, or `created`. One executor and path
pair MUST hold at most one checkout in the owner's catalog. The stored path
MUST be the canonical form that the executor reports.

#### Scenario: One repository holds a checkout on each executor

- **WHEN** the owner registers the same repository on the local executor and on
  `machine://nas`
- **THEN** the repository lists two checkouts, one for each executor

#### Scenario: A duplicate executor and path pair is refused

- **WHEN** the owner registers a path that a checkout of that executor already
  holds
- **THEN** the request fails with a conflict and the stored row is unchanged

#### Scenario: A Machine checkout names its Machine

- **WHEN** the owner registers a checkout on `machine://nas`
- **THEN** the checkout records the executor identifier `machine:nas` and the
  canonical path on that Machine

### Requirement: Worktree checkouts are children of a main checkout

Each checkout MUST have the kind `main` or `worktree`. A `worktree` checkout
MUST store its branch and the parent `main` checkout. The parent MUST belong to
the same repository and the same executor. A `worktree` checkout MUST NOT exist
without a parent. A `main` checkout can store an optional worktree base
directory.

#### Scenario: Worktrees name one main parent

- **WHEN** the owner lists a repository that holds one `main` checkout and two
  worktrees
- **THEN** each worktree names that `main` checkout as its parent

#### Scenario: A worktree parent on another executor is refused

- **WHEN** a worktree record names a parent `main` checkout on another executor
- **THEN** the system refuses the record and stores nothing

#### Scenario: A main checkout can set a worktree base directory

- **WHEN** the owner sets a worktree base directory on a `main` checkout
- **THEN** a new worktree of that checkout is created under that directory

### Requirement: Worktree leases are informational ownership receipts

A lease MUST record the chat, the worktree checkout, the base reference, and the
time of creation. A lease MUST NOT reserve the path and MUST NOT refuse a second
chat. A second chat that binds a leased path MUST succeed, and the worktree MUST
show every chat that binds it. A lease MUST NOT change how a fork copies the
Workspace binding.

#### Scenario: A second chat binds a leased path

- **WHEN** a second chat enters the path of a leased worktree
- **THEN** entry succeeds and the worktree shows both chats

#### Scenario: A fork copies the binding without a new lease

- **WHEN** the owner forks a chat that holds a leased path
- **THEN** the fork copies the Workspace binding and the system writes no lease

### Requirement: Checkout registration inspects the path on its executor

Registration MUST inspect the path on its executor before the system stores a
row. The inspected origin MUST be the authority. A declared repository or remote
that disagrees with the inspected origin MUST fail with a validation error. An
executor that is not reachable MUST fail registration with
`machine_unavailable`. For a clone without a remote, the optional repository
input MUST select one repository of the owner. Inspection MUST fill the display
name and the canonical path.

#### Scenario: A declared repository that disagrees with the origin is refused

- **WHEN** the owner declares repository A and the inspected origin is the
  origin of repository B
- **THEN** the request fails with a validation error and the system stores no
  row

#### Scenario: An offline executor refuses registration

- **WHEN** the owner registers a path on a Machine that is offline
- **THEN** the request fails with `machine_unavailable` and the system stores no
  row

#### Scenario: A clone without a remote joins a named repository

- **WHEN** the owner registers a clone without a remote and names an existing
  repository
- **THEN** the checkout joins that repository and inspection records the
  canonical path

### Requirement: Executors expose typed git operations

Every executor MUST offer typed git operations: inspect, worktree add, worktree
list, worktree remove, and status. Each operation MUST take typed input, MUST
pass git an argument vector, and MUST use a sanitized environment and a timeout.
An operation MUST NOT build a shell command from owner input. Each failure MUST
carry the git standard error in a typed result. An executor that does not
offer an operation MUST fail it with `machine_update_required`.

#### Scenario: An older Machine daemon fails with `machine_update_required`

- **WHEN** the hub calls a git operation on a Machine whose daemon predates it
- **THEN** the call fails with `machine_update_required`
- **AND** no request reaches the daemon

#### Scenario: Owner input reaches git as one argument

- **WHEN** the owner registers a path that holds a `;` character
- **THEN** the executor receives one argument and starts no shell

#### Scenario: A slow operation stops at the timeout

- **WHEN** a git operation does not end within its timeout
- **THEN** the call fails with a typed timeout result and no row is stored

### Requirement: Worktree removal is owner-initiated and guarded

Removal MUST start from an owner action and MUST NOT be available to a Run. The
system MUST refuse removal when the worktree has uncommitted changes or unpushed
commits. The system MUST fail closed when the upstream branch is unknown. When
all checks pass, the executor MUST remove the directory and the system MUST
delete the checkout row.

#### Scenario: A dirty worktree is kept

- **WHEN** the owner asks to remove a worktree with uncommitted changes
- **THEN** the request fails, and the directory and the row remain

#### Scenario: A worktree with unpushed commits is kept

- **WHEN** the worktree has commits that its upstream does not have
- **THEN** the request fails, and the directory and the row remain

#### Scenario: An unknown upstream fails closed

- **WHEN** the worktree branch has no upstream
- **THEN** the request fails, and the directory and the row remain

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
MUST keep its stored Workspace path. A later Run MUST re-check that binding as
before.

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
  binding

### Requirement: Repository records are isolated per owner

The datastore MUST enforce owner isolation for repositories, aliases,
checkouts, and leases. A request for another owner's repository or checkout
identifier MUST return not found. A list MUST contain only the caller's records.
A request without an authenticated identity MUST fail closed.

#### Scenario: Another user's repository is not found

- **WHEN** a user requests, updates, or deletes another user's repository
- **THEN** the system returns not found and changes no row

#### Scenario: Another user's checkout is not found

- **WHEN** a user requests or deletes another user's checkout
- **THEN** the system returns not found and changes no row

#### Scenario: A list holds only the caller's records

- **WHEN** a user lists repositories or checkouts
- **THEN** the response contains only that user's records

#### Scenario: A request without identity fails closed

- **WHEN** a request arrives without an authenticated identity
- **THEN** the system refuses the request and reads no row
