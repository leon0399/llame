# Spec Delta

## ADDED Requirements

### Requirement: Machine daemons answer typed git methods

The daemon MUST answer the git methods `git.inspect`, `git.worktreeAdd`,
`git.worktreeList`, `git.worktreeRemove`, and `git.status`. Each method MUST
take one strict object and run git with an argument array. A caller value that
starts with `-` MUST fail as `invalid_input` before any command starts. Every
other caller value MUST follow `--end-of-options` or `--`, where the subcommand
accepts one. A path MUST be absolute. A failed command MUST return a typed
failure with the git standard error.

#### Scenario: Repository is inspected

- **WHEN** the hub calls `git.inspect` on a Machine directory that holds a clone
- **THEN** the result carries the clone toplevel, `commonDir`, the `linked`
  flag, the main worktree path for a linked worktree, each remote name and URL,
  the branch, and the head commit

#### Scenario: Linked worktree is inspected

- **WHEN** the hub calls `git.inspect` on a directory that is a linked worktree
- **THEN** the result reports `linked` as true and the main worktree path
- **AND** `commonDir` names the git directory that the worktree shares with its
  main clone

#### Scenario: Input cannot reach a shell

- **WHEN** the hub asks for a branch named `a;touch /tmp/x` and a directory
  named `$(id)`
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

### Requirement: Machine git calls run in a sanitized environment

The daemon MUST run every git call with `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, and
`GIT_OPTIONAL_LOCKS=0`. It MUST disable repository hooks and the file-system
monitor for every call. It MUST end a call that passes its timeout.

#### Scenario: Credential prompt cannot block the daemon

- **WHEN** a git command asks for credentials on the terminal
- **THEN** the sanitized environment disables the prompt and git exits with an
  error
- **AND** the daemon returns that error as a typed failure

#### Scenario: Call timeout ends a stuck command

- **WHEN** a git command on an unresponsive file system passes the call timeout
- **THEN** the daemon ends the command and returns a typed failure

#### Scenario: Repository configuration runs no hook

- **WHEN** the target repository sets `core.fsmonitor` to a command and installs
  a `post-checkout` hook
- **THEN** `git.worktreeAdd` on that repository runs neither the command nor the
  hook
- **AND** the worktree is created

### Requirement: Git methods are additive to the Machine protocol

The protocol version MUST NOT change for the git methods. The handshake result
MUST list the git methods that the daemon answers. A Machine whose handshake
lists no git methods MUST fail a git call as `machine_update_required` before
any request. Its file tools and `bash` MUST continue to work.

#### Scenario: Outdated daemon asks for an update

- **WHEN** the hub calls `git.status` on a Machine whose handshake listed no git
  methods
- **THEN** the call fails as `machine_update_required` and no request reaches
  the daemon
- **AND** `read` and `bash` on that Machine continue to work

#### Scenario: Handshake with an old daemon still succeeds

- **WHEN** the hub opens a session to a daemon that predates the git methods
- **THEN** the handshake succeeds and the Machine status reports contact

### Requirement: Worktree directories on a Machine lie inside a registered root

Before any git call, the daemon MUST apply the registered-root check of
"Registered roots bound every Machine address" to the worktree directory. That
check MUST use the nearest ancestor that exists of a directory that does not
exist yet. A refusal MUST return `path_not_registered` and start no git command.

#### Scenario: Worktree directory outside the roots is refused

- **WHEN** the hub asks for a worktree at a directory that no registered root
  contains
- **THEN** the daemon returns `path_not_registered`
- **AND** it starts no git command

#### Scenario: Symbolic link cannot widen a root

- **WHEN** a registered root holds a symbolic link to a directory outside every
  root and a git method targets a path through that link
- **THEN** the daemon returns `path_not_registered`

### Requirement: Machine git results report locators and rewritten errors

Every path field of a git result MUST be a Machine locator. Standard error text
MUST have each registered-root prefix rewritten to the Machine locator form
before it leaves the daemon. A failure result MUST carry that rewritten text.

#### Scenario: Results report Machine locators

- **WHEN** `git.inspect` succeeds on `/home/me/shop` on `devl`
- **THEN** the result reports the toplevel as `machine://devl/home/me/shop`
- **AND** no host path appears in any path field

#### Scenario: Standard error reports locators

- **WHEN** `git.worktreeAdd` on `devl` fails because
  `/home/me/.llame-worktrees/shop/x` already exists
- **THEN** the typed failure reports that path as
  `machine://devl/home/me/.llame-worktrees/shop/x`
- **AND** the failure text carries no bare host path for a registered root
