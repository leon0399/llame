# tool-calling

## Purpose

The durable, multi-step tool-calling run loop: inside the transport-agnostic run executor, a run may interleave model output with tool invocations — the model requests a tool, the loop executes it (tenant-scoped for code-owned tools, timeout-bounded), appends the result, and continues until a final answer or the operator step cap. Every executable tool in this slice is classified or operator-attested `read_only`; availability is a fail-closed operator allowlist (`tools.allowed`, default empty) over code-owned tools and explicitly configured remote MCP tools. Tool activity persists as AI-SDK tool parts + run events (replayable, rendered live and from history, excluded from public shares) and is replayed into later model turns as conventional tool-call/tool-result parts — labelled untrusted, escape-proofed, bounded per call and per turn. Approval flows (§7.5), write/execute tools, org/user grants, and the policy engine's deny-composition remain out of scope and extend this loop rather than replace it.

## Requirements

### Requirement: Multi-step tool-calling run loop

The run executor SHALL support multi-step runs: when the model requests tool invocations, the loop SHALL execute them, append the results to the run's model context, and continue the same run — repeating until the model produces a final answer or the step cap is reached. A **step** is one model turn that requested at least one tool. A model MAY request multiple tool calls in a single turn: they count as **one** step and execute **concurrently** (safe: read-only + individually timeout-bounded), each producing its own call/result parts. The step cap SHALL be evaluated per step, atomically: the turn that reaches the cap executes ALL of its requested calls; no call within an accepted step is refused because of the cap. The loop SHALL run inside the existing durable worker execution (queue-processed, heartbeated, resumable) — never on the request thread.

#### Scenario: Model calls a tool and continues

- **WHEN** the model requests an available tool with valid arguments
- **THEN** the tool executes, its result enters the model context, and the model continues the same run to a final answer

#### Scenario: Multiple sequential tool steps

- **WHEN** the model chains several tool-requesting turns within one run
- **THEN** each executes in order and the conversation context accumulates every call and result

#### Scenario: Parallel tool calls within one turn count as one step

- **WHEN** the model requests three tool calls in a single turn
- **THEN** all three execute concurrently, each with its own call/result parts, and the step counter increments by one

#### Scenario: The cap-reaching step completes atomically

- **WHEN** the step cap is 8, seven steps have run, and the model requests three tool calls in its eighth tool-requesting turn
- **THEN** all three calls of that step execute; afterwards no further tools are offered or executed

#### Scenario: Step cap reached fails closed to answering

- **WHEN** a run reaches the configured maximum tool steps
- **THEN** no further tool calls execute; the model is driven to answer from what it has, and the run completes with the cap visibly recorded in the run's events

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5 set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`, `external_send`, `financial_or_sensitive`, `admin`). In this slice the loop SHALL execute **only `read_only`** tools: a tool with any other classification SHALL be neither advertised to the model nor executed, even if registered and allowlisted — approval machinery (§7.5) arrives with the first write-capable tool.

The `mcp__` tool-id prefix SHALL be reserved for ids produced by the MCP capability. A code-owned or other non-MCP registry entry beginning with that prefix SHALL fail registration, so ID-only namespace permission matching cannot grant authority across source kinds.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called
- **THEN** it executes

#### Scenario: Non-read-only tool is refused even when allowlisted

- **WHEN** a tool classified other than `read_only` is registered and allowlisted, and the model requests it
- **THEN** it is not advertised to the model, and a direct request for it is refused with a recorded, non-fatal tool error

#### Scenario: Unclassified tool cannot register

- **WHEN** a tool without a classification is registered
- **THEN** registration fails at startup (fail loud, not at call time)

#### Scenario: Duplicate tool id cannot register

- **WHEN** two tools register the same id
- **THEN** registration fails at startup naming the id

#### Scenario: Code-owned tool cannot occupy the MCP namespace

- **WHEN** a code-owned registry entry has an id beginning with `mcp__`
- **THEN** registration fails at startup naming the reserved prefix

### Requirement: Fail-closed operator availability gate

Tool eligibility SHALL be governed by the operator allowlist in `llame.config.json` (`tools.allowed`). The default SHALL be an empty allowlist — an instance with no tools configured runs exactly as before this change (no tools advertised, none executable). The system SHALL first construct its source-owned inventory from registered code-owned tools and the safely admitted current or remembered-unavailable MCP inventory, then apply `tools.allowed` strictly as a boolean permission predicate over each candidate's canonical `tool.id`. Code-owned ids SHALL require exact entries. A canonical MCP id SHALL match either the same exact entry or a validated namespace rule `mcp__<configured-server>__*` whose terminal `*` is removed for literal ID-prefix comparison. Matching SHALL be case-sensitive. The validated trailing separator SHALL prevent one server prefix from matching a longer server id, and the reserved `mcp__` namespace SHALL prevent matching code-owned tools. Permission rules SHALL NOT create, copy, expand, or deduplicate candidates. A tool that matches no rule SHALL be neither advertised to the model nor executed if requested.

Exact and namespace MCP entries SHALL grant eligibility only to exact identities learned from safely admitted declarations for that server. When a live process loses the server transport, the last completely admitted identity set SHALL remain source inventory in an unavailable state; when complete discovery succeeds, its newly admitted identity set SHALL replace the prior set authoritatively. Neither permission form SHALL fabricate identities before first successful discovery or expose refused declarations. An eligible dynamic tool SHALL become advertisable or executable only while the source supplies a currently admitted declaration for that exact id under the operator's read-only attestation.

The restart-applied allowlist decision SHALL be bound into the immutable Run snapshot as filtered exact ids and exact declarations when a turn is accepted; wildcard patterns SHALL NOT enter provider requests, manifests, receipts, persistence, or execution binding. Removing an exact entry or namespace wildcard from later instance configuration SHALL affect newly accepted Runs but SHALL NOT retroactively rebind an already accepted Run or its queue retries. Immediate live revocation is outside this capability and requires the future permission-policy system; this bound authorization is permitted here only because every admitted remote tool is operator-attested read-only. Write-capable tools remain prohibited even when they claim idempotence; durable side-effect checkpointing and permission policy are separate follow-ups.

#### Scenario: Default is no tools

- **WHEN** the operator config does not set `tools.allowed`
- **THEN** runs never advertise or execute any tool

#### Scenario: Unlisted tool is not advertised

- **WHEN** a registered code-owned tool or discovered dynamic tool matches neither an exact entry nor an MCP namespace wildcard
- **THEN** it does not appear in the toolset offered to the model

#### Scenario: Unlisted tool is refused

- **WHEN** the model requests a tool that matches neither an exact entry nor an MCP namespace wildcard bound into the Run
- **THEN** the call is refused with a recorded, non-fatal tool error and the run continues

#### Scenario: Unknown tool id in the allowlist fails boot

- **WHEN** `tools.allowed` names an entry that is neither registered in code, a canonical exact dynamic id for a configured source, nor the canonical wildcard for a configured MCP namespace
- **THEN** startup fails naming the offending config path and id

#### Scenario: Eligible dynamic tool can remain unavailable

- **WHEN** a previously admitted MCP identity still matches an exact or namespace permission but its live process loses the server transport
- **THEN** unrelated Runs remain usable and the filtered identity is recorded as unavailable
- **AND** that tool is not advertised or executable for newly bound Runs

#### Scenario: Permission does not create a fresh-offline identity

- **WHEN** a fresh process has no admitted or remembered MCP inventory and `tools.allowed` names an exact id or namespace from that server
- **THEN** the permission produces no effective-context or availability-manifest entry

#### Scenario: Complete discovery removes omitted identities

- **WHEN** successful complete discovery omits or refuses a previously admitted exact identity
- **THEN** the new source inventory no longer contains that identity
- **AND** the next Run treats it as absent even when an exact or namespace permission would match it

#### Scenario: Namespace wildcard admits future exact ids

- **WHEN** a configured MCP server later supplies a safely admitted canonical tool id within its allowlisted namespace
- **THEN** the next Run may bind and advertise that exact id without an instance-config change
- **AND** no wildcard pattern appears in the Run snapshot or provider request

#### Scenario: Overlapping rules filter one inventory candidate once

- **WHEN** one exact MCP id is selected by both its exact entry and its server namespace wildcard
- **THEN** filtering retains the original inventory candidate once without creating another candidate

#### Scenario: Permission filtering does not hide source collisions

- **WHEN** distinct source candidates collide and both match one or more permission rules
- **THEN** both candidates reach the existing collision refusal unchanged rather than being deduplicated by permission matching

#### Scenario: Later allowlist removal does not rebind an accepted Run

- **WHEN** an exact entry or matching namespace wildcard is removed from restart-applied configuration after a Run accepted and snapshotted the filtered exact tool
- **THEN** that Run and its retries retain the bound authorization and declaration
- **AND** newly accepted Runs no longer advertise or execute the removed permission's unmatched tools

#### Scenario: Queue retry may repeat only a remote read

- **WHEN** a queue retry restarts a Run before a prior MCP call result was durably settled
- **THEN** the operator-attested read-only call may execute again
- **AND** no write-capable MCP operation is eligible under this capability

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

### Requirement: First tool is internal, read-only, own-data

The first code-owned tool SHALL remain conversation search over the requesting user's own chats, implemented against the **same server-side search service the web chat search uses**. Code-owned tools SHALL take authorization identity only from trusted Run context and SHALL remain tenant-scoped by datastore enforcement.

MCP tools MAY perform reads outside llame only through the `mcp-tools` capability, on either transport: a remote Streamable HTTP endpoint, or a local server llame runs as a child process. The operator SHALL explicitly configure the source and allowlist each executable namespaced tool exactly or allowlist that configured server's namespace. An exact entry SHALL attest that operation as read-only; a namespace wildcard SHALL attest every current and future safely admitted operation from that server as read-only. MCP execution SHALL receive no llame tenant authorization context, and no credential beyond what the operator configured for that server — request headers for a remote server, declared environment values and arguments for a local one. A local server additionally executes with the host privileges of the llame process itself, which the operator accepts by configuring it; llame bounds the protocol it speaks, not what the program does. Operators MUST NOT allowlist write, send, delete, execute, financial, or administrative MCP operations under either form or transport; llame does not infer or verify semantic effects from MCP metadata.

#### Scenario: Conversation search over own chats

- **WHEN** the model invokes the conversation-search tool with a query
- **THEN** it returns matches only from chats owned by the run's owner

#### Scenario: Tool and UI search share one implementation

- **WHEN** the conversation-search tool and the web chat search execute the same query for the same user
- **THEN** both are served by the same underlying search service

#### Scenario: No external network egress from tools

- **WHEN** the shipped code-owned toolset is enumerated
- **THEN** none performs outbound network requests
- **AND** the only external-tool exception is an explicitly configured MCP read selected by an exact entry or matching namespace wildcard under the operator's read-only attestation

#### Scenario: Explicit MCP read is the only external-tool exception

- **WHEN** the shipped toolset is enumerated
- **THEN** external network tools are limited to explicitly configured MCP ids carrying the operator's exact or namespace-wide read-only attestation
- **AND** no remote tool receives llame's trusted tenant datastore context

### Requirement: Durable, replayable tool activity

Tool calls and results SHALL persist as structured parts on the assistant message and stream as run events, with the same durability and replay guarantees as text/reasoning: a client that reconnects or refreshes mid-tool-execution SHALL reconstruct the full tool activity from the event stream/persisted parts. When a run hits the step cap, a structured **cap-marker part** SHALL persist on the assistant message alongside the call/result parts (history loads message parts, not run events — the cap notice must be reconstructable from persistence alone). Public chat sharing SHALL NOT expose tool parts (the existing text-only egress allowlist already excludes them — this requirement pins that it stays true for the new parts).

#### Scenario: Tool activity survives refresh

- **WHEN** the user refreshes mid-run while a tool is executing
- **THEN** the resumed stream reconstructs the tool call, its in-progress state, and (once done) its result

#### Scenario: Cap marker persists with the message

- **WHEN** a run hits the step cap and later completes
- **THEN** the assistant message's persisted parts include the cap marker, and a full chat reload renders the cap notice from it

#### Scenario: Tool parts never reach public shares

- **WHEN** a chat containing tool calls/results is shared publicly
- **THEN** the public payload contains no tool parts

### Requirement: Tool failure is an observation, not a crash

A tool that throws, times out, becomes unavailable, dynamically loses its trusted executor, or returns invalid output SHALL produce a structured error result — recorded, streamed, and visible to the model — and the run SHALL continue whenever the failure is isolated to that tool. Tool execution SHALL be bounded by the global `tools.callTimeoutSeconds` (operator config, documented built-in default 120). A trusted per-tool registration MAY only reduce that value and MUST be finite, positive, and no greater than the configured global maximum; an invalid override SHALL fail registration/admission before advertisement. The effective abort signal SHALL be forwarded into the executor and remote transport, and a timed-out MCP request/body SHALL be aborted and cleaned up before the structured timeout result settles. Tool errors SHALL never expose internal stack traces, remote exception bodies, or secrets in the recorded result.

Oversized tool results SHALL be truncated to a documented cap, measured in JavaScript UTF-16 code units over the serialized result, after secret redaction. Truncation SHALL operate on the tool's own payload rather than on the result envelope: the `status` discriminant and every top-level field the tool declared SHALL survive, with values shrunk in place. Where the declared field names alone exceed the cap, the cap SHALL win over the declared shape — trailing fields SHALL be omitted and the marker SHALL state how many of how many — so a result above the cap is never emitted. A string value SHALL be cut only on a Unicode code-point boundary, so no truncated payload contains a lone surrogate. Truncation SHALL NOT re-serialize any part of the payload into a string field, so redaction performed before truncation cannot be defeated by an alternate typed representation. A truncated result SHALL carry one visible truncation marker stating how many characters were omitted and the recovery action available to the model. When truncation shortens a list, the marker SHALL also state how many elements of that list survived out of how many it held, naming the lists that lost the most and counting any remainder, so a count read off a shortened list is not mistaken for a complete one. Error results SHALL NOT be truncated, because every error message this loop produces is a short, statically authored string.

A code-owned tool whose trusted executor is missing or incompatible, or whose live declaration no longer matches its immutable snapshot, SHALL remain a context-integrity failure for the Run before any provider request. A dynamic source tool that loses its executor, disconnects, or drifts after enqueue SHALL instead retain its snapshotted model-facing declaration with an unavailable executor for that Run, so a requested call settles non-fatally without substituting a changed contract.

#### Scenario: Tool error surfaces to the model and the run continues

- **WHEN** an executing tool throws
- **THEN** an error result part is recorded, the model observes it, and the run proceeds to a final answer

#### Scenario: Tool call times out

- **WHEN** a tool exceeds its effective timeout
- **THEN** execution and any remote request/body are aborted and cleaned up
- **AND** a structured timeout error result is recorded and the run continues

#### Scenario: Invalid trusted timeout override fails admission

- **WHEN** a trusted tool registers a non-finite, non-positive, or above-global timeout override
- **THEN** registration or admission fails before the tool is advertised

#### Scenario: Dynamic executor disappears after enqueue

- **WHEN** a dynamic tool was bound into a Run snapshot but its source disconnects before the model requests it
- **THEN** the call settles as structured `not_available`, no substitute executes, and the Run continues

#### Scenario: Code-owned declaration drift remains fail-closed

- **WHEN** a snapshotted code-owned tool no longer canonically matches its live trusted declaration
- **THEN** the Run fails before the provider request rather than executing a different contract

#### Scenario: Code-owned executor loss remains fail-closed

- **WHEN** a snapshotted code-owned tool has no compatible trusted executor at execution
- **THEN** the Run fails before the provider request rather than returning a dynamic unavailability observation

#### Scenario: Error results carry no internals

- **WHEN** a tool error result is recorded
- **THEN** it contains a safe message, not a stack trace, raw remote error, or configuration value

#### Scenario: Truncated success result keeps its declared shape

- **WHEN** a successful result serializes above the cap
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

### Requirement: Tool availability is source-neutral and bound per Run

Every new Run SHALL bind one canonical availability manifest covering exact tool ids relevant to that turn regardless of source, including code-owned tools such as `search_conversations`, MCP tools, and later tool sources. The manifest SHALL distinguish the exact eligible ids retained after operator-policy filtering, the exact declarations advertised to the model, and eligible exact ids unavailable for a closed server-authored reason. Configuration patterns SHALL NOT appear in the manifest. A tool never eligible and never previously visible in that chat SHALL not be disclosed through the manifest or reminders.

Every snapshot authored after this capability is deployed SHALL use an observed v1 manifest containing an `entries` array, including when its eligible catalog is empty. Historical snapshots that predate availability observation SHALL use exactly the canonical v0 sentinel `{"version":0,"state":"unobserved"}` with no `entries` field. Comparing a current manifest with that sentinel SHALL use initial-baseline semantics rather than treating the sentinel as an observed empty catalog. A v0 manifest with `entries`, a v1 manifest without `entries`, or any hybrid shape SHALL be rejected as malformed.

#### Scenario: Code-owned and MCP tools share availability semantics

- **WHEN** `search_conversations` and an exact MCP tool selected by an exact entry or namespace wildcard are both eligible for a turn
- **THEN** one manifest describes which exact declarations are advertised and which eligible ids are unavailable

#### Scenario: Unallowlisted discovery remains invisible

- **WHEN** a dynamic source discovers a tool that matches neither an exact entry nor a namespace wildcard and was not previously visible in the chat
- **THEN** its id and declaration appear in neither the model toolset nor an availability reminder

#### Scenario: Admission-refused discovery remains invisible

- **WHEN** a discovered dynamic tool fails declaration admission regardless of whether an exact or namespace permission would match its prospective id
- **THEN** its id and declaration appear in neither the source inventory, model toolset, nor an availability reminder

#### Scenario: Wildcard pattern remains configuration-only

- **WHEN** a namespace wildcard selects one or more admitted MCP tools
- **THEN** the availability manifest contains only their exact canonical ids and states
- **AND** no wildcard pattern is persisted or rendered to the model

#### Scenario: Historical absence of observation differs from an empty catalog

- **WHEN** historical snapshots are migrated before availability was ever observed
- **THEN** they receive exact canonical JSON `{"version":0,"state":"unobserved"}` and its availability hash
- **AND** the sentinel has no `entries` field
- **AND** it is distinct from an observed v1 manifest whose `entries` array is empty

### Requirement: Runtime tool availability is disclosed before the affected user turn

The API SHALL derive availability disclosure from strict server-authored semantic metadata, render the complete canonical context-item text before the triggering user message commits, and persist both together under producer `tool-availability`. The persisted text SHALL include the envelope, provenance, disclosure body, and closing delimiter and SHALL be the sole replay authority. The metadata SHALL retain ids, closed reason codes, and the bound Run id for machine behavior and provenance; it SHALL NOT retain remote-authored text, URLs, raw errors, or prompt contents. Client-authored availability parts MUST be rejected or discarded under the `context-injection` boundary contract.

On the first turn of a model-facing availability disclosure epoch, the reminder SHALL identify only eligible tools that are currently unavailable under the exact heading `Unavailable tools:`; callable tools are already advertised through the provider's native tool declarations on every request and SHALL NOT be duplicated in an initial prose inventory. A fresh conversation SHALL start the first disclosure epoch, and every newly active compaction checkpoint SHALL start another. On later turns within the epoch, the system SHALL compare each id's `absent`, `available`, or `unavailable` state between the current immutable manifest and the preceding accepted Run manifest in that epoch. Each changed id SHALL appear in exactly one group: absent to available as Added tools, available or unavailable to absent as Removed tools, absent to unavailable as Unavailable tools, available to unavailable as Became unavailable, and unavailable to available as Now available. Empty groups SHALL be omitted. `Added tools` SHALL contain only tools callable in the current Run. If availability is unchanged, no availability reminder SHALL be emitted, including while an outage persists.

When an eligible tool keeps the same id and remains available but its canonical declaration changes, the current Run SHALL bind and advertise the new declaration and declaration hash through the provider's native tool contract. Declaration-only drift SHALL NOT produce an availability reminder and SHALL NOT be represented as a synthetic Removed-plus-Added transition.

A prior Run whose user-message/Run/snapshot transaction committed SHALL establish the prior availability baseline regardless of whether that Run later completed, failed, was cancelled, or expired. Its persisted availability block SHALL remain model-visible verbatim on later Runs until superseded by compaction or another context rewrite. A request that fails before the transaction commits SHALL establish no baseline.

When the most recent prior Run manifest is the legacy/unobserved sentinel, the current turn SHALL follow the same initial-baseline semantics: disclose currently eligible unavailable tools, do not emit Added entries for healthy tools, and persist an observed v1 manifest for the new Run.

The first accepted turn after a newly active compaction checkpoint SHALL use the same initial-baseline semantics as a fresh conversation and SHALL NOT compare against a pre-compaction manifest: it SHALL list currently unavailable eligible tools under `Unavailable tools:` and SHALL emit no reminder when all eligible tools are available. This new disclosure epoch SHALL NOT reset MCP clients, catalogs, reconnect backoff, immutable Run manifests, or other runtime or persisted state. A semantic checkpoint MAY retain prior tool outages, recoveries, or failures when they mattered to the conversation; those statements SHALL be treated as historical context rather than current availability. The current request's provider-native declarations and current runtime availability reminder, when present, SHALL establish current callability.

At authoring time, the reminder SHALL instruct the model not to simulate removed or unavailable tools or invent their results. Tool ids and reason prose SHALL be rendered only from validated ids and closed server-authored reason codes. Its persisted position relative to other context items SHALL follow the `context-injection` capability's author-time order, and later replay SHALL preserve that stored position without re-rendering or re-sorting it.

#### Scenario: Initial turn starts degraded

- **WHEN** the first turn has an eligible tool whose source is unavailable
- **THEN** a runtime availability reminder names the tool under `Unavailable tools:` in its shared author-time position before the user text

#### Scenario: Initial healthy turn uses native tool declarations

- **WHEN** every eligible tool is available on the chat's first turn
- **THEN** the provider's native tool declarations advertise the callable tools
- **AND** no runtime availability reminder duplicates them in prose

#### Scenario: Existing chat establishes its first observed baseline after migration

- **WHEN** the latest prior Run uses the legacy/unobserved sentinel and the current turn has healthy eligible tools
- **THEN** the provider's native tool declarations advertise those tools
- **AND** no Added-tools reminder is fabricated from the migration sentinel
- **AND** the new Run binds an observed v1 manifest

#### Scenario: Availability changes between turns

- **WHEN** the current manifest differs observably from the previous turn's manifest
- **THEN** the persisted reminder contains only the non-empty Added, Removed, Unavailable, Became unavailable, and Now available groups
- **AND** each changed id appears in exactly one group

#### Scenario: Newly eligible tool starts unavailable

- **WHEN** a tool was absent on the prior turn and is eligible but unavailable on the current turn
- **THEN** it appears under `Unavailable tools:` with a closed reason
- **AND** it does not appear under `Added tools:`

#### Scenario: Declaration-only drift uses the native contract

- **WHEN** an eligible tool remains available under the same id but its canonical declaration changes
- **THEN** the current Run advertises and binds the new native declaration and declaration hash
- **AND** no runtime availability reminder is emitted solely for that declaration change

#### Scenario: Failed prior Run still establishes the baseline

- **WHEN** an accepted prior Run binds an availability manifest and later fails
- **THEN** the next turn compares against that prior Run's manifest
- **AND** its persisted availability text remains in portable history unchanged until a context rewrite removes it

#### Scenario: Unchanged outage emits no reminder

- **WHEN** an unavailable tool has not changed state since the prior turn
- **THEN** no runtime availability reminder is added solely because the outage persists

#### Scenario: Compaction starts a degraded disclosure epoch

- **WHEN** a newly active compaction checkpoint is followed by a turn with an eligible unavailable tool
- **THEN** that turn uses fresh-conversation semantics and lists the tool under `Unavailable tools:`
- **AND** it does not emit a transition relative to the pre-compaction manifest
- **AND** a later unchanged turn does not repeat the reminder

#### Scenario: Compaction starts a healthy disclosure epoch

- **WHEN** a newly active compaction checkpoint is followed by a turn where every eligible tool is available
- **THEN** provider-native declarations advertise the callable tools
- **AND** no availability reminder or pre-compaction transition is emitted

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

#### Scenario: Transient flap recovers between turns

- **WHEN** a tool disconnects and reconnects between two turn snapshots with the same final availability and declaration
- **THEN** no operational event reminder is emitted solely for the recovered transient flap

#### Scenario: Availability renderer changes

- **WHEN** a later release changes availability wording or reason labels and replays an existing disclosure
- **THEN** the existing disclosure uses its persisted complete text unchanged
- **AND** only newly authored disclosures use the new wording

### Requirement: Tool input schemas may be declared as JSON Schema

A tool SHALL be able to declare its input schema directly as JSON Schema, not only in code. Both forms SHALL receive the same argument validation, the same safety classification gate, the same operator allowlist gate, and the same tenant-scoped execution — neither form SHALL be privileged or exempted.

Argument validation SHALL be **effective**, not merely declared: a schema whose constraints are advertised to the provider but never checked against the returned arguments does not satisfy this requirement. Where the model SDK validates only when a validator is present, one SHALL be supplied, and a failure SHALL surface through the same non-fatal refusal path as any other invalid tool call rather than through a separate error shape.

A tool's schema SHALL be consumed without dialect rewriting. Nothing in this codebase SHALL require a source to declare, restate, or adjust its schema to a preferred JSON Schema dialect — external sources author their own schemas. A schema that declares a supported dialect and compiles successfully SHALL be accepted as shipped; lack of an available validator or compilation failure remains the explicit refusal case below.

Arguments SHALL be validated under the dialect the schema itself declares. Where no `$schema` is declared, draft-07 SHALL be assumed, matching both the model SDK's tool-schema typing and prevailing practice for tool schemas. Semantically equivalent URI forms for a supported dialect SHALL resolve to the same validator without rewriting the source document. A schema SHALL be refused only when it cannot be checked faithfully: no validator for its declared dialect is available, or the schema is malformed or invalid and cannot be compiled by that validator. The refusal SHALL name the affected tool and declared or assumed dialect, SHALL happen before the declaration enters the immutable context snapshot, and SHALL NOT affect valid sibling tools. Validating a schema under a dialect other than its own SHALL NOT be done, because keywords such as `items` carry different meaning between dialects and the mismatch would silently enforce something the author did not write.

Standard JSON Schema formats supported by the validator integration, including `email`, `uri`, and `date-time`, SHALL be enforced when a schema declares them. Advertising a format while silently accepting values that violate it does not satisfy effective validation.

Comparing a bound snapshot declaration against its live tool SHALL NOT convert a schema that is already JSON Schema into another representation and back. Comparison SHALL be by **canonical equality**: two declarations are equal when their canonical forms — recursively key-sorted, with no other normalization — are identical. Key order and other insignificant serialization differences SHALL NOT count as drift; any difference in schema content SHALL. The same canonicalization SHALL be used when the snapshot is written and when it is compared, so the two can never disagree.

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
- **THEN** the malformed tool is refused before snapshotting, naming the tool and dialect, while the valid sibling remains available

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

- **WHEN** a run binds a snapshot declaring a JSON-Schema tool and later executes it, with nothing about that tool changed
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

### Requirement: Tool observations survive into later turns as stored UI parts

A round's tool activity SHALL remain available to the model in later turns
within the bounded replay contract below. What a tool was asked and what it
returned or failed to return SHALL be representable on the next turn unless an
older complete observation must be omitted to enforce the hard budget.

Each replayed observation SHALL carry tool identity, input while its payload
fits, and structured outcome. Calls refused, cancelled, timed out, unavailable,
execution-failed, search-failed, or otherwise errored SHALL retain that outcome
rather than disappearing. Legacy output-error parts without structured outcome
SHALL map to generic `error` without parsing human prose; structured
cancellation metadata MAY recover `cancelled`.

Ordinary stored assistant parts SHALL replay through the existing conventional
AI SDK tool-call/tool-result projection until #599 establishes the canonical UI
message persistence contract. Every projected call SHALL be accompanied by its
matching result, including a well-formed result for a call with no genuine tool
result. Provider-native reasoning/metadata, credentials, and unrelated payloads
SHALL NOT replay.

The ordinary projection SHALL remain:

- portable through SDK tool-call and tool-result parts rather than
  provider-specific structures;
- labelled untrusted inside result content;
- neutralized so remote-authored result content cannot forge a reserved
  structural boundary;
- bounded in JavaScript UTF-16 code units over the exact serialized pair, at
  8,000 per pair and 32,000 per stored assistant turn;
- reduced by preserving pairing before budget, newer observations before older
  ones, and identity/outcome before payload; and
- stable for the same unmodified stored turn under the current explicit
  best-effort projector.

Payloads SHALL clear oldest-first only when clearing shrinks the envelope. If
irreducible pairs still exceed a limit, the oldest complete pairs SHALL be
dropped atomically until the projection fits, with one bounded omission count
and marker. An unmatched call or result SHALL never be emitted.

Visible assistant text and retained tool occurrences SHALL keep their current
chronology. Because ordinary stored messages do not prove parallel or step
boundaries, consecutive calls SHALL continue to project conservatively as
standalone sequential matched pairs. This behavior SHALL NOT be generalized or
rewritten by this change; its research/refactor is scoped by #599.

Compaction SHALL replace the semantic observation ledger with final
message-shaped replacement records. Ordinary and transition compaction SHALL:

1. correlate complete stored call/result observations by `toolCallId`;
2. combine them with tool records from the previous replacement history;
3. enforce the same complete-pair selection, per-pair limit, total 32,000-unit
   budget, newer-pair preference, payload clearing, outcome preservation, and
   bounded omission count; and
4. persist the selected final AI SDK UI `tool-*` parts in replacement history,
   with one complete pair per assistant replacement record and any omission
   marker in its own assistant text record.

The stored final replacement parts SHALL be the sole authority after compaction.
Model replay and cache-aligned compaction input SHALL order the user checkpoint
record first, the stored compacted tool records second, and the retained live
window last. Replay SHALL NOT regenerate tool parts from semantic fields,
re-clear payloads, recompute budgets, or reorder records. A later compaction MAY
materialize a new bounded replacement and omit older complete records, but it
SHALL consume the prior stored records rather than a ledger.

Replacement history SHALL remain RLS-scoped internal state and SHALL NOT enter
public DTOs, search indexes, or ordinary exports. No legacy ledger reader,
empty-ledger sentinel, or inference from summary prose SHALL exist.

The live tool loop SHALL continue to observe its own results within the turn
that produced them.

#### Scenario: A later turn can use an earlier tool result

- **WHEN** a tool returns a result and the user asks about it later
- **THEN** the later request carries its identity, input when retained, result,
  and outcome through the conventional SDK representation

#### Scenario: An unsuccessful call is projected as unsuccessful

- **WHEN** a prior call was refused, cancelled, errored, or timed out
- **THEN** later replay carries a matched result reporting that outcome
- **AND** the call is not silently omitted solely because it failed

#### Scenario: A cancelled call is projected as cancelled

- **WHEN** a prior call was settled by Run termination
- **THEN** its matching result reports `cancelled`
- **AND** it remains distinguishable from a tool-produced error

#### Scenario: A tool call made during reasoning is projected

- **WHEN** a tool was called while reasoning output was produced
- **THEN** the call/result observation follows the same replay contract
- **AND** the reasoning part remains display-only

#### Scenario: Every replayed call has a matching replayed result

- **WHEN** a later request replays stored tool activity
- **THEN** every retained call is immediately paired with its result
- **AND** unmatched calls/results are omitted atomically

#### Scenario: A call with no genuine result still carries a well-formed result

- **WHEN** a call was cancelled, refused, errored, or timed out before a genuine
  tool result existed
- **THEN** replay supplies a well-formed result carrying that outcome
- **AND** it does not narrate the absence as unrelated assistant prose

#### Scenario: Provider reasoning and metadata are never replayed

- **WHEN** stored tool activity includes reasoning or provider metadata
- **THEN** portable observations remain available across model/provider switches
- **AND** originating-provider reasoning and metadata do not replay

#### Scenario: A model or provider switch keeps observations but not provider metadata

- **WHEN** a chat with tool activity continues on another model or provider
- **THEN** portable matched observations remain available through the target
  SDK conversion
- **AND** originating-provider metadata is excluded

#### Scenario: The projection is labelled untrusted

- **WHEN** an ordinary or compacted tool result is replayed
- **THEN** its own result content identifies it as untrusted tool output
- **AND** instruction-like payload text carries no authority

#### Scenario: Replayed content cannot escape its boundary

- **WHEN** a tool result attempts to forge or close a reserved boundary
- **THEN** the replayed result is neutralized under the tool projection contract
- **AND** surrounding structure remains intact

#### Scenario: The projection is stable across turns

- **WHEN** the same unmodified ordinary stored tool part replays twice
- **THEN** the current projector produces the same application content
- **AND** final compacted UI parts replay directly from replacement history

#### Scenario: Interleaved text and tools retain chronology

- **WHEN** an assistant turn contains visible text, tool calls, and later text
- **THEN** the current projector retains their occurrence order as standalone
  text and sequential matched pairs
- **AND** the implementation points to #599 instead of claiming proven step
  boundaries

#### Scenario: Visible text does not consume the observation budget

- **WHEN** visible assistant text surrounds capped tool observations
- **THEN** visible text retains its occurrence order outside the observation
  budget
- **AND** it does not cause an otherwise-retained pair to be dropped

#### Scenario: Hard limits preserve pairing and newest observations

- **WHEN** a serialized pair or turn exceeds its hard limit
- **THEN** payloads clear only when useful, then oldest complete pairs are
  omitted until the result fits
- **AND** exactly one bounded omission marker is retained and call/result counts
  remain equal

#### Scenario: Compaction carries cleared observations across lineage

- **WHEN** ordinary or transition compaction absorbs tool activity
- **THEN** it writes already selected, bounded, payload-cleared final UI tool
  parts into replacement history
- **AND** the next request replays those stored records after the checkpoint and
  before live history without a tool-observation renderer

#### Scenario: Recursive compaction consumes replacement history

- **WHEN** a later compaction supersedes a prior compaction
- **THEN** it consumes prior stored replacement records plus newly absorbed
  observations
- **AND** it writes a wholly new bounded replacement rather than reconstructing
  or extending a semantic ledger

#### Scenario: Existing compactions cannot recover already-absorbed observations

- **WHEN** an active compaction lacks valid replacement history
- **THEN** request preparation fails closed
- **AND** no old ledger or summary prose is used to invent tool observations

#### Scenario: The live loop still observes its own tool results

- **WHEN** a tool executes during a Run
- **THEN** its result remains available within that same Run's tool loop

### Requirement: No mid-run tool-state checkpointing (read-only slice; write-tool landmine)

This slice SHALL NOT checkpoint tool-loop state across worker death: a run that fails or expires mid-loop is not resumed — a retry re-executes tools from the start, which is acceptable **only because every executable tool is read-only**. The first write-capable tool SHALL NOT ship without introducing checkpoint-or-dedupe semantics for tool execution on retry. (Client refresh during a live run is unaffected — run-event replay reconstructs tool activity without re-execution.)

The retry that makes this load-bearing is concrete and always on: the run queue retries a failed **job attempt** under its own policy. A job attempt failing is not the same as the run reaching a terminal state — a retried attempt re-enters the tool loop from the first step only while its run is still claimable, and a run already terminal is never reopened. Re-execution is therefore the default behavior on infrastructure failure, not an edge case — a write-capable tool added without checkpoint-or-dedupe semantics would double-apply its effect on any transient worker failure, with no configuration change required to trigger it.

#### Scenario: Worker death mid-loop does not resume tool state

- **WHEN** the worker dies after several completed tool steps and the run is expired by the deadman
- **THEN** the run terminates per existing semantics; no partial tool-loop state is resumed on a new run

#### Scenario: Refresh does not re-execute tools

- **WHEN** a client reconnects to a live run after tool steps have completed
- **THEN** the replayed stream reconstructs those steps from events without executing any tool again

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** a run's job is retried by the queue and the run is still claimable
- **THEN** its tool loop executes from the first step again, re-invoking tools already invoked in the previous attempt

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** a job is retried for a run that has already reached a terminal state
- **THEN** the run is not reopened, no tool executes, and its terminal state stands

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

### Requirement: Code-owned Knowledge tools use the existing immutable read-only loop

The code-owned tool inventory SHALL include `knowledge_search` and `knowledge_read` in addition to `search_conversations`. Each SHALL declare `read_only`, require its own exact entry in `tools.allowed`, and participate in the same declaration admission, immutable Run tool snapshot, execution rebinding, timeout, abort, settlement, persistence, replay, compaction, result neutralization, truncation, and browser-rendering contracts as every other code-owned tool. The Run tool snapshot SHALL bind operation eligibility and declarations, not a Knowledge resource inventory.

The operator allowlist controls only whether these fixed operations are eligible. It SHALL NOT choose an owner, configured root, child directory, path root, or execution location. A permitted Knowledge tool MAY accept a stable Knowledge Space selector as defined by its code-owned schema, but current authority for that selector MUST come from the trusted Run owner at execution time. Model input SHALL NOT supply or expand ownership or local filesystem authority.

For each newly accepted Run, the code-owned candidate resolver SHALL use the static declaration, safety classification, exact allowlist entry, and configured Knowledge root to determine Knowledge tool availability. It SHALL NOT query or snapshot the owner's Knowledge Space inventory. With a configured root, an owner with zero current resources SHALL still receive the callable tool declarations; invocation SHALL return `knowledge_space_not_configured`. Without a configured root, each otherwise-eligible Knowledge tool SHALL retain the closed `knowledge_space_unavailable` manifest state. The API request path SHALL NOT probe the filesystem.

Worker execution SHALL receive the private filesystem resolver through trusted dependency injection or tool context and current owner identity through trusted Run context. It SHALL resolve current owner resources under RLS for every invocation and SHALL NOT serialize local binding data into declarations or accept it from model input.

Knowledge results SHALL retain the global execution envelope `status: "success" | "error"`; this change SHALL NOT add a generic `partial` status. A successful `knowledge_search` MAY additionally declare `complete: false` with bounded warnings. While its full payload is present, that structured result remains usable. Whenever a later model-replay projection clears that payload—including ordinary bounded next-turn projection and compaction into the observation ledger—the payload-cleared observation SHALL carry outcome `incomplete`, not `success`; later replay SHALL preserve that outcome. Other successful tool results SHALL continue to project and compact as `success`. General partial-result semantics outside Knowledge are not defined by this requirement.

New Knowledge results SHALL persist and render the current passage/range attribution defined by `knowledge-tools` without requiring a content hash. Historical persisted Knowledge results MAY retain their earlier hash-bearing shape. Execution, persistence, replay, compaction, and browser rendering SHALL preserve either bounded observation as authored and SHALL NOT normalize historical results into the new shape or synthesize removed fields. Existing persisted calls without new optional range or cursor arguments SHALL remain valid observations.

Changing either code-owned Knowledge declaration SHALL be a coordinated API/worker revision boundary because an accepted Run binds the exact declaration and a code-owned executor refuses drift. Before replacing binaries for the ranged-read declaration and again before replacing binaries for the passage-search declaration, the deployment SHALL quiesce new Run acceptance and drain every accepted Run bound to the prior declaration. It SHALL deploy matching API and worker binaries before resuming acceptance. Rollback SHALL quiesce and drain Runs bound to the newer declaration before restoring older API or worker binaries. No mixed-revision executor fallback or declaration normalization is introduced by this change.

The canonical closed Knowledge reason vocabulary and model-safe label mapping SHALL retain `knowledge_space_not_configured` and `knowledge_space_unavailable`. Because zero inventory no longer changes tool availability, `knowledge_space_not_configured` SHALL be emitted only as a tool-call result, not as an immutable manifest state. `knowledge_space_unavailable` and its existing recovery mapping SHALL continue to govern missing process configuration without admitting arbitrary reason text.

#### Scenario: Knowledge tool is not allowlisted

- **WHEN** a Knowledge tool is registered but its exact ID is absent from `tools.allowed`
- **THEN** it is neither advertised nor executable for a newly accepted Run

#### Scenario: Allowlisted Knowledge tool is snapshotted

- **WHEN** an exact Knowledge tool ID is allowlisted for a newly accepted Run with a configured Knowledge root
- **THEN** its exact declaration is included in that Run's immutable tool snapshot regardless of current owner inventory
- **AND** execution requires the matching code-owned read-only executor

#### Scenario: Eligible Knowledge tool starts unavailable

- **WHEN** a Knowledge tool is allowlisted but the authoring API has no configured Knowledge root
- **THEN** the Run manifest records `knowledge_space_unavailable`
- **AND** the tool is not advertised as callable for that Run

#### Scenario: Knowledge availability recovery uses the closed mapping

- **WHEN** a later accepted Run changes `knowledge_space_unavailable` to available within the disclosure epoch
- **THEN** its `Now available` transition uses `knowledge_space_restored`
- **AND** no root, host path, or arbitrary reason text is rendered

#### Scenario: Knowledge observation persists through reload and replay

- **WHEN** an allowlisted Knowledge tool completes with passage/range attribution and no content hash
- **THEN** its call and structured result persist and render after browser reload
- **AND** later model replay receives the complete matched pair, a payload-cleared matched pair with honest `success`, `incomplete`, or error outcome, or a bounded omission marker according to the existing pair and turn/ledger budgets

#### Scenario: Historical Knowledge observation is not rewritten

- **WHEN** a persisted Knowledge observation uses the earlier hash-bearing result shape
- **THEN** reload and replay preserve the bounded observation as authored
- **AND** no migration or projection invents new range fields or removes its historical fields

#### Scenario: Knowledge declaration cutover drains prior Runs

- **WHEN** a deployment changes the code-owned declaration for either Knowledge tool
- **THEN** it stops accepting new Runs and drains Runs bound to the prior declaration before replacing API or worker binaries
- **AND** acceptance resumes only after every executing process exposes the matching declaration and executor

#### Scenario: Tool permission cannot alter filesystem authority

- **WHEN** an operator allowlists either Knowledge tool
- **THEN** the permission makes only that fixed operation eligible
- **AND** any supplied space selector still resolves solely through current trusted owner authority

#### Scenario: Zero inventory remains model-visible

- **WHEN** a Run owner has no current Knowledge Spaces but the Knowledge tools are otherwise eligible
- **THEN** the tools are advertised as callable
- **AND** invocation returns the closed `knowledge_space_not_configured` result

#### Scenario: Incomplete Knowledge search stays incomplete after payload clearing

- **WHEN** `knowledge_search` returns `status: "success"` with `complete: false` and its payload is later cleared by any model-replay projection
- **THEN** the payload-cleared observation and subsequent replay carry outcome `incomplete`
- **AND** the call is not upgraded to complete success

### Requirement: Conversation read uses the existing immutable read-only tool loop

The code-owned tool inventory SHALL include `conversation_read` in addition to `search_conversations`, `knowledge_search`, and `knowledge_read`. It SHALL declare `read_only`, require its own exact `tools.allowed` entry, and participate in the existing declaration admission, immutable Run snapshot, execution rebinding, timeout, cooperative cancellation, settlement, persistence, replay, compaction, neutralization, and generic browser-rendering lifecycle. Owner authority SHALL come only from trusted Run context, never from model arguments or a message locator.

The conversation reader SHALL enforce the `conversation-reads` bounds of 2,000 logical lines and 15,000 JavaScript UTF-16 code units before generic result truncation. A read whose first selected source line cannot fit SHALL return `conversation_limit_exceeded`. Bounded pages SHALL preserve exact `nextOffset` and cut-reason metadata, and generic truncation SHALL NOT clip numbered source content.

Structured Chat/message sequence attribution, role/timestamp, numbered content, neighboring eligible sequences, continuation metadata, and the closed untrusted-history notice SHALL persist and render as authored through the ordinary tool UI. Replay SHALL NOT rehydrate newer message content, synthesize hashes/UUIDs/versions/part identities, remove line prefixes/notices, or normalize historical result shapes. Adding or changing the code-owned declaration or Chat-local sequence semantics SHALL use a coordinated API/worker/data cutover: quiesce new Run acceptance, drain Runs bound to the prior declaration and sequence interpretation, migrate durable sequence boundaries, deploy matching executors/declarations, then resume; rollback SHALL restore the matching prior binaries and data snapshot rather than mix locator interpretations.

A persisted conversation-read observation SHALL follow the destination Chat's existing retention and deletion lifecycle. Product behavior SHALL NOT delete an individual source message. Deleting or later losing access to the source Chat SHALL make a fresh read return `conversation_source_not_found` but SHALL NOT redact or rewrite text already recorded in another owner-visible Chat. Deleting the destination Chat SHALL remove its messages, Runs, and Run events through the existing cascade lifecycle.

Because the global-to-Chat-local sequence rewrite is a pre-merge alpha hard cutover, deployment SHALL preflight persisted assistant parts, compaction replacement history, and Run events before changing sequence values. If it finds an experimental canonical `search_conversations` result or `conversation_read` input/result authored under the prior global interpretation, the cutover SHALL abort before mutation. It SHALL NOT rewrite the historical observation, accept its global value as an alias, or guess between colliding locator namespaces. The unsupported experimental Chat or database must be removed/reset as a whole before retrying the cutover.

#### Scenario: Conversation reader is not allowlisted

- **WHEN** `conversation_read` is registered but absent from `tools.allowed`
- **THEN** it is neither advertised nor executable for a newly accepted Run

#### Scenario: Allowlisted reader is bound immutably

- **WHEN** the exact reader ID is eligible for a newly accepted Run
- **THEN** that Run snapshots its exact declaration and requires the matching code-owned executor
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
