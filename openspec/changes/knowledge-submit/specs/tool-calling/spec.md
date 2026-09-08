## MODIFIED Requirements

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5
set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`,
`external_send`, `financial_or_sensitive`, `admin`). The loop SHALL execute
allowlisted `read_only` tools and exact code-owned tools registered by an
approved alpha-native capability. The native set after this change is `read`
classified `read_only`, plus `edit`, `write`, and `knowledge_submit` classified
`write_low_risk`; later native capabilities such as bash must declare their own
exact tools and retry policy. Classification alone SHALL NOT admit any other
write or execution tool. Alpha-native tools carry explicit host authority for
absolute paths and owner-scoped Knowledge authority for `kb://` locators; they
are not a general permission engine or a remote MCP write grant. The candidate
resolver SHALL admit the three native file tools when the process has accepted
native host authority or has a configured Knowledge root, and SHALL leave them
unavailable when it has neither. A configured Knowledge root admits only `read`,
`edit`, and `write`; `bash` and every other host-capability tool remain admitted
solely by accepted native host authority.

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

#### Scenario: Knowledge submit executes only in its native capability

- **WHEN** exact code-owned `knowledge_submit` is allowlisted and trusted native Knowledge capability is present
- **THEN** it executes with the native capability's host authority
- **AND** it is not substituted with a remote MCP operation

#### Scenario: Native tools are admitted by Knowledge root alone

- **WHEN** a process has a configured Knowledge root, no `tools.nativeExecutorId`, and allowlists `read`, `edit`, and `write`
- **THEN** the three tools are advertised and executable for `kb://` locators
- **AND** an absolute path fails closed with `executor_unavailable`

#### Scenario: Knowledge root does not admit bash

- **WHEN** a process has a configured Knowledge root, no `tools.nativeExecutorId`, and allowlists `bash`
- **THEN** `bash` is neither advertised nor executable
- **AND** the Run manifest records it unavailable exactly as before this change

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
