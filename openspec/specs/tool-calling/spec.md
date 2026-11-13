# tool-calling

## Purpose

The durable tool loop interleaves model output with operator-allowlisted tools
and the exact configured native file capability. Datastore operations stay
owner-scoped under RLS; native file operations use explicitly accepted host OS
authority. Tool activity persists for replay. Native mutations have durable
pre-effect fencing and an unknown outcome stops the Run. A startup-loaded
operator allow/reject permission policy gates each invocation, including
unverified MCP tools; an interactive approval workflow remains separate work.

## Requirements

### Requirement: Multi-step tool-calling run loop

The run executor MUST support multi-step Runs. When the model requests tool invocations, the loop
MUST execute them and append their results to the model context of the Run. It MUST continue the
same Run until the model gives a final answer, or until a configured step cap is reached. Without
a configured cap, the loop puts no limit on the number of steps. A step is one model turn that
requested one or more tools. Independent read-only calls can execute at the same time. Calls that
change the same native file path MUST execute one after the other, in the order that the provider
sent them. Each of these calls MUST give its own call part and result part.

The loop MUST count the step cap per segment of the Run, as `run-steering` defines segments. Each
segment starts with a count of zero. The loop MUST evaluate the cap per step, atomically: the
turn that reaches the cap executes all accepted calls. The loop stays queue-processed and
durable.

#### Scenario: Model calls a tool and continues

- **WHEN** the model requests an available tool with valid arguments
- **THEN** the tool executes, its result enters the model context, and the model continues

#### Scenario: Multiple sequential tool steps

- **WHEN** the model makes several tool turns, one after the other, in one Run
- **THEN** each executes in order, and the context keeps every call and result

#### Scenario: Independent read-only calls can run concurrently

- **WHEN** the model requests independent read-only calls in one turn
- **THEN** they can execute at the same time, and the step counter increases by one

#### Scenario: Parallel tool calls within one turn count as one step

- **WHEN** the model requests three independent read-only tool calls in one turn
- **THEN** all three can execute at the same time, each with its own call part and result part
- **AND** the step counter increases by one

#### Scenario: Same-path native mutations are serialized

- **WHEN** one model turn requests two native mutations of the same absolute path
- **THEN** they execute one after the other in the order of the provider
- **AND** the later call reads the bytes that the earlier call wrote

#### Scenario: The cap-reaching step completes atomically

- **WHEN** the step cap is 8, seven steps ran, and the model requests three calls in its eighth tool turn
- **THEN** all three accepted calls execute before the loop refuses further tools

#### Scenario: Step cap reached fails closed to answering

- **WHEN** a segment of a Run reaches the configured maximum of tool steps
- **THEN** no further calls execute, and the system drives the model to answer from what it has
- **AND** the Run records the cap in its events, and the segment ends with that answer

#### Scenario: No step cap unless configured

- **WHEN** no step cap is configured, and the model requests tools across many turns
- **THEN** every accepted step executes
- **AND** the Run continues until the model answers, the owner cancels, or another `durable-runs` rule ends it
- **AND** no cap marker is recorded

#### Scenario: A delivered message restarts the step count

- **WHEN** the step cap is 8, the first segment of a Run used 8 steps, and a steer starts a second segment
- **THEN** the second segment can execute 8 tool steps before the cap applies

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
that carries that attempt MUST still fail as `outcome_unknown` under the
canonical rule for a recorded `native.attempt`.

A known worktree failure MUST append its typed `native.result` in its own
transaction. A known failure writes no worktree, catalog, lease, or binding row.
A git error, a refusal, and a classified timeout are known failures. The
`native.result` MUST stay absent only for a genuinely unknown outcome. A
redelivered Run whose attempt has a durable `native.result` MUST settle its open
worktree call from that result under the canonical settlement rule. The recorded
result MUST remain the settlement source for that call.

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

#### Scenario: A recorded worktree result settles a redelivered call

- **WHEN** a worktree attempt recorded its typed `native.result`, and the Run is
  redelivered
- **THEN** the Run fails as `outcome_unknown` without a replay of the loop
- **AND** its open worktree call settles from the recorded `native.result`
- **AND** no second worktree is created

#### Scenario: A plain entry and an exit stay idempotent

- **WHEN** an `enter_workspace` call carries no `worktree` object, or an
  `exit_workspace` call occurs
- **THEN** the call records no `native.attempt`
- **AND** a retry after the commit of its state change succeeds idempotently
  over Chat state

### Requirement: Each execution attempt applies the operator availability gate and per-call permission

Tool eligibility SHALL be governed by the operator allowlist in `llame.config.jsonc` (`tools.allowed`). The default SHALL be an empty allowlist — an instance with no tools configured runs exactly as before this change (no tools advertised, none executable). The system SHALL first construct its source-owned inventory from registered code-owned tools and the safely admitted current or remembered-unavailable MCP inventory, then apply `tools.allowed` strictly as a boolean permission predicate over each candidate's canonical `tool.id`. Code-owned ids SHALL require exact entries. A canonical MCP id SHALL match either the same exact entry or a validated namespace rule `mcp__<server>__*` whose terminal `*` is removed for literal ID-prefix comparison. Matching SHALL be case-sensitive. The validated trailing separator SHALL prevent one server prefix from matching a longer server id, and the reserved `mcp__` namespace SHALL prevent matching code-owned tools. Permission rules SHALL NOT create, copy, expand, or deduplicate candidates. A tool that matches no rule SHALL be neither advertised to the model nor executed if requested. Every per-call `tools.permissions` evaluation in this capability governs an attempt whose effective permission mode is `default`; an attempt whose effective mode is `bypass` admits the invocation without evaluating any `tools.permissions` group, as `tool-call-permissions` defines, while the `tools.allowed` eligibility gate applies unchanged.

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

### Requirement: Tenant-scoped tool execution

Every datastore access a tool performs SHALL run inside the run owner's tenant transaction (`runAs(ownerUserId)`, RLS-enforced) — a tool can never read or write another tenant's rows, enforced at the datastore, not by tool-author discipline. Tool execution with no established owner identity SHALL fail closed (the tool errors; nothing is read).

#### Scenario: Tool reads only the owner's data

- **WHEN** a tool queries data while executing in user A's run, and matching rows exist for user A and user B
- **THEN** only user A's rows are visible to the tool

#### Scenario: Cross-tenant access is denied at the datastore

- **WHEN** a tool attempts to read a specific resource owned by another tenant
- **THEN** the datastore returns no rows, independent of application-layer checks

#### Scenario: Absent identity fails closed

- **WHEN** tool execution is attempted without a resolvable run owner
- **THEN** the tool call fails with an error and performs no reads

### Requirement: Code-owned tools stay own-data, and web read and web search are the only code-owned web tools

The first code-owned tool SHALL remain conversation search over the requesting user's own chats, implemented against the **same server-side search service the web chat search uses**. Code-owned tools SHALL take authorization identity only from trusted Run context and SHALL remain tenant-scoped by datastore enforcement.

MCP tools MAY perform reads or other operations on external systems only through the `mcp-tools` capability, on either transport: a remote Streamable HTTP endpoint, or a local server llame runs as a child process. The operator SHALL explicitly configure the source, or permit entry into a Workspace whose MCP configuration supplies it, and SHALL allowlist each executable namespaced tool exactly or allowlist that server's namespace. An exact entry or namespace wildcard SHALL determine eligibility for matching, safely admitted MCP declarations; neither SHALL attest that an operation is read-only. The executing process's `tools.permissions` policy SHALL authorize each invocation. MCP execution SHALL receive no llame tenant authorization context, and an operator-configured server SHALL receive no credential beyond what the operator configured for that server — request headers for a remote server, declared environment values and arguments for a local one. A Workspace MCP server is an explicit exception to that source-bound credential statement: its configuration MAY interpolate values from the executing process's environment and filesystem, including llame's own process environment; this is an accepted risk of permitting entry into an audited repository, and the resolved values remain subject to the protections of `mcp-tools`. A local server additionally executes with the host privileges of the llame process itself, which the operator accepts by configuring it; llame bounds the protocol it speaks, not what the program does. The operator MAY allowlist write, send, delete, execute, financial, or administrative MCP operations, but each such invocation still requires an applicable `tools.permissions` allow; llame does not infer or verify semantic effects from MCP metadata.

Code-owned tools MAY reach external networks only as their own capabilities define. Two of them are dedicated web tools, fetching or searching external content on the model's behalf: native `read` on an `http:` or `https:` locator, including its operator-declared adapter targets, under `native-file-tools`, and `web_search`, through operator-configured engines, under `web-search`. Each SHALL be authorized per call by `tools.permissions` before any request and SHALL receive no llame tenant datastore context. Host `bash` executes with the llame process's own network access under `bash-execution`, and a search tool that embeds its query sends it to the operator's embedding provider under `search-embeddings`. A `web-search` engine MAY call a vendor MCP tool as its internal transport under `web-search`; that tool is never declared to the model and is not an MCP tool of `mcp-tools`.

#### Scenario: Conversation search over own chats

- **WHEN** the model invokes the conversation-search tool with a query
- **THEN** it returns matches only from chats owned by the run's owner

#### Scenario: Tool and UI search share one implementation

- **WHEN** the conversation-search tool and the web chat search execute the same query for the same user
- **THEN** both are served by the same underlying search service

#### Scenario: No external network egress from tools

- **WHEN** the shipped code-owned toolset is enumerated
- **THEN** none is a dedicated web-fetch or web-search tool except native `read` on an `http:` or `https:` locator and `web_search`, while host `bash` keeps the process's network access under `bash-execution`
- **AND** each of those two sends a request only after its `tools.permissions` decision allows the call
- **AND** beyond those two code-owned tools, the only external-tool exception is an operator-permitted MCP tool from either an explicitly configured operator server or a successfully entered Workspace MCP server, selected by an exact entry or matching namespace wildcard and authorized by `tools.permissions`

#### Scenario: Explicit MCP tools are the only external-tool exception

- **WHEN** the shipped toolset is enumerated
- **THEN** external network tools are limited to explicitly configured operator MCP ids or MCP ids supplied by a successfully entered Workspace, matching the operator's exact or namespace allowlist and authorized by `tools.permissions`, plus the code-owned native `read` and `web_search` tools when allowlisted and authorized by `tools.permissions`
- **AND** no remote tool receives llame's trusted tenant datastore context

### Requirement: Durable, replayable tool activity

Tool calls and results SHALL persist as structured parts on the assistant message and stream as run events, with the same durability and replay guarantees as text/reasoning: a client that reconnects or refreshes mid-tool-execution SHALL reconstruct the full tool activity from the event stream/persisted parts. When a run hits the step cap, a structured **cap-marker part** SHALL persist on the assistant message alongside the call/result parts (history loads message parts, not run events — the cap notice must be reconstructable from persistence alone). Public chat sharing SHALL NOT expose tool parts (the existing text-only egress allowlist already excludes them — this requirement pins that it stays true for the new parts).

A newly evaluated call SHALL persist the safe permission-decision metadata defined by `tool-call-permissions` in owner-scoped tool activity and stored tool-part metadata. This metadata SHALL remain outside model replay, public shares, exports, and search; adding it SHALL NOT change the stored tool observation or its ordering. A rejected call SHALL NOT report that an executor started. Required decision-persistence failure SHALL prevent execution rather than allowing an unaudited side effect.

#### Scenario: Tool activity survives refresh

- **WHEN** the user refreshes mid-run while a tool is executing
- **THEN** the resumed stream reconstructs the tool call, its in-progress state, and (once done) its result

#### Scenario: Cap marker persists with the message

- **WHEN** a run hits the step cap and later completes
- **THEN** the assistant message's persisted parts include the cap marker, and a full chat reload renders the cap notice from it

#### Scenario: Tool parts never reach public shares

- **WHEN** a chat containing tool calls/results is shared publicly
- **THEN** the public payload contains no tool parts

#### Scenario: History preserves a decision without exposing policy content

- **WHEN** the owner reopens a Chat containing a permission-evaluated call after transient Run events have been removed
- **THEN** its stored tool part retains the policy identity and safe decision metadata
- **AND** model history contains only the ordinary call/result observation without that metadata
- **AND** no matched pattern, input fragment, or resolved secret is added to the decision metadata

### Requirement: Tool failure is an observation, not a crash

An uncertain native `edit` or `write` outcome SHALL abort the model execution
signal and settle the Run without further tool steps. Its tool observation SHALL
report `outcome_unknown` unless a known result is already durable.

A live bash or MCP `outcome_unknown` SHALL NOT abort the model execution
signal. It SHALL be recorded, streamed, and visible to the model as a structured
error result that tells the model to inspect the current state before retrying,
and the run SHALL continue. Crash or redelivery recovery that finds a recorded
native or MCP attempt without a durable result remains outside this live path
and keeps its existing terminal settlement.

Ordinary isolated failures retain the continuation behavior below.

A tool that throws, times out, becomes unavailable, dynamically loses its trusted executor, or returns invalid output SHALL produce a structured error result — recorded, streamed, and visible to the model — and the run SHALL continue whenever the failure is isolated to that tool. Tool execution SHALL be bounded by the global `tools.callTimeoutSeconds` (operator config, documented built-in default 120). A trusted per-tool registration MAY only reduce that value and MUST be finite, positive, and no greater than the configured global maximum; an invalid override SHALL fail registration/admission before advertisement. The effective abort signal SHALL be forwarded into the executor and remote transport, and a timed-out MCP request/body SHALL be aborted and cleaned up before the structured timeout result settles. Tool errors SHALL never expose internal stack traces, remote exception bodies, or secrets in the recorded result.

Oversized tool results SHALL be truncated to a documented cap, measured in JavaScript UTF-16 code units over the model-facing rendering of the result, after secret redaction; `tool-result-rendering` defines that rendering as the serialized result for a JSON-rendered tool and the text shape for a text-rendered tool. The stored `display` object MUST NOT count toward the cap, and text the rendering builds from its values MUST count. Truncation SHALL operate on the tool's own payload rather than on the result envelope: the `status` discriminant and every top-level field the tool declared SHALL survive, with values shrunk in place. Where the declared field names alone exceed the cap, the cap SHALL win over the declared shape — trailing fields SHALL be omitted and the marker SHALL state how many of how many — so a result above the cap is never emitted. A string value SHALL be cut only on a Unicode code-point boundary, so no truncated payload contains a lone surrogate. Truncation SHALL NOT re-serialize any part of the payload into a string field, so redaction performed before truncation cannot be defeated by an alternate typed representation. A truncated result SHALL carry one visible truncation marker stating how many characters were omitted and the recovery action available to the model. When truncation shortens a list, the marker SHALL also state how many elements of that list survived out of how many it held, naming the lists that lost the most and counting any remainder, so a count read off a shortened list is not mistaken for a complete one. Error results SHALL NOT be truncated, because every error message this loop produces is a short, statically authored string.

An image in a tool result SHALL be carried without image bytes, so the cap measures only the
result's model-facing rendering; the stored `display.thumbnail` SHALL sit outside the cap and
SHALL be recorded unchanged. Truncation SHALL NOT cut, shorten, or omit the `media` locator of a
`media://` image result: other values SHALL be shrunk and, at the floor, other fields omitted in
its place, so a recorded `media://` image result always names the complete `media://` locator of
the image it carries.

A code-owned tool whose executor is inconsistent with its admitted in-memory id/schema/classification SHALL fail attempt preparation before a provider request. Fresh attempts SHALL resolve from the executing worker's trusted registry; no historical description or template hash SHALL be required. A dynamic source tool that loses its executor, disconnects, or drifts after attempt preparation SHALL instead retain its attempt-local model-facing declaration with an unavailable executor for that Run, so a requested call settles non-fatally without substituting a changed contract.

#### Scenario: Tool error surfaces to the model and the run continues

- **WHEN** an executing tool throws
- **THEN** the model receives a structured error result and may continue

#### Scenario: Live bash unknown continues the Run

- **WHEN** a bash call records `outcome_unknown` while the Run is executing
- **THEN** the model receives that structured error result
- **AND** the model execution signal is not aborted for that unknown
- **AND** the Run continues

#### Scenario: Live MCP unknown continues the Run

- **WHEN** an MCP call records `outcome_unknown` while the Run is executing
- **THEN** the model receives that structured error result
- **AND** the model execution signal is not aborted for that unknown
- **AND** the Run continues

#### Scenario: Uncertain edit or write still aborts

- **WHEN** a native `edit` or `write` outcome is uncertain
- **THEN** the model execution signal is aborted
- **AND** the Run settles without further tool steps

#### Scenario: Tool call times out

- **WHEN** a tool exceeds its effective timeout
- **THEN** execution and any remote request/body are aborted and cleaned up
- **AND** a structured timeout error result is recorded and the run continues

#### Scenario: Invalid trusted timeout override fails admission

- **WHEN** a trusted tool registers a non-finite, non-positive, or above-global timeout override
- **THEN** registration or admission fails before the tool is advertised

#### Scenario: Dynamic executor disappears after enqueue

- **WHEN** a dynamic tool was bound into an attempt but its source disconnects before the model requests it
- **THEN** the call settles as structured `not_available`, no substitute executes, and the Run continues

#### Scenario: Code-owned declaration drift remains fail-closed

- **WHEN** a prepared code-owned declaration has an id/schema inconsistent with its trusted attempt-local executor
- **THEN** the Run fails before the provider request rather than executing a different contract

#### Scenario: Code-owned executor loss remains fail-closed

- **WHEN** a prepared code-owned tool has no compatible trusted executor at execution
- **THEN** the Run fails before the provider request rather than returning a dynamic unavailability observation

#### Scenario: Error results carry no internals

- **WHEN** a tool error result is recorded
- **THEN** it contains a safe message, not a stack trace, raw remote error, or configuration value

#### Scenario: Truncated success result keeps its declared shape

- **WHEN** a successful result renders above the cap
- **THEN** the recorded result keeps `status: "success"` and every top-level field the tool returned, with oversized values shrunk in place rather than replaced by a serialized fragment of the result

#### Scenario: Truncation cuts on a code-point boundary

- **WHEN** the cut point of an oversized string value falls between the halves of a surrogate pair
- **THEN** the truncated value is well-formed and contains no lone surrogate

#### Scenario: Truncation marker states omission and recovery

- **WHEN** a result is truncated
- **THEN** it carries a marker stating the number of omitted characters and that narrowing the call's arguments recovers the omitted content

#### Scenario: Cap outranks declared shape at the floor

- **WHEN** a successful result's top-level field names alone serialize above the cap
- **THEN** trailing fields are omitted so the recorded result still fits the cap
- **AND** the marker states how many fields of how many were omitted entirely

#### Scenario: Shortened list reports what survived

- **WHEN** truncation drops the tail of a list in the payload
- **THEN** the marker names that list and states how many elements were kept of how many it held
- **AND** when more lists were shortened than the marker names, the remainder is counted rather than named

#### Scenario: Error results are never truncated

- **WHEN** a structured error result is produced
- **THEN** it is recorded unchanged regardless of length

#### Scenario: Permission rejection is a non-fatal tool observation

- **WHEN** the execution policy rejects an otherwise valid available tool call
- **THEN** no tool executor or native effect attempt starts
- **AND** the model receives `permission_denied` and may continue within existing Run limits
- **AND** the system neither retries the rejected call automatically nor requests approval

#### Scenario: Truncation keeps an image result's media reference

- **WHEN** a `media://` image result serializes above the cap because another field is oversized
- **THEN** the recorded result carries the complete `media://` locator unchanged
- **AND** the oversized field is shrunk in place and the marker states the omitted characters

#### Scenario: The floor omits other fields before the media reference

- **WHEN** a `media://` image result's top-level field names alone serialize above the cap
- **THEN** fields other than the one carrying the media reference are omitted until the result fits
- **AND** the recorded result still carries the complete `media://` locator

#### Scenario: A thumbnail does not count toward the cap

- **WHEN** an image result's rendering fits the cap and its `display.thumbnail` would exceed it
  were it counted
- **THEN** the result is recorded without truncation
- **AND** its `display.thumbnail` is recorded unchanged

### Requirement: Availability comparison retains only committed tool identities and states

Every Run whose attempt dispatches a model request SHALL retain an
owner/chat-scoped comparison record consisting only of sorted exact tool ids
and each id's `available` or `unavailable` state, associated with that turn's
message/Run. The record SHALL be written in the transaction that dispatches
the attempt's first model request, beside the availability reminder it
accounts for, and SHALL stay whatever the Run's later outcome; a later retry of
the same Run that dispatches SHALL advance it to that retry's observation in
its own dispatch transaction. It SHALL contain
no schema, template, description, declaration/source hash, connection data, or
raw failure detail. This record SHALL NOT be used for tool admission, execution,
or reconstructing historical tool definitions.

Every attempt that compares SHALL read its own Run's stored record when an
earlier attempt of the Run dispatched, and otherwise the record of the most
recent prior dispatched Run within its disclosure epoch, whether that Run later
completed, failed, was cancelled, or expired. A Run counts as dispatched when
it has a stored record, which every dispatch transaction writes even when the
observed state is empty, or, for a Run that predates dispatch-time records,
when it completed; such a completed Run without a record is migrated
non-observation. No observation SHALL remain distinct from an observed empty
record. An attempt that dispatches no model request SHALL not establish or
replace that baseline. The runtime
catalog and safe current reasons SHALL remain in memory; only actual persisted
reminder text may retain its rendered explanation.

#### Scenario: Worker handoff preserves comparisons

- **WHEN** a retry starts in another worker process
- **THEN** it keeps the reminder its Run already stored and compares its fresh runtime state with the id/state record its Run already stored, or, when no attempt of the Run has dispatched, with the same persisted id/state record of the most recent prior Run that dispatched
- **AND** it does not need the previous worker's catalog or an in-memory cross-Run cache

#### Scenario: Existing state is unobserved

- **WHEN** no historical observation exists
- **THEN** the attempt follows initial availability disclosure semantics
- **AND** it does not treat missing observation as an empty historical catalog

#### Scenario: Historical tool catalog storage is removed

- **WHEN** the coordinated migration removes combined context snapshots
- **THEN** only actual observed id/state records are retained for comparison
- **AND** schemas, descriptions, declaration hashes, and raw manifest payloads are not retained through renamed fields

### Requirement: Attempt availability is disclosed against the preceding dispatched turn

The worker SHALL derive availability disclosure from its current attempt's admitted runtime state and a baseline minimal id/state record: the record its own Run already stored when an earlier attempt of the Run dispatched, and otherwise the record of the most recent prior dispatched Run. A Run counts as dispatched when it has a stored id/state record, which every dispatch transaction writes even when the observed state is empty, or, for a Run that predates dispatch-time records, when it completed. It SHALL prepare canonical `tool-availability` context text for this attempt's model request and persist that text on the triggering user message in the transaction that dispatches the attempt's first model request, whatever the Run's later outcome. The persisted text SHALL include the envelope, provenance, disclosure body, and closing delimiter and SHALL be the sole replay authority. The metadata SHALL retain ids, closed reason codes, and the Run/attempt id for machine behavior and provenance; it SHALL NOT retain remote-authored text, URLs, raw errors, or prompt contents. Client-authored availability parts MUST be rejected or discarded under the `context-injection` boundary contract.

For a configured MCP source that is not ready on the executing worker, previously committed exact ids that still match the current allowlist SHALL supplement availability-comparison input, even when the worker has never discovered that source. This SHALL be a separate non-admissible state-only input, never a `TurnToolCandidate` or an input to schema/classification/catalog admission. They SHALL carry only state and the current source's closed unavailable reason, never reconstructed declarations/classifications/executors, and SHALL not make `tools.<id>` true. Removed/disallowed/unconfigured ids are absent; a ready source's complete fresh discovery is authoritative about removal. No never-observed wildcard tool id SHALL be invented.

On the first turn of a model-facing availability disclosure epoch, the reminder SHALL identify only eligible tools that are currently unavailable under the exact heading `Unavailable tools:`; callable tools are already advertised through the provider's native tool declarations on every request and SHALL NOT be duplicated in an initial prose inventory. A fresh conversation SHALL start the first disclosure epoch, and every published checkpoint message SHALL start another under the rail epoch rule that `context-injection` states once. That epoch start stands even when the attempt it preceded later fails. On later turns within the epoch, the system SHALL compare each id's `absent`, `available`, or `unavailable` state between the current attempt's runtime state and that baseline record in that epoch. Each changed id SHALL appear in exactly one group: absent to available as Added tools, available or unavailable to absent as Removed tools, absent to unavailable as Unavailable tools, available to unavailable as Became unavailable, and unavailable to available as Now available. Empty groups SHALL be omitted. `Added tools` SHALL contain only tools callable in the current Run. If availability is unchanged, no availability reminder SHALL be emitted, including while an outage persists.

When an eligible tool keeps the same id and remains available but its canonical declaration changes, the current attempt SHALL advertise its fresh in-memory declaration through the provider's native tool contract. Declaration-only drift SHALL NOT produce an availability reminder and SHALL NOT be represented as a synthetic Removed-plus-Added transition.

The most recent prior dispatched Run SHALL establish the comparison baseline, whether that Run later completed, failed, was cancelled, or expired. Its persisted reminder text remains model-visible until a context rewrite removes it. The id/state record SHALL advance in the same transaction that persists the reminder it accounts for, including when the comparison emits no reminder. An attempt that dispatches no model request, including a superseded attempt, SHALL persist no availability reminder and SHALL not advance the baseline. A retry of a Run whose earlier attempt dispatched SHALL keep the reminder already stored for that Run unchanged and in place and SHALL use the id/state record already stored for that Run as its baseline, including after worker handoff, unless a checkpoint published since that record was stored started a new epoch, in which case it uses the new epoch's initial semantics. It SHALL persist a new reminder, after the items already stored on the triggering user message, only when its current runtime state differs from that baseline, so `Added tools` lists only tools callable in the current attempt, and its dispatch transaction SHALL advance the Run's id/state record to its own observation. A retry of a Run none of whose attempts dispatched compares with the most recent prior dispatched Run, unless a checkpoint published before the step started a new epoch, in which case it uses the new epoch's initial semantics. A stored reminder stays on the triggering user message when a checkpoint publishes before a retry's step, because that message sits after the checkpoint boundary.

When there is no observed baseline, including migrated non-observation, the attempt SHALL use initial-baseline semantics. The dispatch transaction SHALL store only its sorted exact ids and available/unavailable states; empty observed state is distinct from no observation.

The first turn that dispatches a model request at or after a newly published checkpoint message SHALL use the same initial-baseline semantics as a fresh conversation and SHALL NOT compare against a pre-checkpoint record: it SHALL list currently unavailable eligible tools under `Unavailable tools:` and SHALL emit no reminder when all eligible tools are available. Because a checkpoint message publishes before the model step it was published for, that step's own turn is already the first turn of the new epoch. This new disclosure epoch SHALL NOT reset MCP clients, catalogs, reconnect backoff, attempt-local bindings, or other runtime or persisted state. A semantic checkpoint MAY retain prior tool outages, recoveries, or failures when they mattered to the conversation; those statements SHALL be treated as historical context rather than current availability. The current request's provider-native declarations and current runtime availability reminder, when present, SHALL establish current callability.

At authoring time, the reminder SHALL instruct the model not to simulate removed or unavailable tools or invent their results. Tool ids and reason prose SHALL be rendered only from validated ids and closed server-authored reason codes. Its persisted position relative to other context items SHALL follow the `context-injection` capability's author-time order, and later replay SHALL preserve that stored position without re-rendering or re-sorting it.

#### Scenario: Initial turn starts degraded

- **WHEN** the first turn has an eligible tool whose source is unavailable
- **THEN** a runtime availability reminder names the tool under `Unavailable tools:` in its shared author-time position before the user text

#### Scenario: Initial healthy turn uses native tool declarations

- **WHEN** every eligible tool is available on the chat's first turn
- **THEN** the provider's native tool declarations advertise the callable tools
- **AND** no runtime availability reminder duplicates them in prose

#### Scenario: Existing chat establishes its first observed baseline after migration

- **WHEN** the most recent prior dispatched Run has no observed availability record and the current turn has healthy eligible tools
- **THEN** the provider's native tool declarations advertise those tools
- **AND** no Added-tools reminder is fabricated from the migration sentinel
- **AND** the dispatch transaction stores the minimal observed id/state record

#### Scenario: Availability changes between turns

- **WHEN** the current attempt differs observably from the most recent prior dispatched Run's id/state record
- **THEN** the persisted reminder contains only the non-empty Added, Removed, Unavailable, Became unavailable, and Now available groups
- **AND** each changed id appears in exactly one group

#### Scenario: Newly eligible tool starts unavailable

- **WHEN** a tool was absent on the prior turn and is eligible but unavailable on the current turn
- **THEN** it appears under `Unavailable tools:` with a closed reason
- **AND** it does not appear under `Added tools:`

#### Scenario: Declaration-only drift uses the native contract

- **WHEN** an eligible tool remains available under the same id but its canonical declaration changes
- **THEN** the current attempt advertises its new in-memory declaration without persisting it
- **AND** no runtime availability reminder is emitted solely for that declaration change

#### Scenario: Failed prior attempt does not establish the baseline

- **WHEN** an attempt prepares an availability transition but fails before dispatching any model request
- **THEN** a retry compares against the id/state record its Run already stored, or, when no attempt of its Run dispatched, against the most recent prior dispatched Run's record, and a later turn compares against the most recent prior dispatched Run's record
- **AND** the failed attempt persists no availability reminder and advances no id/state record

#### Scenario: A failed Run that dispatched establishes the baseline

- **WHEN** a Run dispatches a reminder listing grep under `Became unavailable` and then fails
- **THEN** the reminder stays on the triggering user message beside the Run's id/state record, while the Run's own persisted output remains part of the record
- **AND** the next turn compares against that Run's record, so it emits no second `Became unavailable` for grep while grep stays unavailable
- **AND** it lists grep under `Now available` once grep recovers

#### Scenario: Unchanged outage emits no reminder

- **WHEN** an unavailable tool has not changed state since the prior turn
- **THEN** no runtime availability reminder is added solely because the outage persists

#### Scenario: Compaction starts a degraded disclosure epoch

- **WHEN** a checkpoint message publishes before a model step and that step's turn has an eligible unavailable tool
- **THEN** that turn uses fresh-conversation semantics and lists the tool under `Unavailable tools:`
- **AND** it does not emit a transition relative to the pre-checkpoint record
- **AND** a later unchanged turn does not repeat the reminder

#### Scenario: Compaction starts a healthy disclosure epoch

- **WHEN** a checkpoint message publishes before a model step and that step's turn has every eligible tool available
- **THEN** provider-native declarations advertise the callable tools
- **AND** no availability reminder or pre-checkpoint transition is emitted

#### Scenario: A failed attempt still starts the new epoch

- **WHEN** a checkpoint message publishes before a model step and that attempt later fails
- **THEN** the first turn that dispatches after the checkpoint uses fresh-conversation disclosure semantics, whether that is the failed attempt itself or a later turn
- **AND** no later turn compares against a pre-checkpoint record

#### Scenario: Compaction preserves relevant tool-failure history

- **WHEN** a semantic checkpoint mentions a prior tool outage, recovery, or failure that mattered to the conversation
- **THEN** that history remains available to the model
- **AND** the current request's native declarations and current availability reminder, when present, govern current callability

#### Scenario: Unchanged healthy state emits nothing

- **WHEN** every eligible tool is available and availability has not changed since the prior turn
- **THEN** no runtime availability reminder is added

#### Scenario: Model and tool availability change together

- **WHEN** a turn changes model and tool availability
- **THEN** both items are persisted in the order the `context-injection` capability specifies, ahead of the triggering user text within one user message

#### Scenario: Client attempts to forge availability metadata

- **WHEN** a client submits a message containing a tool-availability-shaped data part
- **THEN** the server rejects or discards it under the `context-injection` boundary contract
- **AND** only server-derived state can author the reminder

#### Scenario: Retry reaches a fresh worker while an MCP source is offline

- **WHEN** the most recent prior dispatched Run recorded an MCP id, no attempt of the current Run has dispatched, the new worker has no remembered inventory, and that source remains configured and allowlisted but not ready
- **THEN** the id is an unavailable comparison record outside tool admission with its predicate false
- **AND** the notice reports unavailability rather than removal without reconstructing a tool definition

#### Scenario: Transient flap recovers between turns

- **WHEN** a tool disconnects and reconnects between two recorded turn observations with the same availability
- **THEN** no operational event reminder is emitted solely for the recovered transient flap

#### Scenario: Availability renderer changes

- **WHEN** a later release changes availability wording or reason labels and replays an existing disclosure
- **THEN** the existing disclosure uses its persisted complete text unchanged
- **AND** only newly authored disclosures use the new wording

#### Scenario: Failed attempt observes a temporary outage

- **WHEN** the most recent prior dispatched Run's record had grep available, attempt A of the current Run sees it unavailable, dispatches a reminder listing it under `Became unavailable`, and fails, and retry B sees grep available again
- **THEN** B keeps A's stored reminder unchanged and in place and compares its runtime state against the Run's stored record, so it appends one new reminder listing grep under `Now available` after the stored items
- **AND** B's native tool declarations advertise grep as callable, and B's dispatch transaction advances the Run's id/state record to B's observation
- **AND** the next turn compares with B's record and emits nothing for grep while grep stays available
- **AND** had A dispatched no request, B would compare with the previous dispatched Run's record and emit nothing for grep

#### Scenario: Baseline publication is atomic and fenced

- **WHEN** an attempt dispatches its first model request
- **THEN** its exact reminder text and minimal id/state record commit atomically in that attempt-fenced dispatch transaction
- **AND** stale or superseded attempts, and attempts that never dispatch, cannot publish competing records

### Requirement: Tool input schemas may be declared as JSON Schema

A tool SHALL be able to declare its input schema directly as JSON Schema, not only in code. Both forms SHALL receive the same argument validation, the same safety classification gate, the same operator allowlist gate, and the same tenant-scoped execution — neither form SHALL be privileged or exempted.

Argument validation SHALL be **effective**, not merely declared: a schema whose constraints are advertised to the provider but never checked against the returned arguments does not satisfy this requirement. Where the model SDK validates only when a validator is present, one SHALL be supplied, and a failure SHALL surface through the same non-fatal refusal path as any other invalid tool call rather than through a separate error shape.

A tool's schema SHALL be consumed without dialect rewriting. Nothing in this codebase SHALL require a source to declare, restate, or adjust its schema to a preferred JSON Schema dialect — external sources author their own schemas. A schema that declares a supported dialect and compiles successfully SHALL be accepted as shipped; lack of an available validator or compilation failure remains the explicit refusal case below.

Arguments SHALL be validated under the dialect the schema itself declares. Where no `$schema` is declared, draft-07 SHALL be assumed, matching both the model SDK's tool-schema typing and prevailing practice for tool schemas. Semantically equivalent URI forms for a supported dialect SHALL resolve to the same validator without rewriting the source document. A schema SHALL be refused only when it cannot be checked faithfully: no validator for its declared dialect is available, or the schema is malformed or invalid and cannot be compiled by that validator. The refusal SHALL name the affected tool and declared or assumed dialect, SHALL happen before the declaration enters the attempt-local model catalog, and SHALL NOT affect valid sibling tools. Validating a schema under a dialect other than its own SHALL NOT be done, because keywords such as `items` carry different meaning between dialects and the mismatch would silently enforce something the author did not write.

Standard JSON Schema formats supported by the validator integration, including `email`, `uri`, and `date-time`, SHALL be enforced when a schema declares them. Advertising a format while silently accepting values that violate it does not satisfy effective validation.

Comparing an attempt-local MCP source declaration against its current source SHALL NOT convert a schema that is already JSON Schema into another representation and back. Comparison SHALL be by **canonical equality**: two declarations are equal when their canonical forms — recursively key-sorted, with no other normalization — are identical. Key order and other insignificant serialization differences SHALL NOT count as drift; any difference in schema content SHALL. The same canonicalization SHALL be used when the in-memory declaration is admitted and when it is compared, so the two can never disagree.

#### Scenario: A schema is validated under its own declared dialect

- **WHEN** a source contributes a tool whose input schema declares a dialect for which a validator is available
- **THEN** the tool is accepted as shipped, and its arguments are validated under that dialect

#### Scenario: A schema without a declared dialect is accepted

- **WHEN** a source contributes a tool whose input schema declares no `$schema`
- **THEN** the tool is accepted and its arguments are validated under the assumed default

#### Scenario: An unsupported dialect refuses only the affected tool

- **WHEN** a source contributes a tool whose schema declares a dialect no available validator supports
- **THEN** that tool is refused, naming the tool and the dialect, and the refusal does not affect other tools from the same source

#### Scenario: A malformed schema refuses only the affected tool

- **WHEN** a source contributes one tool whose schema cannot compile and another tool with a valid schema
- **THEN** the malformed tool is refused before attempt advertisement, naming the tool and dialect, while the valid sibling remains available

#### Scenario: Equivalent supported dialect URIs select the same validator

- **WHEN** two otherwise-equivalent schemas declare canonical URI variants of the same supported dialect
- **THEN** both are validated under that dialect without rewriting either source schema

#### Scenario: Standard formats are enforced

- **WHEN** a JSON Schema constrains an argument using the supported `email`, `uri`, or `date-time` format
- **THEN** a conforming value is accepted and a non-conforming value is refused before execution

#### Scenario: Key order is not drift

- **WHEN** a bound declaration and its live tool differ only in the key order of their JSON Schema
- **THEN** they compare equal and the tool executes

#### Scenario: A changed schema is drift

- **WHEN** a live tool's schema differs from its bound declaration in any content — an added, removed, or altered constraint
- **THEN** they do not compare equal

#### Scenario: A JSON-Schema tool is advertised, validated, and executed

- **WHEN** an allowlisted tool classified `read_only` declares its input schema as JSON Schema, and the model calls it with valid arguments
- **THEN** it is advertised, its arguments are validated against that schema, and it executes through the same path as a code-authored tool

#### Scenario: Invalid arguments for a JSON-Schema tool are refused

- **WHEN** the model calls such a tool with arguments its schema rejects
- **THEN** the call does not execute, a structured non-fatal error result is recorded, and the run continues

#### Scenario: A schema advertised to the provider is also enforced locally

- **WHEN** a JSON-Schema tool is called with arguments that violate its schema but that the provider returned anyway
- **THEN** the violation is caught before the tool executes

#### Scenario: An unchanged JSON-Schema tool rebinds without spurious drift

- **WHEN** an attempt admits a JSON-Schema tool and later executes it, with nothing about that tool changed
- **THEN** the declaration matches and the tool executes

#### Scenario: Tool activity from a JSON-Schema tool reconstructs from history

- **WHEN** a chat containing a completed JSON-Schema tool call is reloaded
- **THEN** the persisted parts reconstruct the same call and result presentation as a code-authored tool

### Requirement: Cooperative cancellation reaches tool execution

Tool execution SHALL receive a cancellation signal derived from both the run's termination and the effective per-call timeout, so a tool that supports cooperative cancellation can abandon work whose result can no longer be used. The same per-call timeout signal SHALL drive both the execution context and the timeout race. A tool that ignores the signal SHALL still be bounded by that timeout and SHALL still produce a structured result. The signal SHALL come from the trusted execution context, never from model-controlled arguments.

A cooperative rejection caused by the per-call timeout SHALL produce the structured `timeout` outcome. A rejection caused by the parent run abort SHALL NOT be recorded as `execution_failed` or win first settlement; the call SHALL remain open for the run's terminal settlement so its durable outcome agrees with the terminal run state.

#### Scenario: Run cancellation reaches an executing tool

- **WHEN** a run is cancelled while a tool is executing
- **THEN** that tool's execution context observes cancellation

#### Scenario: Per-call timeout still bounds an uncooperative tool

- **WHEN** an executing tool ignores the cancellation signal
- **THEN** it is still bounded by its effective timeout and still yields a structured result

#### Scenario: A cooperative per-call timeout remains a timeout

- **WHEN** a tool rejects after observing its per-call timeout signal
- **THEN** its structured outcome is `timeout`, not `execution_failed`

#### Scenario: A parent abort remains terminal settlement

- **WHEN** a tool rejects after observing the parent run abort
- **THEN** that rejection does not settle the call as `execution_failed`, and the run's terminal settlement supplies the first and only durable outcome

### Requirement: Termination settles in-flight tool activity

When a run terminates — cancelled, expired, or failed — every tool call that was requested but never settled SHALL be settled before the run reaches its terminal state. Settlement SHALL be observable identically in the live event stream and in the persisted assistant message: a client watching live and a client reloading from history SHALL see the same outcome for that call.

A settlement produced by termination SHALL be distinguishable in the durable record from a result produced by a tool that genuinely failed. The marker carrying that distinction SHALL survive every hop the record takes — the run-event log, the live event stream, the persisted assistant message, and history reconstruction — so no consumer has to infer termination from surrounding context. A presentation layer SHALL be able to render a terminated call differently from a failed one using only what the record carries.

Settlement SHALL be at most once per tool call. Once a call is settled, a later result for that same call SHALL affect neither the live stream nor the persisted message: the first settlement stands, and exactly one outcome for that call reaches each surface.

A terminated run SHALL NOT leave a tool rendered as running, and SHALL NOT drop the record that the call was requested.

A worker SHALL acknowledge a drained model stream only after the owner-scoped Run is durably terminal. If an asynchronous model or tool callback fails to persist settlement but the SDK resolves stream consumption, the worker SHALL reject that job attempt so the queue can retry. A cancellation observed at either worker pickup gate SHALL use the same central terminal settlement path, so a retried attempt with durable open tool events settles them before publishing the terminal Run event.

#### Scenario: Cancelling mid-tool settles the call in the live stream

- **WHEN** a run is cancelled while a tool call is in flight
- **THEN** the live stream settles that tool's activity before finishing

#### Scenario: History shows the cancelled call, not an absent one

- **WHEN** the same run's chat is reloaded from persistence
- **THEN** the tool call appears with a cancelled outcome rather than being absent

#### Scenario: Live and reloaded views agree

- **WHEN** a run terminates with a tool call in flight
- **THEN** the outcome shown live and the outcome reconstructed from history are the same

#### Scenario: A cancellation settlement is distinguishable from a genuine failure

- **WHEN** the durable record of a terminated run is inspected
- **THEN** a call settled by termination is distinguishable from a call whose tool returned an error

#### Scenario: Settlement is idempotent per call

- **WHEN** a tool ignores cancellation and completes after its call was already settled by termination
- **THEN** the first settlement stands, the late result does not replace it, and both the live stream and the persisted message contain exactly one outcome for that call

#### Scenario: Expiry settles in-flight calls

- **WHEN** a run expires while a tool call is in flight
- **THEN** that call is settled on the same terms as cancellation, in the live stream and in history

#### Scenario: Failure settles in-flight calls

- **WHEN** a run fails while a tool call is in flight
- **THEN** that call is settled on the same terms, and remains distinguishable from a result the tool itself produced

#### Scenario: The chat UI presents a cancelled call as cancelled, not failed

- **WHEN** a chat containing a termination-settled tool call is viewed, live or reloaded from history
- **THEN** it is presented as cancelled rather than as a tool error, so the distinction in the durable record is the one the reader sees

#### Scenario: A swallowed settlement write failure remains retryable

- **WHEN** an asynchronous parent-abort settlement cannot persist an open call and the model SDK nevertheless resolves stream consumption
- **THEN** the worker does not acknowledge the job while the owner-scoped Run remains nonterminal
- **AND** a cancellation observed on retry uses central settlement to reconstruct and settle durable open calls before the terminal event

### Requirement: Earlier tool activity takes part in later model context

The tool activity of a committed turn MUST stay in later model context until a
checkpoint absorbs it, through the projection of `turn-replay`. A failed call
MUST keep its outcome and MUST NOT disappear. The live tool loop MUST observe its
own results in the Run that made them.

#### Scenario: A later turn can use an earlier tool result

- **WHEN** a tool returns a result and the user asks about it later
- **THEN** the later request carries its identity, its input, its result, and its outcome through the conventional SDK form

#### Scenario: An unsuccessful call is projected as unsuccessful

- **WHEN** an earlier call was refused, cancelled, errored, or timed out
- **THEN** later replay carries a matched result that reports that outcome
- **AND** the system does not omit the call because it failed

#### Scenario: A model or provider switch keeps observations

- **WHEN** a Chat with tool activity continues on another model or provider
- **THEN** the earlier calls and results replay through the target SDK conversion
- **AND** the reasoning parts of the earlier turns follow the model rule of `reasoning-output`

#### Scenario: The live loop still observes its own tool results

- **WHEN** a tool executes during a Run
- **THEN** its result stays available in the tool loop of that same Run

### Requirement: A failed attempt stays in later context as the user saw it

The prospective cutover boundary in `context-injection` MUST govern the retention
of failed attempts. The system MUST NOT filter or rebuild the current
conversation state retrospectively. A failed, cancelled, expired, or superseded
attempt MUST stay in later context as the user saw it. A follow-up Run from
`turn-actions` can replace the reply. Its reasoning parts follow the model rule of
`reasoning-output`.

#### Scenario: A cancelled call is projected as cancelled

- **WHEN** an unsuccessful Run termination settled an earlier call
- **THEN** operational and UI replay report its matched `cancelled` result
- **AND** the persisted output of that failed attempt stays part of model history
- **AND** it stays different from an error that a tool produced

#### Scenario: A follow-up Run replaces the record of a failed attempt

- **WHEN** a failed reply holds a settled tool pair and an unfinished step, and the owner regenerates the turn
- **THEN** after the Regenerate Run dispatches, later turns do not replay that tool pair or that step

### Requirement: A stored failure replays with its stored outcome

A replayed failure MUST carry the structured outcome that its tool part stores,
except a call that the AI SDK refused, which `turn-replay` covers.
A legacy failed part with no structured outcome MUST replay as the generic
`error`. The system MUST NOT parse human prose to find an outcome. Structured
cancellation metadata can recover `cancelled`.

#### Scenario: A legacy failed part replays as a generic error

- **WHEN** a later turn replays a failed tool part that stores error text and no structured outcome
- **THEN** the replayed result carries the outcome `error`
- **AND** the system does not read the error text to choose another outcome

### Requirement: Every replayed call has its result

Each replayed call MUST have its matched result in the tool message of its step.
A call with no real result MUST replay a well-formed result that carries its
outcome. The system MUST NOT send a call or a result with no match. Credentials
and unrelated payloads MUST NOT replay.

#### Scenario: Every replayed call has a matching replayed result

- **WHEN** a later request replays stored tool activity
- **THEN** each call has its result in the tool message that follows the assistant message of its step
- **AND** the counts of calls and results are equal

#### Scenario: A call with no genuine result still carries a well-formed result

- **WHEN** a call was cancelled, refused, errored, or timed out before a real tool result existed
- **THEN** replay gives a well-formed result that carries that outcome
- **AND** it does not tell about the absence as unrelated assistant prose

### Requirement: Absorbed tool activity crosses a checkpoint only as summary text

A tool record MUST NOT cross a checkpoint. A checkpoint message MUST carry no tool
part. There MUST be no observation ledger, no replacement set, and no compacted
tool record to read back. Absorbed tool activity stays only as summary text: the
`Errors and Corrections`, `Completed`, and `Critical References` content of the
summary. Replay of the rows after a checkpoint MUST NOT read the checkpoint.

#### Scenario: Absorbed tool activity crosses a checkpoint only as summary text

- **WHEN** a checkpoint message absorbs a range of history that contains tool activity
- **THEN** that activity is available to later requests only as summary text
- **AND** the checkpoint message carries no tool record, and the rows after it replay through the projection of `turn-replay`

#### Scenario: Recursive compaction consumes the prior checkpoint's stored text

- **WHEN** a later checkpoint supersedes an earlier checkpoint
- **THEN** its summary input is the stored text of the earlier checkpoint, then the rows that it newly absorbs
- **AND** it writes no list of tool records, and it carries no record forward

### Requirement: No tool observation is rebuilt from a checkpoint

Checkpoint text MUST stay owner-scoped like the checkpoint row that carries it.
The system MUST NOT rebuild a tool observation from summary prose or from the text
of an older checkpoint. It MUST NOT rebuild one from an inference about the
contents of an absorbed turn.

#### Scenario: A checkpoint without stored text cannot recover absorbed observations

- **WHEN** an active checkpoint message has no valid non-empty stored text
- **THEN** request preparation fails closed
- **AND** the system invents no tool observation from summary prose or from a ledger

### Requirement: A stored part records its model step

A stored text, reasoning, or tool part MUST record, as `step`, the number of the
model step that produced it. In a Continue Run, the numbers MUST continue after
the highest step of the kept parts. When a kept tool part has no `step`, Continue
admission MUST copy it from the `tool.requested` event of that call. The system
MUST NOT add `step` to a part stored before this change.

#### Scenario: Two parallel calls record one step

- **WHEN** one model response in step 2 writes text and calls `read("a.md")` and `read("b.md")`
- **THEN** the stored text part and both stored tool parts record `step: 2`

#### Scenario: A Continue Run numbers its steps after the kept steps

- **WHEN** the kept parts of a Continue Run end with a call at `step: 1`, and the first step of the Continue Run calls `read("c.md")`
- **THEN** the stored tool part of that call records `step: 2`

#### Scenario: A Continue of an older Run keeps its steps

- **WHEN** the owner continues a Run whose tool parts were stored with no `step`
- **THEN** each kept tool part gets the step number of its `tool.requested` event
- **AND** the sequential steps of that Run stay separate in the Continue request

#### Scenario: An old part keeps no step

- **WHEN** a part stored before this change replays on a later turn
- **THEN** it has no `step`, and the system writes none to it

### Requirement: Tool results store images without image data

The system MUST store a tool result with an image in its tool part as the native
image result. The result MUST NOT carry a media descriptor, image bytes, or base64
content. Only a `media://` read names its image, by a `media://` locator in
`media`. Each other image result has no `media` field, and the tool part keeps its
retained bytes and display `thumbnail` as `media-attachments` defines.

#### Scenario: An image result is stored without image data

- **WHEN** a `read` of `/work/shot.png` returns an image result
- **THEN** the stored tool part carries that native image result, with `kind: "image"`, `mediaType`, `width`, `height`, and `path`, and no `media` field
- **AND** its stored output carries the display-only `thumbnail` and no other image data, and no `provenance`, `byteSize`, or `model` descriptor field
- **AND** the tool part keeps the retained model variant beside the result

#### Scenario: A media read result is stored as a media reference

- **WHEN** a `read` of `media://<id>` returns an image result
- **THEN** the stored tool part carries that native image result with `media` `media://<id>`
- **AND** it carries no `thumbnail`, no image bytes, and no base64 data

### Requirement: No thumbnail or retained byte reaches the model

The system MUST remove `thumbnail` and retained bytes from each model-facing
result, live and replayed. The system MUST NOT accept them from a client.

#### Scenario: A thumbnail never reaches the model

- **WHEN** an image result stored with a `thumbnail` reaches the model live in its Run, or replays in a later request
- **THEN** no part of any request carries the `thumbnail` or any part of its data URL

### Requirement: A replayed image result attaches under the epoch image window

A replayed image MUST become provider image content, built at request time, only
when three conditions are true. The model declares `image` input, the model
variant is available, and the epoch image window attaches the reference. A `media://` result takes its variant
from the media store, and each other result from its retained bytes. This applies
to a later step, a later turn, a Continue Run, and an owner fork. It also applies
to a compaction request and to a reply rebuilt from the event log.

#### Scenario: An attached image result replays as image content

- **WHEN** a later step of the Run that read `/work/shot.png`, on a model that declares `image` input, replays its image result
- **AND** the epoch image window attaches the reference
- **THEN** the replayed result carries its text and the image as provider image content built from the retained model variant in its stored tool part
- **AND** the call stays directly paired with its result

#### Scenario: A media read result replays from the store in a later turn

- **WHEN** a later turn on a model that declares `image` input replays a stored `media://<id>` image result, and the epoch image window attaches its reference
- **THEN** the replayed result carries its text and the image as provider image content built from the stored model variant

#### Scenario: An earlier turn's retained image read replays as image content

- **WHEN** a later turn on a model that declares `image` input replays the stored image result of `read("/work/shot.png")`, and the epoch image window attaches its reference
- **THEN** the replayed result carries its text and the image as provider image content built from the retained model variant
- **AND** the call stays directly paired with its result

### Requirement: A replayed image that cannot attach becomes a placeholder

A result with neither `media` nor `retainedMedia` MUST replay as its text only,
with no image and no placeholder. Each other result that cannot attach MUST carry
the image placeholder of `media-attachments` in its text. A `media://` reference
that is not media of the Run owner MUST replay as the unavailable placeholder.
These placeholders MUST NOT fail the request.

#### Scenario: An earlier turn's image read replays as not retained

- **WHEN** a later turn on a model with `image` input replays the stored result of `read("/work/shot.png")` for a 1600×900 image
- **AND** that tool part has no `retainedMedia`
- **THEN** the text of the replayed result carries the fields of the result and no placeholder
- **AND** the request carries no image content for that result

#### Scenario: An unattached image result replays as a placeholder

- **WHEN** a request replays an image result
- **AND** its reference is outside the bounds of the epoch image window, or the model of the request does not declare `image` input
- **THEN** the text of the replayed result carries the matching image placeholder with the locator of the image
- **AND** the request carries no image content for that result

#### Scenario: A replayed image reference never resolves another owner's media

- **WHEN** a stored tool part replayed in the Run of user A references a media id that user B owns
- **THEN** the replayed result carries the unavailable placeholder, and the request continues
- **AND** no image bytes or descriptor fields of the object of user B reach the request

### Requirement: Framing llame authors inside tool results is a packaged template

Each closed notice that llame places inside a tool result MUST be a packaged
template file. These notices are the prior-conversation notice of
`conversation-reads`, the search-excerpt notice of `chat-search`, the Knowledge
content notice of `knowledge-tools`, and the path instruction of `agent-skills`.
The module that writes the text owns the file, and the process that runs the tool
ships it. The template renders under the producer-owned-values rule that
`context-injection` defines for item bodies. These templates MUST NOT be operator
configuration, and no configuration key can select, replace, or disable one. The
rendered notice bytes MUST stay identical to the previous inline text. A tool
result MUST NOT have an untrusted-output frame around it, live or replayed. Its
payload MUST be the rendering and the neutralization that `tool-result-rendering`
defines.

Result content that a tool implementation, the permission layer, or result
truncation writes is not a notice of this requirement. That content includes
error messages, permission rejections, and settlement and truncation notices.

#### Scenario: Wrapped tool output is unchanged by the template migration

- **WHEN** a tool result goes to a model, live or replayed
- **THEN** no untrusted-output frame and no outcome line surround it
- **AND** its payload is the rendering that `tool-result-rendering` defines, neutralized once

#### Scenario: A result notice is unchanged by the template migration

- **WHEN** a conversation read, search, Knowledge read, or skill read returns its closed notice
- **THEN** the notice text is byte-identical to the previous inline constant
- **AND** the capability that owns the notice still obeys its content rules

#### Scenario: No configuration replaces a result notice

- **WHEN** an operator configuration names a replacement for a result notice
- **THEN** startup rejects the unknown key under the closed schema
- **AND** the packaged template stays in use

### Requirement: No mid-run tool-state checkpointing (read-only slice; write-tool landmine)

The read-only loop can retry a claimable Run from the first step of its current segment, with new
worker context. It can do this only when that segment has no recorded native attempt or MCP
dispatch. A retry MUST keep the delivered messages and the replies of earlier segments. A retry
MUST resolve its own prompt and its own attempt-local catalog again. It MUST NOT use the
preparation of the failed attempt. It MUST compare availability with the id and state record that
its Run stored when an earlier attempt dispatched. When no such record exists, it MUST compare
with the record of the most recent earlier dispatched Run. The persisted output of the failed
attempt stays part of the committed record that later turns load. A follow-up Run from
`turn-actions` can replace that reply.

A Run that executed an alpha native `edit` or `write` MUST NOT replay that mutation
automatically. This applies after a worker failure, a timeout, or an unknown settlement. A Run
that dispatched an MCP operation MUST NOT replay that operation automatically. The host MUST stop
the affected Run with `outcome_unknown` and require a new explicit user or model attempt. A
client reconnect MUST replay recorded tool activity. It MUST NOT execute the mutation or the MCP
operation again.

A redelivered Run with a recorded `native.attempt` in its current segment MUST fail as
`outcome_unknown`. It MUST NOT replay its loop. A recorded `native.attempt` of an earlier segment
has a settled result, and it MUST NOT stop the retry. This recovery rule has no native-executor
or `workerId` precondition. Before terminal settlement, the host MUST settle each open call that
has a durable `native.result` from that result, whatever the tool source. An open `bash`, native
mutation, or MCP call with a recorded `native.attempt` and no result for it MUST settle as
`outcome_unknown`. Every other open call settles as the termination settlement rules
require.

Only a Continue that the owner requests through `turn-actions` can carry the settled tool-loop
state of a terminal Run into a new Run. That Continue Run MUST replay the settled results. It
MUST NOT execute a settled call again. A future durable effect-dedupe capability can replace
this terminal behavior, and this capability does not define it.

A wake of a Run from `awaiting_jobs` is not a retry. The first attempt after a wake MUST
continue from the stored steps of the current reply, as the requirement for a woken Run defines.
A redelivered queue job of a woken Run is a retry, and it MUST follow the rules of this
requirement.

#### Scenario: Known native mutation result is replayed without execution

- **WHEN** a native edit or write settled before a client reconnect
- **THEN** replay returns the recorded tool result
- **AND** the filesystem mutation does not execute again

#### Scenario: Worker death mid-loop does not resume tool state

- **WHEN** the worker dies after several completed tool steps, and the deadman expires the Run
- **THEN** the Run ends under the rules that apply today
- **AND** no new Run resumes the partial tool-loop state, unless the owner requests a Continue

#### Scenario: Refresh does not re-execute tools

- **WHEN** a client reconnects to a live Run after tool steps completed
- **THEN** replay builds those steps again from durable events and does not execute a native mutation again

#### Scenario: Worker failure does not replay a native mutation

- **WHEN** a worker fails after a native mutation or an MCP dispatch can have started, and before its result is known
- **THEN** the host settles the effect as `outcome_unknown`, and the Run stops
- **AND** a queue retry does not invoke that mutation or MCP operation again

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** the queue retries the job of a read-only Run, the Run is still claimable, and no `native.attempt` is recorded
- **THEN** its tool loop executes again from the first step of its current segment
- **AND** it can invoke again the read-only tools that the earlier attempt invoked

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** the queue retries a job for a Run that is already terminal
- **THEN** the Run does not open again, no tool executes, and its terminal state stays

#### Scenario: Read-only retry remains unchanged

- **WHEN** a claimable Run holds only read-only tools, has no recorded `native.attempt`, and its job retries
- **THEN** the read-only retry behavior of today stays available
- **AND** the host infers no native mutation from the read-only result

#### Scenario: A Continue carries settled tool results into a new Run

- **WHEN** a Run failed after a settled `edit` call and a settled `bash` call with `outcome_unknown`, and the owner continues it
- **THEN** the Continue Run gives the model both stored results
- **AND** it does not execute either call again

#### Scenario: A settled write in an earlier segment does not stop a retry

- **WHEN** the first segment of a Run settled a native `write`
- **AND** the worker dies in the second segment before a native attempt of that segment
- **THEN** the retry restarts the second segment from its delivered message
- **AND** the `write` does not execute again

#### Scenario: A wake does not restart the segment

- **WHEN** a Run leaves `awaiting_jobs` after two completed tool steps of its current segment
- **THEN** the first attempt after the wake keeps both steps and executes neither call again

#### Scenario: A retry after a wake restarts a read-only segment

- **WHEN** the queue retries the job of a woken Run whose current segment has no `native.attempt`
- **THEN** the tool loop executes again from the first step of that segment

### Requirement: A tool can yield to a steer

A tool can declare that it yields. `wait` and `bash` on the llame host MUST yield, and no other
tool does. A steer, an interrupt, or a job notice can signal the Run. Each open call of a tool
that yields MUST then return a known result at once. The work of that call MUST continue as a job of
`background-jobs`. A call that yields MUST NOT settle as `outcome_unknown` or `cancelled`.

#### Scenario: A read does not yield

- **WHEN** the owner sends a steer while a `read` of a web locator runs
- **THEN** the `read` finishes with its own result before the steer is delivered

#### Scenario: Two commands yield at one signal

- **WHEN** two host `bash` calls of one step run in the foreground, and the owner sends a steer
- **THEN** both calls return `backgrounded`, and both commands continue

### Requirement: Only a wait call stays open while its Run waits

A `wait` call MUST be the only tool call that stays open while a Run is in `awaiting_jobs`. The
Run MUST settle every other call of the step before it enters that status. A step MUST hold at
most one open `wait` call, and a second `wait` call in the step MUST return an error. A `wait`
call MUST NOT record a native attempt, because it has no effect on the host.

#### Scenario: A wait beside a read in one step

- **WHEN** the model calls `read` and `wait` in one step
- **THEN** the `read` result is stored before the Run enters `awaiting_jobs`

#### Scenario: Two wait calls in one step

- **WHEN** the model calls `wait` twice in one step
- **THEN** the second call returns an error that names the first call, and the Run waits on the first call only

### Requirement: A woken Run settles the wait and continues from its stored steps

When a Run leaves `awaiting_jobs`, its attempt MUST record the result of the open `wait` call
exactly once. It MUST then send the next model request with the history and the stored steps of
the current reply, through that result. It MUST NOT execute a settled call again. A redelivered
queue job of the woken Run MUST follow the retry rules of `No mid-run tool-state checkpointing`.

#### Scenario: A build fails while the Run waits

- **WHEN** a Run waits on a build, the build fails, and another worker claims the Run
- **THEN** the reply keeps its earlier steps, and the `wait` call gets the result that names the failed build
- **AND** the next model request carries those steps and that result

#### Scenario: A worker stops after the wake

- **WHEN** the current segment holds no native attempt, and the worker stops after it recorded the `wait` result
- **THEN** the retry executes the segment again from its first step
- **AND** a new `wait` call on the settled job returns at once

#### Scenario: A worker stops after the wake of a segment with a command

- **WHEN** the current segment holds a `bash` attempt, and the worker stops after the wake
- **THEN** the redelivered Run fails as `outcome_unknown`, and the owner can start a Continue

### Requirement: The stop tool is a host-capability tool

`stop` MUST have the `execute_code` classification, and it MUST be in the exact host-capability
set. It MUST be available only on a process that can run host `bash`. Its retry policy is this:
a retried `stop` call requests the stop again, and a job that is already settled keeps its
state. `wait` MUST have the `read_only` classification.

#### Scenario: Stop is advertised with bash

- **WHEN** `tools.allowed` names `bash` and `stop`, and the process accepted native host authority
- **THEN** the system advertises `stop`

#### Scenario: Stop without host authority is not advertised

- **WHEN** `tools.allowed` names `stop`, and the process accepted no native host authority
- **THEN** the system does not advertise `stop` and does not execute it

### Requirement: Tool activity is rendered in the chat UI

The web chat SHALL render tool activity inline in the message stream — the call (tool name + arguments summary), a running state, and the result (or error) — consistent with the existing part renderers (text, reasoning), including for historical messages loaded from persistence.

#### Scenario: Live rendering during a run

- **WHEN** a tool executes during a streamed run
- **THEN** the UI shows the call and its running state, then the result, without a refresh

#### Scenario: Historical rendering

- **WHEN** a chat containing past tool activity is reopened
- **THEN** the persisted tool parts render the same call/result presentation

#### Scenario: Step-cap notice is visible in the UI

- **WHEN** a run hits the step cap
- **THEN** the chat UI renders a visible inline notice alongside the final answer (live and when reloaded from history)

### Requirement: Code-owned Knowledge tools use the attempt-local read-only loop

The code-owned tool inventory MUST include `knowledge_search` and
`search_conversations`. Knowledge file access is the `kb://` locator of the
native file tools. `knowledge_search` MUST declare `read_only` and MUST require
its own exact entry in `tools.allowed`. It MUST follow the same contracts as each
other code-owned tool. These contracts are declaration admission, the
attempt-local tool catalog, trusted executor binding, timeout, abort, and
settlement. They also include persistence, replay, compaction, result
neutralization, truncation, and browser rendering. The runtime
catalog MUST describe operation eligibility and declarations, not a Knowledge
resource inventory. The system MUST NOT persist the catalog.

The operator allowlist controls only whether these fixed operations are eligible.
It MUST NOT choose an owner, a configured root, a child directory, a path root, or
an execution location. A permitted Knowledge tool can accept a stable Knowledge
Space selector as its code-owned schema defines. The current authority for that
selector MUST come from the trusted Run owner at execution time. Model input MUST
NOT supply or expand ownership or local filesystem authority.

For each new execution attempt, the candidate resolver of the worker MUST find
Knowledge tool availability from four inputs. These are the source declaration,
the safety classification, the exact allowlist entry, and the configured
Knowledge root. It MUST NOT query
or snapshot the Knowledge Space inventory of the owner. With a configured root, an
owner with no current resources MUST still receive the callable tool
declarations, and a call MUST return `knowledge_space_not_configured`. Without a
configured root, each Knowledge tool that is otherwise eligible MUST keep the
closed `knowledge_space_unavailable` manifest state. The API acceptance path MUST
NOT resolve the catalog or probe the filesystem.

Worker execution MUST receive the private filesystem resolver through trusted
dependency injection or tool context. It MUST receive the current owner identity
through trusted Run context. It MUST resolve the current resources of the owner
under RLS for each call. It MUST NOT serialize local binding data into
declarations or accept it from model input.

Knowledge results and `grep` results MUST keep the global execution envelope
`status: "success" | "error"`. The system MUST NOT add a generic `partial`
status. A successful `knowledge_search` or `grep` can also declare
`complete: false` with bounded warnings. A later turn MUST replay that result as
the live loop sent it, with `complete: false` in its payload, under
`turn-replay`. No replay can clear that payload or show the call as complete.
This requirement does not define partial-result semantics for other tools.

New Knowledge results MUST persist and render the passage and range attribution
that `knowledge-tools` defines, with no content hash. A historical persisted
Knowledge result can keep its earlier shape with a hash. Execution, persistence,
replay, compaction, and browser rendering MUST keep each observation as written.
They MUST NOT change a historical result into the new shape or add a removed
field. A persisted call without the new optional range or cursor arguments MUST
stay a valid observation.

A change to execution semantics or to the meaning of stored Knowledge locators
MUST stay a coordinated API, worker, and data boundary. An edit to a description
template applies at restart. It adds no historical declaration-hash requirement
for a scheduled Run. Before a deployment replaces binaries for the passage-search
declaration, it MUST stop new Run acceptance. It MUST drain each accepted Run
that the prior declaration binds. It MUST deploy matching API and worker binaries
before it accepts Runs again. A rollback MUST stop acceptance and drain the Runs
that the newer declaration binds before it restores older API or worker
binaries. This requirement adds no executor fallback across revisions and no
declaration normalization.

The closed Knowledge reason vocabulary and its model-safe label map MUST keep
`knowledge_space_not_configured` and `knowledge_space_unavailable`. Zero
inventory does not change tool availability. Thus
`knowledge_space_not_configured` MUST appear only as a tool-call result, not as a
runtime availability state. When the process has no Knowledge configuration, the
system MUST use the safe `knowledge_space_unavailable` label. A recovery notice
MUST name the restored tool and MUST NOT state a prior cause. The previous
committed record stores only the id and the state.

#### Scenario: Knowledge tool is not allowlisted

- **WHEN** a Knowledge tool is registered but its exact id is not in `tools.allowed`
- **THEN** a new execution attempt does not advertise or execute it

#### Scenario: Allowlisted Knowledge tool is admitted at runtime

- **WHEN** an exact Knowledge tool id is allowlisted for a new execution attempt with a configured Knowledge root
- **THEN** the in-memory tool catalog of that Run includes its exact declaration, whatever the current owner inventory is
- **AND** execution requires the matching code-owned read-only executor

#### Scenario: Eligible Knowledge tool starts unavailable

- **WHEN** a Knowledge tool is allowlisted but the worker of the attempt has no configured Knowledge root
- **THEN** the runtime availability of the attempt records `knowledge_space_unavailable`
- **AND** the Run does not advertise the tool as callable

#### Scenario: Knowledge availability recovery does not infer a prior cause

- **WHEN** an attempt admits a Knowledge tool that the most recent prior dispatched Run in the disclosure epoch recorded as unavailable
- **THEN** its `Now available` transition names that exact tool and states no stored failure reason
- **AND** no root, host path, or free reason text appears

#### Scenario: Knowledge observation persists through reload and replay

- **WHEN** an allowlisted Knowledge tool completes with passage and range attribution and no content hash
- **THEN** its call and structured result persist and render after a browser reload
- **AND** later model replay carries the complete matched pair as the live loop sent it

#### Scenario: Historical Knowledge observation is not rewritten

- **WHEN** a persisted Knowledge observation uses the earlier result shape with a hash
- **THEN** reload and replay keep the observation as written
- **AND** no migration or projection adds new range fields or removes its historical fields

#### Scenario: Knowledge declaration cutover drains prior Runs

- **WHEN** a deployment changes the code-owned `knowledge_search` declaration
- **THEN** it stops new Run acceptance and drains the Runs that the prior declaration binds before it replaces API or worker binaries
- **AND** acceptance starts again only after each process that executes Runs exposes the matching declaration and executor

#### Scenario: Tool permission cannot alter filesystem authority

- **WHEN** an operator allowlists `knowledge_search`
- **THEN** the permission makes only that fixed operation eligible
- **AND** a supplied space selector still resolves only through the current trusted owner authority

#### Scenario: Zero inventory remains model-visible

- **WHEN** a Run owner has no current Knowledge Spaces but `knowledge_search` is otherwise eligible
- **THEN** the tool is advertised as callable
- **AND** a call returns the closed `knowledge_space_not_configured` result

#### Scenario: Removed reader is not recreated from history

- **WHEN** historical tool activity names the removed `knowledge_read` id
- **THEN** a new attempt does not rebuild or execute it from that history
- **AND** the system applies no shim, alias, or redirect to `read`

#### Scenario: Incomplete Knowledge search stays incomplete after payload clearing

- **WHEN** `knowledge_search` returns `status: "success"` with `complete: false`, and a later turn replays it
- **THEN** the replayed result carries `complete: false` as the live loop sent it
- **AND** no replay clears its payload or shows the call as complete

#### Scenario: Incomplete grep stays incomplete after payload clearing

- **WHEN** `grep` returns `status: "success"` with `complete: false`, and a later turn replays it
- **THEN** the replayed result carries `complete: false` as the live loop sent it
- **AND** no replay clears its payload or shows the call as complete

### Requirement: Conversation read uses the attempt-local read-only tool loop

The code-owned tool inventory SHALL include `conversation_read` in addition to `search_conversations` and `knowledge_search`. It SHALL declare `read_only`, require its own exact `tools.allowed` entry, and participate in the existing declaration admission, attempt-local runtime catalog, trusted executor binding, timeout, cooperative cancellation, settlement, persistence, replay, compaction, neutralization, and generic browser-rendering lifecycle. Owner authority SHALL come only from trusted Run context, never from model arguments or a message locator.

The conversation reader SHALL enforce the `conversation-reads` bounds of 2,000 logical lines and 15,000 JavaScript UTF-16 code units before generic result truncation. A read whose first selected source line cannot fit SHALL return `conversation_limit_exceeded`. Bounded pages SHALL preserve exact `nextOffset` and cut-reason metadata, and generic truncation SHALL NOT clip numbered source content.

Structured Chat/message sequence attribution, role/timestamp, numbered content, neighboring eligible sequences, continuation metadata, and the closed untrusted-history notice SHALL persist and render as authored through the ordinary tool UI. Replay SHALL NOT rehydrate newer message content, synthesize hashes/UUIDs/versions/part identities, remove line prefixes/notices, or normalize historical result shapes. Changing executable or Chat-local sequence semantics SHALL use a coordinated API/worker/data cutover; restart-applied description wording does not require a persisted declaration hash: quiesce new Run acceptance, drain Runs bound to the prior declaration and sequence interpretation, migrate durable sequence boundaries, deploy matching executors/declarations, then resume; rollback SHALL restore the matching prior binaries and data snapshot rather than mix locator interpretations.

A persisted conversation-read observation SHALL follow the destination Chat's existing retention and deletion lifecycle. Product behavior SHALL NOT delete an individual source message. Deleting or later losing access to the source Chat SHALL make a fresh read return `conversation_source_not_found` but SHALL NOT redact or rewrite text already recorded in another owner-visible Chat. Deleting the destination Chat SHALL remove its messages, Runs, and Run events through the existing cascade lifecycle.

Because the global-to-Chat-local sequence rewrite is a pre-merge alpha hard cutover, deployment SHALL preflight persisted assistant parts, compaction replacement history, and Run events before changing sequence values. If it finds an experimental canonical `search_conversations` result or `conversation_read` input/result authored under the prior global interpretation, the cutover SHALL abort before mutation. It SHALL NOT rewrite the historical observation, accept its global value as an alias, or guess between colliding locator namespaces. The unsupported experimental Chat or database must be removed/reset as a whole before retrying the cutover.

#### Scenario: Conversation reader is not allowlisted

- **WHEN** `conversation_read` is registered but absent from `tools.allowed`
- **THEN** it is neither advertised nor executable for a newly prepared execution attempt

#### Scenario: Allowlisted reader is bound immutably

- **WHEN** the exact reader ID is eligible for a newly prepared execution attempt
- **THEN** that attempt retains its exact declaration in memory and requires the matching code-owned executor
- **AND** no Chat/sequence argument supplies owner authority

#### Scenario: Bounded continuation survives persistence

- **WHEN** a reader success returns numbered content with `nextOffset` and a cut reason
- **THEN** live events, assistant-message settlement, browser reload, and full-payload replay preserve the exact result
- **AND** the persisted observation is not replaced by a generic truncation preview

#### Scenario: Historical read is not rehydrated

- **WHEN** message content, sequence navigation, or line-rendering code changes after a read result was persisted
- **THEN** reload and replay preserve the bounded historical observation as authored
- **AND** they do not reread the source or rewrite its coordinates/content

#### Scenario: Experimental global locator blocks the alpha cutover

- **WHEN** migration preflight finds a persisted canonical search/read observation in live message parts, compaction replacement history, or Run events authored with the unmerged global sequence interpretation
- **THEN** the cutover fails before rewriting any message or compaction sequence
- **AND** it neither mutates that observation nor installs a global-sequence alias path

#### Scenario: Source deletion does not rewrite another Chat's observation

- **WHEN** a persisted conversation-read result in one owner-visible Chat quotes a source Chat later deleted or unavailable
- **THEN** the historical result remains recorded while a fresh call returns `conversation_source_not_found`
- **AND** deleting the destination Chat removes that observation under the existing Chat/Run cascade lifecycle

#### Scenario: Generic tool UI remains the rendering floor

- **WHEN** a live or historical `conversation_read` result reaches the browser
- **THEN** the existing structured tool renderer displays its input, lifecycle state, result, or closed error
- **AND** no specialized source card, outline, activity timeline, or conversation-only renderer is required

#### Scenario: Conversation-read declaration cutover drains prior Runs

- **WHEN** deployment changes code-owned conversation declarations or the interpretation of message sequence fields
- **THEN** it stops accepting new Runs and drains Runs and queue payloads bound to the prior interpretation before migrating sequence boundaries
- **AND** acceptance resumes only after every API and worker exposes the matching declaration, executor, and Chat-local sequence semantics

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

### Requirement: Code-owned web search uses the attempt-local read-only loop

The code-owned tool inventory SHALL include `web_search`. It SHALL declare `read_only`, require its own exact `tools.allowed` entry, and participate in the existing declaration admission, attempt-local runtime catalog, trusted executor binding, timeout, cooperative cancellation, settlement, persistence, replay, compaction, neutralization, and truncation contracts. Its engine behavior and its dedicated browser rendering are owned by `web-search`.

#### Scenario: Allowlisted web search is declared

- **WHEN** `tools.allowed` contains `web_search`, `webSearch.chain` is configured, and an attempt composes its catalog
- **THEN** the model receives a `web_search` declaration with the `web-search` input schema

#### Scenario: Unlisted web search is absent

- **WHEN** `tools.allowed` omits `web_search`
- **THEN** no attempt declares `web_search`, and a model call naming it is refused with a recorded, non-fatal tool error and the run continues

### Requirement: PDF results are carried without bytes and their media locator survives the cap

A PDF in a tool result SHALL be carried without PDF bytes and without a thumbnail. The cap SHALL
measure the serialized result's remaining fields, including its text and metadata. Truncation
SHALL NOT cut, shorten, or omit the `media` locator of a
`media://` PDF result: other values SHALL be shrunk and, at the floor, other fields omitted in its
place, so a recorded `media://` PDF result always names the complete `media://` locator of the PDF
it carries.

#### Scenario: PDF bytes do not count toward the cap

- **WHEN** a `read` of `/work/paper.pdf` returns a PDF result for a 15-page, 2,215,244-byte PDF
- **THEN** the cap measures only the serialized PDF result, which is not truncated
- **AND** the recorded result carries no PDF bytes, no base64 data, and no `thumbnail`

#### Scenario: Truncation keeps a PDF result's media reference

- **WHEN** a `media://` PDF result serializes above the cap because another field is oversized
- **THEN** the recorded result carries the complete `media://` locator unchanged
- **AND** the oversized field is shrunk in place and the marker states the omitted characters

#### Scenario: The floor omits other fields before a PDF's media reference

- **WHEN** a `media://` PDF result's top-level field names alone serialize above the cap
- **THEN** other fields are omitted and the marker states how many of how many
- **AND** the recorded result still carries the complete `media://` locator

### Requirement: PDF tool observations are stored and replayed like image results

The system MUST store a PDF in a tool result in the tool part as the native PDF result. The result
MUST NOT carry a media descriptor, PDF bytes, or base64 content. The tool part MUST keep the
retained original of an unstored PDF beside the result, as `media-attachments` defines. On replay,
its text MUST be the live rendering that `turn-replay` defines. The PDF MUST become provider file content, built from
its original at request time, only when three conditions are true. The request's model declares
`pdf` input, the original is available, and the epoch image window attaches it. A result with neither
`media` nor `retainedMedia` MUST replay as its text only, with no file content and no placeholder. For each other
result, when the three conditions are not all true, its text MUST carry the matching PDF
placeholder.

#### Scenario: A PDF result is stored without PDF data

- **WHEN** a `read` of `/work/paper.pdf` returns a PDF result
- **THEN** the stored tool part carries that native PDF result, with `status: "success"`,
  `kind: "pdf"`, `mediaType` `application/pdf`, `pages`, `byteSize`, and `path`, and no `media` field
- **AND** its stored output carries no `thumbnail`, no PDF bytes, and no base64 data
- **AND** the tool part keeps the retained original beside the result

#### Scenario: A media read PDF result is stored as a media reference

- **WHEN** a `read` of `media://<id>` returns a PDF result
- **THEN** the stored tool part carries that native PDF result with `media` `media://<id>`
- **AND** it carries no `thumbnail`, no PDF bytes, and no base64 data

#### Scenario: An attached PDF result replays as file content

- **WHEN** a later step of the Run that read `/work/paper.pdf` replays its PDF result, on a model with `pdf` input
- **AND** the epoch image window attaches the reference
- **THEN** the replayed result carries its text and the PDF as provider file content built from the
  retained original in its stored tool part
- **AND** the call remains immediately paired with its result

#### Scenario: A media read PDF result replays from the store in a later turn

- **WHEN** a later turn on a model that declares `pdf` input replays a stored `media://<id>` PDF result
  whose reference the epoch image window attaches
- **THEN** the replayed result carries its text and the PDF as provider file content built from the
  stored original

#### Scenario: An earlier turn's PDF read replays as not retained

- **WHEN** a later turn, a Continue Run, a compaction request, or a fork replays the stored PDF result
  of `read("/work/paper.pdf")` for a 15-page PDF, on a model with `pdf` input
- **AND** that tool part has no `retainedMedia`
- **THEN** the replayed result's text carries the fields of the result and no placeholder
- **AND** the request carries no file content for that result and does not fail

#### Scenario: An earlier turn's retained PDF read replays as file content

- **WHEN** a later turn on a model that declares `pdf` input replays the stored PDF result of
  `read("/work/paper.pdf")`, and the epoch image window attaches its reference
- **THEN** the replayed result carries its text and the PDF as provider file content built from the
  retained original

#### Scenario: A model without PDF input receives the omitted placeholder

- **WHEN** a request whose model declares `image` but not `pdf` input replays the PDF result of
  `read("/work/paper.pdf")` for a 15-page PDF
- **THEN** the replayed result's text carries
  `[pdf "/work/paper.pdf" 15 pages, omitted: this model has no PDF input]`
- **AND** the request carries no file content for that result

#### Scenario: A PDF result beyond the window replays as the limit placeholder

- **WHEN** a request on a model with `pdf` input replays the PDF result of `read("/work/paper.pdf")`
  for a 15-page PDF
- **AND** its reference is beyond the bounds of the epoch image window
- **THEN** the replayed result's text carries
  `[pdf "/work/paper.pdf" 15 pages, not attached: this context's PDF limit is reached]`
- **AND** the request carries no file content for that result

#### Scenario: PDF content does not consume the observation budget

- **WHEN** a replayed PDF result's original would serialize as base64 longer than 8,000 UTF-16 code
  units
- **THEN** the replayed pair carries its whole text
- **AND** the retained bytes are not part of that text

#### Scenario: A dropped pair carries no PDF

- **WHEN** a checkpoint absorbs an older pair whose result carries a PDF
- **THEN** neither the pair nor its file content appears in a later request
- **AND** the checkpoint carries no tool record

#### Scenario: A replayed PDF reference never resolves another owner's media

- **WHEN** a stored `media://<id>` PDF result replayed in user A's Run references a media id owned by
  user B
- **THEN** the replayed result carries `[pdf media://<id> unavailable]` and the request proceeds
- **AND** no PDF bytes or descriptor fields of user B's object reach the request

### Requirement: A stored tool part records the classification of a call that started

When a tool call starts, the `tool.started` event and the stored tool part MUST record
`classification` with the classification of the tool that executes it. A call that the
availability gate or the permission policy rejects does not start. Its stored part MUST record
`classification: null`, also after a rebuild from events. The chat history response MUST return
the field. Model replay, public shares, exports, and search MUST NOT carry it.

#### Scenario: A started bash call records its classification

- **WHEN** a `bash` call starts and settles
- **THEN** its stored tool part records `classification: "execute_code"`

#### Scenario: A rejected call records no classification

- **WHEN** the availability gate or the permission policy rejects a tool call before it starts
- **THEN** its stored tool part records `classification: null`

#### Scenario: A rebuilt reply keeps the classification

- **WHEN** a settler without the live collector rebuilds a reply that holds a started `edit` call and a rejected `bash` call
- **THEN** the rebuilt `edit` part records `classification: "write_low_risk"` and the rebuilt `bash` part records `classification: null`

#### Scenario: An MCP call records unverified

- **WHEN** an allowlisted MCP tool call starts
- **THEN** its stored tool part records `classification: "unverified"`
