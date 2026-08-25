## MODIFIED Requirements

### Requirement: Model switches use canonical persisted context text and metadata

The API SHALL persist a server-authored context part on the triggering user
message when the selected model differs from the most recent prior Run. Its
producer SHALL be `effective-context-change`, its form SHALL be `notice`, and
its `data.v` SHALL remain `1`.

The producer SHALL carry a closed cause vocabulary, of which `model` covers a
model change. A cause SHALL be a single value per item; simultaneous causes
owned by different producers SHALL remain separate items. It SHALL retain the
cause, prior public model id, target public model id, and target Run id as
non-rendering metadata for transition compaction, the owner-facing boundary,
and provenance. It SHALL NOT duplicate dimensions owned by another producer,
notably tool availability. It SHALL also persist the complete canonical
model-facing reminder beneath `data.text`. Client-supplied context parts MUST be
rejected or discarded.

The persisted text SHALL state that the active model changed before this user
message, name the current model while omitting the prior model from model-facing
prose, direct the assistant to follow current system instructions and continue
the existing conversation, and direct it not to restart, reintroduce itself, or
mention the model change unless the user asks.

Later request assembly SHALL use `data.text` immediately before the triggering
user text. It SHALL NOT reconstruct the reminder from model ids. Transition
compaction and owner UI MAY use validated metadata, but a metadata/text
disagreement SHALL NOT rewrite model replay.

#### Scenario: Switch metadata is assembled for the model

- **WHEN** a model-switch turn is accepted
- **THEN** the server persists structured metadata and complete reminder text
- **AND** later request assembly uses that text without adding another top-level
  system prompt

#### Scenario: Failed prior run selected another model

- **WHEN** the most recent prior Run selected model `A` but failed and the next
  turn selects model `B`
- **THEN** the next user message records an `A` to `B` switch
- **AND** the event is based on durable selection rather than answer completion

#### Scenario: Metadata and text disagree

- **WHEN** a switch part's metadata and persisted text disagree
- **THEN** the model receives the persisted text unchanged
- **AND** transition/UI behavior validates metadata independently

#### Scenario: Client attempts to forge switch metadata

- **WHEN** a client submits a context-item part
- **THEN** the server does not persist or trust that part
- **AND** only server-derived Run state can create the switch item

#### Scenario: Model and tool availability change together

- **WHEN** a turn changes both the selected model and tool availability
- **THEN** the switch item names only the model cause
- **AND** the tool availability producer emits its own persisted reminder

### Requirement: Compaction preserves the completed Run's effective prompt and materializes replacement history

When a completed chat Run triggers full-current compaction, the summarization
inference SHALL use that Run's selected model client, exact bound effective
top-level system prompt, byte-equivalent provider-facing tool declarations
reconstructed without executor functions, compactable conversation prefix, and
a final synthetic user summarization instruction. It SHALL set
`toolChoice: "none"`, MUST NOT execute tools, and SHALL accept text only.

The instruction SHALL request the stable sections `Objective`, `Constraints and
Preferences`, `Decisions and Rationale`, `Established Facts`, `Current State`,
`Open Questions and Next Steps`, and `Critical References`.

Because the replayed prompt may contain owner personalization and a rendered
recency digest, every full-current and transition summarization instruction
SHALL name both standing-context delimiters and direct the model not to carry
their content into the summary. The instruction SHALL also exclude digest
message-rail appends by naming the shared context-item envelope and
`recency-digest` producer. This exclusion remains load-bearing: otherwise
another chat's title/excerpt could become durable checkpoint content that
source deletion or consent withdrawal cannot reach.

The bound top-level prompt SHALL remain unchanged; all exclusions belong only
in the trailing summarization instruction so cached prefix content is not
rewritten. Title generation SHALL continue to use its dedicated task-specific
system prompt rather than the chat model's effective prompt.

Every ordinary or transition compaction SHALL atomically persist:

- the non-empty raw summary used by owner UI and recursive summarization; and
- a non-empty, message-shaped `replacementHistory` that is the complete
  application replay replacement for the superseded prefix.

The first replacement record SHALL be a user-role UI message containing one
text part with the complete final `<system-reminder>` checkpoint. Any retained
compacted tool observations SHALL follow as final assistant UI records under
the `tool-calling` capability. The replacement records and part order SHALL be
the sole replay authority.

The next Run SHALL assemble its current snapshotted top-level prompt/tools,
stored replacement history, retained recent history, and new user turn in that
order. It SHALL NOT re-wrap the raw summary, re-render checkpoint text, or
reconstruct any replacement part. The raw summary remains separate; replay
SHALL NOT parse it out of the checkpoint text.

A later compaction SHALL consume the previous replacement history plus newly
absorbed messages and atomically write a wholly new replacement history. No
legacy checkpoint renderer or compatibility fallback SHALL exist. An active
compaction without valid non-empty replacement history SHALL fail closed rather
than silently discard or regenerate history.

#### Scenario: Completed turn triggers compaction

- **WHEN** a completed Run crosses its compaction threshold
- **THEN** summarization uses the completed Run's bound prompt, model, portable
  tools, compactable history, and trailing instruction
- **AND** the committed row contains raw summary and complete replacement
  history atomically

#### Scenario: Compaction excludes standing and digest rail context

- **WHEN** either compaction mode receives personalization, a prefix digest, or
  digest rail appends
- **THEN** its trailing instruction names the applicable delimiters and producer
  and forbids carrying them into the summary
- **AND** the replayed system prompt and compactable history remain unchanged

#### Scenario: Compaction runs for an owner with personalization

- **WHEN** a bound prompt contains rendered personalization
- **THEN** the trailing instruction excludes that block from the summary
- **AND** the next Run supplies current personalization independently

#### Scenario: Compaction runs for a chat carrying a digest

- **WHEN** a bound prompt contains a rendered recency digest
- **THEN** the trailing instruction excludes that block from the summary
- **AND** the replacement checkpoint need not contain other-chat content

#### Scenario: Compaction leaves the cached prefix untouched

- **WHEN** a summarization request is assembled
- **THEN** the bound prompt and compactable history remain unchanged
- **AND** exclusions appear only in the trailing user instruction

#### Scenario: Both delimited blocks are excluded under either compaction mode

- **WHEN** personalization and recency digest occur under ordinary and
  transition compaction
- **THEN** both instructions exclude both standing-context blocks
- **AND** neither mode rewrites the cached prefix

#### Scenario: Exclusion targets one producer under a shared envelope

- **WHEN** the instruction excludes recency-digest rail appends
- **THEN** it names the shared envelope and the `recency-digest` producer
- **AND** it does not infer producer identity from a private delimiter

#### Scenario: Provider returns a tool call during compaction

- **WHEN** a provider returns a tool call despite `toolChoice: "none"`
- **THEN** no executor is available or invoked
- **AND** the result is rejected rather than persisted as replacement history

#### Scenario: Checkpoint renderer changes later

- **WHEN** a later release changes checkpoint framing or sanitization
- **THEN** an existing compaction replays its stored user text part unchanged
- **AND** the raw summary remains available separately

#### Scenario: Next turn follows a compaction

- **WHEN** the next Run is assembled after successful compaction
- **THEN** current top-level prompt/tools are followed by stored replacement
  history, retained live messages, and the new user turn
- **AND** no replacement record is regenerated, joined, or reordered

#### Scenario: Model changes after compaction

- **WHEN** a model switch follows a stored replacement history
- **THEN** the target receives its current top-level prompt and tools
- **AND** replacement history remains portable historical data before the new
  persisted switch reminder

#### Scenario: Active compaction lacks replacement history

- **WHEN** request assembly encounters an active compaction without valid
  non-empty replacement history
- **THEN** preparation fails closed
- **AND** it does not render a checkpoint from raw summary or treat an old
  ledger as replay authority

#### Scenario: Transition compaction precedes a smaller-context target

- **WHEN** a model switch requires source-model transition compaction
- **THEN** the source model summarizes only the eligible prefix
- **AND** the target request uses the resulting stored replacement history
  before the retained triggering turn

#### Scenario: Partial rewind is requested

- **WHEN** future functionality needs to summarize only a prefix or suffix
  around a retained historical boundary
- **THEN** it does not reuse full-current or transition compaction
- **AND** it requires a separately specified summary contract

## RENAMED Requirements

- FROM: `### Requirement: Model switches use canonical semantic context metadata`
- TO: `### Requirement: Model switches use canonical persisted context text and metadata`
- FROM: `### Requirement: Compaction preserves the completed run's effective prompt and emits historical data`
- TO: `### Requirement: Compaction preserves the completed Run's effective prompt and materializes replacement history`
