## ADDED Requirements

### Requirement: The handshake calls the bootstrap service

A Machine connection MUST call `BootstrapService.GetInfo` first, check the
reported protocol version, and bind the instance id to the Machine name.
Only after those checks succeed may it call `MachineService.ListRoots`,
`MachineService.GetLimits`, or another main-service method. Discovery MUST use
`llame-machine attach --print-socket`; the installation MUST connect to the
reported Unix socket directly for the host or through an SSH socket forward.

#### Scenario: The host is reached through attach

- **WHEN** the API connects to the host Machine
- **THEN** it starts `llame-machine attach --print-socket` as a child and calls `GetInfo` first

## REMOVED Requirements

### Requirement: The Machine session is versioned and multiplexed

**Reason**: The JSON-RPC framing is replaced by gRPC over HTTP/2.
**Migration**: See `machine-daemon` "The main service matches the protocol version exactly".

### Requirement: The handshake lists the git methods that a daemon answers

**Reason**: gRPC methods are typed; a missing method answers UNIMPLEMENTED.
**Migration**: The installation reports UNIMPLEMENTED as update required.

### Requirement: The handshake reports the static facts of a Machine

**Reason**: Static facts come from the bootstrap service.
**Migration**: See `machine-daemon` "The bootstrap service never breaks", which lists the facts and the identity output. Per-root total disk comes from `MachineService.ListRoots` at the same handshake.

### Requirement: Bash runs on a Machine through its working directory

**Reason**: A lost caller no longer kills a daemon-held job.
**Migration**: See `bash-execution` "Bash runs as a job of the current Machine's daemon" for working-directory resolution, the managed environment, and foreground delivery.

### Requirement: In-process host operations need a verified host Machine daemon

**Reason**: No host file or shell operation executes in the installation process.
**Migration**: The identity-checked bootstrap gates every host daemon operation, including bash.

## MODIFIED Requirements

### Requirement: Machine mutations use the native effect fence

`edit`, `write`, and `bash` on a Machine SHALL record the durable native attempt before dispatch and its result after. A failure before dispatch SHALL return `machine_unavailable`; a file mutation whose session is lost after dispatch and before its result SHALL settle as `outcome_unknown`. A daemon-held bash job SHALL instead follow the binding and reconciliation rules of `background-jobs`.

Each mutating RPC other than `McpService.OpenSession` SHALL carry an installation-drawn idempotency key. The field SHALL be `request_id`, except `JobService.CreateJob`, whose persisted `job_id` SHALL be its key. The tool call id SHALL travel as `x-llame-tool-call-id`, and trace context as `sentry-trace` and `baggage`. The deadline SHALL be the gRPC timeout. Run, attempt, and delivery sequence SHALL stay in the durable native attempt record and SHALL NOT be sent to the daemon.

#### Scenario: Session lost mid-edit is unknown, not retried

- **WHEN** the SSH session drops after an `edit` request is sent and before its result arrives
- **THEN** the tool call settles as `outcome_unknown` and the edit is not sent again

#### Scenario: Unreachable Machine before dispatch is unavailable

- **WHEN** the session cannot be opened before an `edit` is sent
- **THEN** the call returns `machine_unavailable` and records no unknown outcome

#### Scenario: Exhausted budget is refused

- **WHEN** a request reaches the daemon after its time budget is spent
- **THEN** the daemon refuses it without opening a file or starting a process

### Requirement: Machine git results report locators and rewritten errors

Every path field of a git result shown to an owner or model MUST be a Machine locator. The daemon MUST return absolute host paths and raw standard error. The installation MUST rewrite each registered-root prefix to the Machine locator form before the result leaves the installation for its caller. A failure result MUST carry that rewritten text.

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

### Requirement: The host is a configured Machine

The host MUST be an ordinary entry in `machines.hosts`. `machines.local` MUST name the entry of the computer that runs the process. The process MUST discover the host daemon with a child that runs `attach --print-socket` and connect to the reported Unix socket. Every other Machine MUST use SSH discovery and Unix-socket forwarding. The command MUST come from `LLAME_MACHINE_COMMAND`. When it is unset, the process MUST run the repository build at `apps/machine/dist/<target>/llame-machine`, where `LLAME_MACHINE_BIN_DIR` replaces `apps/machine/dist` when set. `attach` MUST exit with status 78 when the running daemon reports another instance id than the one its own configuration directory holds; the installation MUST report that exit as `machine_identity_mismatch`. A discovery command that fails otherwise, such as an SSH forced command that still runs a daemon without `attach --print-socket`, MUST make the Machine unavailable with reason `unreachable`.

#### Scenario: The host is reached through a child process

- **WHEN** `machines.local` is `devl` and the model reads `machine://devl/etc/hostname`
- **THEN** the process starts `llame-machine attach --print-socket` as a child and reads the file through the daemon socket
- **AND** no SSH process starts

#### Scenario: Another worker reaches the host over SSH

- **WHEN** the entry `devl` has a `destination` and a worker with `machines.local` set to `gpu` reads `machine://devl/etc/hostname`
- **THEN** that worker reads the file through SSH to `devl`

#### Scenario: The child and the SSH login share one daemon configuration

- **WHEN** the entry `devl` has a `destination`, and the worker on `devl` starts its child with another configuration directory than the SSH login uses, while both share one state directory
- **THEN** the `attach` of the second path exits with status 78 and that path gets `machine_identity_mismatch`
- **AND** the operator documentation requires one configuration directory for both paths

#### Scenario: A crashed child starts again at the next call

- **WHEN** the discovery child for `devl` fails before a connection is established and the model then reads a file on `devl`
- **THEN** the process starts a new discovery child for that read

### Requirement: Host operations never fall back to in-process execution

The API MUST start when the host Machine daemon cannot start. Each operation on the host Machine MUST then fail with the existing Machine-unavailable results. The process MUST NOT run that operation in process. This includes host `bash`.

#### Scenario: A missing daemon fails the call

- **WHEN** `LLAME_MACHINE_COMMAND` names a program that does not exist and the model reads `/etc/hostname` on the host Machine
- **THEN** the read returns `machine_unavailable`
- **AND** no file is read in process

#### Scenario: The API starts without a host daemon

- **WHEN** the host Machine daemon cannot start
- **THEN** the API starts and the Machines list shows the host Machine offline with reason `unreachable`

### Requirement: Each Machine daemon reports a persistent instance id

Each Machine daemon MUST create an instance id once and keep it in its configuration directory. Two daemons that start at the same time with one directory MUST report the same id. The bootstrap service MUST report the id, the release version, the build id, and the protocol version. The protocol version MUST be the integer in `packages/machine-protocol/proto/protocol.json`, and the hub MUST accept only an exact match.

#### Scenario: Two first starts agree on one id

- **WHEN** two daemon processes start at the same time with an empty configuration directory
- **THEN** both report the same instance id

#### Scenario: A daemon with another protocol version is not used

- **WHEN** `GetInfo` reports a protocol version other than the installation's
- **THEN** every operation on that Machine fails with `machine_update_required`

#### Scenario: A version 1 daemon is not used

- **WHEN** the SSH forced command of `devl` still runs a protocol version 1 daemon, which has no `attach --print-socket`
- **THEN** discovery fails and the Machines list shows `devl` offline with reason `unreachable`
- **AND** no main-service request is sent

#### Scenario: A daemon without unit-letter selectors is not used

- **WHEN** the SSH forced command of `devl` still runs a protocol version 2 daemon, which has no `L` selector forms and no `attach --print-socket`
- **THEN** discovery fails and the Machines list shows `devl` offline with reason `unreachable`
- **AND** no main-service request is sent

### Requirement: The installation binds each Machine name to one instance id

At the first successful bootstrap for a Machine name, the hub MUST record its instance id before the session accepts a main-service request. When a later bootstrap reports a different id, the hub MUST end the session before any main-service request. Each operation on that Machine MUST then return `machine_identity_mismatch`. When the hub cannot read or write the binding, the session MUST fail with `machine_unavailable`. The binding MUST stay when the operator removes the entry or the status is pruned.

An incompatible protocol version or UNIMPLEMENTED method MUST make the installation report `machine_update_required`. The daemon MUST NOT send either `machine_update_required` or `machine_identity_mismatch` as an `ErrorReason`; these decisions belong to the installation. `GetInfo` MUST remain callable before those checks, but no main-service call may precede them.

#### Scenario: A second computer under one name is refused

- **WHEN** `devl` is bound to one instance id and a daemon with another id answers for `devl`
- **THEN** the hub sends no main-service request to that daemon
- **AND** every `devl` operation returns `machine_identity_mismatch`
- **AND** the Machines list shows `devl` offline with reason `identity_mismatch`

#### Scenario: A removed and re-added name keeps its binding

- **WHEN** the operator removes `devl` from the configuration, the hub prunes its status, and the operator adds `devl` again with another computer
- **THEN** the first handshake of that computer gets `machine_identity_mismatch`

#### Scenario: An unreadable binding fails closed

- **WHEN** the database is unreachable at a handshake for `devl`
- **THEN** the session fails with `machine_unavailable` and no main-service request reaches the daemon

#### Scenario: Co-located processes share one host Machine

- **WHEN** an API process and a worker process on one computer both set `machines.local` to `devl` and each starts its own discovery child
- **THEN** both children discover the same daemon socket, both bootstrap handshakes report the same instance id, and both processes use `devl`

#### Scenario: A wrong local name is refused before host bash

- **WHEN** a worker on computer A sets `machines.local` to `gpu`, `gpu` is bound to the instance id of computer B, and the model calls `bash` on `gpu`
- **THEN** the call returns `machine_identity_mismatch`
- **AND** no command starts on computer A

### Requirement: The host Machine daemon receives only a base environment

The process MUST start the host Machine daemon child with only these variables when they are set: `PATH`, `LANG`, `TERM`, `HOME`, `TMPDIR`, `USER`, `LOGNAME`, `LLAME_MACHINE_CONFIG_DIR`, `LLAME_MACHINE_STATE_DIR`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and `SENTRY_RELEASE`. It MUST NOT pass other variables of the worker environment. A command that `LLAME_MACHINE_COMMAND` names can set more variables for the daemon, under operator control.

This decision bounds the environment only. The daemon still runs as the OS user of the worker, with that user's file access. A stdio server that it starts can read the worker environment through `/proc/<pid>/environ`. An operator who must keep hub credentials out of host Workspaces names a wrapper in `LLAME_MACHINE_COMMAND` that starts the daemon as a separate OS user. The [base-environment decision](../../../../../docs/adr/2026-11-20-host-daemon-child-gets-a-base-environment.md) records this limitation.

#### Scenario: A database credential does not reach the daemon

- **WHEN** the worker environment sets `POSTGRES_URL` and the process starts the host Machine daemon
- **THEN** the daemon environment does not contain `POSTGRES_URL`
- **AND** no process that the daemon starts inherits it

#### Scenario: A Sentry token does not reach the daemon

- **WHEN** the worker environment sets `SENTRY_AUTH_TOKEN` and `SENTRY_DSN`
- **THEN** the daemon environment contains `SENTRY_DSN` and does not contain `SENTRY_AUTH_TOKEN`

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
failure with the git standard error.

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

- **WHEN** the nearest `.git` entry of a path changed after an earlier `git.locate` and the hub calls `git.state` on that path
- **THEN** `GetStatus` returns a typed failure and starts no git process
