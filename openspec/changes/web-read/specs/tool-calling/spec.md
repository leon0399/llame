## MODIFIED Requirements

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5
set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`,
`external_send`, `financial_or_sensitive`, `admin`). The loop SHALL execute
allowlisted `read_only` tools and exact code-owned tools registered by an
approved alpha-native capability only when the executing process's call-permission policy also allows the invocation. The initial native set is `read` classified
`read_only`, plus `edit` and `write` classified `write_low_risk`; later native
capabilities such as Knowledge submit or bash must declare their own exact tools
and retry policy. Classification alone SHALL NOT admit any other write or
execution tool. Alpha-native tools carry explicit host authority for absolute paths and
owner-scoped Knowledge authority for `kb://` locators; they are not a general
permission engine or a remote MCP write grant. The candidate resolver SHALL admit
`edit` and `write` when the process has accepted native host authority or
has a configured Knowledge root, and SHALL leave them unavailable when it has
neither. It SHALL admit `read` whenever `tools.allowed` names it, because
skill and web locators need no host authority; an absolute path on a process
without accepted native authority still fails closed with
`executor_unavailable`. A configured Knowledge root admits only `read`,
`edit`, and `write`; `bash` and every other host-capability tool remain
admitted solely by accepted native host authority.

The `mcp__` tool-id prefix SHALL be reserved for ids produced by the MCP
capability. A code-owned or other non-MCP registry entry beginning with that
prefix SHALL fail registration, so ID-only namespace permission matching cannot
grant authority across source kinds.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called and its invocation passes the execution permission policy
- **THEN** it executes

#### Scenario: Alpha native file tool executes only in its host capability

- **WHEN** an exact code-owned native tool is allowlisted, its trusted alpha native capability is present, and the invocation passes execution permission checks
- **THEN** it executes with the native host authority declared by that capability
- **AND** it is not substituted with a hosted path or remote MCP operation

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
