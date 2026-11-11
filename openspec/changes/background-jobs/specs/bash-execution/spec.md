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
When a Run is resumed on any host after an attempt without a recorded result, recovery MUST fail
the Run with `outcome_unknown`. It MUST NOT execute the command again. A shell process group can
survive a worker crash. A replacement worker can admit a new bash command while the old group is
alive.

When the managed child closes and the process group is not yet proven empty, the executor MUST
SIGKILL the group and settle from that proof. A group that is proven empty MUST record a known
result with the observed exit status. A group that cannot be proven empty MUST record
`outcome_unknown`.

A command on the llame host has no per-call deadline. At its foreground bound the call MUST
start the move. A successful move within the settlement window MUST record `backgrounded`;
a failed or late move MUST follow the rules of `A move that fails stops the command`.
The command deadline is the job lifetime of `background-jobs`. For a command on
an `ssh://` or `machine://` directory, the runner MUST pass bash a separate timeout signal and
duration. The effective deadline of that command MUST be the lesser of the per-call timeout of
the runner and the 300-second cap of the managed executor. Caller cancellation stays separate.
After a deadline, a foreground bound, or a Run cancellation, bash MUST have at most 750 ms to settle and persist
`native.result`. If settlement or persistence takes longer, the result MUST be
`outcome_unknown`. The host MUST NOT run an attempt again automatically, under the same or
another tool-call ID.

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
or when a steer, interrupt, or job notice signals the Run. A successful timely move MUST return
`backgrounded`, keep the earlier output, and leave the command running as a job. A failed or late move MUST follow `A move that fails stops the command`.

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
`outcome_unknown`. The call MUST settle within 750 ms of starting the move. A late commit MUST
leave a normal job. A late failure MUST stop the command but keep its recorded
`outcome_unknown` result.

#### Scenario: The job record cannot be written

- **WHEN** the database refuses the job record of a move, and the stop proves the process group empty
- **THEN** the call returns `timed_out` with the output so far and a message that names the failed move

#### Scenario: A failed move with an unproved stop

- **WHEN** the database refuses a promotion, and the process group cannot be proven empty
- **THEN** the call returns `outcome_unknown`, and the Run continues

#### Scenario: A move that is recorded late

- **WHEN** a job record commits more than 750 ms after the foreground bound
- **THEN** the call returns `outcome_unknown`, and the job settles with a notice normally

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
