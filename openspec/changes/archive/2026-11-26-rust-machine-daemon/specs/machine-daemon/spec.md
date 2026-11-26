## ADDED Requirements

### Requirement: A connection attaches to the running daemon or starts it

Every connection to a Machine MUST first run `llame-machine attach --print-socket`.
The command MUST start the daemon of its OS account when no daemon holds the
daemon lock, wait for its socket, and print that socket's absolute path. The
installation MUST connect to that Unix socket directly for the host Machine,
or through an SSH Unix-socket forward for another Machine.

#### Scenario: The first attach starts the daemon

- **WHEN** no daemon runs for the account and `attach --print-socket` starts
- **THEN** the command starts one daemon, waits for its socket, and prints its path

#### Scenario: A second attach reaches the same daemon

- **WHEN** a daemon runs and a second `attach --print-socket` starts with the same configuration directory
- **THEN** the command prints that daemon's socket path and no second daemon starts

#### Scenario: A stale socket is replaced

- **WHEN** the socket file exists but no process holds the daemon lock
- **THEN** the new daemon removes the socket file and binds a new one

### Requirement: The daemon state is private to its OS account

The daemon MUST keep its socket, its lock, and its job directories under
`LLAME_MACHINE_STATE_DIR` when that nonempty operator override is set.
Otherwise it MUST use `$XDG_STATE_HOME/llame-machine`, or
`~/.local/state/llame-machine` when that variable is unset. The directory
MUST have mode 0700. One daemon MUST serve one OS account, and installations
that share a box MUST use separate accounts.

#### Scenario: The state directory is private

- **WHEN** the daemon starts
- **THEN** its state directory has mode 0700 and its socket has mode 0600

### Requirement: The bootstrap service never breaks

The daemon MUST serve `stead.machine.bootstrap.v1.BootstrapService.GetInfo`.
The answer MUST carry the persistent instance id, the release version, the
build id, the main-service protocol version, the kernel boot id, the daemon
start time, static facts, and capabilities as open name and version strings.
The static facts MUST be the OS, the architecture, the kernel release, the CPU
count, and the memory size. At each successful handshake the installation MUST
record those facts, their capture time, and the total disk of each registered
root that `MachineService.ListRoots` reports. `llame-machine info` MUST print the instance id, the
release version, the build id, and the protocol version, and
`llame-machine --version` MUST print the release version. During alpha the
capabilities are informational: the exact protocol-version match decides what
the installation may call, and a main-service method that a daemon answers
with UNIMPLEMENTED MUST be reported as update required. CI MUST refuse a
breaking change to the bootstrap package unless the change records a reviewed
exception.

#### Scenario: Facts refresh at each handshake

- **WHEN** the operator adds memory to `devl` and the installation connects again
- **THEN** the Machines list shows the new memory size, each root's total disk, and the time of that handshake

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
and a `stead.machine.v1.ErrorDetail` carrying an `ErrorReason`. This
specification writes each reason without its `ERROR_REASON_` prefix, in lower
case. The reasons and their status codes are:

- `invalid_argument` with INVALID_ARGUMENT, for a malformed request field;
- `path_not_registered` with PERMISSION_DENIED, for a path that lies or
  resolves outside every registered root;
- `job_limit` with RESOURCE_EXHAUSTED, for a full running-job limit;
- `job_not_found` with NOT_FOUND, for an unknown job or another owner's job;
- `job_running` with FAILED_PRECONDITION, for releasing a job that has not
  settled.

A path outside the roots MUST get the same message whether or not the path
exists. An outcome of started work MUST travel in the response. A failure that
a service's response type defines, such as the `GitService` failure
`invalid_input`, MUST also travel in the response, even when the daemon starts
no work.

#### Scenario: A path outside the roots is refused without revealing it

- **WHEN** a call names `/etc/passwd` on a Machine whose only root is `/srv/app`
- **THEN** the daemon answers PERMISSION_DENIED with reason `path_not_registered` and the fixed message

### Requirement: Mutating calls carry an idempotency key

Every mutating call except an MCP session MUST carry an installation-drawn
`request_id`, or `job_id` for `JobService.CreateJob`. The daemon MUST retain completed results in
an in-memory cache bounded by ten minutes or 4,096 keys. A resend while its key
is retained MUST return the first result without repeating the effect; a
running key MUST wait for its first result. This is not a minimum replay
window. The installation MUST NOT resend a mutation with an unknown outcome
unless it proves that no effect happened. Otherwise it MUST report
`outcome_unknown` under the durable native effect fence.

#### Scenario: A resent edit returns the first result

- **WHEN** an edit ran and a request with its retained key reaches the daemon again
- **THEN** the daemon returns the first result and the file holds one edit

### Requirement: Every command runs as a daemon job

The daemon MUST run every command as a job with a job id that the installation
draws. A start with a known job id MUST return the existing job. The daemon
MUST NOT decide whether a command is foreground or background.

#### Scenario: A resent start runs the command once

- **WHEN** the installation sends two starts with the same job id
- **THEN** the command runs once and both answers name the same job

### Requirement: A daemon job carries its owner's tag

`JobService.CreateJob` MUST record the opaque owner tag supplied by the
installation. `GetJob`, `ReadOutput`, `CancelJob`, and `DeleteJob` MUST require
that tag to match. An unknown job id and an id belonging to another owner
MUST both answer NOT_FOUND with reason `job_not_found`.

`ListJobs` and `WatchJobs` are daemon-wide administrative operations for the
installation's reconciler. Their records MUST carry owner tags. The
installation MUST NOT expose that administrative list directly to an owner or
model. Every model-facing or owner-facing job operation MUST first resolve an
owner-scoped persisted Chat job and use its recorded daemon job id and tag.

#### Scenario: Another owner's daemon job is not found

- **WHEN** a read or stop names a job id with another owner's tag
- **THEN** the daemon answers NOT_FOUND with reason `job_not_found` and the job does not change

#### Scenario: Administrative reconciliation does not authorize a model read

- **WHEN** the reconciler observes a daemon job with an owner tag
- **THEN** it resolves the matching persisted binding under that owner's datastore identity
- **AND** a Run of another owner cannot use that record to read or stop the job

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

### Requirement: An unproved stop settles a job as lost

`JobService.CancelJob` and the end of a job's lifetime MUST kill the job's
process group and prove within a bounded stop budget that the group is empty.
When the proof succeeds, the job MUST settle `cancelled` or `timed_out`. When
it fails, the job MUST settle `lost` with the cause `cancel_unproved`, and the
daemon MUST NOT report the process group as stopped. A settled job, including
such a `lost` job, MUST NOT count toward the running-job limit.

#### Scenario: A stop that cannot be proved is lost

- **WHEN** `CancelJob` kills a job's group and a process of that group survives the stop budget
- **THEN** the job settles `lost` with cause `cancel_unproved`
- **AND** the job no longer counts toward the running-job limit

### Requirement: The job stream starts with a snapshot

`JobService.WatchJobs` MUST send every job the daemon knows, each with its
opaque owner tag, then a snapshot marker, then one full job record for each
later change, for as long as the connection lasts. The installation MUST
resolve each record through its owner-scoped persisted job binding before
reading output, settling the row, or releasing the daemon job.

#### Scenario: A reconnecting installation catches up

- **WHEN** a job settled while no connection was open and the installation opens `JobService.WatchJobs`
- **THEN** the snapshot carries the settled job

### Requirement: A Machine owns its capacity limits

The Machine MUST read its running-job limit and its per-stream output ceiling
from `config.toml`, with defaults of 32 running jobs and 64 MiB. At the output
ceiling the daemon MUST stop recording the stream, mark the job truncated, and
keep the process running.
The running-job limit MUST count jobs the current daemon records as running.
A `lost` outcome MUST NOT claim that an earlier process group stopped; after
a daemon crash, surviving groups remain outside that count and require
inspection of the environment. This limit is not an OS process quota.

#### Scenario: The running-job limit refuses a new job

- **WHEN** 32 jobs run and a start arrives
- **THEN** the daemon answers RESOURCE_EXHAUSTED with reason `job_limit`

### Requirement: An outdated daemon is replaced when it runs no job

`attach` MUST compare the running daemon's build id with its own. When they
differ and no job runs, `attach` MUST stop the running daemon and start its
own binary. When jobs run, the running daemon MUST keep serving.
Replacement ends the old daemon's open calls. A mutation whose result is lost
MUST settle as `outcome_unknown` under the native effect fence and MUST NOT be
sent again. An affected MCP session MUST close; a later call may open a new
session. Draining other open calls before replacement is outside this change.

#### Scenario: A rebuilt binary applies on the next attach

- **WHEN** the binary changed and the running daemon has no job
- **THEN** the next attach serves from a daemon that reports the new build id

### Requirement: The daemon reports host paths

Results MUST name absolute host paths and carry raw git standard error. The
installation MUST render Machine locators from them.

#### Scenario: A read result names the host path

- **WHEN** the installation reads `/srv/app/a.txt`
- **THEN** the result path is `/srv/app/a.txt` and the installation shows `machine://box/srv/app/a.txt`
