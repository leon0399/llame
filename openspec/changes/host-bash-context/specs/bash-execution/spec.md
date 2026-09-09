## MODIFIED Requirements

### Requirement: Alpha host bash uses the native executor gate

When `tools.nativeExecutorId` is configured and `bash` is present in
`tools.allowed`, the model-facing `bash` tool SHALL be available on that native
host. The model supplies shell text, an optional working directory, and
optional additional environment variables; the host invokes `bash -c` as the
host OS user. Each call SHALL start a fresh process: no working directory,
variable, or shell state persists between calls, and the tool description
SHALL state so. The model SHALL NOT select an executor, network mode, or
permission mode, and SHALL NOT replace a base environment variable. Bounded
output, input, duration, and process limits SHALL still apply. This alpha path
is explicit host authority, not multi-tenant isolation. A later managed Sandbox
and a separate permission proposal MAY strengthen isolation and approval
without changing the command/result contract.

#### Scenario: Missing native executor fails closed

- **WHEN** `tools.nativeExecutorId` is unset
- **THEN** a bash request is unavailable
- **AND** no host process starts

#### Scenario: Allowlist omit fails closed

- **WHEN** `bash` is absent from `tools.allowed`
- **THEN** bash is neither advertised nor executed

#### Scenario: Model cannot widen execution

- **WHEN** command arguments carry any key other than the declared `command`,
  `cwd`, and `env`
- **THEN** the call is refused as invalid input before it reaches the executor
- **AND** no process starts

#### Scenario: Base environment cannot be replaced

- **WHEN** `env` names a base environment variable, `PATH` included
- **THEN** the executor rejects the call before the attempt is recorded
- **AND** the result names the colliding key

#### Scenario: Shell text runs via bash -c

- **WHEN** the model calls `bash` with shell text
- **THEN** the host runs that text as `bash -c`
- **AND** the model does not pick a different configured tool basename

#### Scenario: Working directory is per call

- **WHEN** the model supplies a `cwd` that resolves to an existing directory
- **THEN** that command runs with that directory as its working directory
- **AND** the next call without `cwd` runs in the host's default directory

#### Scenario: Unusable working directory does not run the command

- **WHEN** the supplied `cwd` is not an enterable directory
- **THEN** no process starts and no attempt is recorded
- **AND** the result states that the literal argument was not usable, that no
  shell expansion was applied to it, and how to list or create it

#### Scenario: Spawn failure after the attempt is recorded

- **WHEN** the attempt is recorded and the process still fails to start
- **THEN** the attempt's recorded result is a known refusal, never
  `outcome_unknown`
- **AND** the Run continues

#### Scenario: Child environment is declared, not inherited

- **WHEN** a command prints its environment
- **THEN** the initial environment passed to the child contains exactly the
  declared base variables and the call's own additions
- **AND** no unlisted variable of the llame process, and no llame credential,
  is inherited into that initial environment
- **AND** Bash, its launcher, or the runtime can add variables such as `PWD`,
  `SHLVL`, and `_` before the command prints its environment

### Requirement: Command results are bounded and explicit

Each bash call SHALL enforce finite input, duration, process, stdout, and stderr
bounds. The result SHALL contain a safe status, exit code when known, bounded
output, and truncation metadata when output is limited. The executor SHALL
return output as the command produced it, cut at the bound, without rewriting,
reordering, or deleting lines. Values the host knows to be secret SHALL be
redacted before the result leaves the executor. The delimiter neutralization
every model-facing tool result receives SHALL still apply to the copy the model
reads. After timeout settlement proves the process group stopped, the watcher
SHALL drain output for at most 50 ms; a stream still open at that bound SHALL be
marked truncated and destroyed.

#### Scenario: Oversized output is bounded

- **WHEN** a command produces more output than the configured result bound
- **THEN** the result contains a bounded prefix and explicit truncation metadata
- **AND** excess output is not sent to the model

#### Scenario: Non-zero exit is observable

- **WHEN** a command exits non-zero within its bounds
- **THEN** the result reports the non-zero status and bounded stderr
- **AND** it does not convert the command into a successful file or Knowledge effect

#### Scenario: Paths and diagnostics survive

- **WHEN** a command prints absolute paths, a stack trace, or a line beginning
  with `Error:`
- **THEN** the executor result contains those lines verbatim within the bound
- **AND** only reserved tool delimiters are escaped in the copy the model reads

### Requirement: Unknown command effects are never replayed automatically

The host SHALL record the command attempt for the Run and tool call in the
durable Run event log before starting execution and SHALL record its result
after. A command SHALL become a known result only after its process group is
proven empty; a descendant that leaves the group is outside this proof, and
the contract SHALL say so rather than claim a process tree. A timeout whose
process group is proven empty SHALL be a known `timed_out` result carrying
bounded partial output. An unproven stop after timeout, cancellation, or host
failure SHALL produce terminal `outcome_unknown`. A process that never started
SHALL be a known refusal, never `outcome_unknown`. An `outcome_unknown` SHALL
terminate the Run that issued it. While a process of that attempt is still
observed alive by the worker, the worker SHALL refuse new bash admission on
that worker and SHALL re-signal the group on each refusal; the refusal SHALL
lift without operator action once the group is empty, and SHALL NOT outlive
the process it names.
The quarantine is process-local and is lost if the worker crashes; the durable
`native.attempt` SHALL still prevent recovery from re-executing the command,
and recovery SHALL fail the Run with `outcome_unknown`. An in-flight shell
process group can survive that crash, and a replacement worker can admit a new
bash command while the old group remains alive because the replacement has no
quarantine for the lost worker.
The runner SHALL pass bash a distinct effective timeout signal and duration;
the effective deadline SHALL be the lesser of the runner's per-call timeout
and the managed executor's 300-second cap, while caller cancellation remains
separate. After the runner's per-call timeout or Run cancellation, bash SHALL
have at most 750 ms to settle and persist `native.result`; if settlement or
persistence exceeds that grace, the result SHALL be `outcome_unknown`.
The host SHALL NOT rerun an attempt automatically, under the same or another
tool-call ID: a Run resumed on any host after an attempt without a recorded
result SHALL NOT re-execute it.

#### Scenario: Normal completion permits the next call

- **WHEN** the command exits and its process group is proven empty
- **THEN** the attempt records a known result
- **AND** the next approved file or bash operation may run in the same Run

#### Scenario: Proven-stopped timeout is known

- **WHEN** the deadline elapses and the process group is proven empty
- **THEN** the result is `timed_out` with the output produced before the kill
- **AND** the Run continues

#### Scenario: Unproven stop after timeout is unknown

- **WHEN** the deadline elapses and the process group cannot be proven empty
- **THEN** the result is `outcome_unknown`
- **AND** the Run terminates

#### Scenario: Crash becomes unknown

- **WHEN** the worker is lost after command start before a result is recorded
- **THEN** a resume on any worker does not re-execute the command
- **AND** the Run reports that a host command or mutation may have executed
- **AND** the old process group may remain alive and untracked on the replacement
  worker, which may admit a new bash command beside it

#### Scenario: Failed cancellation fences the context

- **WHEN** cancellation cannot prove the process group empty
- **THEN** the result is `outcome_unknown`
- **AND** the fenced context is the Run: it terminates, and no other Run is
  affected once its process group is observed empty

#### Scenario: Surviving process quarantines the worker until it is gone

- **WHEN** one Run ends with `outcome_unknown` and its process group is still
  alive
- **THEN** a bash call in another Run on the same worker is refused with a
  result naming the surviving attempt, and the group is signalled again
- **AND** once the group is observed empty the next call on that worker is
  admitted, with no operator or process restart

#### Scenario: Other Runs are unaffected once nothing survives

- **WHEN** one Run ends with `outcome_unknown` and no process of it is observed
  alive
- **THEN** a later bash call in another Run on the same worker is admitted
- **AND** no operator or process restart is needed

## REMOVED Requirements

### Requirement: Bash and native file tools share one live directory

**Reason**: The shipped alpha has one host, so "same working directory" was a
tautology enforced by comparing a value to itself, and the mismatched-executor
scenario had no reachable path. With a per-call working directory the
requirement no longer describes anything.

**Migration**: Replaced by "Bash and native file tools observe one live host
filesystem" below. `workspace_mismatch` is removed; the Knowledge submit
scenario moves with the requirement.

## ADDED Requirements

### Requirement: Bash and native file tools observe one live host filesystem

Bash and native `read`, `edit`, and `write` on one host SHALL operate on the
same live host filesystem as the same OS user. A bash mutation with a known
result SHALL be visible to the next native read, and a native mutation SHALL be
visible to the next bash command. The host SHALL NOT return a stale copy. A
future executor adapter SHALL preserve this same-filesystem result contract.

#### Scenario: Native edit is visible to bash

- **WHEN** native edit changes a file and the next bash command reads that path
- **THEN** bash observes the changed bytes
- **AND** it does not read a stale server-side copy

#### Scenario: Bash mutation is visible to native read

- **WHEN** bash changes a file and exits with a known result
- **THEN** the next native read observes the current bytes
- **AND** the result does not claim that Git or Knowledge submission occurred

#### Scenario: Submit waits for a known workspace state

- **WHEN** Knowledge submit targets a workspace with an active bash command
- **THEN** submit waits for a known command result before staging
- **AND** an unknown command outcome fences submit and prevents a concurrent commit
