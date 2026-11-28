# Machine git copy failures

## MODIFIED Requirements

### Requirement: Machine daemons answer typed git methods

The installation's git operations MUST map to `stead.machine.v1.GitService`:
`git.inspect` to `GetRepository`, `git.locate` to `LocateRepository`,
`git.state` to `GetStatus`, `git.worktreeAdd` to `CreateWorktree`,
`git.worktreeList` to `ListWorktrees`, and `git.worktreeRemove` to
`DeleteWorktree`. Other capabilities name the operations, and their results
keep the names those capabilities define. `LocateRepository` MUST start no git
process. `GetStatus` MUST take the git entry that the installation admitted and
MUST fail without starting git when that entry is no longer the nearest `.git`
entry of the path. Each method MUST take one typed request. Git MUST get an argument
array. A caller value that starts with `-` MUST fail before git starts with the
typed `invalid_input` failure in the response, as the `GitService` response
defines it. Other
caller values MUST follow `--end-of-options` or `--` where the subcommand
accepts one. A path MUST be absolute. A failed command MUST return a typed
failure with the git standard error, except that a `COPY_FAILED` failure MUST
carry a fixed reason phrase and at most one bounded relative path instead of
standard error.

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

#### Scenario: Copy failure carries no standard error

- **WHEN** `git.worktreeAdd` fails because the environment copy cannot write `config/secret.env`
- **THEN** the daemon returns a typed `COPY_FAILED` failure whose message is a fixed reason phrase plus `config/secret.env`
- **AND** the message holds no git standard error, OS error text, manifest line, or file bytes

#### Scenario: Locate starts no git process

- **WHEN** the hub calls `git.locate` on a Machine directory inside a clone
- **THEN** the result names the nearest `.git` entry as a Machine locator
- **AND** the daemon starts no git process

#### Scenario: State refuses a changed git entry

- **WHEN** the nearest `.git` entry of a path changed after an earlier `git.locate` and the hub calls `git.state` on that path
- **THEN** `GetStatus` returns a typed failure and starts no git process
