## MODIFIED Requirements

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5
set. The loop SHALL execute allowlisted `read_only` tools and exact code-owned
alpha-native tools registered by an approved capability. The native set after
this change includes `read`, `edit`, `write`, and `bash`, with `bash` classified
`execute_code`. Classification alone SHALL NOT admit another write or execution
tool. Alpha-native tools carry explicit host authority and are not remote MCP
writes.

The `mcp__` prefix SHALL remain reserved for MCP-generated ids.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called
- **THEN** it executes

#### Scenario: Bash executes only in its native capability

- **WHEN** exact code-owned `bash` is allowlisted and trusted native execution capability is present
- **THEN** it executes with that host authority
- **AND** it is not substituted with a remote or weaker executor

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
that has executed native `edit`, `write`, `knowledge_submit`, or `bash` SHALL NOT
automatically replay that effect after worker failure, timeout, or unknown
settlement. Bash SHALL durably record an attempt before process start and fence
the executor after unknown termination. Client reconnect SHALL replay recorded
activity without executing the effect.

#### Scenario: Worker death mid-loop does not resume tool state

- **WHEN** the worker dies after several completed tool steps and the Run expires
- **THEN** no partial tool-loop state is resumed on a new Run

#### Scenario: Refresh does not re-execute tools

- **WHEN** a client reconnects after a bash result was settled
- **THEN** replay reconstructs the result without starting another process

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** a read-only Run's job retries and the Run remains claimable
- **THEN** its read-only loop may execute from the first step
- **AND** no native mutation or bash effect is replayed

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** a job retries for a terminal Run
- **THEN** the Run is not reopened and no tool executes
