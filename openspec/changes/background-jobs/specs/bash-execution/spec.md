## MODIFIED Requirements

### Requirement: Alpha host bash uses the native executor gate

When `tools.nativeExecutorId` is configured and `bash` is present in `tools.allowed`, the
model-facing `bash` tool MUST be available on that native host. The model supplies shell text,
an optional directory for the command, and optional additional environment variables. The model
can also supply `async` and `unlimited`, which this capability and `background-jobs` define. The
host runs `bash -c` as the host OS user. When a Workspace is entered, an omitted `cwd` MUST use
the Workspace root. A relative `cwd` MUST resolve from that root with lexical path resolution,
as POSIX `path.posix.resolve` does, and it MUST keep a trailing separator. The executor MUST
receive exactly the projected absolute string, with that trailing separator. Projection MUST NOT
resolve real paths. The OS follows symlinks inside the projected path as for any absolute path.
For this requirement, a relative value does not start with `/` and has no `scheme:` prefix that
the shared locator parser recognizes (case-insensitive `scheme://`). An unknown scheme MUST stay
`invalid_path`, and the host MUST NOT treat it as a relative directory. `..` can resolve outside
the root. An absolute `cwd` MUST stay absolute. Without an entered Workspace, the directory
behavior of the host MUST stay as it is. Each call MUST start a fresh process. A per-call
directory override, a variable, or a shell state MUST NOT persist between calls. The tool
description MUST state this. It MUST state that an omitted `cwd` uses the Workspace root while a
Workspace is entered, and the default directory of the host otherwise. It MUST state that a
relative `cwd` resolves from the Workspace root without confinement. Workspace path resolution
MUST NOT perform shell expansion on the submitted `cwd`. The model MUST NOT select an executor, a
network mode, or a permission mode, and it MUST NOT replace a base environment variable. Bounded
output, input, duration, and process limits MUST still apply. This alpha path is explicit host
authority, not multi-tenant isolation. A later managed Sandbox and a separate permission proposal
can strengthen isolation and approval without a change to the command and result contract.

#### Scenario: Missing native executor fails closed

- **WHEN** `tools.nativeExecutorId` is unset
- **THEN** a bash request is unavailable
- **AND** no host process starts

#### Scenario: Allowlist omit fails closed

- **WHEN** `bash` is absent from `tools.allowed`
- **THEN** bash is not advertised and not executed

#### Scenario: Model cannot widen execution

- **WHEN** command arguments carry a key other than the declared `command`, `cwd`, `env`, `async`, and `unlimited`
- **THEN** the call is refused as invalid input before it reaches the executor
- **AND** no process starts

#### Scenario: Base environment cannot be replaced

- **WHEN** `env` names a base environment variable, `PATH` included
- **THEN** the executor rejects the call before the attempt is recorded
- **AND** the result names the key that collides

#### Scenario: Shell text runs via bash -c

- **WHEN** the model calls `bash` with shell text
- **THEN** the host runs that text as `bash -c`
- **AND** the model does not pick a different configured tool basename

#### Scenario: Working directory is per call

- **WHEN** no Workspace is entered and the model supplies a `cwd` that resolves to a directory that exists
- **THEN** that command runs in that directory
- **AND** the next call without `cwd` runs in the default directory of the host

#### Scenario: Unusable working directory does not run the command

- **WHEN** the supplied `cwd` does not resolve to a directory that the host can enter
- **THEN** no process starts and no attempt is recorded
- **AND** the result identifies the unusable value and states that the submitted `cwd` was not shell-expanded
- **AND** the result states how to list or create the directory

#### Scenario: Spawn failure after the attempt is recorded

- **WHEN** the attempt is recorded and the process still fails to start
- **THEN** the recorded result of the attempt is a known refusal, never `outcome_unknown`
- **AND** the Run continues

#### Scenario: Child environment is declared, not inherited

- **WHEN** a command prints its environment
- **THEN** the initial environment of the child holds exactly the declared base variables and the additions of the call
- **AND** that initial environment holds no unlisted variable of the llame process and no llame credential
- **AND** Bash, its launcher, or the runtime can add variables such as `PWD`, `SHLVL`, and `_` before the command prints its environment

#### Scenario: Omitted working directory uses the Workspace root

- **WHEN** a Workspace with root `/work/project` is entered and the model calls `bash` without `cwd`
- **THEN** the command runs in `/work/project`

#### Scenario: Relative working directory resolves from the Workspace root

- **WHEN** a Workspace with root `/work/project` is entered and the model calls `bash` first with `cwd: "packages/api"` and then with `cwd: "../shared"`
- **THEN** the first command runs in `/work/project/packages/api`
- **AND** the second command runs in `/work/shared`, outside the Workspace root

#### Scenario: Workspace working directory preserves a trailing separator

- **WHEN** a Workspace with root `/work/project` is entered and the model calls `bash` with `cwd: "packages/api/"`
- **THEN** the executor receives `/work/project/packages/api/` exactly, with the trailing separator
- **AND** the command runs in that directory

#### Scenario: Unknown working-directory scheme is invalid

- **WHEN** a Workspace is entered and the model calls `bash` with `cwd: "vault://notes"`
- **THEN** the tool returns `invalid_path`
- **AND** no process starts, and no filesystem probe treats the value as a relative directory

#### Scenario: The background fields are accepted

- **WHEN** the model calls `bash` with `command` and `async: true`
- **THEN** the call passes input validation

### Requirement: Command results are bounded and explicit

Each bash call MUST enforce finite input, duration, process, stdout, and
stderr bounds. On the llame host and for an `ssh://` command, each stream
bound MUST be `tools.artifacts.maxBytes` UTF-8 bytes. A Machine command MUST
keep the 32,000-unit stream bound of the Machine protocol. The result MUST
contain a safe status, the exit code when known, the bounded output, and
truncation metadata when a bound cut the output. It MUST carry the wall time
from spawn to settlement as `wallTimeMs` when the producer reports it. The
result MUST NOT carry constant fields that name the operation or the executor.

A `command_failed` message MUST carry the exit code, the elapsed time when
known, and the bounded streams in the bash text shape of
`tool-result-rendering`. A `timed_out` message MUST name the elapsed time that
the producer measured. It MUST omit that time when no command started.

The executor MUST return output as the command produced it, cut at the bound.
The executor MUST NOT rewrite, reorder, or delete lines, except to replace a
member and to drop a required fragment. llame MUST replace
every member of the instance's configured credential set (`instance-config`)
with `[REDACTED]`. The replacement MUST occur before llame records the result,
stores it as an artifact, or sends it to the model.

On the llame host the executor redacts. For an `ssh://` command and a Machine
command, the API redacts the output it received. llame never sends the
configured credential set to the remote host or the Machine.

The executor MUST apply the bound to the raw output's positions in the bound's
own unit, and a stream MUST NOT exceed the bound. A cut, a drop, or a gap can
clip a member. llame MUST replace a clipped fragment of 10 or more characters
with `[REDACTED]` and MUST remove a shorter one. llame can cut a stream at a
capture or transport limit, or because the command timed out. In that case
llame MUST drop the fragment at the end that is a proper prefix of a member.

When a transport dropped output between two kept parts of a stream, a member
fragment can match on both sides of that gap. llame MUST drop both fragments.
A cut, a drop, or a gap MUST NOT expose any part of a member match.

Secrets that a bound Workspace's own MCP configuration resolves are not
members. The delimiter neutralization of every tool result MUST still apply to
the copy that the model reads. After timeout settlement proves that the
process group stopped, the watcher MUST drain output for at most 50 ms. The
watcher MUST mark a stream that is still open at that bound as truncated, and
MUST destroy it.

For a command on the llame host, the foreground bound starts promotion instead
of stopping the command. The command's duration follows the job lifetime rules
of `background-jobs`, including its operator-authorized unlimited option. An
unresolved host promotion has no per-call deadline: the call MUST remain
unsettled until promotion or recovery determines the authoritative result. The
`ssh://` and Machine duration bounds and settlement rules remain unchanged.

#### Scenario: Oversized output is bounded

- **WHEN** a command on the llame host produces more output than `tools.artifacts.maxBytes`
- **THEN** the result contains a bounded prefix and explicit truncation metadata
- **AND** the output after that bound reaches neither the model nor the artifact

#### Scenario: Non-zero exit is observable

- **WHEN** a command exits non-zero within its bounds
- **THEN** the result reports the non-zero status and bounded stderr
- **AND** it does not convert the command into a successful file or Knowledge effect

#### Scenario: Paths and diagnostics survive

- **WHEN** a command prints absolute paths, a stack trace, or a line that begins with `Error:`
- **THEN** the executor result contains those lines verbatim within the bound
- **AND** only reserved tool delimiters are escaped in the copy that the model reads

#### Scenario: Wall time is reported

- **WHEN** a command runs for 1,240 ms and exits 0
- **THEN** the result carries `wallTimeMs` 1240
- **AND** the header that the model reads is `exit 0, 1.2 s`

#### Scenario: A timeout names the elapsed time

- **WHEN** the deadline stops a command after 30.0 s
- **THEN** the `timed_out` message names 30.0 s elapsed

#### Scenario: An old daemon reports no wall time

- **WHEN** a Machine daemon that predates `wallTimeMs` answers a bash call
- **THEN** the hub result carries no `wallTimeMs`
- **AND** the call settles with its other fields unchanged

#### Scenario: A host stream within the default bound is kept

- **WHEN** `tools.artifacts.maxBytes` is its default 8 MiB and a command on the llame host prints 3 MB to stdout
- **THEN** the executor keeps all 3 MB, and the result is not marked truncated

#### Scenario: A printed provider key is redacted

- **WHEN** a provider `key` resolves to `sk-canary-7Qx2Lm9Vb4Rt8Wn3` and a file holds that key. A bash command on the llame host prints that file
- **THEN** the result's stdout contains `[REDACTED]` where the key was
- **AND** the recorded result, its artifact, and its replay contain no `sk-canary-7Qx2Lm9Vb4Rt8Wn3`

#### Scenario: Remote output is redacted by the API

- **WHEN** an `ssh://` command or a Machine command writes a configured credential to its output
- **THEN** the recorded result contains `[REDACTED]` where the credential was and not the credential
- **AND** neither request to the remote host nor request to the Machine carried the credential set

#### Scenario: A credential crossing the output bound is redacted whole

- **WHEN** a command on the llame host prints output whose configured credential begins a few characters before the stdout bound
- **THEN** the result contains no prefix of the credential
- **AND** the result is still bounded and marked truncated

#### Scenario: An earlier redaction does not expose a later credential

- **WHEN** a command prints a configured credential longer than `[REDACTED]` near the start of stdout. The longest member then begins just past the stdout bound
- **THEN** the result contains `[REDACTED]` for the first and no prefix of the second

#### Scenario: A credential ending at the cut is not exposed

- **WHEN** a configured credential crosses the stdout bound and its last character is the first character of another member
- **THEN** the result contains no part of it

#### Scenario: A credential cut by the timeout is not exposed

- **WHEN** a command times out while it prints a configured credential
- **THEN** the result contains no prefix of the credential

#### Scenario: A credential cut by a Machine's bound is not exposed

- **WHEN** a Machine command's stdout reaches the 32,000-unit bound in the middle of a configured credential
- **THEN** the hub result contains no prefix of the credential
- **AND** the result is marked truncated

#### Scenario: A short fragment at the bound leaves no marker

- **WHEN** a configured credential starts 4 characters before the stdout bound
- **THEN** the result's stdout ends before the credential and is no longer than the bound
- **AND** it contains no character of the credential

#### Scenario: Non-credential configuration survives

- **WHEN** `knowledge.root` resolves to `/srv/kb` and a command prints `/srv/kb/notes.md`
- **THEN** the result contains `/srv/kb/notes.md` verbatim

#### Scenario: Promotion wins the durable fence

- **WHEN** promotion commits the job, initial output, and `backgrounded` result before recovery
- **THEN** the host call returns `backgrounded` and the job exists
- **AND** recovery uses the committed result without settling a second outcome

#### Scenario: Recovery wins the durable fence

- **WHEN** recovery records `outcome_unknown` for an open host command before promotion commits
- **THEN** the Run fails and the command is not executed again
- **AND** the losing promotion creates no job

#### Scenario: A lost acknowledgement does not roll back promotion

- **WHEN** promotion commits but the host loses the transaction acknowledgement
- **THEN** the host resolves the result under the durable fence
- **AND** the committed `backgrounded` result remains authoritative

#### Scenario: Remote command timeout remains unchanged

- **WHEN** an `ssh://` command reaches its effective runner or managed-executor timeout, or a Machine command reaches its 300-second cap
- **THEN** the existing remote timeout signal, duration, and settlement bound apply
- **AND** the host-promotion exception does not start or extend the remote command

### Requirement: Unknown command effects are never replayed automatically

The host MUST record the command attempt for the Run and tool call in the durable Run event log
before it starts the command. It MUST record the result after. A command becomes a known result
only after its process group is proven empty. A descendant that leaves the group is outside this
proof. The contract MUST say so, and it MUST NOT claim a process tree. A stop at a deadline
whose process group is proven empty MUST be a known `timed_out` result with bounded partial
output. A stop after a deadline, a cancellation, or a host failure that is not proven MUST
produce `outcome_unknown`. A process that never started MUST be a known refusal, never
`outcome_unknown`.

A live `outcome_unknown` result that is recorded while the Run still executes MUST be a tool
observation. The Run MUST continue. A later approved bash call on that worker MUST be admitted
when the process bound has a free slot. The model-facing message MUST tell the model to inspect
the current workspace state before a new attempt. The host MUST still signal the process group
at settlement as a best effort, except when a background promotion remains in progress.
The host MUST NOT refuse a later bash admission because of an earlier unknown on that worker.

The durable `native.attempt` MUST still prevent a second execution of the command by recovery.
When a Run is resumed after an attempt without a recorded result, recovery MUST arbitrate with any
pending promotion before it determines the result. Recovery that wins records `outcome_unknown`
and fails the Run; it MUST NOT execute the command again. A shell process group can survive a
worker crash. A replacement worker can admit a new bash command while the old group is alive.

When the managed child closes and the process group is not yet proven empty, the executor MUST
SIGKILL the group and settle from that proof. A group that is proven empty MUST record a known
result with the observed exit status. A group that cannot be proven empty MUST record
`outcome_unknown`.

A command on the llame host has no per-call deadline. At its foreground bound the call MUST
start the move. A committed move MUST record `backgrounded`; a failed move MUST follow the rules
of `A move that fails stops the command`.
The command deadline is the job lifetime of `background-jobs`. For a command on
an `ssh://` or `machine://` directory, the runner MUST pass bash a separate timeout signal and
duration. The effective deadline of that command MUST be the lesser of the per-call timeout of
the runner and the 300-second cap of the managed executor. Caller cancellation stays separate.
After a deadline or Run cancellation, a remote bash call has at most 750 ms to settle and
persist `native.result`; a longer settlement or persistence produces `outcome_unknown`.
After a host Run cancellation with no promotion pending, bash has at most 750 ms to settle and
persist `native.result`; a longer settlement or persistence produces `outcome_unknown`. For a
host promotion whose durable outcome remains unresolved after 750 ms, the host MUST NOT publish
a final result or advance the Run until the authoritative outcome is known.
Promotion and recovery MUST arbitrate one durable result under the same database fence. Promotion
MUST commit the job, its initial output and its `backgrounded` result in one transaction. Recovery
that wins first MUST record `outcome_unknown` under that fence; a losing promotion MUST NOT create
a job. A lost commit acknowledgement MUST be resolved under that fence, not treated as a rollback.
The host MUST NOT run an attempt again automatically, under the same or another tool-call ID.

#### Scenario: Normal completion permits the next call

- **WHEN** the command exits and its process group is proven empty
- **THEN** the attempt records a known result
- **AND** the next approved file or bash operation can run in the same Run

#### Scenario: Proven-stopped timeout is known

- **WHEN** the deadline of a command on a `machine://` directory passes and the process group is proven empty
- **THEN** the result is `timed_out` with the output from before the stop
- **AND** the Run continues

#### Scenario: Unproven stop after timeout is unknown and the Run continues

- **WHEN** the deadline of a command on a `machine://` directory passes and the process group cannot be proven empty
- **THEN** the result is `outcome_unknown`
- **AND** the Run continues
- **AND** the next approved bash call on that worker is admitted

#### Scenario: Crash becomes unknown

- **WHEN** the worker is lost after the command starts and before a result is recorded
- **THEN** a resume on any worker does not execute the command again
- **AND** the Run reports that a host command or mutation can have executed
- **AND** the old process group can stay alive and untracked, and the replacement worker can admit a new bash command

#### Scenario: Failed cancellation is an observation

- **WHEN** a cancellation cannot prove the process group empty
- **THEN** the result is `outcome_unknown`
- **AND** the Run continues when that unknown is recorded as a live tool result
- **AND** a later bash call on the same worker is admitted when the process bound has a free slot

#### Scenario: Exit with survivors uses post-kill proof

- **WHEN** the managed child closes and a member of the process group is still observable
- **THEN** the executor SIGKILLs the group
- **AND** when the group is then proven empty, the attempt records a known result with the observed exit status
- **AND** when the group cannot be proven empty, the attempt records `outcome_unknown` and the Run continues

#### Scenario: Other Runs are unaffected after an unknown

- **WHEN** one Run records a live `outcome_unknown`
- **THEN** a later bash call in another Run on the same worker is admitted
- **AND** no operator action and no process restart is necessary

#### Scenario: A host command is not stopped at the foreground bound

- **WHEN** a host command runs longer than the foreground bound
- **THEN** its call returns `backgrounded`, and the attempt records that result
- **AND** the command continues

#### Scenario: A host command ends at the job lifetime

- **WHEN** the job lifetime of a host command passes and its process group is proven empty
- **THEN** the job is `timed_out` and keeps the output from before the stop

## ADDED Requirements

### Requirement: A host command can start in the background

A `bash` call on the llame host with `async: true` MUST start the command as a job of
`background-jobs` and return `backgrounded` at once. `unlimited: true` MUST ask for a job with no
lifetime, as `background-jobs` defines. A `bash` call on an `ssh://` or `machine://` directory
that sets `async` or `unlimited` MUST be refused before any process starts. The refusal MUST say
that background work is available only on the llame host.

#### Scenario: A build starts in the background

- **WHEN** the model calls `bash` with `command: "make"` and `async: true`
- **THEN** the call returns `backgrounded` with a job locator before `make` exits

#### Scenario: A remote directory refuses async

- **WHEN** the model calls `bash` with an `ssh://` `cwd` and `async: true`
- **THEN** the call returns an error, and no process starts on either host

### Requirement: A foreground host command moves to the background

A foreground host `bash` call MUST start a move when it reaches the bound of `instance-config`,
or when a steer, interrupt, or job notice signals the Run. A successful move MUST return
`backgrounded`, keep the earlier output, and leave the command running as a job. A failed move
MUST follow `A move that fails stops the command`.

#### Scenario: A long test suite passes the bound

- **WHEN** a host command still runs 120 seconds after its start, with the default bound
- **THEN** its call returns `backgrounded`, and the command continues as a job

#### Scenario: Output from before the move is kept

- **WHEN** a command prints 10 lines and then moves to the background
- **THEN** a `read` of the `stdout` of its job returns those 10 lines

### Requirement: A command that exits during a move still gets its job

A command that exits while a timely move commits MUST NOT prevent the move. The call MUST return
`backgrounded`. The job MUST settle under `A job settles from the exit of its command`, with its notice.

#### Scenario: A command exits during the move

- **WHEN** a command exits while its timely move commits
- **THEN** the call returns `backgrounded`, and the job settles under the process-group proof rule with a notice

### Requirement: A move that fails stops the command

A failed move MUST stop the command under the cancellation rules. A proved stop MUST return
`timed_out` with its output and a failed-move message; an unproved stop MUST return
`outcome_unknown`. A late commit leaves a normal job and records `backgrounded`. Until the
transaction outcome is known, the call remains unsettled and the Run does not advance.

#### Scenario: The job record cannot be written

- **WHEN** the database refuses the job record of a move, and the stop proves the process group empty
- **THEN** the call returns `timed_out` with the output so far and a message that names the failed move

#### Scenario: A failed move with an unproved stop

- **WHEN** the database refuses a promotion, and the process group cannot be proven empty
- **THEN** the call returns `outcome_unknown`, and the Run continues

#### Scenario: A move that is recorded late

- **WHEN** a job record commits more than 750 ms after the foreground bound
- **THEN** the call returns the committed `backgrounded` result, and the job settles with a notice normally

### Requirement: A job settles from the exit of its command

A `bash` job whose command exits with code 0 MUST settle as `succeeded`. A command that exits
with another code MUST settle as `failed` with that code. A command that a signal ends MUST
settle as `failed`, and its exit detail MUST name the signal. Each of these needs the proof of
an empty process group that this capability defines. A job whose group cannot be proven empty
MUST settle as `lost`.

#### Scenario: A failing build settles as failed

- **WHEN** the command of a job exits with code 2 and its process group is proven empty
- **THEN** the job is `failed` with the exit code 2

#### Scenario: A survivor makes the outcome unknown

- **WHEN** the command of a job exits and a member of its process group cannot be stopped
- **THEN** the job is `lost`

### Requirement: The backgrounded result tells the model what follows

A `backgrounded` result MUST hold the job locator, the elapsed time, and the cause: `async`,
`time`, or `message`. Its model-facing text MUST be: "The command continues in the background as
`<locator>`. You get a notice when it settles. Do not poll it." For the cause `message`, the
text MUST start with: "Moved to the background to handle an incoming message."

#### Scenario: A steer names its cause

- **WHEN** a steer moves a foreground command to the background
- **THEN** the result holds the cause `message`, and its text starts with the fixed sentence for that cause

### Requirement: A Run cancellation stops a foreground host command

A Run can be cancelled, expire, or fail while a host `bash` call runs in the foreground. The
host MUST then stop that command under the cancellation rules of this capability. The host MUST
NOT stop a command that already moved to the background. A Run abort of any
kind MUST NOT stop a command whose move is pending, and a move that commits leaves a normal job.
A Run abort before the move starts MUST stop the foreground command. Remote commands do not change.

#### Scenario: Stop during a foreground command

- **WHEN** the owner cancels a Run while its host `bash` call has run for 20 seconds
- **THEN** the command stops, and the call settles as this capability requires for a cancellation

#### Scenario: A cancellation during a pending move

- **WHEN** the owner cancels a Run while the move of its host `bash` command is pending
- **THEN** the command is not stopped, and a move that commits leaves a normal job

#### Scenario: An expiry during a pending move

- **WHEN** a Run expires while the move of its host `bash` command is pending
- **THEN** the command is not stopped, and a move that commits leaves a normal job

#### Scenario: A cancellation before the move starts

- **WHEN** the owner cancels a Run before its host `bash` command reaches the bound
- **THEN** the command stops

#### Scenario: Stop after the move

- **WHEN** the owner cancels a Run whose command moved to the background a minute ago
- **THEN** the job of that command stays `running`

### Requirement: One bound limits the commands of a worker process

Each worker process MUST run at most `tools.bash.maxProcesses` managed commands at one time. The
bound MUST count foreground host commands, jobs, and `ssh://` commands. A call past the bound
MUST be refused before its attempt is recorded and before any process starts. The refusal MUST
have the type `limit_reached`, MUST name the bound, and MUST say that a later call can succeed.
It MUST NOT have the type `unavailable`.

#### Scenario: Two commands in one step both run

- **WHEN** the model calls `bash` twice in one step, with the default bound
- **THEN** both commands run, and each call gets its own result

#### Scenario: A call past the bound is refused

- **WHEN** a worker process runs 64 managed commands, with the default bound, and one more `bash` call arrives
- **THEN** the call returns `limit_reached`, no attempt is recorded, and no process starts

### Requirement: The bash description explains background work

The `bash` description MUST tell the model that a long host command moves to the background and
continues. It MUST tell the model to set `async: true` for a command that it does not wait for,
and not to poll a job. It MUST name each of `wait`, `read`, and `stop` only when the Run has
that tool, as `tool-prompt-templates` requires.

#### Scenario: Description has the background instructions

- **WHEN** the packaged `bash` description is rendered for a Run that has `wait`, `read`, and `stop`
- **THEN** it names `async`, the move to the background, and the three job tools

#### Scenario: An absent tool is not recommended

- **WHEN** the description is rendered for a Run that has `bash` and no `stop`
- **THEN** it does not name `stop`
