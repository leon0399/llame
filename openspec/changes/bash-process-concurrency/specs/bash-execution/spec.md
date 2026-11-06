# Spec Delta

## MODIFIED Requirements

### Requirement: Alpha host bash uses the native executor gate

When `tools.nativeExecutorId` is configured and `bash` is present in
`tools.allowed`, the model-facing `bash` tool SHALL be available on that native
host. The model supplies shell text, an optional working directory, and
optional additional environment variables; the host invokes `bash -c` as the
host OS user. When a Workspace is entered, an omitted `cwd` SHALL use the
Workspace root, and a relative `cwd` SHALL resolve from that root using lexical
path resolution like POSIX `path.posix.resolve` while preserving a trailing
separator; the executor SHALL receive exactly the projected absolute string,
including that trailing separator. Projection SHALL NOT perform realpath
resolution; symlinks inside the projected path SHALL be followed by the OS as
for any absolute path. For this requirement, "relative" means a value not
starting with `/` and without a `scheme:` prefix recognized by the shared
locator parser (case-insensitive `scheme://`). An unknown scheme SHALL remain
`invalid_path` rather than being treated as a relative directory. `..` MAY
resolve outside the root. An absolute `cwd` SHALL remain absolute. Without an
entered Workspace, the existing host working-directory behavior SHALL remain
unchanged. Each call SHALL start a fresh process: no per-call working-directory
override, variable, or shell state persists between calls. The tool description
SHALL state this and SHALL state that an omitted `cwd` uses the Workspace root
while entered and the host's default directory otherwise, and that a relative
`cwd` is resolved from the Workspace root without confinement, and that the
managed process bound belongs to the worker process and a call beyond it is
refused rather than queued. Workspace path resolution SHALL NOT perform shell
expansion on the submitted `cwd`.
The model SHALL NOT select an
executor, network mode, or permission mode, and SHALL NOT replace a base
environment variable. Bounded output, input, duration, and process limits
SHALL still apply, with the process bound scoped to the worker process. This
alpha path is explicit host authority, not
multi-tenant isolation. A later managed Sandbox and a separate permission
proposal MAY strengthen isolation and approval without changing the
command/result contract.

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

- **WHEN** no Workspace is entered and the model supplies a `cwd` that resolves to an existing directory
- **THEN** that command runs with that directory as its working directory
- **AND** the next call without `cwd` runs in the host's default directory

#### Scenario: Unusable working directory does not run the command

- **WHEN** the supplied `cwd` does not resolve to an enterable directory
- **THEN** no process starts and no attempt is recorded
- **AND** the result identifies the unusable working-directory value and states that the submitted `cwd` was not shell-expanded (Workspace-relative projection, when applicable, is path resolution only), and how to list or create it

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

#### Scenario: Omitted working directory uses the Workspace root

- **WHEN** a Workspace with root `/work/project` is entered and the model calls `bash` without `cwd`
- **THEN** the command runs with `/work/project` as its working directory

#### Scenario: Relative working directory resolves from the Workspace root

- **WHEN** a Workspace with root `/work/project` is entered and the model calls `bash` first with `cwd: "packages/api"` and then with `cwd: "../shared"`
- **THEN** the first command runs with `/work/project/packages/api` as its working directory
- **AND** the second command runs with `/work/shared` as its working directory, outside the Workspace root

#### Scenario: Workspace working directory preserves a trailing separator

- **WHEN** a Workspace with root `/work/project` is entered and the model calls `bash` with `cwd: "packages/api/"`
- **THEN** the executor receives `/work/project/packages/api/` exactly, including the trailing separator
- **AND** the command runs with that directory as its working directory

#### Scenario: Unknown working-directory scheme is invalid

- **WHEN** a Workspace is entered and the model calls `bash` with `cwd: "vault://notes"`
- **THEN** the tool returns `invalid_path`
- **AND** no process starts or filesystem probe treats the value as a relative directory

### Requirement: Unknown command effects are never replayed automatically

The host SHALL record the command attempt for the Run and tool call in the
durable Run event log before starting execution and SHALL record its result
after. A command SHALL become a known result only after its process group is
proven empty; a descendant that leaves the group is outside this proof, and
the contract SHALL say so rather than claim a process tree. A timeout whose
process group is proven empty SHALL be a known `timed_out` result carrying
bounded partial output. An unproven stop after timeout, cancellation, or host
failure SHALL produce `outcome_unknown`. A process that never started
SHALL be a known refusal, never `outcome_unknown`.

A live `outcome_unknown` result recorded while the Run is still executing
SHALL be a tool observation: the Run SHALL continue, later approved bash
calls on that worker SHALL be eligible for admission subject to the worker
process bound, and the model-facing message SHALL
tell the model to inspect the current workspace state before retrying. The
host SHALL still best-effort signal the process group during settlement.
The host SHALL NOT refuse later bash admission because of a prior unknown
on that worker.

The durable `native.attempt` SHALL still prevent recovery from re-executing
the command. When a Run is resumed on any host after an attempt without a
recorded result, recovery SHALL fail the Run with `outcome_unknown` and
SHALL NOT re-execute the command. An in-flight shell process group can
survive a worker crash, and a replacement worker MAY admit a new bash
command while the old group remains alive.

When the managed child closes and the process group is not yet proven empty,
the executor SHALL SIGKILL the group and settle from that proof: a proven-empty
group SHALL record a known result with the observed exit status; a group that
cannot be proven empty SHALL record `outcome_unknown`.

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

#### Scenario: Unproven stop after timeout is unknown and the Run continues

- **WHEN** the deadline elapses and the process group cannot be proven empty
- **THEN** the result is `outcome_unknown`
- **AND** the Run continues
- **AND** the next approved bash call on that worker is eligible for admission subject to the worker process bound

#### Scenario: Crash becomes unknown

- **WHEN** the worker is lost after command start before a result is recorded
- **THEN** a resume on any worker does not re-execute the command
- **AND** the Run reports that a host command or mutation may have executed
- **AND** the old process group may remain alive and untracked on the replacement
  worker, which may admit a new bash command beside it

#### Scenario: Failed cancellation is an observation

- **WHEN** cancellation cannot prove the process group empty
- **THEN** the result is `outcome_unknown`
- **AND** the Run continues when that unknown is recorded as a live tool result
- **AND** a later bash call on the same worker is eligible for admission subject to the worker process bound

#### Scenario: Exit with survivors uses post-kill proof

- **WHEN** the managed child closes and a process-group member is still observable
- **THEN** the executor SIGKILLs the group
- **AND** if the group is then proven empty, the attempt records a known result
  with the observed exit status
- **AND** if the group cannot be proven empty, the attempt records `outcome_unknown`
  and the Run continues

#### Scenario: Other Runs are unaffected after an unknown

- **WHEN** one Run records a live `outcome_unknown`
- **THEN** a later bash call in another Run on the same worker is eligible for admission subject to the worker process bound
- **AND** no operator or process restart is needed

#### Scenario: Capacity still applies after an unknown

- **WHEN** a Run records a live `outcome_unknown` and other reservations fill the worker's process bound
- **THEN** a later approved bash call is refused because capacity is exhausted, not because of the prior unknown
- **AND** it becomes eligible for admission when capacity is available

## ADDED Requirements

### Requirement: The managed process bound belongs to the worker and refuses beyond it

Each worker SHALL share one managed-bash capacity across its Runs. Admission
SHALL reserve a slot before recording an attempt. A call beyond capacity SHALL
return `process_limit` immediately, without a process or attempt, naming the
capacity, per-worker scope, and possibility of a fresh retry. It SHALL NOT queue,
automatically retry, or replay the refused call. Reservations SHALL release
exactly once; existing live-unknown continuation and durable no-replay behavior
SHALL remain unchanged.

#### Scenario: Calls within the bound are admitted concurrently

- **WHEN** a step issues two otherwise-valid bash calls with two free slots and no competing admissions
- **THEN** both are admitted and each starts its own process
- **AND** each records its own attempt and result

#### Scenario: Two calls compete for one remaining slot

- **WHEN** two otherwise-valid calls arrive with one free slot and the first admitted call remains active
- **THEN** exactly one is admitted and the other returns `process_limit`
- **AND** no capacity is oversubscribed

#### Scenario: Exhausted bound refuses before the attempt

- **WHEN** the worker holds its bound of reservations and another otherwise-valid bash call arrives
- **THEN** the call is refused immediately with no process started and no attempt recorded
- **AND** the refused command does not start later on its own

#### Scenario: Refusal names the bound and permits a fresh retry

- **WHEN** a call is refused because the worker holds its bound
- **THEN** the result carries `process_limit`, names the configured capacity and per-worker scope, and states that a fresh call may succeed
- **AND** the missing native executor classification is unchanged

#### Scenario: Runs on one worker share the bound

- **WHEN** two Runs execute concurrently on one worker and the first holds the bound
- **THEN** a bash call in the second Run is refused under the same bound
- **AND** after one reservation is released, a fresh otherwise-valid call in the second Run is admitted if no competitor takes that slot

#### Scenario: Pending attempt writes consume capacity

- **WHEN** all slots are reserved by calls waiting for their durable attempt writes
- **THEN** another otherwise-valid call is refused as `process_limit` without recording an attempt or starting a process

#### Scenario: Reservations are released exactly once

- **WHEN** an admission is cancelled or abandoned before execution, its attempt write fails, its existing attempt is recovered, or its execution settles
- **THEN** its reservation is released exactly once
- **AND** cancellation after execution starts does not free that slot before execution settles
- **AND** a settled live `outcome_unknown` frees its slot without quarantining later calls, while durable recovery still never re-executes its unresolved attempt

### Requirement: Operators configure the worker process capacity

`tools.bashMaxProcesses` SHALL accept a positive safe integer and default to
four. Invalid resolved values SHALL fail startup naming the field. Each worker
process SHALL bind its capacity at startup until restart. Capacities SHALL be
independent across worker processes, not a host-wide or per-owner limit.

#### Scenario: Default and configured capacities

- **WHEN** a worker starts without `tools.bashMaxProcesses`
- **THEN** its capacity is four
- **AND** configuring a positive safe integer instead binds that capacity until the worker restarts

#### Scenario: Invalid capacity fails startup

- **WHEN** the resolved capacity is zero, negative, fractional, non-finite, unsafe as an integer, null, or a value of the wrong type
- **THEN** startup fails naming `tools.bashMaxProcesses`
- **AND** no worker starts with an invalid bound

#### Scenario: Separate workers have independent capacities

- **WHEN** one worker is saturated and a second worker has a free slot
- **THEN** an otherwise-valid call on the second worker can be admitted without waiting for the first worker
- **AND** aggregate capacity is the sum of worker capacities, not a host-wide bound
