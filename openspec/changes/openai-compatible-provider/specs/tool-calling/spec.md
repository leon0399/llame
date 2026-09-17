## MODIFIED Requirements

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
  replayed reasoning parts are passed back unchanged and the target provider
  ignores or drops the ones it cannot read

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
