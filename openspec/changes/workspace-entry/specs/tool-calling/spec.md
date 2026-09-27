## MODIFIED Requirements

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5 set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`, `external_send`, `financial_or_sensitive`, `admin`, `unverified`). The loop SHALL execute allowlisted `read_only` tools and exact code-owned tools registered by an approved alpha-native capability only when the executing process's `tools.permissions` policy also allows the invocation. MCP tools SHALL declare `unverified`; their eligibility SHALL be determined by an admitted MCP declaration whose exact id matches either an exact `tools.allowed` entry or a validated namespace rule, not by a `read_only` classification. An MCP invocation SHALL execute only when its source is allowlisted and the executing process's `tools.permissions` policy allows that invocation. The initial native set is `read` classified `read_only`, plus `edit` and `write` classified `write_low_risk`; later native capabilities such as Knowledge submit or bash must declare their own exact tools and retry policy. Classification alone SHALL NOT admit any other write or execution tool. Alpha-native tools carry explicit host authority for absolute paths and owner-scoped Knowledge authority for `kb://` locators; they are not a general permission engine, and their host authority SHALL NOT grant authority to MCP tools. The candidate resolver SHALL admit `edit` and `write` when the process has accepted native host authority or has a configured Knowledge root, and SHALL leave them unavailable when it has neither. It SHALL admit `read` whenever `tools.allowed` names it, because skill and web locators need no host authority; an absolute path on a process without accepted native authority still fails closed with `executor_unavailable`. A configured Knowledge root admits only `read`, `edit`, and `write`; `bash`, `enter_workspace`, `exit_workspace`, and every other host-capability tool remain admitted solely by accepted native host authority. The exact host-capability set SHALL include `enter_workspace` and `exit_workspace`; `enter_workspace` SHALL be classified `execute_code`, `exit_workspace` SHALL be classified `write_low_risk`, neither SHALL record a `native.attempt` effect, both SHALL bind the Run to the executing native executor identity like other host tools, and both SHALL be idempotent over Chat state when retried after their state change commits. Every MCP source-inventory, advertisement, executable-binding, and unavailable-state gate SHALL use source admission, `tools.allowed`, and per-call `tools.permissions` as applicable; no MCP gate SHALL require or infer a `read_only` classification or attestation, and an unavailable MCP declaration SHALL retain at most its exact identity for availability disclosure without an executable binding.

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

#### Scenario: Write-capable MCP tool executes under both gates

- **WHEN** an MCP source supplies an admitted write-capable declaration whose exact id matches `tools.allowed`, and the invocation passes the executing process's `tools.permissions` policy
- **THEN** the tool executes despite its `unverified` classification

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

The existing read-only loop may retry a claimable Run from its first step with freshly resolved
worker context only when that Run has no recorded native attempt or MCP dispatch. A retry SHALL
re-resolve its own prompt and its own attempt-local catalog rather than reuse the failed attempt's
preparation, and SHALL compare availability against the same previous committed turn. The failed
attempt's persisted output remains part of the committed record that later turns load. A Run that
has executed an alpha native `edit` or `write` SHALL NOT automatically replay that mutation after a
worker failure, timeout, or unknown settlement. A Run that has dispatched an MCP operation SHALL
likewise not automatically replay that operation. The host SHALL stop the affected Run with
`outcome_unknown` and require a new explicit user/model attempt. Client reconnect SHALL replay
recorded tool activity without executing the mutation or MCP operation again. A redelivered Run
carrying any recorded `native.attempt` SHALL fail as `outcome_unknown` without replaying its loop;
this recovery rule has no native-executor or `workerId` precondition. Before terminal settlement,
each open call with a matching durable `native.result` SHALL be settled from that result regardless
of tool source; an open call without a matching result SHALL settle as `outcome_unknown`.
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

- **WHEN** a client reconnects to a live run after tool steps have completed
- **THEN** replay reconstructs those steps from durable events without executing a native mutation again

#### Scenario: Worker failure does not replay a native mutation

- **WHEN** a worker fails after a native mutation or MCP dispatch may have started but before its result is known
- **THEN** the effect is settled as `outcome_unknown` and the Run stops
- **AND** a queue retry does not invoke that mutation or MCP operation again

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** a read-only Run's job is retried by the queue, the Run is still claimable, and no `native.attempt` is recorded
- **THEN** its tool loop executes from the first step again
- **AND** it may re-invoke read-only tools already invoked in the previous attempt

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** a job is retried for a Run that has already reached a terminal state
- **THEN** the Run is not reopened, no tool executes, and its terminal state stands

#### Scenario: Read-only retry remains unchanged

- **WHEN** a claimable Run contains only read-only tools, has no recorded `native.attempt`, and its job retries
- **THEN** the existing read-only retry behavior remains available
- **AND** no native mutation is inferred from the read-only result

## REMOVED Requirements

### Requirement: Each execution attempt applies the fail-closed operator availability gate

**Reason**: Its text and scenarios stated that MCP tools are limited to operator-attested read-only operations; this change retires that attestation, so the scenarios that named it cannot be retained.

**Migration**: Replaced by "Each execution attempt applies the operator availability gate and per-call permission", which keeps every other rule and scenario and makes `tools.permissions` the authorization gate for MCP invocations.

### Requirement: First tool is internal, read-only, own-data

**Reason**: Its text and scenarios stated that MCP tools are limited to operator-attested read-only operations; this change retires that attestation, so the scenarios that named it cannot be retained.

**Migration**: Replaced by "Code-owned tools stay internal and own-data while MCP is the only external-tool path", which keeps every other rule and scenario and makes `tools.permissions` the authorization gate for MCP invocations.

## ADDED Requirements

### Requirement: Each execution attempt applies the operator availability gate and per-call permission

Tool eligibility SHALL be governed by the operator allowlist in `llame.config.json` (`tools.allowed`). The default SHALL be an empty allowlist — an instance with no tools configured runs exactly as before this change (no tools advertised, none executable). The system SHALL first construct its source-owned inventory from registered code-owned tools and the safely admitted current or remembered-unavailable MCP inventory, then apply `tools.allowed` strictly as a boolean permission predicate over each candidate's canonical `tool.id`. Code-owned ids SHALL require exact entries. A canonical MCP id SHALL match either the same exact entry or a validated namespace rule `mcp__<server>__*` whose terminal `*` is removed for literal ID-prefix comparison. Matching SHALL be case-sensitive. The validated trailing separator SHALL prevent one server prefix from matching a longer server id, and the reserved `mcp__` namespace SHALL prevent matching code-owned tools. Permission rules SHALL NOT create, copy, expand, or deduplicate candidates. A tool that matches no rule SHALL be neither advertised to the model nor executed if requested.

Exact and namespace MCP entries SHALL grant eligibility only to exact identities learned from safely admitted declarations for that source. A valid MCP id or namespace rule SHALL NOT require a configured server to exist when the allowlist is validated. When a live process loses the server transport, the last completely admitted identity set SHALL remain source inventory in an unavailable state; when complete discovery succeeds, its newly admitted identity set SHALL replace the prior set authoritatively. Neither permission form SHALL fabricate identities before first successful discovery or expose refused declarations. An eligible dynamic tool SHALL become advertisable only while the source supplies a currently admitted declaration for that exact id matching the allowlist. Its invocation SHALL execute only when the executing process's `tools.permissions` policy allows it; MCP classification, including `unverified`, SHALL neither replace nor bypass either gate.

The executing worker's restart-applied allowlist SHALL filter exact ids and declarations into attempt-local memory when each execution attempt is prepared; wildcard patterns SHALL NOT enter provider requests, manifests, receipts, persistence, or execution binding. After a worker restart, changed exact or namespace rules SHALL apply to its next attempt, including a retry of an already scheduled Run. Declarations SHALL remain fixed within that attempt except that a trusted in-Run Workspace entry action SHALL add each Workspace declaration that passes the same source, allowlist, classification, and schema checks as attempt composition; a Workspace exit, switch, or detach SHALL retain those declarations in the attempt-local catalog while making their executors unavailable, as required by the dynamic-tool failure behavior. The executing process SHALL additionally apply its startup-loaded `tools.permissions` policy to each new invocation, including calls from older Runs. Hot policy reload remains outside this capability; operator changes require a restart. Remote MCP tools SHALL be executable only for a currently admitted declaration selected by the allowlist and only when `tools.permissions` allows the invocation. No `read_only` attestation or idempotence claim SHALL substitute for either gate.

Before invoking an MCP operation, the executing worker SHALL durably append a `native.attempt`
event through the same owner-scoped recovery path used for native mutation attempts, with
`operation: "mcp"` and the MCP tool id in its path field. If the worker is interrupted after that
record and before a durable `native.result`, the dispatch outcome SHALL be `outcome_unknown` and
the Run SHALL stop rather than continue its loop. On redelivery, any Run carrying a recorded
`native.attempt` SHALL fail as `outcome_unknown` without replaying the loop; this has no
native-executor or `workerId` precondition. Any open call with a matching durable `native.result`
SHALL be settled from that result regardless of tool source.

#### Scenario: Default is no tools

- **WHEN** the operator config does not set `tools.allowed`
- **THEN** runs never advertise or execute any tool

#### Scenario: Unlisted tool is not advertised

- **WHEN** a registered code-owned tool or discovered dynamic tool matches neither an exact entry nor an MCP namespace wildcard
- **THEN** it does not appear in the toolset offered to the model

#### Scenario: Unlisted tool is refused

- **WHEN** the model requests a tool that matches neither an exact entry nor an MCP namespace wildcard in the current attempt's validated allowlist
- **THEN** the call is refused with a recorded, non-fatal tool error and the run continues

#### Scenario: Unknown tool id in the allowlist fails boot

- **WHEN** `tools.allowed` names an id that is neither registered in code nor a grammar-valid MCP exact id or namespace wildcard
- **THEN** startup fails naming the offending config path and id
- **AND** a grammar-valid MCP id or namespace wildcard does not need to name a configured server

#### Scenario: Eligible dynamic tool can remain unavailable

- **WHEN** a previously admitted MCP identity still matches an exact or namespace permission but its live process loses the server transport
- **THEN** unrelated Runs remain usable and the filtered identity is recorded as unavailable
- **AND** that tool is not advertised or executable for newly prepared attempts

#### Scenario: Permission does not create a fresh-offline identity

- **WHEN** a fresh process has no admitted or remembered MCP inventory and `tools.allowed` names an exact id or namespace from that source
- **THEN** the permission produces no runtime candidate or availability-state entry

#### Scenario: Complete discovery removes omitted identities

- **WHEN** successful complete discovery omits or refuses a previously admitted exact identity
- **THEN** the new source inventory no longer contains that identity
- **AND** the next execution attempt treats it as absent even when an exact or namespace permission would match it

#### Scenario: Namespace wildcard admits future exact ids

- **WHEN** an MCP source later supplies a safely admitted canonical tool id within its allowlisted namespace
- **THEN** the next execution attempt may bind and advertise that exact id without an instance-config change
- **AND** no wildcard pattern appears in the database or provider request

#### Scenario: Overlapping rules filter one inventory candidate once

- **WHEN** one exact MCP id is selected by both its exact entry and its server namespace wildcard
- **THEN** filtering retains the original inventory candidate once without creating another candidate

#### Scenario: Permission filtering does not hide source collisions

- **WHEN** distinct source candidates collide and both match one or more permission rules
- **THEN** both candidates reach the existing collision refusal unchanged rather than being deduplicated by permission matching

#### Scenario: Later allowlist removal applies to the next execution attempt

- **WHEN** an exact entry or namespace rule is removed from a worker's restart-applied configuration after a Run was scheduled
- **THEN** its next attempt, including a retry, omits tools no longer admitted
- **AND** the earlier attempt's catalog is never recovered from the database

#### Scenario: Queue retry does not replay a dispatched MCP operation

- **WHEN** a worker fails after the MCP dispatch attempt was durably recorded before invocation and
  the operation's result is unknown
- **THEN** the Run stops with `outcome_unknown` and does not replay its tool loop
- **AND** a queue retry does not invoke that MCP operation again

#### Scenario: Permission reject does not hide a tool

- **WHEN** a tool remains admitted by `tools.allowed` and its execution permission group rejects every call
- **THEN** permission evaluation does not remove it from the attempt-local catalog or availability state
- **AND** attempted calls receive a non-fatal `permission_denied` observation

#### Scenario: Missing permission does not hide an allowlisted MCP tool

- **WHEN** an MCP tool remains admitted by `tools.allowed` but no applicable `tools.permissions` group allows its invocation
- **THEN** permission evaluation does not remove it from the attempt-local catalog or availability state
- **AND** an attempted call receives a non-fatal `permission_denied` observation and does not execute

### Requirement: Code-owned tools stay internal and own-data while MCP is the only external-tool path

The first code-owned tool SHALL remain conversation search over the requesting user's own chats, implemented against the **same server-side search service the web chat search uses**. Code-owned tools SHALL take authorization identity only from trusted Run context and SHALL remain tenant-scoped by datastore enforcement.

MCP tools MAY perform reads or other operations on external systems only through the `mcp-tools` capability, on either transport: a remote Streamable HTTP endpoint, or a local server llame runs as a child process. The operator SHALL explicitly configure the source, or permit entry into a Workspace whose MCP configuration supplies it, and SHALL allowlist each executable namespaced tool exactly or allowlist that server's namespace. An exact entry or namespace wildcard SHALL determine eligibility for matching, safely admitted MCP declarations; neither SHALL attest that an operation is read-only. The executing process's `tools.permissions` policy SHALL authorize each invocation. MCP execution SHALL receive no llame tenant authorization context, and an operator-configured server SHALL receive no credential beyond what the operator configured for that server — request headers for a remote server, declared environment values and arguments for a local one. A Workspace MCP server is an explicit exception to that source-bound credential statement: its configuration MAY interpolate values from the executing process's environment and filesystem, including llame's own process environment; this is an accepted risk of permitting entry into an audited repository, and the resolved values remain subject to the protections of `mcp-tools`. A local server additionally executes with the host privileges of the llame process itself, which the operator accepts by configuring it; llame bounds the protocol it speaks, not what the program does. The operator MAY allowlist write, send, delete, execute, financial, or administrative MCP operations, but each such invocation still requires an applicable `tools.permissions` allow; llame does not infer or verify semantic effects from MCP metadata.

#### Scenario: Conversation search over own chats

- **WHEN** the model invokes the conversation-search tool with a query
- **THEN** it returns matches only from chats owned by the run's owner

#### Scenario: Tool and UI search share one implementation

- **WHEN** the conversation-search tool and the web chat search execute the same query for the same user
- **THEN** both are served by the same underlying search service

#### Scenario: No external network egress from tools

- **WHEN** the shipped code-owned toolset is enumerated
- **THEN** none performs outbound network requests
- **AND** the only external-tool exception is an operator-permitted MCP tool from either an explicitly configured operator server or a successfully entered Workspace MCP server, selected by an exact entry or matching namespace wildcard and authorized by `tools.permissions`

#### Scenario: Explicit MCP tools are the only external-tool exception

- **WHEN** the shipped toolset is enumerated
- **THEN** external network tools are limited to explicitly configured operator MCP ids or MCP ids supplied by a successfully entered Workspace, matching the operator's exact or namespace allowlist and authorized by `tools.permissions`
- **AND** no remote tool receives llame's trusted tenant datastore context

### Requirement: Trusted in-Run tool additions are admitted and made unavailable with Workspace state

Only a trusted harness action entering a Workspace SHALL add tool declarations to the active
attempt; model output or an untrusted tool source SHALL NOT add declarations directly. Each
addition SHALL pass the same source admission, `tools.allowed`, safety-classification, and
schema-admission checks as declarations composed at attempt start, and each invocation SHALL
independently pass the executing process's `tools.permissions` policy. An admitted addition SHALL
become callable beginning with the next model step in that Run. The active attempt's model-facing
declaration map and executable binding SHALL be updated in place. The declaration key SHALL never
be removed from that attempt during the Run. A Workspace exit, switch, or detach SHALL make the
corresponding executor unavailable while retaining its declaration; a later request for that id
SHALL be refused as unavailable, recorded as a non-fatal tool refusal, and SHALL NOT execute or
substitute a changed contract. Adding tools SHALL NOT reset, increase, or bypass the configured
tool-step cap.

If an entering Workspace server's id is byte-equal to an operator server id whose tools are already
declared in the active attempt, the Workspace server SHALL contribute no tools to that attempt. The
entry result SHALL identify those tools as "shadows from the next Run"; the operator declarations
SHALL retain their executors for the rest of that attempt. From the next attempt that composes the
live binding, including a retry attempt of the same Run, the started Workspace server SHALL shadow
the operator server under the same tool ids and exact-id permission groups.

If a Workspace server's id differs from an operator server id only by ASCII case, the Workspace
server SHALL be reported unavailable with reason "case-only collision with an operator server",
SHALL contribute no tools, and SHALL leave the operator tools unaffected.

When a trusted Workspace action re-adds an id already present in the active attempt, including after
exit then re-entry or a switch between roots defining that id, the new executor SHALL be bound only
when the newly admitted declaration is identical to the retained declaration as compared in memory;
nothing SHALL be persisted for that comparison. If the declarations differ, that id SHALL have no
executor in this attempt and the entry result SHALL report it as "available from the next Run".
Declarations SHALL never be replaced or removed within the attempt.

Tool availability SHALL be resolved at runtime rather than declared as a scheduling-time
restriction. At the start of each attempt, the Run SHALL compose current Workspace tools from the
live binding, and each active step SHALL use its current in-memory declarations. Added declarations
SHALL exist only in the active attempt's memory; nothing about them SHALL be persisted as a Run
record. A subsequent attempt for a Chat that remains entered, including a retry of the same Run,
SHALL resolve current Workspace declarations from the live binding at its start, independent of
prior attempt or Run state.

#### Scenario: Workspace entry makes an admitted tool callable on the next step

- **WHEN** a trusted harness action enters a Workspace during a Run and its MCP source supplies a declaration that passes the same admission checks used at attempt composition
- **THEN** the declaration is added to the active tool set and can be called beginning with the next model step
- **AND** calls remain subject to the executing process's `tools.permissions` policy
- **AND** the addition does not reset, increase, or bypass the configured tool-step cap

#### Scenario: Workspace exit or switch removes an added tool executor

- **WHEN** a Workspace exit, switch, or detach makes an MCP declaration that was added during the active Run unavailable and the model later requests that id
- **THEN** the declaration remains in the attempt-local tool set with an unavailable executor, and the call is refused as unavailable without executing or substituting a changed contract
- **AND** the refusal is recorded and non-fatal to the Run

#### Scenario: Subsequent attempt composes active Workspace tools from its start

- **WHEN** a subsequent attempt starts for a Chat that remains entered, including a retry of the same
  Run, and a Workspace MCP declaration is currently admitted
- **THEN** the declaration is in the attempt's tool set before the first model step
- **AND** the attempt resolves it from the live Workspace binding rather than from prior Run state

#### Scenario: Mid-Run Workspace shadowing is deferred

- **WHEN** an entering Workspace server's id is byte-equal to an operator server id whose tools are already declared in the active attempt
- **THEN** the Workspace server contributes no tools in that attempt, the entry result reports "shadows from the next Run", and the operator tools keep their executors
- **AND** the next attempt, including a retry of the same Run, uses the started Workspace server under the same tool ids and exact-id permission groups without collision-refusing the operator tools

#### Scenario: ASCII-case-only Workspace server collision is unavailable

- **WHEN** an entering Workspace server's id differs from an operator server id only by ASCII case
- **THEN** the Workspace server is reported unavailable with reason "case-only collision with an operator server", contributes no tools, and leaves the operator tools unaffected

#### Scenario: Re-adding a retained declaration requires an identical declaration

- **WHEN** a trusted Workspace action exits and re-enters, or switches between roots, and the new source admits an id already present in the active attempt
- **THEN** the new executor is bound only when the newly admitted declaration is identical to the retained declaration as compared in memory
- **AND** if the declaration differs, that id has no executor in this attempt and the entry result reports it as "available from the next Run"
- **AND** the retained declaration key is neither replaced nor removed
