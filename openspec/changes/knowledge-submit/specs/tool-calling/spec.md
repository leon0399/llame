## MODIFIED Requirements

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5
set. The loop SHALL execute allowlisted `read_only` tools and exact code-owned
alpha-native tools registered by an approved capability. The native set after
this change includes `read`, `edit`, `write`, and `knowledge_submit`, with
`knowledge_submit` classified `write_low_risk`. Classification alone SHALL NOT
admit another write or execution tool. Alpha-native tools carry explicit host
authority; they are not remote MCP writes or a general permission system.

The `mcp__` prefix SHALL remain reserved for MCP-generated ids.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called
- **THEN** it executes

#### Scenario: Alpha native file tool executes only in its host capability

- **WHEN** an exact code-owned native tool is allowlisted and its trusted alpha native capability is present
- **THEN** it executes with the native host authority declared by that capability
- **AND** it is not substituted with a hosted path or remote MCP operation

#### Scenario: Knowledge submit executes only in its native capability

- **WHEN** exact code-owned `knowledge_submit` is allowlisted and trusted native Knowledge capability is present
- **THEN** it executes with the native capability's host authority
- **AND** it is not substituted with a remote MCP operation

#### Scenario: Non-read-only tool is refused even when allowlisted

- **WHEN** a tool outside the exact alpha-native set is classified other than `read_only`, registered and allowlisted, and requested
- **THEN** it is not advertised or executed
- **AND** the request receives a recorded non-fatal refusal

#### Scenario: Unclassified tool cannot register

- **WHEN** a tool without a classification is registered
- **THEN** registration fails at startup

#### Scenario: Duplicate tool id cannot register

- **WHEN** two tools register the same id
- **THEN** registration fails at startup naming the id

#### Scenario: Code-owned tool cannot occupy the MCP namespace

- **WHEN** a code-owned registry entry begins with `mcp__`
- **THEN** registration fails at startup naming the reserved prefix

### Requirement: No mid-run tool-state checkpointing (read-only slice; write-tool landmine)

The existing read-only loop MAY retry a claimable Run from its first step. A Run
that has executed native `edit`, `write`, or `knowledge_submit` SHALL NOT
automatically replay that mutation after worker failure, timeout, or unknown
settlement. The capability SHALL durably record a pre-effect attempt and fence
retries until it reconciles a known commit or returns `outcome_unknown`.
Client reconnect SHALL replay recorded activity without executing the effect.

#### Scenario: Known native mutation result is replayed without execution

- **WHEN** a native edit or write settled before a client reconnect
- **THEN** replay returns the recorded tool result
- **AND** the filesystem mutation is not executed again

#### Scenario: Worker death mid-loop does not resume tool state

- **WHEN** the worker dies after several completed tool steps and the Run expires
- **THEN** no partial tool-loop state is resumed on a new Run

#### Scenario: Refresh does not re-execute tools

- **WHEN** a client reconnects after a submit result was settled
- **THEN** replay reconstructs the result without running Git again

#### Scenario: Worker failure does not replay a native mutation

- **WHEN** a worker fails after a native mutation may have started but before its result is known
- **THEN** the mutation is recorded as `outcome_unknown` or the native attempt fails terminally
- **AND** a queue retry does not invoke that mutation again

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** a read-only Run's job retries and the Run remains claimable
- **THEN** its read-only loop may execute from the first step
- **AND** no native mutation or submit effect is replayed

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** a job retries for a terminal Run
- **THEN** the Run is not reopened and no tool executes

#### Scenario: Read-only retry remains unchanged

- **WHEN** a claimable Run contains only read-only tools and its job retries
- **THEN** the existing read-only retry behavior remains available
- **AND** no native mutation is inferred from the read-only result
