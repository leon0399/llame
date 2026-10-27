## MODIFIED Requirements

### Requirement: Model switches use canonical persisted context text and metadata

The worker MUST prepare a server-authored context part when the selected model differs from the
baseline model. The baseline model is the model on the most recent prior assistant reply in the
Chat whose sequence is below the triggering user message. This applies whatever the status of that
reply, and whether or not a checkpoint absorbed it. A failed or cancelled reply counts, because its
switch item is already in history. The previous completed Run stays the source for the model and
the system-prompt receipt of compaction. A Run whose reply a Regenerate from `turn-actions`
replaced is not that Run; the Run that the reply usage names is. A running or finalized reply
records its model id in its usage. Thus each Run that dispatched a model request leaves a reply
that can be this baseline. The worker MUST persist that exact text on the triggering user message,
in the dispatch transaction of the first model request of the attempt. This applies whatever the
outcome of the Run. A retry of the same Run MUST keep the stored item unchanged. It MUST NOT add a second
switch item when one is already stored on the triggering user message. A Continue Run MUST follow
the same rule as a retry. The first dispatch of a Regenerate Run MUST remove each model-switch item
with cause `model` from the triggering user message. It then stores the item that its own
comparison yields, after the last stored context item. A retry of that Regenerate Run keeps the
item that its first dispatch stored. The producer MUST be
`effective-context-change`, the form MUST be `notice`, and `data.v` MUST stay `1`.

The producer MUST carry a closed cause vocabulary, in which `model` covers a model change. A cause
MUST be one value for each item. Causes at the same time that different producers own MUST stay
separate items. The item MUST keep the cause, the prior public model id, the target public model
id, and the target Run id as non-rendering metadata. The owner-facing boundary and provenance use
it.
It MUST NOT repeat dimensions that another producer owns, such as tool availability. It MUST also
persist the complete canonical model-facing reminder in `data.text`. The system MUST reject or
discard context parts that a client supplies.

The persisted text MUST state that the active model changed before this user message. It MUST name
the prior model and the current model. Each name is the display name, then the public llame model
id, then the provider model id when the system knows it. The text MUST tell the assistant to follow
the current system instructions and to continue the current conversation. It MUST tell the
assistant not to start again, not to introduce itself again, and not to mention the model change
unless the user asks.

The system MUST render each model from a descriptor that the producer derives. The descriptor holds
the display name, the public llame model id, and the provider model id when known. Other catalog
values MUST NOT reach the body. The system MUST resolve the display name and the provider model id from
the configured model catalog when it authors the item. They MUST stay rendering values, not
persisted metadata. When the catalog has no name for a model, the public llame model id of that
model MUST fill its name slot. When the provider model id is unknown, the system MUST omit the
provider clause of that model and MUST NOT render it empty. A display name and a provider model id
are operator-authored text. The system MUST neutralize them under the reserved-delimiter rules of
`instance-config`, as it neutralizes an operator-authored catalog description. The public llame
model id MUST render raw.

Later request assembly MUST use `data.text` at its stored author-time position with the triggering
user text, in the producer order of `context-injection`. It MUST NOT rebuild the reminder from model
ids. The owner UI can use validated metadata, but a difference between metadata and text MUST NOT
change model replay.

#### Scenario: Switch metadata is assembled for the model

- **WHEN** a model-switch attempt is prepared and then dispatches its first model request
- **THEN** the dispatch transaction atomically persists its structured metadata and the complete reminder text on the triggering user message
- **AND** later request assembly uses that text and adds no other top-level system prompt

#### Scenario: Failed prior run selected another model

- **WHEN** the most recent prior Run selected model `A`, dispatched a model request, and then failed, and the next turn selects model `B`
- **THEN** the new attempt compares model `B` with model `A` on the assistant reply of the failed Run
- **AND** the system persists a switch item from model `A` to model `B`, also when the last completed turn used model `B`
- **AND** a Run that failed before it dispatched any model request left no reply and is not the baseline

#### Scenario: A failed Run's switch is not announced twice

- **WHEN** a Run on model `B` follows a reply on model `A`, persists a switch item from `A` to `B` at dispatch, and then fails
- **AND** the next turn selects model `B` again
- **THEN** the next turn authors no model-switch item
- **AND** history still carries the switch item of the failed Run before its triggering user message

#### Scenario: Returning to the earlier model after a failed switch

- **WHEN** a Run persisted a switch item from model `A` to model `B` and then failed
- **AND** the next turn selects model `A`
- **THEN** that turn persists a switch item from model `B` to model `A`
- **AND** history does not let the model think that model `B` is still active

#### Scenario: A switch that forces compaction is still announced

- **WHEN** the most recent prior reply records model `A`, and the next turn selects model `B` with a smaller context
- **AND** the prepared request does not fit the window of model `B`
- **AND** the window variant publishes a checkpoint that absorbs the reply of model `A`
- **THEN** the attempt still compares model `B` with model `A` on that absorbed reply
- **AND** it persists a switch item from model `A` to model `B` at dispatch
- **AND** the request carries the checkpoint before that reminder and the triggering user text

#### Scenario: A checkpoint left by an undispatched Run does not hide the switch

- **WHEN** a reply records model `A`, and a later Run on model `B` publishes a checkpoint that absorbs that reply, then fails before it dispatches
- **AND** the next turn selects model `B`
- **THEN** that turn compares model `B` with model `A` on the absorbed reply
- **AND** it persists a switch item from model `A` to model `B`

#### Scenario: A retry reuses the stored switch item

- **WHEN** an attempt persisted a switch item at dispatch, and a later attempt of the same Run retries it
- **THEN** the request of the retry carries the stored switch item unchanged and in place
- **AND** the retry adds no second switch item, because one is already stored on the triggering user message

#### Scenario: Metadata and text disagree

- **WHEN** the metadata and the persisted text of a switch part disagree
- **THEN** the model receives the persisted text unchanged
- **AND** UI behavior validates the metadata independently

#### Scenario: Client attempts to forge switch metadata

- **WHEN** a client submits a context-item part
- **THEN** the server does not persist or trust that part
- **AND** only server-derived Run state can create the switch item

#### Scenario: Model and tool availability change together

- **WHEN** a turn changes both the selected model and the tool availability
- **THEN** the switch item names only the model cause
- **AND** the tool availability producer emits its own persisted reminder

#### Scenario: Both models are named with their catalog values

- **WHEN** the system authors a model-switch item, and the configured model catalog has a name and a provider model id for both models
- **THEN** the persisted text names the prior model and the current model
- **AND** each name is the display name, then the public llame model id, then the provider model id
- **AND** the metadata still carries only the cause, the two model ids, and the target Run id

#### Scenario: The configured catalog carries no name for a model

- **WHEN** the configured model catalog has no name for one of the two models when the system authors the item
- **THEN** the public llame model id of that model fills its name slot
- **AND** that id also renders in its own slot, so the text repeats it and does not omit the model

#### Scenario: The provider model id is unknown

- **WHEN** the configured model catalog has no provider model id for one of the two models when the system authors the item
- **THEN** the clause of that model omits the provider part fully
- **AND** the system renders no empty parenthesis and no substitute id

#### Scenario: A catalog-authored name carries a reserved delimiter

- **WHEN** the display name or the provider model id of a model contains the reserved delimiter name of the rail as a tag
- **THEN** the rendered body carries it neutralized as operator-authored text
- **AND** the public llame model id renders raw
- **AND** the rendered body contains one envelope

#### Scenario: An item persisted before the rendering change

- **WHEN** the system replays an item persisted before this change, or validates its metadata
- **THEN** its stored text replays unchanged, and its metadata still matches the exact model-change record
- **AND** the system renders no stored item again from current catalog values

#### Scenario: Regenerate with a new model replaces the switch item

- **WHEN** the first Run of a turn stored a switch item from model `A` to model `B`, and the owner regenerates the turn with model `C`
- **THEN** the Regenerate dispatch removes the stored item and stores a switch item from `A` to `C`

#### Scenario: Regenerate with the prior reply's model removes the switch item

- **WHEN** the first Run of a turn stored a switch item from model `A` to model `B`, and the owner regenerates the turn with model `A`
- **THEN** the Regenerate dispatch removes the stored item and stores no switch item

#### Scenario: A replaced Run is not the previous completed Run

- **WHEN** a Regenerate replaced the `completed` reply of Run `R1`, the Regenerate Run then failed, and the owner sends a new message
- **THEN** compaction for the new turn does not use `R1` as the previous completed Run
