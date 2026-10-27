## MODIFIED Requirements

### Requirement: No mid-run tool-state checkpointing (read-only slice; write-tool landmine)

The read-only loop can retry a claimable Run from its first step with new worker context only
when that Run has no recorded native attempt or MCP dispatch. A retry MUST resolve its own prompt
and its own attempt-local catalog again, and MUST NOT use the preparation of the failed attempt.
It MUST compare availability with the id and state record that its Run stored when an earlier
attempt dispatched. When no such record exists, it MUST compare with the record of the most
recent prior dispatched Run. The persisted output of the failed attempt stays part of the
committed record that later turns load. A Run that executed an alpha native `edit` or `write`
MUST NOT replay that mutation automatically. This applies after a worker failure, a timeout, or an
unknown settlement. A Run that dispatched an MCP operation MUST NOT replay that operation
automatically.
The host MUST stop the affected Run with `outcome_unknown` and require a new explicit user or
model attempt. A client reconnect MUST replay recorded tool activity and MUST NOT execute the
mutation or the MCP operation again. A redelivered Run with a recorded `native.attempt` MUST fail
as `outcome_unknown` and MUST NOT replay its loop. This recovery rule has no native-executor or
`workerId` precondition. Before terminal settlement, the host MUST settle each open call that has
a matching durable `native.result` from that result, whatever the tool source. An open `bash`,
native mutation, or MCP call with a recorded `native.attempt` and no matching result MUST settle
as `outcome_unknown`. Every other open call settles as the termination settlement rules require.
Only a Continue that the owner requests through `turn-actions` can carry the settled tool-loop
state of a terminal Run into a new Run. That Continue Run MUST replay the settled results, and
MUST NOT execute a settled call again. A future durable effect-dedupe capability can replace
this terminal behavior; it is outside this change.

#### Scenario: Known native mutation result is replayed without execution

- **WHEN** a native edit or write settled before a client reconnect
- **THEN** replay returns the recorded tool result
- **AND** the filesystem mutation does not execute again

#### Scenario: Worker death mid-loop does not resume tool state

- **WHEN** the worker dies after several completed tool steps, and the deadman expires the Run
- **THEN** the Run ends under the current semantics
- **AND** no new Run resumes the partial tool-loop state unless the owner requests a Continue

#### Scenario: Refresh does not re-execute tools

- **WHEN** a client reconnects to a live Run after tool steps completed
- **THEN** replay rebuilds those steps from durable events and does not execute a native mutation again

#### Scenario: Worker failure does not replay a native mutation

- **WHEN** a worker fails after a native mutation or an MCP dispatch can have started, but before its result is known
- **THEN** the host settles the effect as `outcome_unknown`, and the Run stops
- **AND** a queue retry does not invoke that mutation or MCP operation again

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** the queue retries the job of a read-only Run, the Run is still claimable, and no `native.attempt` is recorded
- **THEN** its tool loop executes from the first step again
- **AND** it can invoke again the read-only tools that the previous attempt invoked

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** the queue retries a job for a Run that is already terminal
- **THEN** the Run does not open again, no tool executes, and its terminal state stays

#### Scenario: Read-only retry remains unchanged

- **WHEN** a claimable Run holds only read-only tools, has no recorded `native.attempt`, and its job retries
- **THEN** the current read-only retry behavior stays available
- **AND** the host infers no native mutation from the read-only result

#### Scenario: A Continue carries settled tool results into a new Run

- **WHEN** a Run failed after a settled `edit` call and a settled `bash` call with `outcome_unknown`, and the owner continues it
- **THEN** the Continue Run gives the model both stored results
- **AND** it does not execute either call again

## ADDED Requirements

### Requirement: A stored tool part records the classification of a call that started

When a tool call starts, its stored tool part MUST record `classification` with the
classification of the tool that executes it. The stored part of a call that did not start MUST
record `classification: null`. The chat history response MUST return the field. A tool part with
no `classification` field is a part that the system stored before this rule.

#### Scenario: A started bash call records its classification

- **WHEN** a `bash` call starts and settles
- **THEN** its stored tool part records `classification: "execute_code"`

#### Scenario: A rejected call records no classification

- **WHEN** the availability gate rejects a tool call before it starts
- **THEN** its stored tool part records `classification: null`

#### Scenario: An MCP call records unverified

- **WHEN** an allowlisted MCP tool call starts
- **THEN** its stored tool part records `classification: "unverified"`
