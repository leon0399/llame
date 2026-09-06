## MODIFIED Requirements

### Requirement: Multi-step tool-calling run loop

The run executor SHALL support multi-step runs: when the model requests tool
invocations, the loop SHALL execute them, append the results to the run's model
context, and continue the same run until the model produces a final answer or
the step cap is reached. A step is one model turn that requested at least one
tool. Multiple independent read-only calls MAY execute concurrently. Calls that
mutate the same native file path SHALL execute sequentially in provider-emitted
order, each producing its own call/result parts. The step cap SHALL be evaluated
per step, atomically: the turn that reaches the cap executes all accepted calls.
The loop remains queue-processed and durable.

#### Scenario: Model calls a tool and continues

- **WHEN** the model requests an available tool with valid arguments
- **THEN** the tool executes, its result enters model context, and the model continues

#### Scenario: Multiple sequential tool steps

- **WHEN** the model chains several tool-requesting turns within one Run
- **THEN** each executes in order and context accumulates every call and result

#### Scenario: Independent read-only calls can run concurrently

- **WHEN** the model requests independent read-only calls in one turn
- **THEN** they may execute concurrently and the step counter increments once

#### Scenario: Parallel tool calls within one turn count as one step

- **WHEN** the model requests three independent read-only tool calls in one turn
- **THEN** all three may execute concurrently, each with its own call/result parts, and the step counter increments by one

#### Scenario: Same-path native mutations are serialized

- **WHEN** one model turn requests two native mutations against the same absolute path
- **THEN** they execute sequentially in provider order
- **AND** the later call observes the earlier call's current bytes

#### Scenario: The cap-reaching step completes atomically

- **WHEN** the step cap is 8, seven steps have run, and the model requests three calls in its eighth tool turn
- **THEN** all three accepted calls execute before further tools are refused

#### Scenario: Step cap reached fails closed to answering

- **WHEN** a Run reaches the configured maximum tool steps
- **THEN** no further calls execute and the cap is recorded in Run events

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5
set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`,
`external_send`, `financial_or_sensitive`, `admin`). The loop SHALL execute
allowlisted `read_only` tools and exact code-owned tools registered by an
approved alpha-native capability. The initial native set is `read` classified
`read_only`, plus `edit` and `write` classified `write_low_risk`; later native
capabilities such as Knowledge submit or bash must declare their own exact tools
and retry policy. Classification alone SHALL NOT admit any other write or
execution tool. Alpha-native tools carry explicit host authority; they are not a
general permission engine or a remote MCP write grant.

The `mcp__` tool-id prefix SHALL be reserved for ids produced by the MCP
capability. A code-owned or other non-MCP registry entry beginning with that
prefix SHALL fail registration, so ID-only namespace permission matching cannot
grant authority across source kinds.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called
- **THEN** it executes

#### Scenario: Alpha native file tool executes only in its host capability

- **WHEN** an exact code-owned native tool is allowlisted and its trusted alpha native capability is present
- **THEN** it executes with the native host authority declared by that capability
- **AND** it is not substituted with a hosted path or remote MCP operation

#### Scenario: Non-read-only tool is refused even when allowlisted

- **WHEN** a tool outside the exact alpha native file set is classified other than `read_only`, registered and allowlisted, and the model requests it
- **THEN** it is not advertised or executed
- **AND** a direct request receives a recorded non-fatal refusal

#### Scenario: Unclassified tool cannot register

- **WHEN** a tool without a classification is registered
- **THEN** registration fails at startup

#### Scenario: Duplicate tool id cannot register

- **WHEN** two tools register the same id
- **THEN** registration fails at startup naming the id

#### Scenario: Code-owned tool cannot occupy the MCP namespace

- **WHEN** a code-owned registry entry has an id beginning with `mcp__`
- **THEN** registration fails at startup naming the reserved prefix

### Requirement: No mid-run tool-state checkpointing (read-only slice; write-tool landmine)

The existing read-only loop may retry a claimable Run from its first step. A Run
that has executed an alpha native `edit` or `write` SHALL NOT automatically
replay that mutation after a worker failure, timeout, or unknown settlement.
The host SHALL settle the mutation as `outcome_unknown` or fail the containing
native mutation attempt and require a new explicit user/model attempt. Client
reconnect SHALL replay recorded tool activity without executing the mutation
again. A future durable effect-dedupe capability may replace this terminal
behavior; it is outside this change.

#### Scenario: Known native mutation result is replayed without execution

- **WHEN** a native edit or write settled before a client reconnect
- **THEN** replay returns the recorded tool result
- **AND** the filesystem mutation is not executed again

#### Scenario: Worker death mid-loop does not resume tool state

- **WHEN** the worker dies after several completed tool steps and the run is expired by the deadman
- **THEN** the run terminates per existing semantics
- **AND** no partial tool-loop state is resumed on a new run

#### Scenario: Refresh does not re-execute tools

- **WHEN** a client reconnects to a live run after tool steps have completed
- **THEN** replay reconstructs those steps from durable events without executing a native mutation again

#### Scenario: Worker failure does not replay a native mutation

- **WHEN** a worker fails after a native mutation may have started but before its result is known
- **THEN** the mutation is recorded as `outcome_unknown` or the native attempt fails terminally
- **AND** a queue retry does not invoke that mutation again

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** a read-only Run's job is retried by the queue and the Run is still claimable
- **THEN** its tool loop executes from the first step again
- **AND** it may re-invoke read-only tools already invoked in the previous attempt

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** a job is retried for a Run that has already reached a terminal state
- **THEN** the Run is not reopened, no tool executes, and its terminal state stands

#### Scenario: Read-only retry remains unchanged

- **WHEN** a claimable Run contains only read-only tools and its job retries
- **THEN** the existing read-only retry behavior remains available
- **AND** no native mutation is inferred from the read-only result
