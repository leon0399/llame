## MODIFIED Requirements

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5 set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`, `external_send`, `financial_or_sensitive`, `admin`, `unverified`). The loop SHALL execute allowlisted `read_only` tools and exact code-owned tools registered by an approved alpha-native capability only when the executing process's `tools.permissions` policy also allows the invocation. MCP tools SHALL declare `unverified`; their eligibility SHALL be determined by an admitted MCP declaration whose exact id matches either an exact `tools.allowed` entry or a validated namespace rule, not by a `read_only` classification. An MCP invocation SHALL execute only when its source is allowlisted and the executing process's `tools.permissions` policy allows that invocation. The initial native set is `read` and `grep` classified `read_only`, plus `edit` and `write` classified `write_low_risk`; later native capabilities such as Knowledge submit or bash must declare their own exact tools and retry policy. Classification alone SHALL NOT admit any other write or execution tool. Alpha-native tools carry explicit host authority for absolute paths and owner-scoped Knowledge authority for `kb://` locators, and `read` alone carries owner-scoped, read-only media authority for `media://` locators, which resolves only the Run owner's media; they are not a general permission engine, and their host authority SHALL NOT grant authority to MCP tools. The candidate resolver SHALL admit `edit` and `write` when the process has accepted native host authority or has a configured Knowledge root, and SHALL leave them unavailable when it has neither. It SHALL admit `read` whenever `tools.allowed` names it, because skill, web, and `media://` locators need no host authority; an absolute path on a process without accepted native authority still fails closed with `executor_unavailable`. It MUST admit `grep` when the process has accepted native host authority, a configured Knowledge root, a configured skill source, or a configured Machine, and MUST leave `grep` unavailable when it has none of these; the `grep-tool` capability owns that tool's scope and admission rules. A configured Knowledge root admits only `read`, `grep`, `edit`, and `write`; `bash`, `enter_workspace`, `exit_workspace`, and every other host-capability tool remain admitted solely by accepted native host authority. The exact host-capability set SHALL include `enter_workspace` and `exit_workspace`; `enter_workspace` SHALL be classified `execute_code`, `exit_workspace` SHALL be classified `write_low_risk`, neither SHALL record a `native.attempt` effect, both SHALL bind the Run to the executing native executor identity like other host tools, and both SHALL be idempotent over Chat state when retried after their state change commits. Every MCP source-inventory, advertisement, executable-binding, and unavailable-state gate SHALL use source admission, `tools.allowed`, and per-call `tools.permissions` as applicable; no MCP gate SHALL require or infer a `read_only` classification or attestation, and an unavailable MCP declaration SHALL retain at most its exact identity for availability disclosure without an executable binding.

The `mcp__` tool-id prefix SHALL be reserved for ids produced by the MCP capability. A code-owned or other non-MCP registry entry beginning with that prefix SHALL fail registration, so ID-only namespace permission matching cannot grant authority across source kinds.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called and its invocation passes the execution permission policy
- **THEN** it executes

#### Scenario: Alpha native file tool executes only in its host capability

- **WHEN** an exact code-owned native host tool, including `enter_workspace` or `exit_workspace`, is allowlisted, its trusted host capability is present, and the invocation passes execution permission checks
- **THEN** it executes with the host authority declared by that capability
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

#### Scenario: Read serves media locators without host or Knowledge authority

- **WHEN** a process has no `tools.nativeExecutorId` and no configured Knowledge root, allowlists
  `read`, and the Run owner reads `media://<id>` of an image that owner holds
- **THEN** `read` returns the image result when its permission policy allows the call
- **AND** without a matching allow the call receives `permission_denied`

#### Scenario: Media authority does not cross owners

- **WHEN** user A's Run reads `media://<id>` of an image owned by user B, under a policy that allows
  the locator text
- **THEN** the call returns `not_found`, exactly as for an id that does not exist
- **AND** no bytes or descriptor fields of user B's image reach user A

#### Scenario: Media authority is read-only

- **WHEN** `edit` or `write` targets a `media://` locator
- **THEN** the call returns the existing unsupported-operation error
- **AND** no media object or stored variant changes

#### Scenario: Grep is admitted by any serving backend

- **WHEN** `tools.allowed` names `grep` and the process has a configured skill source but no native executor, Knowledge root, or Machine
- **THEN** `grep` is advertised
- **AND** a host or `kb://` scope still fails closed under the `grep-tool` capability
