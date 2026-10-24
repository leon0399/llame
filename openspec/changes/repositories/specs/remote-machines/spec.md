# Spec Delta

## ADDED Requirements

### Requirement: Machine daemons answer typed git methods

The daemon MUST answer the git methods `git.inspect`, `git.worktreeAdd`,
`git.worktreeList`, `git.worktreeRemove`, and `git.status`. Each method MUST
take one strict object, run git with an argument array (never a shell string),
and set a timeout and a sanitized environment. A failed command MUST return a
typed failure with the git stderr.

#### Scenario: Repository is inspected

- **WHEN** the hub calls `git.inspect` on a Machine directory that holds a clone
- **THEN** the result carries the clone toplevel, each remote name and URL, the branch, and the head commit

#### Scenario: Input cannot reach a shell

- **WHEN** the hub asks for a branch named `a;touch /tmp/x` and a directory named `$(id)`
- **THEN** the daemon passes each value as one argument and starts no shell
- **AND** no file named `/tmp/x` appears

#### Scenario: Git failure carries the stderr

- **WHEN** `git.worktreeAdd` names a branch that another checkout already uses
- **THEN** the daemon returns a typed failure with git's stderr text
- **AND** no worktree directory appears

#### Scenario: Credential prompt cannot block the daemon

- **WHEN** a git command would ask for credentials on the terminal
- **THEN** the sanitized environment disables the prompt and git exits with an error
- **AND** the daemon returns that error as a typed failure

#### Scenario: Call timeout ends a stuck command

- **WHEN** a git command on an unresponsive file system passes the call timeout
- **THEN** the daemon ends the command and returns a typed failure

### Requirement: Git methods are additive to the Machine protocol

The protocol version MUST NOT change for the git methods. The handshake result
MUST list the git methods the daemon answers. A Machine whose handshake lists
no git methods MUST fail a git call as `machine_update_required` before any
request, and its file tools and `bash` MUST continue to work.

#### Scenario: Outdated daemon asks for an update

- **WHEN** the hub calls `git.status` on a Machine whose handshake listed no git methods
- **THEN** the call fails as `machine_update_required` and no request reaches the daemon
- **AND** `read` and `bash` on that Machine continue to work

#### Scenario: Handshake with an old daemon still succeeds

- **WHEN** the hub opens a session to a daemon that predates the git methods
- **THEN** the handshake succeeds and the Machine status reports contact

### Requirement: Worktree directories on a Machine lie inside a registered root

Before any git call, the daemon MUST check each directory against the
registered roots, lexically and on the canonical form. A directory outside
every root MUST fail as `path_not_registered`. Every path that a git result
returns MUST be a Machine locator.

#### Scenario: Worktree directory outside the roots is refused

- **WHEN** the hub asks for a worktree at a directory that no registered root contains
- **THEN** the daemon returns `path_not_registered`
- **AND** it starts no git command

#### Scenario: Symbolic link cannot widen a root

- **WHEN** a registered root holds a symbolic link to a directory outside every root and a git method targets a path through that link
- **THEN** the daemon returns `path_not_registered`

#### Scenario: Refusal does not reveal existence

- **WHEN** two directories lie outside every root and only one of them exists
- **THEN** both requests return the identical `path_not_registered` result

#### Scenario: Results report Machine locators

- **WHEN** `git.inspect` succeeds on `/home/me/shop` on `devl`
- **THEN** the result reports the toplevel as `machine://devl/home/me/shop`
- **AND** no host path appears in any field
