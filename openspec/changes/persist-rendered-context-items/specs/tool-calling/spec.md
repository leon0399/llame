## MODIFIED Requirements

### Requirement: Runtime tool availability is disclosed before the affected user turn

The API SHALL derive availability disclosure from strict server-authored semantic metadata, render the complete canonical context-item text before the triggering user message commits, and persist both together under producer `tool-availability`. The persisted text SHALL include the envelope, provenance, disclosure body, and closing delimiter and SHALL be the sole replay authority. The metadata SHALL retain ids, closed reason codes, and the bound Run id for machine behavior and provenance; it SHALL NOT retain remote-authored text, URLs, raw errors, or prompt contents. Client-authored availability parts MUST be discarded.

On the first turn of a model-facing availability disclosure epoch, the reminder SHALL identify only eligible tools that are currently unavailable under the exact heading `Unavailable tools:`; callable tools are already advertised through the provider's native tool declarations on every request and SHALL NOT be duplicated in an initial prose inventory. A fresh conversation SHALL start the first disclosure epoch, and every newly active compaction checkpoint SHALL start another. On later turns within the epoch, the system SHALL compare each id's `absent`, `available`, or `unavailable` state between the current immutable manifest and the preceding accepted Run manifest in that epoch. Each changed id SHALL appear in exactly one group: absent to available as Added tools, available or unavailable to absent as Removed tools, absent to unavailable as Unavailable tools, available to unavailable as Became unavailable, and unavailable to available as Now available. Empty groups SHALL be omitted. `Added tools` SHALL contain only tools callable in the current Run. If availability is unchanged, no availability reminder SHALL be emitted, including while an outage persists.

When an eligible tool keeps the same id and remains available but its canonical declaration changes, the current Run SHALL bind and advertise the new declaration and declaration hash through the provider's native tool contract. Declaration-only drift SHALL NOT produce an availability reminder and SHALL NOT be represented as a synthetic Removed-plus-Added transition.

A prior Run whose user-message/Run/snapshot transaction committed SHALL establish the prior availability baseline regardless of whether that Run later completed, failed, was cancelled, or expired. Its persisted availability block SHALL remain model-visible verbatim on later Runs until superseded by compaction or another context rewrite. A request that fails before the transaction commits SHALL establish no baseline.

When the most recent prior Run manifest is the legacy/unobserved sentinel, the current turn SHALL follow the same initial-baseline semantics: disclose currently eligible unavailable tools, do not emit Added entries for healthy tools, and persist an observed v1 manifest for the new Run.

The first accepted turn after a newly active compaction checkpoint SHALL use the same initial-baseline semantics as a fresh conversation and SHALL NOT compare against a pre-compaction manifest: it SHALL list currently unavailable eligible tools under `Unavailable tools:` and SHALL emit no reminder when all eligible tools are available. This new disclosure epoch SHALL NOT reset MCP clients, catalogs, reconnect backoff, immutable Run manifests, or other runtime or persisted state. A semantic checkpoint MAY retain prior tool outages, recoveries, or failures when they mattered to the conversation; those statements SHALL be treated as historical context rather than current availability. The current request's provider-native declarations and current runtime availability reminder, when present, SHALL establish current callability.

At authoring time, the reminder SHALL instruct the model not to simulate removed or unavailable tools or invent their results. Tool ids and reason prose SHALL be rendered only from validated ids and closed server-authored reason codes. Its persisted position relative to other context items SHALL follow the `context-injection` capability's author-time order, and later replay SHALL preserve that stored position without re-rendering or re-sorting it.

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
- **THEN** the server discards it and only server-derived state can author the reminder

#### Scenario: Transient flap recovers between turns

- **WHEN** a tool disconnects and reconnects between two turn snapshots with the same final availability and declaration
- **THEN** no operational event reminder is emitted solely for the recovered transient flap

#### Scenario: Availability renderer changes

- **WHEN** a later release changes availability wording or reason labels and replays an existing disclosure
- **THEN** the existing disclosure uses its persisted complete text unchanged
- **AND** only newly authored disclosures use the new wording

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

## RENAMED Requirements

- FROM: `### Requirement: Tool observations survive into later turns`
- TO: `### Requirement: Tool observations survive into later turns as stored UI parts`
