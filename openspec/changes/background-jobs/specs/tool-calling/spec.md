## MODIFIED Requirements

### Requirement: No mid-run tool-state checkpointing (read-only slice; write-tool landmine)

The read-only loop can retry a claimable Run from the first step of its current segment, with new
worker context. It can do this only when that segment has no recorded native attempt or MCP
dispatch. A retry MUST keep the delivered messages and the replies of earlier segments. A retry
MUST resolve its own prompt and its own attempt-local catalog again. It MUST NOT use the
preparation of the failed attempt. It MUST compare availability with the id and state record that
its Run stored when an earlier attempt dispatched. When no such record exists, it MUST compare
with the record of the most recent earlier dispatched Run. The persisted output of the failed
attempt stays part of the committed record that later turns load. A follow-up Run from
`turn-actions` can replace that reply.

A Run that executed an alpha native `edit` or `write` MUST NOT replay that mutation
automatically. This applies after a worker failure, a timeout, or an unknown settlement. A Run
that dispatched an MCP operation MUST NOT replay that operation automatically. The host MUST stop
the affected Run with `outcome_unknown` and require a new explicit user or model attempt. A
client reconnect MUST replay recorded tool activity. It MUST NOT execute the mutation or the MCP
operation again.

A redelivered Run with a recorded `native.attempt` in its current segment MUST fail as
`outcome_unknown`. It MUST NOT replay its loop. A recorded `native.attempt` of an earlier segment
has a settled result, and it MUST NOT stop the retry. This recovery rule has no native-executor
or `workerId` precondition. Before terminal settlement, the host MUST settle each open call that
has a durable `native.result` from that result, whatever the tool source. An open `bash`, native
mutation, or MCP call with a recorded `native.attempt` and no result for it MUST settle as
`outcome_unknown`. Every other open call settles as the termination settlement rules
require.

Only a Continue that the owner requests through `turn-actions` can carry the settled tool-loop
state of a terminal Run into a new Run. That Continue Run MUST replay the settled results. It
MUST NOT execute a settled call again. A future durable effect-dedupe capability can replace
this terminal behavior, and this capability does not define it.

A wake of a Run from `awaiting_jobs` is not a retry. The first attempt after a wake MUST
continue from the stored steps of the current reply, as the requirement for a woken Run defines.
A redelivered queue job of a woken Run is a retry, and it MUST follow the rules of this
requirement.

#### Scenario: Known native mutation result is replayed without execution

- **WHEN** a native edit or write settled before a client reconnect
- **THEN** replay returns the recorded tool result
- **AND** the filesystem mutation does not execute again

#### Scenario: Worker death mid-loop does not resume tool state

- **WHEN** the worker dies after several completed tool steps, and the deadman expires the Run
- **THEN** the Run ends under the rules that apply today
- **AND** no new Run resumes the partial tool-loop state, unless the owner requests a Continue

#### Scenario: Refresh does not re-execute tools

- **WHEN** a client reconnects to a live Run after tool steps completed
- **THEN** replay builds those steps again from durable events and does not execute a native mutation again

#### Scenario: Worker failure does not replay a native mutation

- **WHEN** a worker fails after a native mutation or an MCP dispatch can have started, and before its result is known
- **THEN** the host settles the effect as `outcome_unknown`, and the Run stops
- **AND** a queue retry does not invoke that mutation or MCP operation again

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** the queue retries the job of a read-only Run, the Run is still claimable, and no `native.attempt` is recorded
- **THEN** its tool loop executes again from the first step of its current segment
- **AND** it can invoke again the read-only tools that the earlier attempt invoked

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** the queue retries a job for a Run that is already terminal
- **THEN** the Run does not open again, no tool executes, and its terminal state stays

#### Scenario: Read-only retry remains unchanged

- **WHEN** a claimable Run holds only read-only tools, has no recorded `native.attempt`, and its job retries
- **THEN** the read-only retry behavior of today stays available
- **AND** the host infers no native mutation from the read-only result

#### Scenario: A Continue carries settled tool results into a new Run

- **WHEN** a Run failed after a settled `edit` call and a settled `bash` call with `outcome_unknown`, and the owner continues it
- **THEN** the Continue Run gives the model both stored results
- **AND** it does not execute either call again

#### Scenario: A settled write in an earlier segment does not stop a retry

- **WHEN** the first segment of a Run settled a native `write`
- **AND** the worker dies in the second segment before a native attempt of that segment
- **THEN** the retry restarts the second segment from its delivered message
- **AND** the `write` does not execute again

#### Scenario: A wake does not restart the segment

- **WHEN** a Run leaves `awaiting_jobs` after two completed tool steps of its current segment
- **THEN** the first attempt after the wake keeps both steps and executes neither call again

#### Scenario: A retry after a wake restarts a read-only segment

- **WHEN** the queue retries the job of a woken Run whose current segment has no `native.attempt`
- **THEN** the tool loop executes again from the first step of that segment

## ADDED Requirements

### Requirement: A tool can yield to a steer

A tool can declare that it yields. `wait` and `bash` on the llame host MUST yield, and no other
tool does. A steer, an interrupt, or a job notice can signal the Run. Each open call of a tool
that yields MUST then return a known result at once. The work of that call MUST continue as a job of
`background-jobs`. A call that yields MUST NOT settle as `outcome_unknown` or `cancelled`.

#### Scenario: A read does not yield

- **WHEN** the owner sends a steer while a `read` of a web locator runs
- **THEN** the `read` finishes with its own result before the steer is delivered

#### Scenario: Two commands yield at one signal

- **WHEN** two host `bash` calls of one step run in the foreground, and the owner sends a steer
- **THEN** both calls return `backgrounded`, and both commands continue

### Requirement: Only a wait call stays open while its Run waits

A `wait` call MUST be the only tool call that stays open while a Run is in `awaiting_jobs`. The
Run MUST settle every other call of the step before it enters that status. A step MUST hold at
most one open `wait` call, and a second `wait` call in the step MUST return an error. A `wait`
call MUST NOT record a native attempt, because it has no effect on the host.

#### Scenario: A wait beside a read in one step

- **WHEN** the model calls `read` and `wait` in one step
- **THEN** the `read` result is stored before the Run enters `awaiting_jobs`

#### Scenario: Two wait calls in one step

- **WHEN** the model calls `wait` twice in one step
- **THEN** the second call returns an error that names the first call, and the Run waits on the first call only

### Requirement: A woken Run settles the wait and continues from its stored steps

When a Run leaves `awaiting_jobs`, its attempt MUST record the result of the open `wait` call
exactly once. It MUST then send the next model request with the history and the stored steps of
the current reply, through that result. It MUST NOT execute a settled call again. A redelivered
queue job of the woken Run MUST follow the retry rules of `No mid-run tool-state checkpointing`.

#### Scenario: A build fails while the Run waits

- **WHEN** a Run waits on a build, the build fails, and another worker claims the Run
- **THEN** the reply keeps its earlier steps, and the `wait` call gets the result that names the failed build
- **AND** the next model request carries those steps and that result

#### Scenario: A worker stops after the wake

- **WHEN** the current segment holds no native attempt, and the worker stops after it recorded the `wait` result
- **THEN** the retry executes the segment again from its first step
- **AND** a new `wait` call on the settled job returns at once

#### Scenario: A worker stops after the wake of a segment with a command

- **WHEN** the current segment holds a `bash` attempt, and the worker stops after the wake
- **THEN** the redelivered Run fails as `outcome_unknown`, and the owner can start a Continue

### Requirement: The stop tool is a host-capability tool

`stop` MUST have the `execute_code` classification, and it MUST be in the exact host-capability
set. It MUST be available only on a process that can run host `bash`. Its retry policy is this:
a retried `stop` call requests the stop again, and a job that is already settled keeps its
state. `wait` MUST have the `read_only` classification.

#### Scenario: Stop is advertised with bash

- **WHEN** `tools.allowed` names `bash` and `stop`, and the process accepted native host authority
- **THEN** the system advertises `stop`

#### Scenario: Stop without host authority is not advertised

- **WHEN** `tools.allowed` names `stop`, and the process accepted no native host authority
- **THEN** the system does not advertise `stop` and does not execute it
