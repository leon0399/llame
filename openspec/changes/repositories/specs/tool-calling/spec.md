# Spec Delta

## MODIFIED Requirements

### Requirement: Tool registry with mandatory safety classification

Every registered tool MUST declare a safety classification from the SPEC §13.5
set. That set contains `read_only`, `write_low_risk`, `write_high_risk`,
`execute_code`, `external_send`, `financial_or_sensitive`, `admin`, and
`unverified`. The loop MUST execute an allowlisted `read_only` tool only when
the `tools.permissions` policy of that process also allows the invocation. The
loop MUST execute an exact code-owned tool that an approved alpha-native
capability registers only under the same condition.

An MCP tool MUST declare `unverified`. The system MUST determine its eligibility
by an admitted MCP declaration. The exact id of that declaration MUST match an
exact `tools.allowed` entry or a validated namespace rule. A `read_only`
classification MUST NOT determine that eligibility. An MCP invocation MUST
execute only when its source is allowlisted. The `tools.permissions` policy of
the process that executes it MUST also allow that invocation.

The initial native set is `read` and `grep` with `read_only`, plus `edit` and
`write` with `write_low_risk`. A later native capability, such as bash, MUST
declare its own exact tools and its own retry policy. A classification alone
MUST NOT admit any other write tool or execution tool.

An alpha-native tool carries explicit host authority for absolute paths. It also
carries owner-scoped Knowledge authority for `kb://` locators. `read` alone
carries owner-scoped, read-only media authority for `media://` locators. That
authority resolves only the media of the Run owner. These tools are not a
general permission engine. Their host authority MUST NOT grant authority to MCP
tools.

The candidate resolver MUST admit `edit` and `write` when the process accepted
native host authority or has a configured Knowledge root. It MUST leave them
unavailable when the process has neither. It MUST admit `read` whenever
`tools.allowed` names it. Skill, web, and `media://` locators need no host
authority. An absolute path on a process without accepted native authority MUST
still fail closed with `executor_unavailable`. It MUST admit `grep` when the
process accepted native host authority.

It MUST also admit `grep` when it has a configured Knowledge root, operator
skill source, or Machine. It MUST leave `grep` unavailable when the process has
none of these. The `grep-tool` capability owns the scope and the admission rules
of that tool. A configured Knowledge root admits only `read`, `grep`, `edit`,
and `write`. Accepted native host authority alone admits `bash`,
`enter_workspace`, `exit_workspace`, and every other host-capability tool.

The exact host-capability set MUST include `enter_workspace` and
`exit_workspace`. `enter_workspace` MUST have the `execute_code` classification,
and `exit_workspace` MUST have the `write_low_risk` classification. Both MUST
bind the Run to the native executor identity that executes them, like other host
tools. An `enter_workspace` call that carries a `worktree` object MUST append a
`native.attempt` with the `worktree` operation before it calls
`git.worktreeAdd`. It MUST append the `native.result` of that attempt in the
transaction that stores the worktree rows and the bound root. A redelivered Run
that carries that attempt MUST fail as `outcome_unknown` under the canonical
rule for a recorded `native.attempt`.

A known worktree failure MUST append its typed `native.result` in its own
transaction. A known failure writes no worktree, catalog, lease, or binding row.
A git error, a refusal, and a classified timeout are known failures. The
`native.result` MUST stay absent only for a genuinely unknown outcome.

The system MUST NOT retry that call idempotently. A redelivered Run MUST NOT
replay its loop and MUST NOT create a second worktree. An `exit_workspace` call
MUST NOT record a `native.attempt`. An `enter_workspace` call without a
`worktree` object MUST NOT record one either. Both calls MUST stay idempotent
over Chat state when a retry follows the commit of their state change.

Every MCP gate for source inventory, advertisement, executable bind, and
unavailable state MUST use source admission, `tools.allowed`, and per-call
`tools.permissions` as applicable. An MCP gate MUST NOT require or infer a
`read_only` classification or attestation. An unavailable MCP declaration MUST
retain at most its exact identity for availability disclosure, without an
executable bind.

The `mcp__` tool-id prefix is reserved for ids that the MCP capability produces.
A code-owned entry or another non-MCP registry entry with that prefix MUST fail
registration. A permission match on the id alone then cannot grant authority
across source kinds.

#### Scenario: Read-only tool executes

- **WHEN** the model calls an allowlisted tool with the `read_only`
  classification, and the invocation passes the execution permission policy
- **THEN** the tool executes

#### Scenario: Alpha native file tool executes only in its host capability

- **WHEN** `tools.allowed` names an exact code-owned native host tool, such as
  `enter_workspace` or `exit_workspace`, and the trusted host capability of that
  tool is present
- **AND** the invocation passes the execution permission checks
- **THEN** the tool executes with the host authority that the capability declares
- **AND** the system does not substitute it with a hosted path or a remote MCP
  operation

#### Scenario: Native tools are admitted by Knowledge root alone

- **WHEN** a process has a configured Knowledge root, no `tools.nativeExecutorId`,
  and `tools.allowed` with `read`, `edit`, and `write`
- **THEN** the system advertises the three tools for `kb://` locators
- **AND** each call executes only when its `tools.permissions` policy allows it
- **AND** a call without an allow match receives `permission_denied`
- **AND** an absolute path fails closed with `executor_unavailable`

#### Scenario: Read is admitted by the allowlist alone

- **WHEN** a process has no `tools.nativeExecutorId`, no configured Knowledge
  root, and `tools.allowed` with `read`, `edit`, and `write`
- **THEN** the system advertises `read`, and `read` serves web locators under its
  permission policy
- **AND** the system does not advertise `edit` and does not execute it
- **AND** the system does not advertise `write` and does not execute it
- **AND** an absolute-path `read` fails closed with `executor_unavailable`

#### Scenario: Knowledge root does not admit bash

- **WHEN** a process has a configured Knowledge root, no `tools.nativeExecutorId`,
  and `tools.allowed` with `bash`
- **THEN** the system does not advertise `bash` and does not execute it
- **AND** the Run manifest records it unavailable exactly as before this change

#### Scenario: Non-read-only tool is refused even when allowlisted

- **WHEN** a non-MCP tool has a classification other than `read_only`, and it is
  outside the exact approved host-capability set
- **AND** the tool is registered and allowlisted, and the model requests it
- **THEN** the system does not advertise the tool and does not execute it
- **AND** a direct request receives a recorded non-fatal refusal

#### Scenario: Unclassified tool cannot register

- **WHEN** a tool without a classification is registered
- **THEN** registration fails at startup

#### Scenario: Duplicate tool id cannot register

- **WHEN** two tools register the same id
- **THEN** registration fails at startup and names the id

#### Scenario: Code-owned tool cannot occupy the MCP namespace

- **WHEN** a code-owned registry entry has an id that starts with `mcp__`
- **THEN** registration fails at startup and names the reserved prefix

#### Scenario: Write-capable MCP tool executes under both gates

- **WHEN** an MCP source supplies an admitted write-capable declaration, and its
  exact id matches `tools.allowed`
- **AND** the invocation passes the `tools.permissions` policy of the process
  that executes it
- **THEN** the tool executes despite its `unverified` classification

#### Scenario: Read serves media locators without host or Knowledge authority

- **WHEN** a process has no `tools.nativeExecutorId` and no configured Knowledge
  root, and `tools.allowed` names `read`
- **AND** the Run owner reads `media://<id>` of an image that the owner holds
- **THEN** `read` returns the image result when its permission policy allows the
  call
- **AND** a call without an allow match receives `permission_denied`

#### Scenario: Media authority does not cross owners

- **WHEN** the Run of user A reads `media://<id>` of an image that user B owns,
  under a policy that allows the locator text
- **THEN** the call returns `not_found`, exactly as for an id that does not exist
- **AND** no bytes or descriptor fields of the image of user B reach user A

#### Scenario: Media authority is read-only

- **WHEN** `edit` or `write` targets a `media://` locator
- **THEN** the call returns the current unsupported-operation error
- **AND** no media object changes and no stored variant changes

#### Scenario: Grep is admitted by any serving backend

- **WHEN** `tools.allowed` names `grep`, and the process has a configured skill
  source but no native executor, no Knowledge root, and no Machine
- **THEN** the system advertises `grep`
- **AND** a host scope returns `executor_unavailable`
- **AND** a `kb://` scope returns `knowledge_space_unavailable`

#### Scenario: A worktree entry records one worktree attempt

- **WHEN** an `enter_workspace` call carries a `worktree` object
- **THEN** the worker appends a `native.attempt` with the `worktree` operation
  before it calls `git.worktreeAdd`
- **AND** it appends the `native.result` of that attempt in the transaction that
  stores the worktree rows and the bound root
- **AND** a redelivery of that Run fails as `outcome_unknown` without a replay of
  the loop and creates no second worktree

#### Scenario: A plain entry and an exit stay idempotent

- **WHEN** an `enter_workspace` call carries no `worktree` object, or an
  `exit_workspace` call occurs
- **THEN** the call records no `native.attempt`
- **AND** a retry after the commit of its state change succeeds idempotently
  over Chat state
