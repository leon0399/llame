## MODIFIED Requirements

### Requirement: Attempt availability is disclosed against the preceding successful turn

The worker SHALL derive availability disclosure from its current attempt's admitted runtime state and the previous successful committed turn's minimal id/state record. It SHALL prepare canonical `tool-availability` context text for this attempt's model request and publish that text into message history only with successful turn completion. The persisted text SHALL include the envelope, provenance, disclosure body, and closing delimiter and SHALL be the sole replay authority. The metadata SHALL retain ids, closed reason codes, and the Run/attempt id for machine behavior and provenance; it SHALL NOT retain remote-authored text, URLs, raw errors, or prompt contents. Client-authored availability parts MUST be rejected or discarded under the `context-injection` boundary contract.

For a configured MCP source that is not ready on the executing worker, previously committed exact ids that still match the current allowlist SHALL supplement availability-comparison input, even when the worker has never discovered that source. This SHALL be a separate non-admissible state-only input, never a `TurnToolCandidate` or an input to schema/classification/catalog admission. They SHALL carry only state and the current source's closed unavailable reason, never reconstructed declarations/classifications/executors, and SHALL not make `tools.<id>` true. Removed/disallowed/unconfigured ids are absent; a ready source's complete fresh discovery is authoritative about removal. No never-observed wildcard tool id SHALL be invented.

On the first turn of a model-facing availability disclosure epoch, the reminder SHALL identify only eligible tools that are currently unavailable under the exact heading `Unavailable tools:`; callable tools are already advertised through the provider's native tool declarations on every request and SHALL NOT be duplicated in an initial prose inventory. A fresh conversation SHALL start the first disclosure epoch, and every published checkpoint message SHALL start another under the rail epoch rule that `context-injection` states once. That epoch start stands even when the attempt it preceded later fails. On later turns within the epoch, the system SHALL compare each id's `absent`, `available`, or `unavailable` state between the current attempt's runtime state and the preceding successful turn's minimal id/state record in that epoch. Each changed id SHALL appear in exactly one group: absent to available as Added tools, available or unavailable to absent as Removed tools, absent to unavailable as Unavailable tools, available to unavailable as Became unavailable, and unavailable to available as Now available. Empty groups SHALL be omitted. `Added tools` SHALL contain only tools callable in the current Run. If availability is unchanged, no availability reminder SHALL be emitted, including while an outage persists.

When an eligible tool keeps the same id and remains available but its canonical declaration changes, the current attempt SHALL advertise its fresh in-memory declaration through the provider's native tool contract. Declaration-only drift SHALL NOT produce an availability reminder and SHALL NOT be represented as a synthetic Removed-plus-Added transition.

Only a successfully committed turn SHALL establish the comparison baseline. Its published reminder text remains model-visible until a context rewrite removes it. A failed, cancelled, expired, or superseded attempt SHALL publish no availability reminder to model history and SHALL not advance the baseline. Every retry compares with the same preceding committed turn, including after worker handoff, unless a checkpoint published before the step started a new epoch, in which case every retry of that Run uses the new epoch's initial semantics.

When there is no successful observed baseline, including migrated non-observation, the attempt SHALL use initial-baseline semantics. Successful completion SHALL store only its sorted exact ids and available/unavailable states; empty observed state is distinct from no observation.

The first successfully committed turn at or after a newly published checkpoint message SHALL use the same initial-baseline semantics as a fresh conversation and SHALL NOT compare against a pre-checkpoint record: it SHALL list currently unavailable eligible tools under `Unavailable tools:` and SHALL emit no reminder when all eligible tools are available. Because a checkpoint message publishes before the model step it was published for, that step's own turn is already the first turn of the new epoch. This new disclosure epoch SHALL NOT reset MCP clients, catalogs, reconnect backoff, attempt-local bindings, or other runtime or persisted state. A semantic checkpoint MAY retain prior tool outages, recoveries, or failures when they mattered to the conversation; those statements SHALL be treated as historical context rather than current availability. The current request's provider-native declarations and current runtime availability reminder, when present, SHALL establish current callability.

At authoring time, the reminder SHALL instruct the model not to simulate removed or unavailable tools or invent their results. Tool ids and reason prose SHALL be rendered only from validated ids and closed server-authored reason codes. Its persisted position relative to other context items SHALL follow the `context-injection` capability's author-time order, and later replay SHALL preserve that stored position without re-rendering or re-sorting it.

#### Scenario: Initial turn starts degraded

- **WHEN** the first turn has an eligible tool whose source is unavailable
- **THEN** a runtime availability reminder names the tool under `Unavailable tools:` in its shared author-time position before the user text

#### Scenario: Initial healthy turn uses native tool declarations

- **WHEN** every eligible tool is available on the chat's first turn
- **THEN** the provider's native tool declarations advertise the callable tools
- **AND** no runtime availability reminder duplicates them in prose

#### Scenario: Existing chat establishes its first observed baseline after migration

- **WHEN** the prior successful turn has no observed availability record and the current turn has healthy eligible tools
- **THEN** the provider's native tool declarations advertise those tools
- **AND** no Added-tools reminder is fabricated from the migration sentinel
- **AND** successful completion stores the minimal observed id/state record

#### Scenario: Availability changes between turns

- **WHEN** the current attempt differs observably from the previous successful turn's id/state record
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

- **WHEN** an attempt prepares an availability transition but fails
- **THEN** a retry or later turn compares against the preceding successful committed turn
- **AND** the failed attempt's staged availability reminder does not publish into model history, while the attempt's own persisted output remains part of the record

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
- **THEN** the next successfully committed turn uses fresh-conversation disclosure semantics
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

- **WHEN** the previous successful turn recorded an MCP id, the new worker has no remembered inventory, and that source remains configured and allowlisted but not ready
- **THEN** the id is an unavailable comparison record outside tool admission with its predicate false
- **AND** the notice reports unavailability rather than removal without reconstructing a tool definition

#### Scenario: Transient flap recovers between turns

- **WHEN** a tool disconnects and reconnects between two successful turn observations with the same availability
- **THEN** no operational event reminder is emitted solely for the recovered transient flap

#### Scenario: Availability renderer changes

- **WHEN** a later release changes availability wording or reason labels and replays an existing disclosure
- **THEN** the existing disclosure uses its persisted complete text unchanged
- **AND** only newly authored disclosures use the new wording

#### Scenario: Failed attempt observes a temporary outage

- **WHEN** the previous committed message had grep available, an attempt sees it unavailable and fails, and its retry sees it available again
- **THEN** the retry emits no restoration notice because it compares with the previous committed message
- **AND** the failed attempt changes neither the comparison record nor the published reminder, while its own persisted output remains part of the record

#### Scenario: Baseline publication is atomic and fenced

- **WHEN** a winning attempt successfully commits its assistant turn
- **THEN** its exact reminder text and minimal id/state record commit atomically with that completion
- **AND** stale or failed attempts cannot publish competing records

### Requirement: Tool observations survive into later turns as stored UI parts

The prospective cutover boundary in `context-injection` SHALL govern failed-attempt retention; existing conversation state SHALL not be retrospectively filtered or rebuilt. A failed, cancelled, expired, or superseded attempt keeps its partial output and context as the user saw them, and that record participates in later model context and compaction like any other committed turn. An individual failed tool call within a successfully committed attempt SHALL still retain its normal paired failure observation.

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
result. Credentials and unrelated payloads SHALL NOT replay, and the tool
projection SHALL NOT carry provider-native reasoning or metadata; persisted
reasoning parts and their provider metadata reach the provider only through
`reasoning-output`'s same-Chat replay, outside this projection and its budget.

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

Tool activity SHALL remain available to the model until a checkpoint absorbs
it, and no tool record SHALL cross that boundary. A checkpoint message SHALL
carry no tool part, SHALL select and re-bound no payload, and SHALL recompute no
budget; there SHALL be no semantic observation ledger, bounded replacement set,
or compacted tool record to read back. Absorbed tool activity survives only as
summary text, where the summary's `Errors and Corrections`, `Completed`, and
`Critical References` content is the carrier. Rows after the latest checkpoint
SHALL keep the ordinary bounded projection above unchanged, and replay of those
rows SHALL NOT consult the checkpoint.

Checkpoint text SHALL stay owner-scoped like the checkpoint row that carries it,
and no tool observation SHALL be reconstructed from summary prose, from an older
checkpoint's text, or from any inference about what an absorbed turn contained.

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

- **WHEN** a prior call was settled by unsuccessful Run termination
- **THEN** operational/UI replay reports its matching `cancelled` result, and that failed attempt's persisted output remains part of model history like any other committed turn
- **AND** it remains distinguishable from a tool-produced error

#### Scenario: A tool call made during reasoning is projected

- **WHEN** a tool was called while reasoning output was produced
- **THEN** the call/result observation follows the same replay contract
- **AND** the reasoning part is not carried by the tool projection; it replays
  under `reasoning-output` in its own occurrence position

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
- **AND** the tool projection carries no originating-provider reasoning or
  metadata; reasoning replay is governed by `reasoning-output`

#### Scenario: A model or provider switch keeps observations but not provider metadata

- **WHEN** a chat with tool activity continues on another model or provider
- **THEN** portable matched observations remain available through the target
  SDK conversion
- **AND** originating-provider metadata is excluded from the tool projection;
  replayed reasoning parts are passed back unchanged, `reasoning-output` omits
  before the request the ones the target wire cannot represent, and the target
  provider ignores or drops the rest

#### Scenario: The projection is labelled untrusted

- **WHEN** a tool result is replayed
- **THEN** its own result content identifies it as untrusted tool output
- **AND** instruction-like payload text carries no authority

#### Scenario: Replayed content cannot escape its boundary

- **WHEN** a tool result attempts to forge or close a reserved boundary
- **THEN** the replayed result is neutralized under the tool projection contract
- **AND** surrounding structure remains intact

#### Scenario: The projection is stable across turns

- **WHEN** the same unmodified ordinary stored tool part replays twice
- **THEN** the current projector produces the same application content
- **AND** no tool part is materialized at a checkpoint boundary

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

- **WHEN** a checkpoint message absorbs a range of history that contains tool
  activity
- **THEN** that activity is available to later requests only as summary text
- **AND** the checkpoint message carries no tool record and replay of rows above
  it uses the ordinary bounded projection

#### Scenario: Recursive compaction consumes replacement history

- **WHEN** a later checkpoint supersedes a prior checkpoint
- **THEN** its summary input is the prior checkpoint's stored text plus the
  newly absorbed rows
- **AND** it writes no list of tool records and no record is carried forward

#### Scenario: Existing compactions cannot recover already-absorbed observations

- **WHEN** an active checkpoint message lacks valid non-empty stored text
- **THEN** request preparation fails closed
- **AND** no tool observation is invented from summary prose or from any ledger

#### Scenario: The live loop still observes its own tool results

- **WHEN** a tool executes during a Run
- **THEN** its result remains available within that same Run's tool loop
