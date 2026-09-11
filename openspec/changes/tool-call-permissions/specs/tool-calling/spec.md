## MODIFIED Requirements

### Requirement: Fail-closed operator availability gate

Tool eligibility SHALL be governed by the operator allowlist in `llame.config.json` (`tools.allowed`). The default SHALL be an empty allowlist — an instance with no tools configured runs exactly as before this change (no tools advertised, none executable). The system SHALL first construct its source-owned inventory from registered code-owned tools and the safely admitted current or remembered-unavailable MCP inventory, then apply `tools.allowed` strictly as a boolean permission predicate over each candidate's canonical `tool.id`. Code-owned ids SHALL require exact entries. A canonical MCP id SHALL match either the same exact entry or a validated namespace rule `mcp__<configured-server>__*` whose terminal `*` is removed for literal ID-prefix comparison. Matching SHALL be case-sensitive. The validated trailing separator SHALL prevent one server prefix from matching a longer server id, and the reserved `mcp__` namespace SHALL prevent matching code-owned tools. Permission rules SHALL NOT create, copy, expand, or deduplicate candidates. A tool that matches no rule SHALL be neither advertised to the model nor executed if requested.

Exact and namespace MCP entries SHALL grant eligibility only to exact identities learned from safely admitted declarations for that server. When a live process loses the server transport, the last completely admitted identity set SHALL remain source inventory in an unavailable state; when complete discovery succeeds, its newly admitted identity set SHALL replace the prior set authoritatively. Neither permission form SHALL fabricate identities before first successful discovery or expose refused declarations. An eligible dynamic tool SHALL become advertisable or executable only while the source supplies a currently admitted declaration for that exact id under the operator's read-only attestation.

The restart-applied allowlist decision SHALL be bound into the immutable Run snapshot as filtered exact ids and exact declarations when a turn is accepted; wildcard patterns SHALL NOT enter provider requests, manifests, receipts, persistence, or execution binding. Removing an exact entry or namespace wildcard from later instance configuration SHALL affect newly accepted Runs but SHALL NOT retroactively rebind an already accepted Run or its queue retries. This snapshot binds availability, not a permanent exemption from execution permission checks. The executing process SHALL additionally apply its startup-loaded `tools.permissions` policy to each new invocation, including calls from older Runs. Hot policy reload remains outside this capability; operator changes require a restart. Remote tools remain restricted to operator-attested read-only operations. Write-capable MCP tools remain prohibited even when they claim idempotence; durable side-effect checkpointing and permission policy are separate follow-ups.

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
- **THEN** that Run and its retries retain the bound availability and declaration, subject to the executing process's call-permission policy
- **AND** newly accepted Runs no longer advertise or execute the removed permission's unmatched tools

#### Scenario: Queue retry may repeat only a remote read

- **WHEN** a queue retry restarts a Run before a prior MCP call result was durably settled
- **THEN** the operator-attested read-only call may execute again
- **AND** no write-capable MCP operation is eligible under this capability

#### Scenario: Permission reject does not hide a tool

- **WHEN** a tool remains admitted by `tools.allowed` and its execution permission group rejects every call
- **THEN** permission evaluation does not remove it from the immutable catalog or availability manifest
- **AND** attempted calls receive a non-fatal `permission_denied` observation

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
the three native tools when the process has accepted native host authority or
has a configured Knowledge root, and SHALL leave them unavailable when it has
neither. A configured Knowledge root admits only `read`, `edit`, and `write`;
`bash` and every other host-capability tool remain admitted solely by accepted
native host authority.

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
- **THEN** the three tools are advertised and executable for `kb://` locators
- **AND** an absolute path fails closed with `executor_unavailable`

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

### Requirement: Tool failure is an observation, not a crash

An uncertain native `edit` or `write` outcome SHALL abort the model execution
signal and settle the Run without further tool steps. Its tool observation SHALL
report `outcome_unknown` unless a known result is already durable. Ordinary
isolated failures retain the continuation behavior below.

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

#### Scenario: Permission rejection is a non-fatal tool observation

- **WHEN** the execution policy rejects an otherwise valid available tool call
- **THEN** no tool executor or native effect attempt starts
- **AND** the model receives `permission_denied` and may continue within existing Run limits
- **AND** the system neither retries the rejected call automatically nor requests approval

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
