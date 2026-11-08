# Spec Delta

## MODIFIED Requirements

### Requirement: Machine daemons answer typed git methods

The daemon MUST answer the git methods `git.inspect`, `git.worktreeAdd`,
`git.worktreeList`, `git.worktreeRemove`, `git.locate`, and `git.state`. Each
method MUST take one strict object. A git process MUST get an argument array. A
caller value that starts with `-` MUST fail as `invalid_input` before any
command starts. Other caller values MUST follow `--end-of-options` or `--` where
the subcommand accepts one. A path MUST be absolute. A failed command MUST
return a typed failure with the git standard error.

#### Scenario: Repository is inspected

- **WHEN** the hub calls `git.inspect` on a Machine directory that holds a clone
- **THEN** the result carries the clone toplevel, `commonDir`, the `linked` flag, and the main worktree path for a linked worktree
- **AND** the result carries each remote name and URL, the branch, and the head commit

#### Scenario: Linked worktree is inspected

- **WHEN** the hub calls `git.inspect` on a directory that is a linked worktree
- **THEN** the result reports `linked` as true and the main worktree path
- **AND** `commonDir` names the git directory that the worktree shares with its main clone

#### Scenario: Input cannot reach a shell

- **WHEN** the hub asks for a branch named `a;touch /tmp/x` and a directory named `$(id)`
- **THEN** the daemon passes each value as one argument and starts no shell
- **AND** no file named `/tmp/x` appears

#### Scenario: Option-like value is invalid input

- **WHEN** the hub passes `baseRef` `--force` to `git.worktreeAdd`
- **THEN** the daemon returns `invalid_input` as a typed failure
- **AND** it starts no git command

#### Scenario: Git failure carries the standard error

- **WHEN** `git.worktreeAdd` names a branch that another checkout already uses
- **THEN** the daemon returns a typed failure with the git standard error text
- **AND** no worktree directory appears

#### Scenario: Locate starts no git process

- **WHEN** the hub calls `git.locate` on a Machine directory inside a clone
- **THEN** the result names the nearest `.git` entry as a Machine locator
- **AND** the daemon starts no git process

#### Scenario: State refuses a changed git entry

- **WHEN** the hub calls `git.state` with a git entry that is no longer the nearest `.git` entry of the path
- **THEN** the daemon returns a typed failure and starts no git process

### Requirement: Git methods are additive to the Machine protocol

The protocol version MUST NOT change for the git methods. The handshake result
MUST list the git methods that the daemon answers. The hub MUST fail a call to a
git method that the handshake did not list as `machine_update_required`, before
any request. File tools and `bash` on that Machine MUST continue to work.

#### Scenario: Outdated daemon asks for an update

- **WHEN** the hub calls `git.state` on a Machine whose handshake listed no git methods
- **THEN** the call fails as `machine_update_required` and no request reaches the daemon
- **AND** `read` and `bash` on that Machine continue to work

#### Scenario: Handshake with an old daemon still succeeds

- **WHEN** the hub opens a session to a daemon that predates the git methods
- **THEN** the handshake succeeds and the Machine status reports contact

#### Scenario: A daemon without the state method asks for an update

- **WHEN** the handshake lists `git.inspect` and `git.status` but not `git.state`, and the hub calls `git.state`
- **THEN** the call fails as `machine_update_required` and no request reaches the daemon

## ADDED Requirements

### Requirement: Machine git discovery stays inside the registered root

`git.locate` MUST search only from the path up to the outermost registered root
that holds it. It MUST read nothing above that root. When no `.git` entry exists
in that range, it MUST return `no_repository_in_root`, not `not_a_repository`.

#### Scenario: A repository above the registered root is not found

- **WHEN** the registered root is `/srv/app`, the path is `/srv/app/web`, and the only `.git` entry is `/srv/.git`
- **THEN** `git.locate` returns `no_repository_in_root`
- **AND** the daemon reads nothing above `/srv/app`

### Requirement: Machine git state reads only inside the registered roots

Before git starts, `git.state` MUST resolve the git directory, the common
directory, and each object alternate. When one of them is outside the
registered roots, it MUST return `outside_registered_root` and start no git
process.

#### Scenario: An outside common directory is refused

- **WHEN** a worktree `.git` file inside `/srv/app` points to a git directory under `/home/me/repo`, outside every registered root
- **THEN** `git.state` returns `outside_registered_root`
- **AND** no git process starts
