## ADDED Requirements

### Requirement: A connection attaches to the running daemon or starts it

Every connection to a Machine MUST run `llame-machine attach --stdio`. The
command MUST connect to the daemon of its OS account over the daemon socket,
or start the daemon first when no daemon holds the daemon lock. It MUST then
relay gRPC bytes between its standard streams and the socket, and MUST write
nothing else to its standard output.

#### Scenario: The first attach starts the daemon

- **WHEN** no daemon runs for the account and `attach --stdio` starts
- **THEN** the command starts one daemon, waits for its socket, and relays the connection

#### Scenario: A second attach reaches the same daemon

- **WHEN** a daemon runs and a second `attach --stdio` starts
- **THEN** the command connects to that daemon and no second daemon starts

#### Scenario: A stale socket is replaced

- **WHEN** the socket file exists but no process holds the daemon lock
- **THEN** the new daemon removes the socket file and binds a new one

### Requirement: The daemon state is private to its OS account

The daemon MUST keep its socket, its lock, and its job directories in
`$XDG_STATE_HOME/llame-machine`, or `~/.local/state/llame-machine` when the
variable is unset. The directory MUST have mode 0700. One daemon MUST serve
one OS account, and installations that share a box MUST use separate accounts.

#### Scenario: The state directory is private

- **WHEN** the daemon starts
- **THEN** its state directory has mode 0700 and its socket has mode 0600

### Requirement: The bootstrap service never breaks

The daemon MUST serve `stead.machine.bootstrap.v1.BootstrapService.GetInfo`.
The answer MUST carry the persistent instance id, the release version, the
build id, the main-service protocol version, the kernel boot id, static facts,
and capabilities as open name and version strings. CI MUST refuse a breaking
change to the bootstrap package unless the change records a reviewed
exception.

#### Scenario: An outdated daemon stays identifiable

- **WHEN** an installation connects to a daemon with another protocol version
- **THEN** `GetInfo` still answers with the daemon's instance id and protocol version

### Requirement: The main service matches the protocol version exactly

During alpha the installation MUST accept a daemon only when `GetInfo`
reports exactly the protocol version in `packages/machine-protocol/proto/protocol.json`.
Every change to the `stead.machine.v1` package MUST increase that version.

#### Scenario: A daemon with another version is refused new work

- **WHEN** `GetInfo` reports a protocol version that differs from the installation's
- **THEN** the installation reports the Machine as update required and sends it no main-service call

### Requirement: Refusals before work are status codes with a reason

The daemon MUST refuse a request it does not start with a gRPC status code
and a `google.rpc.ErrorInfo` reason: `invalid_argument` for a malformed
request, `path_not_registered` for a path outside every registered root, and
`machine_job_limit` for a job over the running-job limit. A path outside the
roots MUST get the same message whether or not the path exists. An outcome of
started work MUST travel in the response, never as a status code.

#### Scenario: A path outside the roots is refused without revealing it

- **WHEN** a call names `/etc/passwd` on a Machine whose only root is `/srv/app`
- **THEN** the daemon answers PERMISSION_DENIED with reason `path_not_registered` and the fixed message

### Requirement: Mutating calls carry an idempotency key

Every mutating call except an MCP session MUST carry a key that the
installation draws for the call. The daemon MUST return the first result for a
resent key for at least 10 minutes while it runs, and MUST NOT repeat the
effect. A key that the daemon no longer knows MUST start the call again only
when the installation proves no effect happened; otherwise the outcome is
unknown.

#### Scenario: A resent edit returns the first result

- **WHEN** the connection drops after an edit ran and the installation resends the edit with the same key
- **THEN** the daemon returns the first result and the file holds one edit

### Requirement: Every command runs as a daemon job

The daemon MUST run every command as a job with a job id that the installation
draws. A start with a known job id MUST return the existing job. The daemon
MUST NOT decide whether a command is foreground or background.

#### Scenario: A resent start runs the command once

- **WHEN** the installation sends two starts with the same job id
- **THEN** the command runs once and both answers name the same job

### Requirement: Job records live in per-job directories

Each job MUST have a directory under `jobs/` that holds its start record, one
file per output stream, and a status record written at settlement. Output
MUST be readable by byte offset while the job runs and after it settles. The
daemon MUST delete a job directory only when the installation releases a
settled job.

#### Scenario: Output is read by offset

- **WHEN** a job wrote 10 bytes and the installation reads from offset 4
- **THEN** the daemon returns the last 6 bytes

### Requirement: A restarted daemon reports unfinished jobs as lost

At start the daemon MUST settle every job directory that has no status record
as `lost`, with the cause `daemon_restarted`, or `machine_rebooted` when the
stored boot id differs. The output of such a job MUST stay readable.

#### Scenario: A job of a crashed daemon is lost

- **WHEN** the daemon stops while a job runs and a new daemon starts
- **THEN** the job is `lost` with cause `daemon_restarted` and its partial output is readable

### Requirement: The job stream starts with a snapshot

`Jobs.Watch` MUST send every job the daemon knows, then a snapshot marker, then
one full job record for each later change, for as long as the connection
lasts.

#### Scenario: A reconnecting installation catches up

- **WHEN** a job settled while no connection was open and the installation opens `Jobs.Watch`
- **THEN** the snapshot carries the settled job

### Requirement: A Machine owns its capacity limits

The Machine MUST read its running-job limit and its per-stream output ceiling
from `config.toml`, with defaults of 32 running jobs and 64 MiB. At the output
ceiling the daemon MUST stop recording the stream, mark the job truncated, and
keep the process running.

#### Scenario: The running-job limit refuses a new job

- **WHEN** 32 jobs run and a start arrives
- **THEN** the daemon answers RESOURCE_EXHAUSTED with reason `machine_job_limit`

### Requirement: An outdated daemon is replaced when it runs no job

`attach` MUST compare the running daemon's build id with its own. When they
differ and no job runs, `attach` MUST stop the running daemon and start its
own binary. When jobs run, the running daemon MUST keep serving.

#### Scenario: A rebuilt binary applies on the next attach

- **WHEN** the binary changed and the running daemon has no job
- **THEN** the next attach serves from a daemon that reports the new build id

### Requirement: The daemon reports host paths

Results MUST name absolute host paths and carry raw git standard error. The
installation MUST render Machine locators from them.

#### Scenario: A read result names the host path

- **WHEN** the installation reads `/srv/app/a.txt`
- **THEN** the result path is `/srv/app/a.txt` and the installation shows `machine://box/srv/app/a.txt`
