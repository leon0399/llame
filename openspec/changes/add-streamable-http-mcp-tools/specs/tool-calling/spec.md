## MODIFIED Requirements

### Requirement: Fail-closed operator availability gate

Tool eligibility SHALL be governed by the operator allowlist in `llame.config.json` (`tools.allowed`). The default SHALL be an empty allowlist — an instance with no tools configured runs exactly as before this change (no tools advertised, none executable). A tool absent from the allowlist SHALL be neither advertised to the model nor executed if requested. Code-owned ids SHALL remain strictly registered at boot; syntactically valid namespaced dynamic ids SHALL be allowed to remain eligible while their declared source is unavailable, but SHALL become advertisable or executable only after the source supplies a currently admitted declaration for that exact id under the operator's read-only attestation.

The restart-applied allowlist decision SHALL be bound into the immutable Run snapshot when a turn is accepted. Removing an id from later instance configuration SHALL affect newly accepted Runs but SHALL NOT retroactively rebind an already accepted Run or its queue retries. Immediate live revocation is outside this capability and requires the future permission-policy system; this bound authorization is permitted here only because every admitted tool is operator-attested read-only or idempotent.

#### Scenario: Default is no tools

- **WHEN** the operator config does not set `tools.allowed`
- **THEN** runs never advertise or execute any tool

#### Scenario: Unlisted tool is not advertised

- **WHEN** a registered code-owned tool or discovered dynamic tool is absent from the allowlist
- **THEN** it does not appear in the toolset offered to the model

#### Scenario: Unlisted tool is refused

- **WHEN** the model requests a tool that is not in the allowlist
- **THEN** the call is refused with a recorded, non-fatal tool error and the run continues

#### Scenario: Unknown code-owned tool id fails boot

- **WHEN** `tools.allowed` names a non-namespaced tool id that is not registered in code
- **THEN** startup fails naming the offending config path and id

#### Scenario: Eligible dynamic tool can remain unavailable

- **WHEN** `tools.allowed` names a valid dynamic tool whose declared source cannot currently supply an admitted declaration
- **THEN** startup and unrelated Runs remain usable
- **AND** that tool is not advertised or executable for newly bound Runs

#### Scenario: Later allowlist removal does not rebind an accepted Run

- **WHEN** a tool is removed from restart-applied configuration after a Run accepted and snapshotted it
- **THEN** that Run and its retries retain the bound authorization and declaration
- **AND** newly accepted Runs no longer advertise or execute the removed tool

### Requirement: First tool is internal, read-only, own-data

The first code-owned tool SHALL remain conversation search over the requesting user's own chats, implemented against the **same server-side search service the web chat search uses**. Code-owned tools SHALL take authorization identity only from trusted Run context and SHALL remain tenant-scoped by datastore enforcement.

Remote MCP tools MAY perform outbound network reads only through the `mcp-tools` capability: the operator SHALL explicitly configure the remote source and allowlist each executable namespaced tool, every such allowlist entry SHALL be the operator's attestation that the operation is read-only, and remote execution SHALL receive no llame tenant authorization context or credential other than the operator-configured headers for that MCP server. Operators MUST NOT allowlist write, send, delete, execute, financial, or administrative MCP operations under this exception; llame does not infer or verify remote semantic effects from MCP metadata.

#### Scenario: Conversation search over own chats

- **WHEN** the model invokes the conversation-search tool with a query
- **THEN** it returns matches only from chats owned by the run's owner

#### Scenario: Tool and UI search share one implementation

- **WHEN** the conversation-search tool and the web chat search execute the same query for the same user
- **THEN** both are served by the same underlying search service

#### Scenario: Explicit MCP read is the only external-tool exception

- **WHEN** the shipped toolset is enumerated
- **THEN** external network tools are limited to explicitly configured MCP ids carrying the operator's read-only attestation
- **AND** no remote tool receives llame's trusted tenant datastore context

### Requirement: Tool failure is an observation, not a crash

A tool that throws, times out, becomes unavailable, dynamically loses its trusted executor, or returns invalid output SHALL produce a structured error result — recorded, streamed, and visible to the model — and the run SHALL continue whenever the failure is isolated to that tool. Tool execution SHALL be bounded by the global `tools.callTimeoutSeconds` (operator config, documented built-in default 15). A trusted per-tool registration MAY only reduce that value and MUST be finite, positive, and no greater than the configured global maximum; an invalid override SHALL fail registration/admission before advertisement. The effective abort signal SHALL be forwarded into the executor and remote transport, and a timed-out MCP request/body SHALL be aborted and cleaned up before the structured timeout result settles. Tool errors SHALL never expose internal stack traces, remote exception bodies, or secrets in the recorded result. Oversized tool results SHALL be truncated to a documented cap with a visible truncation marker after secret redaction.

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

## ADDED Requirements

### Requirement: Tool availability is source-neutral and bound per Run

Every new Run SHALL bind one canonical availability manifest covering tool ids relevant to that turn regardless of source, including code-owned tools such as `search_conversations`, MCP tools, and later tool sources. The manifest SHALL distinguish the eligible ids selected by operator policy, the exact declarations advertised to the model, and eligible ids unavailable for a closed server-authored reason. A tool never eligible and never previously visible in that chat SHALL not be disclosed through the manifest or reminders.

Every snapshot authored after this capability is deployed SHALL use an observed v1 manifest containing an `entries` array, including when its eligible catalog is empty. Historical snapshots that predate availability observation SHALL use exactly the canonical v0 sentinel `{"version":0,"state":"unobserved"}` with no `entries` field. Comparing a current manifest with that sentinel SHALL use initial-baseline semantics rather than treating the sentinel as an observed empty catalog. A v0 manifest with `entries`, a v1 manifest without `entries`, or any hybrid shape SHALL be rejected as malformed.

#### Scenario: Code-owned and MCP tools share availability semantics

- **WHEN** `search_conversations` and an MCP search tool are both eligible for a turn
- **THEN** one manifest describes which exact declarations are advertised and which eligible ids are unavailable

#### Scenario: Unallowlisted discovery remains invisible

- **WHEN** a dynamic source discovers a tool that is neither allowlisted nor previously visible in the chat
- **THEN** its id and declaration appear in neither the model toolset nor an availability reminder

#### Scenario: Historical absence of observation differs from an empty catalog

- **WHEN** historical snapshots are migrated before availability was ever observed
- **THEN** they receive exact canonical JSON `{"version":0,"state":"unobserved"}` and its availability hash
- **AND** the sentinel has no `entries` field
- **AND** it is distinct from an observed v1 manifest whose `entries` array is empty

### Requirement: Runtime tool availability is disclosed before the affected user turn

The API SHALL persist strict server-authored, non-text semantic metadata on a triggering user message and SHALL render it as a canonical `<runtime-tool-availability>` reminder immediately before that message's visible user text. Client-authored availability metadata MUST be discarded. The persisted metadata SHALL contain ids, closed reason codes, and the bound Run id, not literal reminder prose, remote-authored text, URLs, or raw errors.

On the first turn of a model-facing availability disclosure epoch, the reminder SHALL identify only eligible tools that are currently unavailable under the exact heading `Unavailable tools:`; callable tools are already advertised through the provider's native tool declarations on every request and SHALL NOT be duplicated in an initial prose inventory. A fresh conversation SHALL start the first disclosure epoch, and every newly active compaction checkpoint SHALL start another. On later turns within the epoch, the system SHALL compare each id's `absent`, `available`, or `unavailable` state between the current immutable manifest and the preceding accepted Run manifest in that epoch. Each changed id SHALL appear in exactly one group: absent to available as Added tools, available or unavailable to absent as Removed tools, absent to unavailable as Unavailable tools, available to unavailable as Became unavailable, and unavailable to available as Now available. Empty groups SHALL be omitted. `Added tools` SHALL contain only tools callable in the current Run. If availability is unchanged, no availability reminder SHALL be emitted, including while an outage persists.

When an eligible tool keeps the same id and remains available but its canonical declaration changes, the current Run SHALL bind and advertise the new declaration and declaration hash through the provider's native tool contract. Declaration-only drift SHALL NOT produce an availability reminder and SHALL NOT be represented as a synthetic Removed-plus-Added transition.

A prior Run whose user-message/Run/snapshot transaction committed SHALL establish the prior availability baseline regardless of whether that Run later completed, failed, was cancelled, or expired. Its persisted user message and server-authored availability part SHALL remain model-visible on later Runs until superseded by compaction or another context rewrite. A request that fails before the transaction commits SHALL establish no baseline.

When the most recent prior Run manifest is the legacy/unobserved sentinel, the current turn SHALL follow the same initial-baseline semantics: disclose currently eligible unavailable tools, do not emit Added entries for healthy tools, and persist an observed v1 manifest for the new Run.

The first accepted turn after a newly active compaction checkpoint SHALL use the same initial-baseline semantics as a fresh conversation and SHALL NOT compare against a pre-compaction manifest: it SHALL list currently unavailable eligible tools under `Unavailable tools:` and SHALL emit no reminder when all eligible tools are available. This new disclosure epoch SHALL NOT reset MCP clients, catalogs, reconnect backoff, immutable Run manifests, or other runtime or persisted state. A semantic checkpoint MAY retain prior tool outages, recoveries, or failures when they mattered to the conversation; those statements SHALL be treated as historical context rather than current availability. The current request's provider-native declarations and current runtime availability reminder, when present, SHALL establish current callability.

The reminder SHALL instruct the model not to simulate removed or unavailable tools or invent their results. Tool ids and reason prose SHALL be rendered only from validated ids and closed server-authored reason codes. A model-switch reminder, when present on the same turn, SHALL render first, followed by the availability reminder and then the user text.

#### Scenario: Initial turn starts degraded

- **WHEN** the first turn has an eligible tool whose source is unavailable
- **THEN** a runtime availability reminder names the tool under `Unavailable tools:` immediately before the user text

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
- **THEN** the reminder contains only the non-empty Added, Removed, Unavailable, Became unavailable, and Now available groups
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
- **AND** its persisted availability disclosure remains in portable history until a context rewrite removes it

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
- **THEN** the model-switch reminder appears first, the runtime tool-availability reminder second, and the triggering user text last within one user message

#### Scenario: Client attempts to forge availability metadata

- **WHEN** a client submits a message containing a tool-availability-shaped data part
- **THEN** the server discards it and only server-derived state can author the reminder

#### Scenario: Transient flap recovers between turns

- **WHEN** a tool disconnects and reconnects between two turn snapshots with the same final availability and declaration
- **THEN** no operational event reminder is emitted solely for the recovered transient flap
