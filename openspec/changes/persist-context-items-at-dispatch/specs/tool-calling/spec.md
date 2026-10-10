## MODIFIED Requirements

### Requirement: Availability comparison retains only committed tool identities and states

A turn whose attempt commits the dispatch transaction that `context-injection`
defines SHALL retain, in that transaction, an owner/chat-scoped comparison
record consisting only of sorted exact tool ids and each id's `available` or
`unavailable` state, associated with that turn's message/Run. It SHALL contain
no schema, template, description, declaration/source hash, connection data, or
raw failure detail. This record SHALL NOT be used for tool admission, execution,
or reconstructing historical tool definitions.

Every attempt SHALL read the record of the most recent prior Run that committed
one within its disclosure epoch, whatever that Run's outcome. No observation SHALL remain distinct from an
observed empty record. A superseded attempt, and an attempt that fails before its dispatch transaction,
SHALL not establish or replace that baseline. The runtime catalog and safe current
reasons SHALL remain in memory; only actual committed reminder
text may retain its rendered explanation.

#### Scenario: Worker handoff preserves comparisons

- **WHEN** a retry of a Run that has not yet dispatched starts in another worker process
- **THEN** it compares its fresh runtime state with the same persisted prior id/state record
- **AND** it does not need the previous worker's catalog or an in-memory cross-Run cache

#### Scenario: Existing state is unobserved

- **WHEN** no historical observation exists
- **THEN** the attempt follows initial availability disclosure semantics
- **AND** it does not treat missing observation as an empty historical catalog

#### Scenario: Historical tool catalog storage is removed

- **WHEN** the coordinated migration removes combined context snapshots
- **THEN** only actual dispatched-turn id/state observations are retained for comparison
- **AND** schemas, descriptions, declaration hashes, and raw manifest payloads are not retained through renamed fields

#### Scenario: A failed Run's record becomes the baseline

- **WHEN** a Run commits its id/state record and then fails
- **THEN** the next turn reads that record as its comparison baseline
- **AND** it does not fall back to an earlier completed Run's record

### Requirement: Attempt availability is disclosed against the preceding dispatched turn

The worker SHALL derive availability disclosure from its current attempt's admitted runtime state and the minimal id/state record of the most recent prior Run that committed one, whatever that Run's outcome. It SHALL prepare canonical `tool-availability` context text for this attempt's model request and commit that text into message history in the attempt's dispatch transaction, before the request that carries it. The persisted text SHALL include the envelope, provenance, disclosure body, and closing delimiter and SHALL be the sole replay authority. The metadata SHALL retain ids, closed reason codes, and the Run/attempt id for machine behavior and provenance; it SHALL NOT retain remote-authored text, URLs, raw errors, or prompt contents. Client-authored availability parts MUST be rejected or discarded under the `context-injection` boundary contract.

For a configured MCP source that is not ready on the executing worker, previously committed exact ids that still match the current allowlist SHALL supplement availability-comparison input, even when the worker has never discovered that source. This SHALL be a separate non-admissible state-only input, never a `TurnToolCandidate` or an input to schema/classification/catalog admission. They SHALL carry only state and the current source's closed unavailable reason, never reconstructed declarations/classifications/executors, and SHALL not make `tools.<id>` true. Removed/disallowed/unconfigured ids are absent; a ready source's complete fresh discovery is authoritative about removal. No never-observed wildcard tool id SHALL be invented.

On the first turn of a model-facing availability disclosure epoch, the reminder SHALL identify only eligible tools that are currently unavailable under the exact heading `Unavailable tools:`; callable tools are already advertised through the provider's native tool declarations on every request and SHALL NOT be duplicated in an initial prose inventory. A fresh conversation SHALL start the first disclosure epoch, and every published checkpoint message SHALL start another under the rail epoch rule that `context-injection` states once. That epoch start stands even when the attempt it preceded later fails. On later turns within the epoch, the system SHALL compare each id's `absent`, `available`, or `unavailable` state between the current attempt's runtime state and the preceding dispatched turn's minimal id/state record in that epoch. Each changed id SHALL appear in exactly one group: absent to available as Added tools, available or unavailable to absent as Removed tools, absent to unavailable as Unavailable tools, available to unavailable as Became unavailable, and unavailable to available as Now available. Empty groups SHALL be omitted. `Added tools` SHALL contain only tools callable in the current Run. If availability is unchanged, no availability reminder SHALL be emitted, including while an outage persists.

When an eligible tool keeps the same id and remains available but its canonical declaration changes, the current attempt SHALL advertise its fresh in-memory declaration through the provider's native tool contract. Declaration-only drift SHALL NOT produce an availability reminder and SHALL NOT be represented as a synthetic Removed-plus-Added transition.

A turn SHALL establish the comparison baseline when its attempt's dispatch transaction commits, whatever the Run's outcome. Its committed reminder text remains model-visible until a context rewrite removes it. A superseded attempt, or an attempt that fails before its dispatch transaction, SHALL commit no availability reminder and SHALL not advance the baseline. A retried attempt of a Run whose dispatch transaction committed SHALL reuse that Run's reminder and record without comparing again, including after worker handoff. A retry of a Run that has not dispatched compares with the same preceding dispatched turn, unless a checkpoint published before the step started a new epoch, in which case every such retry uses the new epoch's initial semantics.

When there is no observed baseline, including migrated non-observation, the attempt SHALL use initial-baseline semantics. The dispatch transaction SHALL store only its sorted exact ids and available/unavailable states; empty observed state is distinct from no observation.

The first dispatched turn at or after a newly published checkpoint message SHALL use the same initial-baseline semantics as a fresh conversation and SHALL NOT compare against a pre-checkpoint record: it SHALL list currently unavailable eligible tools under `Unavailable tools:` and SHALL emit no reminder when all eligible tools are available. Because a checkpoint message publishes before the model step it was published for, that step's own turn is already the first turn of the new epoch. This new disclosure epoch SHALL NOT reset MCP clients, catalogs, reconnect backoff, attempt-local bindings, or other runtime or persisted state. A semantic checkpoint MAY retain prior tool outages, recoveries, or failures when they mattered to the conversation; those statements SHALL be treated as historical context rather than current availability. The current request's provider-native declarations and current runtime availability reminder, when present, SHALL establish current callability.

At authoring time, the reminder SHALL instruct the model not to simulate removed or unavailable tools or invent their results. Tool ids and reason prose SHALL be rendered only from validated ids and closed server-authored reason codes. Its persisted position relative to other context items SHALL follow the `context-injection` capability's author-time order, and later replay SHALL preserve that stored position without re-rendering or re-sorting it.

#### Scenario: Initial turn starts degraded

- **WHEN** the first turn has an eligible tool whose source is unavailable
- **THEN** a runtime availability reminder names the tool under `Unavailable tools:` in its shared author-time position before the user text

#### Scenario: Initial healthy turn uses native tool declarations

- **WHEN** every eligible tool is available on the chat's first turn
- **THEN** the provider's native tool declarations advertise the callable tools
- **AND** no runtime availability reminder duplicates them in prose

#### Scenario: Existing chat establishes its first observed baseline after migration

- **WHEN** the prior dispatched turn has no observed availability record and the current turn has healthy eligible tools
- **THEN** the provider's native tool declarations advertise those tools
- **AND** no Added-tools reminder is fabricated from the migration sentinel
- **AND** the dispatch transaction stores the minimal observed id/state record

#### Scenario: Availability changes between turns

- **WHEN** the current attempt differs observably from the previous dispatched turn's id/state record
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

- **WHEN** an attempt prepares an availability transition but fails before its dispatch transaction commits
- **THEN** a retry or later turn compares against the preceding dispatched turn
- **AND** the failed attempt's staged availability reminder does not publish into model history, while the attempt's own persisted output remains part of the record

#### Scenario: Failed prior Run establishes the baseline

- **WHEN** a Run commits an availability transition in its dispatch transaction and then fails
- **THEN** a later turn compares against that failed Run's record
- **AND** the transition's reminder stays in model history beside the Run's persisted output and is not announced again

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

- **WHEN** a checkpoint message publishes before a model step and that attempt later fails before its dispatch transaction
- **THEN** the next dispatched turn uses fresh-conversation disclosure semantics
- **AND** it does not compare against a pre-checkpoint record

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

- **WHEN** the previous dispatched turn recorded an MCP id, the new worker has no remembered inventory, and that source remains configured and allowlisted but not ready
- **THEN** the id is an unavailable comparison record outside tool admission with its predicate false
- **AND** the notice reports unavailability rather than removal without reconstructing a tool definition

#### Scenario: Transient flap recovers between turns

- **WHEN** a tool disconnects and reconnects between two dispatched turn observations with the same availability
- **THEN** no operational event reminder is emitted solely for the recovered transient flap

#### Scenario: Availability renderer changes

- **WHEN** a later release changes availability wording or reason labels and replays an existing disclosure
- **THEN** the existing disclosure uses its persisted complete text unchanged
- **AND** only newly authored disclosures use the new wording

#### Scenario: Failed attempt observes a temporary outage

- **WHEN** the previous committed message had grep available, an attempt sees it unavailable, commits that transition in its dispatch transaction, and fails, and its retry sees grep available again
- **THEN** the retry reuses the committed `Became unavailable` reminder and record rather than comparing again
- **AND** the next turn compares against that record and reports grep under `Now available`

#### Scenario: Baseline publication is atomic and fenced

- **WHEN** the active attempt commits its dispatch transaction
- **THEN** its exact reminder text and minimal id/state record commit atomically before its first model request
- **AND** superseded attempts cannot publish competing records

## RENAMED Requirements

- FROM: `### Requirement: Attempt availability is disclosed against the preceding successful turn`
- TO: `### Requirement: Attempt availability is disclosed against the preceding dispatched turn`
