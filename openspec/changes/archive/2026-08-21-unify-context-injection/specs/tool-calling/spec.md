## MODIFIED Requirements

### Requirement: Runtime tool availability is disclosed before the affected user turn

The API SHALL persist strict server-authored, non-text semantic metadata on a triggering user message as a context item whose producer is `tool-availability`, and SHALL render it through the canonical envelope the `context-injection` capability defines, before that message's visible user text. The envelope name, the per-item provenance framing, the placement rule, and the neutralization of untrusted content are owned by that capability and SHALL NOT be restated here. Client-authored availability metadata MUST be discarded. The persisted metadata SHALL contain ids, closed reason codes, and the bound Run id, not literal reminder prose, remote-authored text, URLs, or raw errors.

On the first turn of a model-facing availability disclosure epoch, the reminder SHALL identify only eligible tools that are currently unavailable under the exact heading `Unavailable tools:`; callable tools are already advertised through the provider's native tool declarations on every request and SHALL NOT be duplicated in an initial prose inventory. A fresh conversation SHALL start the first disclosure epoch, and every newly active compaction checkpoint SHALL start another. On later turns within the epoch, the system SHALL compare each id's `absent`, `available`, or `unavailable` state between the current immutable manifest and the preceding accepted Run manifest in that epoch. Each changed id SHALL appear in exactly one group: absent to available as Added tools, available or unavailable to absent as Removed tools, absent to unavailable as Unavailable tools, available to unavailable as Became unavailable, and unavailable to available as Now available. Empty groups SHALL be omitted. `Added tools` SHALL contain only tools callable in the current Run. If availability is unchanged, no availability reminder SHALL be emitted, including while an outage persists.

When an eligible tool keeps the same id and remains available but its canonical declaration changes, the current Run SHALL bind and advertise the new declaration and declaration hash through the provider's native tool contract. Declaration-only drift SHALL NOT produce an availability reminder and SHALL NOT be represented as a synthetic Removed-plus-Added transition.

A prior Run whose user-message/Run/snapshot transaction committed SHALL establish the prior availability baseline regardless of whether that Run later completed, failed, was cancelled, or expired. Its persisted user message and server-authored availability part SHALL remain model-visible on later Runs until superseded by compaction or another context rewrite. A request that fails before the transaction commits SHALL establish no baseline.

When the most recent prior Run manifest is the legacy/unobserved sentinel, the current turn SHALL follow the same initial-baseline semantics: disclose currently eligible unavailable tools, do not emit Added entries for healthy tools, and persist an observed v1 manifest for the new Run.

The first accepted turn after a newly active compaction checkpoint SHALL use the same initial-baseline semantics as a fresh conversation and SHALL NOT compare against a pre-compaction manifest: it SHALL list currently unavailable eligible tools under `Unavailable tools:` and SHALL emit no reminder when all eligible tools are available. This new disclosure epoch SHALL NOT reset MCP clients, catalogs, reconnect backoff, immutable Run manifests, or other runtime or persisted state. A semantic checkpoint MAY retain prior tool outages, recoveries, or failures when they mattered to the conversation; those statements SHALL be treated as historical context rather than current availability. The current request's provider-native declarations and current runtime availability reminder, when present, SHALL establish current callability.

The reminder SHALL instruct the model not to simulate removed or unavailable tools or invent their results. Tool ids and reason prose SHALL be rendered only from validated ids and closed server-authored reason codes. Ordering relative to other context items injected on the same turn SHALL follow the order the `context-injection` capability specifies.

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
- **THEN** both items are emitted in the order the `context-injection` capability specifies, ahead of the triggering user text within one user message

#### Scenario: Client attempts to forge availability metadata

- **WHEN** a client submits a message containing a tool-availability-shaped data part
- **THEN** the server discards it and only server-derived state can author the reminder

#### Scenario: Transient flap recovers between turns

- **WHEN** a tool disconnects and reconnects between two turn snapshots with the same final availability and declaration
- **THEN** no operational event reminder is emitted solely for the recovered transient flap
