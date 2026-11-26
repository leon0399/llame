## ADDED Requirements

### Requirement: Bash runs as a job of the current Machine's daemon

Every `bash` call whose directory belongs to a configured Machine MUST start
a daemon job on that Machine, including the host. A foreground call MUST wait
for the job's settlement up to its bound. When the bound passes, a steer
arrives, or the connection drops, the call MUST become a background job with
the cause `time`, `message`, or `disconnect`, and the command MUST keep running.
An `ssh://` call MUST stay foreground-only under its existing timeout and
settlement rules; the foreground bound MUST NOT promote it.

`bash` MUST accept a Machine locator as `cwd` and run on that Machine in that
directory. In a Workspace, an omitted or relative `cwd` MUST resolve on the
Workspace's Machine. The environment MUST be the managed base environment plus
the declared `env` entries. The bounds of `bash-execution` MUST apply.

#### Scenario: A dropped connection backgrounds the command

- **WHEN** the connection to the Machine drops during a foreground command
- **THEN** the call returns a backgrounded result with cause `disconnect` and the job keeps running

#### Scenario: Command runs remotely in the given directory

- **WHEN** the model calls `bash` with `cwd: "machine://devl/home/me/shop"` and `command: "pwd"`
- **THEN** the output is `/home/me/shop` produced on `devl`

#### Scenario: Relative cwd inside a Machine Workspace

- **WHEN** the Chat is bound to `machine://devl/home/me/shop` and the model calls `bash` with `cwd: "packages/ui"`
- **THEN** the command runs on `devl` in `/home/me/shop/packages/ui`

#### Scenario: The host Machine is a working directory from a Machine Workspace

- **WHEN** the Chat is bound to `machine://gpu/srv/app`, the host Machine is `devl`, and the model calls `bash` with `cwd: "machine://devl/home/me/shop"`
- **THEN** the command runs on `devl` in `/home/me/shop`

### Requirement: A command can start in the background on every Machine

`async` and `unlimited` MUST be accepted on every configured Machine.
An `ssh://` call that sets either option MUST be refused before any process
starts. Standalone SSH commands MUST stay foreground-only.

#### Scenario: A background command on a remote Machine

- **WHEN** a call with `async` runs on `machine://box`
- **THEN** the call returns a job locator at once

#### Scenario: A remote directory refuses async

- **WHEN** the model calls `bash` with an `ssh://` `cwd` and `async: true`
- **THEN** the call returns an error, and no process starts on either host

### Requirement: Daemon and SSH command results are bounded and explicit

Each bash call MUST enforce finite input, process, stdout, and stderr bounds.
Its duration MUST be finite unless the operator authorizes `unlimited: true`
under `background-jobs`. Each returned stream
bound MUST be `tools.artifacts.maxBytes` UTF-8 bytes. A configured Machine
MUST also enforce its own retained-output byte ceiling; the installation MUST
apply its result bound to the bytes it reads from that retained output. The result MUST
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

For every configured Machine and an `ssh://` command, the API redacts the output it received. llame never sends the
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

For a command on any configured Machine, the foreground bound starts promotion instead
of stopping the command. The command's duration follows the job lifetime rules
of `background-jobs`, including its operator-authorized unlimited option. An
unresolved Machine promotion has no per-call deadline: the call MUST remain
unsettled until promotion or recovery determines the authoritative result. The
`ssh://` duration bounds and settlement rules remain unchanged.

#### Scenario: Promotion wins the durable fence

- **WHEN** promotion commits background delivery and the `backgrounded` result for the persisted daemon job before recovery
- **THEN** the Machine call returns `backgrounded` and the job exists
- **AND** recovery uses the committed result without settling a second outcome

#### Scenario: Recovery wins the durable fence

- **WHEN** recovery records `outcome_unknown` for an open host command before promotion commits
- **THEN** the Run fails and the command is not executed again
- **AND** the losing promotion does not dispatch a second command or overwrite the authoritative result

#### Scenario: A lost acknowledgement does not roll back promotion

- **WHEN** promotion commits but the host loses the transaction acknowledgement
- **THEN** the host resolves the result under the durable fence
- **AND** the committed `backgrounded` result remains authoritative

#### Scenario: Remote command timeout remains unchanged

- **WHEN** an `ssh://` command reaches its effective runner or managed-executor timeout
- **THEN** the existing remote timeout signal, duration, and settlement bound apply
- **AND** Machine promotion does not start or extend that standalone SSH command

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

- **WHEN** a Machine command's stdout reaches its retained-output or installation read bound in the middle of a configured credential
- **THEN** the hub result contains no prefix of the credential
- **AND** the result is marked truncated

#### Scenario: A short fragment at the bound leaves no marker

- **WHEN** a configured credential starts 4 characters before the stdout bound
- **THEN** the result's stdout ends before the credential and is no longer than the bound
- **AND** it contains no character of the credential

#### Scenario: Non-credential configuration survives

- **WHEN** `knowledge.root` resolves to `/srv/kb` and a command prints `/srv/kb/notes.md`
- **THEN** the result contains `/srv/kb/notes.md` verbatim

### Requirement: Daemon command effects are never replayed automatically

The installation MUST record the durable native attempt before dispatch and its
result after. A process that never started MUST be a known refusal, never
`outcome_unknown`. A known start refusal MUST remove its unstarted job binding.
A daemon running-job-limit refusal with reason `job_limit` MUST map to the
installation's `machine_job_limit` classification.
Its model-facing result MUST be `limit_reached`, state that a later call can
succeed, and MUST NOT classify the temporary capacity refusal as unavailable.

A daemon command MUST have its owner-scoped binding persisted before `CreateJob`.
The installation MUST NOT dispatch it again during native-attempt recovery.
A missing native result MAY fail its Run under the existing recovery contract;
that MUST NOT delete the binding or repeat a command that can still be running.
Job state and output MUST reconcile through `background-jobs` independently of
that Run. A recorded live `outcome_unknown` remains a tool observation, and the
Run MUST continue. Later authorized calls MUST remain admissible within the
applicable Machine limit, without an operator action or process restart.

A known command settlement MUST prove that its process group is empty. A
descendant that leaves that group is outside the proof; the contract MUST NOT
claim a process-tree proof. When the managed child closes with group survivors,
the daemon MUST SIGKILL the group and settle from the resulting proof. An
unproved stop MUST record `outcome_unknown`, never a proved `timed_out` result.
The model-facing unknown result MUST tell the model to inspect current
Workspace state before making a new attempt.

Every configured Machine command MUST use the job lifetime, not a 300-second
per-call deadline. Its foreground bound starts promotion rather than stopping
the command. Promotion and recovery MUST arbitrate one authoritative native
result under the same durable fence; a losing promotion MUST NOT overwrite it.
A lost commit acknowledgement MUST be resolved under that fence. An unresolved
promotion MUST NOT advance the Run or publish a final result. A Run cancellation
before promotion MUST stop the foreground command; a committed promotion MUST
leave a background job. Cancellation with no pending promotion has at most
750 ms to settle and persist the native result; otherwise it is unknown.
A cancellation request MUST be persisted on the binding before its daemon RPC.
If the RPC cannot reach the Machine, reconciliation MUST deliver the retained
request on reconnection. That cancellation MUST take precedence over a
simultaneous disconnect; it MUST NOT become ordinary background promotion.

A standalone `ssh://` command MUST keep its separate timeout and cancellation
signals, the lesser of its per-call timeout and 300-second managed-executor cap,
and the 750 ms result-persistence bound after deadline or cancellation.

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

#### Scenario: A crash does not repeat a daemon command

- **WHEN** the worker is lost after the command starts and before a result is recorded
- **THEN** a resume on any worker does not execute the command again
- **AND** the Run reports that a host command or mutation can have executed
- **AND** the bound daemon job remains reconcilable independently of that Run, and a later approved command can be admitted within the Machine limit

#### Scenario: Failed cancellation is an observation

- **WHEN** a cancellation cannot prove the process group empty
- **THEN** the result is `outcome_unknown`
- **AND** the Run continues when that unknown is recorded as a live tool result
- **AND** a later bash call on the same worker is admitted when the applicable Machine limit has a free slot

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

## REMOVED Requirements

### Requirement: One bound limits the commands of a worker process

**Reason**: Each Machine owns its running-job limit.
**Migration**: Delete `tools.bash.maxProcesses`; set `limits.max_running_jobs` on the Machine.

### Requirement: Bash on the host Machine of the worker runs in the worker

**Reason**: Host commands run as jobs of the host Machine daemon.
**Migration**: None.

### Requirement: A host command can start in the background

**Reason**: Background commands run on every Machine.
**Migration**: See "A command can start in the background on every Machine".

### Requirement: Command results are bounded and explicit

**Reason**: Every configured Machine now uses daemon job lifetimes and byte-bounded retained output, and incompatible old daemons are refused.
**Migration**: See "Daemon and SSH command results are bounded and explicit".

### Requirement: Unknown command effects are never replayed automatically

**Reason**: Daemon jobs outlive worker crashes and keep a reconcilable binding; worker-local process slots and untracked host commands are removed.
**Migration**: See "Daemon command effects are never replayed automatically".

## MODIFIED Requirements

### Requirement: A Run cancellation stops a foreground host command

A Run can be cancelled, expire, or fail while a configured Machine `bash` call runs in the foreground. The
installation MUST then stop that command under the cancellation rules of this capability. The installation MUST
NOT stop a command that already moved to the background. A Run abort of any
kind MUST NOT stop a command whose move is pending, and a move that commits leaves a normal job.
A Run abort before the move starts MUST stop the foreground command. Standalone `ssh://` cancellation does not change.

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

#### Scenario: Stop during a remote Machine foreground command

- **WHEN** the owner cancels a Run while a foreground command runs on another configured Machine
- **THEN** the installation requests cancellation from that Machine daemon rather than promoting the command

### Requirement: The backgrounded result tells the model what follows

A `backgrounded` result MUST hold the job locator, the elapsed time, and the cause: `async`,
`time`, `message`, or `disconnect`. Its model-facing text MUST be: "The command continues in the background as
`<locator>`. You get a notice when it settles. Do not poll it." For the cause `message`, the
text MUST start with: "Moved to the background to handle an incoming message."

#### Scenario: A steer names its cause

- **WHEN** a steer moves a foreground command to the background
- **THEN** the result holds the cause `message`, and its text starts with the fixed sentence for that cause
