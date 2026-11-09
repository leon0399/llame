## MODIFIED Requirements

### Requirement: Multi-step tool-calling run loop

The run executor MUST support multi-step Runs. When the model requests tool invocations, the loop
MUST execute them and append their results to the model context of the Run. It MUST continue the
same Run until the model gives a final answer, or until a configured step cap is reached. Without
a configured cap, the loop puts no limit on the number of steps. A step is one model turn that
requested one or more tools. Independent read-only calls can execute at the same time. Calls that
change the same native file path MUST execute one after the other, in the order that the provider
sent them. Each of these calls MUST give its own call part and result part.

The loop MUST count the step cap per segment of the Run, as `run-steering` defines segments. Each
segment starts with a count of zero. The loop MUST evaluate the cap per step, atomically: the
turn that reaches the cap executes all accepted calls. The loop stays queue-processed and
durable.

#### Scenario: Model calls a tool and continues

- **WHEN** the model requests an available tool with valid arguments
- **THEN** the tool executes, its result enters the model context, and the model continues

#### Scenario: Multiple sequential tool steps

- **WHEN** the model makes several tool turns, one after the other, in one Run
- **THEN** each executes in order, and the context keeps every call and result

#### Scenario: Independent read-only calls can run concurrently

- **WHEN** the model requests independent read-only calls in one turn
- **THEN** they can execute at the same time, and the step counter increases by one

#### Scenario: Parallel tool calls within one turn count as one step

- **WHEN** the model requests three independent read-only tool calls in one turn
- **THEN** all three can execute at the same time, each with its own call part and result part
- **AND** the step counter increases by one

#### Scenario: Same-path native mutations are serialized

- **WHEN** one model turn requests two native mutations of the same absolute path
- **THEN** they execute one after the other in the order of the provider
- **AND** the later call reads the bytes that the earlier call wrote

#### Scenario: The cap-reaching step completes atomically

- **WHEN** the step cap is 8, seven steps ran, and the model requests three calls in its eighth tool turn
- **THEN** all three accepted calls execute before the loop refuses further tools

#### Scenario: Step cap reached fails closed to answering

- **WHEN** a segment of a Run reaches the configured maximum of tool steps
- **THEN** no further calls execute, and the system drives the model to answer from what it has
- **AND** the Run records the cap in its events, and the segment ends with that answer

#### Scenario: No step cap unless configured

- **WHEN** no step cap is configured, and the model requests tools across many turns
- **THEN** every accepted step executes
- **AND** the Run continues until the model answers, the owner cancels, or another `durable-runs` rule ends it
- **AND** no cap marker is recorded

#### Scenario: A delivered message restarts the step count

- **WHEN** the step cap is 8, the first segment of a Run used 8 steps, and a steer starts a second segment
- **THEN** the second segment can execute 8 tool steps before the cap applies

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
