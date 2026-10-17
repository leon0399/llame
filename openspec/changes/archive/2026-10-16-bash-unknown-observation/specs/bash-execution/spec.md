## MODIFIED Requirements

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
calls on that worker SHALL be admitted, and the model-facing message SHALL
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
- **AND** the next approved bash call on that worker is admitted

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
- **AND** a later bash call on the same worker is admitted

#### Scenario: Exit with survivors uses post-kill proof

- **WHEN** the managed child closes and a process-group member is still observable
- **THEN** the executor SIGKILLs the group
- **AND** if the group is then proven empty, the attempt records a known result
  with the observed exit status
- **AND** if the group cannot be proven empty, the attempt records `outcome_unknown`
  and the Run continues

#### Scenario: Other Runs are unaffected after an unknown

- **WHEN** one Run records a live `outcome_unknown`
- **THEN** a later bash call in another Run on the same worker is admitted
- **AND** no operator or process restart is needed
