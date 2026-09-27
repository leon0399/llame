## MODIFIED Requirements

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5 set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`, `external_send`, `financial_or_sensitive`, `admin`, `unverified`). The loop SHALL execute allowlisted `read_only` tools and exact code-owned tools registered by an approved alpha-native capability only when the executing process's `tools.permissions` policy also allows the invocation. MCP tools SHALL declare `unverified`; their eligibility SHALL be determined by an admitted MCP declaration whose exact id matches either an exact `tools.allowed` entry or a validated namespace rule, not by a `read_only` classification. An MCP invocation SHALL execute only when its source is allowlisted and the executing process's `tools.permissions` policy allows that invocation. The initial native set is `read` classified `read_only`, plus `edit` and `write` classified `write_low_risk`; later native capabilities such as Knowledge submit or bash must declare their own exact tools and retry policy. Classification alone SHALL NOT admit any other write or execution tool. Alpha-native tools carry explicit host authority for absolute paths and owner-scoped Knowledge authority for `kb://` locators; they are not a general permission engine, and their host authority SHALL NOT grant authority to MCP tools. The candidate resolver SHALL admit `edit` and `write` when the process has accepted native host authority or has a configured Knowledge root, and SHALL leave them unavailable when it has neither. It SHALL admit `read` whenever `tools.allowed` names it, because skill and web locators need no host authority; an absolute path on a process without accepted native authority still fails closed with `executor_unavailable`. A configured Knowledge root admits only `read`, `edit`, and `write`; `bash`, `enter_workspace`, `exit_workspace`, and every other host-capability tool remain admitted solely by accepted native host authority. The exact host-capability set SHALL include `enter_workspace` and `exit_workspace`; `enter_workspace` SHALL be classified `execute_code`, `exit_workspace` SHALL be classified `write_low_risk`, neither SHALL record a `native.attempt` effect, both SHALL bind the Run to the executing native executor identity like other host tools, and both SHALL be idempotent over Chat state when retried after their state change commits. Every MCP source-inventory, advertisement, executable-binding, and unavailable-state gate SHALL use source admission, `tools.allowed`, and per-call `tools.permissions` as applicable; no MCP gate SHALL require or infer a `read_only` classification or attestation, and an unavailable MCP declaration SHALL retain at most its exact identity for availability disclosure without an executable binding.

The native set after this change is `read` classified `read_only`, plus `edit`, `write`, and `knowledge_submit` classified `write_low_risk`; later native capabilities such as bash must declare their own exact tools and retry policy. Classification alone SHALL NOT admit any other write or execution tool. Alpha-native tools carry explicit host authority for absolute paths and owner-scoped Knowledge authority for `kb://` locators; they are not a general permission engine or a remote MCP write grant. The candidate resolver SHALL admit `edit` and `write` when the process has accepted native host authority or has a configured Knowledge root, and SHALL leave them unavailable when it has neither. It SHALL admit `read` whenever `tools.allowed` names it, because skill and web locators need no host authority; an absolute path on a process without accepted native authority still fails closed with `executor_unavailable`. A configured Knowledge root admits only `read`, `edit`, and `write`; `bash` and every other host-capability tool remain admitted solely by accepted native host authority.

The `mcp__` tool-id prefix SHALL be reserved for ids produced by the MCP capability. A code-owned or other non-MCP registry entry beginning with that prefix SHALL fail registration, so ID-only namespace permission matching cannot grant authority across source kinds.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called and its invocation passes the execution permission policy
- **THEN** it executes

#### Scenario: Alpha native file tool executes only in its host capability

- **WHEN** an exact code-owned native host tool, including `enter_workspace` or `exit_workspace`, is allowlisted, its trusted host capability is present, and the invocation passes execution permission checks
- **THEN** it executes with the host authority declared by that capability
- **AND** it is not substituted with a hosted path or remote MCP operation

#### Scenario: Knowledge submit executes only in its native capability

- **WHEN** exact code-owned `knowledge_submit` is allowlisted and trusted native Knowledge capability is present
- **THEN** it executes with the native capability's host authority
- **AND** it is not substituted with a remote MCP operation

#### Scenario: Native tools are admitted by Knowledge root alone

- **WHEN** a process has a configured Knowledge root, no `tools.nativeExecutorId`, and allowlists `read`, `edit`, and `write`
- **THEN** the three tools are advertised for `kb://` locators
- **AND** each call executes only when its `tools.permissions` policy allows it; without a matching allow the call receives `permission_denied`
- **AND** an absolute path fails closed with `executor_unavailable`

#### Scenario: Read is admitted by the allowlist alone

- **WHEN** a process has no `tools.nativeExecutorId` and no configured Knowledge root, and allowlists `read`, `edit`, and `write`
- **THEN** `read` is advertised and serves web locators under its permission policy
- **AND** `edit` and `write` are neither advertised nor executable, and an absolute-path `read` fails closed with `executor_unavailable`

#### Scenario: Knowledge root does not admit bash

- **WHEN** a process has a configured Knowledge root, no `tools.nativeExecutorId`, and allowlists `bash`
- **THEN** `bash` is neither advertised nor executable
- **AND** the Run manifest records it unavailable exactly as before this change

#### Scenario: Non-read-only tool is refused even when allowlisted

- **WHEN** a non-MCP tool outside the exact approved host-capability set is classified other than `read_only`, registered and allowlisted, and the model requests it
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

#### Scenario: Write-capable MCP tool executes under both gates

- **WHEN** an MCP source supplies an admitted write-capable declaration whose exact id matches `tools.allowed`, and the invocation passes the executing process's `tools.permissions` policy
- **THEN** the tool executes despite its `unverified` classification

### Requirement: No mid-run tool-state checkpointing (read-only slice; write-tool landmine)

The existing read-only loop may retry a claimable Run from its first step with freshly resolved
worker context only when that Run has no recorded native attempt or MCP dispatch. A retry SHALL
re-resolve its own prompt and its own attempt-local catalog rather than reuse the failed attempt's
preparation, and SHALL compare availability against the same previous committed turn. The failed
attempt's persisted output remains part of the committed record that later turns load. A Run that
has executed an alpha native `edit`, `write`, or `knowledge_submit` SHALL NOT automatically replay that mutation after a
worker failure, timeout, or unknown settlement. A Run that has dispatched an MCP operation SHALL
likewise not automatically replay that operation. The host SHALL stop the affected Run with
`outcome_unknown` and require a new explicit user/model attempt. Client reconnect SHALL replay
recorded tool activity without executing the mutation or MCP operation again. A redelivered Run
carrying any recorded `native.attempt` SHALL fail as `outcome_unknown` without replaying its loop;
this recovery rule has no native-executor or `workerId` precondition. Before terminal settlement,
each open call with a matching durable `native.result` SHALL be settled from that result regardless
of tool source. An open `bash`, native mutation, or MCP call whose `native.attempt` is recorded
without a matching result SHALL settle as `outcome_unknown`; every other open call settles as the
termination settlement rules require.
A future durable effect-dedupe capability may replace this terminal behavior; it is outside this
change.

#### Scenario: Known native mutation result is replayed without execution

- **WHEN** a native edit or write settled before a client reconnect
- **THEN** replay returns the recorded tool result
- **AND** the filesystem mutation is not executed again

#### Scenario: Worker death mid-loop does not resume tool state

- **WHEN** the worker dies after several completed tool steps and the run is expired by the deadman
- **THEN** the run terminates per existing semantics
- **AND** no partial tool-loop state is resumed on a new run

#### Scenario: Refresh does not re-execute tools

- **WHEN** a client reconnects to a live run after tool steps have completed, including a `knowledge_submit` step
- **THEN** replay reconstructs those steps from durable events without executing a native mutation or `knowledge_submit` effect again

#### Scenario: Worker failure does not replay a native mutation

- **WHEN** a worker fails after a native mutation, `knowledge_submit`, or MCP dispatch may have started but before its result is known
- **THEN** the effect is settled as `outcome_unknown` and the Run stops
- **AND** a queue retry does not invoke that mutation, `knowledge_submit` effect, or MCP operation again

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** a read-only Run's job is retried by the queue, the Run is still claimable, and no `native.attempt` is recorded
- **THEN** its tool loop executes from the first step again
- **AND** it may re-invoke read-only tools already invoked in the previous attempt
- **AND** it does not replay a `knowledge_submit` effect

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** a job is retried for a Run that has already reached a terminal state
- **THEN** the Run is not reopened, no tool executes, and its terminal state stands

#### Scenario: Read-only retry remains unchanged

- **WHEN** a claimable Run contains only read-only tools, has no recorded `native.attempt`, and its job retries
- **THEN** the existing read-only retry behavior remains available
- **AND** no native mutation is inferred from the read-only result
