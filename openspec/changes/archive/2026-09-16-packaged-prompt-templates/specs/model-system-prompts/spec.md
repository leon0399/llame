## MODIFIED Requirements

### Requirement: Model switches use canonical persisted context text and metadata

The worker SHALL prepare a server-authored context part when the selected model
differs from the most recent successfully committed prior Run. It SHALL publish
that exact text on the triggering user message only with successful turn
completion; failed attempts SHALL publish no model-switch context. Its producer
SHALL be `effective-context-change`, its form SHALL be `notice`, and its
`data.v` SHALL remain `1`.

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
message, name the prior model and the current model, each as its display name
followed by its public llame model id and, where the provider model id is
known, that provider model id, direct the assistant to follow current system
instructions and continue the existing conversation, and direct it not to
restart, reintroduce itself, or mention the model change unless the user asks.

Each model SHALL be rendered from a producer-derived descriptor carrying that
model's display name, public llame model id, and, when known, provider model
id; no other catalog value SHALL reach the body. The display name and the
provider model id SHALL be resolved from the configured model catalog when the
item is authored and SHALL remain rendering values rather than persisted
metadata. Where the catalog carries no name for a model, that model's public
llame model id SHALL stand in its name slot; where the provider model id is
unknown, that model's provider clause SHALL be omitted rather than rendered
empty. A display name and a provider model id are operator-authored text and
SHALL be neutralized under the reserved-delimiter rules `instance-config`
defines, exactly as an operator-authored catalog description already is; the
public llame model id SHALL render raw.

Later request assembly SHALL use `data.text` at its stored author-time position
associated with the triggering user text, following the `context-injection`
producer order. It SHALL NOT reconstruct the reminder from model ids.
Transition compaction and owner UI MAY use validated metadata, but a
metadata/text disagreement SHALL NOT rewrite model replay.

#### Scenario: Switch metadata is assembled for the model

- **WHEN** a model-switch attempt is prepared and then successfully committed
- **THEN** the server atomically persists its structured metadata and complete reminder text
- **AND** later request assembly uses that text without adding another top-level
  system prompt

#### Scenario: Failed prior run selected another model

- **WHEN** the most recent prior Run selected model `A` but failed and the next
  turn selects model `B`
- **THEN** the new attempt compares model `B` against the last successfully committed turn, if any
- **AND** model `A` from the failed attempt does not become the model-context baseline

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

#### Scenario: Both models are named with their catalog values

- **WHEN** a model-switch item is authored and the configured model catalog
  carries a name and a provider model id for both models
- **THEN** the persisted text names the prior model and the current model
- **AND** each is named by its display name followed by its public llame model
  id and its provider model id
- **AND** the metadata still carries only the cause, the two model ids, and the
  target Run id

#### Scenario: The configured catalog carries no name for a model

- **WHEN** the configured model catalog carries no name for one of the two
  models when the item is authored
- **THEN** that model's public llame model id stands in its name slot
- **AND** that id also renders in its own slot, so the text repeats it rather
  than omitting the model

#### Scenario: The provider model id is unknown

- **WHEN** the configured model catalog carries no provider model id for one of
  the two models when the item is authored
- **THEN** that model's clause omits the provider part entirely
- **AND** no empty parenthesis or substituted id is rendered

#### Scenario: A catalog-authored name carries a reserved delimiter

- **WHEN** a model's display name or provider model id contains the rail's
  reserved delimiter name as a tag
- **THEN** the rendered body carries it neutralized as operator-authored text
- **AND** the public llame model id renders raw
- **AND** the rendered body contains one envelope

#### Scenario: An item persisted before the rendering change

- **WHEN** an item persisted before this change is replayed or its metadata is
  validated
- **THEN** its stored text replays unchanged and its metadata still matches the
  exact model-change record
- **AND** no stored item is re-rendered from current catalog values

## ADDED Requirements

### Requirement: Summarization instructions and the title prompts are packaged templates

The full-current summarization instruction, the transition summarization instruction, the title-generation system prompt, and the title-generation user prompt SHALL be packaged template files owned by their modules and shipped with the executing process, rendered through the same engine and under the same producer-owned-values rule as item bodies under `context-injection`. They SHALL NOT be operator configuration: no configuration key SHALL select, replace, or disable one, and they SHALL remain outside system-prompt receipts.

The rendered instructions and prompts SHALL be byte-identical to their previous inline text, SHALL continue to request the stable summary sections, and SHALL continue to name both standing-context delimiters and the `recency-digest` producer under the shared envelope. The stable section list and the exclusion sentence SHALL be carried by the instruction template itself and verified against independently authored literal text rather than derived from or compared with a shared constant.

#### Scenario: Compaction request is unchanged by the template migration

- **WHEN** full-current or transition compaction assembles its trailing instruction after this change
- **THEN** the instruction text is byte-identical to the previous inline instruction
- **AND** the bound prompt, compactable prefix, and tool-declaration behavior of that mode are unchanged

#### Scenario: Instruction template omits a stable section or the digest exclusion

- **WHEN** a packaged instruction template no longer contains one of the stable section headings or no longer names the `recency-digest` producer under the shared envelope
- **THEN** the compaction contract check fails against its independently authored literal text
- **AND** the omission cannot be masked by comparing the instruction with itself

#### Scenario: Title generation keeps its dedicated prompts

- **WHEN** a title is generated after this change
- **THEN** the request uses the packaged title system prompt and wraps the bounded conversation text with the packaged title user prompt, both byte-identical to the previous inline text
- **AND** it does not use the chat model's effective system prompt or any owner personalization

#### Scenario: No configuration replaces an instruction template

- **WHEN** an operator configuration attempts to name a replacement for a summarization instruction or a title prompt
- **THEN** startup rejects the unknown key under the closed schema
- **AND** the packaged template remains in use
