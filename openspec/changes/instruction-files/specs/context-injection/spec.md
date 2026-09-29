## MODIFIED Requirements

### Requirement: Server-authored context is injected as discrete items on one rail

Every server-authored contribution to a chat's model-visible conversation that is not part of the system prompt SHALL be injected as a **context item** on one rail. An item SHALL be rendered inside a single canonical `<system-reminder>` envelope, and SHALL NOT introduce a top-level delimiter name of its own.

A materialized compaction checkpoint SHALL remain a rail context item with producer `compaction` and form `checkpoint` for envelope and Run-receipt semantics. Its durable representation SHALL be the storage exception: a user-role replacement-history UI message containing one ordinary text part with the complete final canonical envelope, not a persisted `data-context` part. `model-system-prompts` SHALL own that storage and replay contract.

The wire role SHALL remain `user`. A provider-level role for injected context SHALL NOT be invented, and items SHALL NOT be emitted as additional conversation messages of their own where a message already exists to carry them: items attached to a turn SHALL be carried inside that turn's triggering user message.

An item authored **between the model steps of one Run** — an in-Run item — has no user message to carry it. It SHALL be stored as a `data-context` part on that Run's assistant message, immediately after the tool part whose result triggered it, and SHALL be supplied to the model as a user-role text message placed after that tool result on the step that follows the trigger and on every later step of the same Run at the same position. It SHALL use the same envelope, framing, and vocabulary as an attached item. In-Run items SHALL be staged in memory and published with the assistant message only when the attempt wins; a failed or superseded attempt SHALL publish none.

Each item SHALL occupy its **own text content block** within that message rather than being concatenated with another item or with the user's text. The separation between server-authored content and user-authored content SHALL therefore be structural rather than a textual convention that user input can imitate.

#### Scenario: Two items are injected on one turn

- **WHEN** two context items are injected before a user's message
- **THEN** each renders in its own `<system-reminder>` envelope in its own text content block
- **AND** the user's visible text occupies a further block in the same message
- **AND** no additional conversation message is created

#### Scenario: A turn carries no injected item

- **WHEN** a turn has no context item to inject
- **THEN** the user message carries only the user's visible text
- **AND** its serialized form is unchanged from a turn that predates this capability

#### Scenario: An item is not attached to a turn

- **WHEN** an item's producer has no triggering user message to attach to
- **THEN** the item is carried by the message its producer already owns
- **AND** it uses the same envelope, framing, and vocabulary as an attached item

#### Scenario: An in-Run item follows its triggering tool result

- **WHEN** a producer authors an item after a tool result inside a Run
- **THEN** the item is stored on the Run's assistant message after that tool part
- **AND** every later model step of that Run receives it as a user-role message directly after that tool result
- **AND** a failed attempt publishes neither the item nor a seen record of it

#### Scenario: A compaction checkpoint replaces history

- **WHEN** compaction materializes replacement history for a superseded prefix
- **THEN** its first record is a user-role UI message containing one ordinary
  text part with the complete final checkpoint envelope
- **AND** the envelope and Run receipt retain producer `compaction` and form
  `checkpoint`, while the stored record is not a `data-context` part and replays
  without metadata reconstruction

Worker-attempt contributions intended for conversation history SHALL be staged in memory before target-model I/O and published in the triggering message only with successful turn completion. Failed or superseded attempts SHALL not publish those staged rail parts; the attempt's own persisted output remains part of the record as the user saw it and enters later model context like any other committed turn. Legitimate accepted-message facts remain persisted-literal; accepting a user message is not publishing a failed attempt's context. Committed parts retain the exact prepared text and existing envelope/order.

### Requirement: Co-occurring items have a total author-time order

When more than one item is injected on the same turn, the authoring/request-preparation path SHALL persist them in a fixed producer precedence order, ahead of the triggering user text within the same message:

1. `effective-context-change`
2. `tool-availability`
3. `workspace`
4. `instructions`
5. `skill-catalog`
6. `skill-activation`
7. `recency-digest`
8. `temporal`

When one producer contributes more than one item, those items SHALL be stored in emission order. A producer added later SHALL extend this authoring list in the rail specification.

In-Run items SHALL be ordered by the model step that triggered them and, within a step, by this same producer precedence; they are never re-sorted against the attached items of the triggering user message.

Replay SHALL preserve the stored part order. It SHALL NOT re-sort historical items through the current precedence list or merge adjacent text parts. The compaction checkpoint is carried by replacement history of its own and follows that capability's placement rule rather than this attached-item list.

#### Scenario: Several producers fire on one turn

- **WHEN** a model change, availability change, and chat-list change accompany one user message
- **THEN** their final text blocks are persisted in fixed author-time order
- **AND** every later replay preserves the stored order and part boundaries

#### Scenario: One producer contributes two items on one turn

- **WHEN** one producer emits two items before the same user message
- **THEN** both persist in producer emission order
- **AND** neither item is merged or suppressed

#### Scenario: A temporal item accompanies other items on one turn

- **WHEN** a temporal item accompanies another context item
- **THEN** authoring persists the temporal item last among attached items
- **AND** replay retains that stored position

#### Scenario: The precedence list changes later

- **WHEN** a later release adds a producer or changes author-time precedence
- **THEN** new items follow the new authoring order
- **AND** existing messages remain in their original stored order

When worker preparation adds attempt-owned items beside already persisted message facts, the final request SHALL apply this same producer order while preserving each producer's internal order and all user-authored content. Successful publication SHALL store that final ordering atomically; a failed attempt SHALL publish no staged rail items, while its own assistant output persists as the record of that turn.

#### Scenario: Workspace and skill catalog items share a turn

- **WHEN** a Workspace state change and an effective skill catalog change accompany one user message
- **THEN** the `workspace` item precedes the `skill-catalog` item and both precede the user text
- **AND** replay preserves those stored positions

#### Scenario: Workspace snapshot and root instructions share a turn

- **WHEN** an accepted turn re-establishes the Workspace snapshot and stages the root instruction chain
- **THEN** the `workspace` item precedes the `instructions` item and both precede any `skill-catalog` item

### Requirement: Successful Runs record the winning attempt's injected items

Each successfully completed Run SHALL record the winning attempt's context items injected into the requests it executed, as
they appeared in the final application request and in every later model step of that attempt, together with each item's
producer, form, and residency. In-Run items SHALL follow the final request's items in step order. The record SHALL be owner-scoped and enforced at
the datastore, and SHALL NOT be exposed to a non-owner, public share, ordinary
transcript export, or search projection.

For a persisted item, recording SHALL copy the same stored text used by the
request and SHALL NOT invoke a renderer. A data-only or empty context part that
contributed nothing SHALL still appear in the Run item record with empty text,
so intentional omission remains distinguishable from absence; metadata SHALL
NOT be rendered to fill it. A bind-time item SHALL record its final computed
text.

When request preparation rebuilds the request after transition compaction, the
record SHALL describe the rebuilt request. A Run whose preparation fails before
dispatch SHALL record no injected items.

The record SHALL identify the winning attempt and remain separate from its system-prompt-only receipt and the minimal availability comparison record. It SHALL commit with successful turn publication. Failed-attempt injected-item lists SHALL not become this record or model history; their system-only receipts and necessary operational events remain separate.
Content copied from outside the chat SHALL remain non-erasable through deletion
of its source once it has been written into a persisted reminder or Run record;
that limitation SHALL remain documented.

#### Scenario: A Run injects items

- **WHEN** a Run executes with persisted context text
- **THEN** its record copies the exact text used by the final request
- **AND** the record is readable only by the chat owner

#### Scenario: A Run injects an in-Run item

- **WHEN** a Run's winning attempt emits an item between model steps
- **THEN** the record lists it after the final request's items, with its producer, form, and residency
- **AND** its text is the stored part text, not a re-render

#### Scenario: A renderer's wording changes

- **WHEN** a producer renderer changes after an item and Run record were stored
- **THEN** both retain the original persisted text
- **AND** neither invokes the current renderer

#### Scenario: An inert context part accompanies a Run

- **WHEN** a stored context part has no non-empty text
- **THEN** it contributes no model part but remains in the Run context-item
  record with empty text
- **AND** metadata is not rendered to fill either location

#### Scenario: Two Runs render the same system prompt

- **WHEN** two successfully completed Runs render the same system prompt but inject different reminders
- **THEN** each Run records its own reminder text
- **AND** each identifies its own successful attempt and system-only receipt

#### Scenario: A source of injected content is deleted

- **WHEN** a reminder copied content from another chat that is later deleted
- **THEN** the persisted reminder and prior Run record remain unchanged
- **AND** the deletion limitation is not hidden

### Requirement: Stored parts cross a minimal SDK conversion boundary

Request assembly SHALL treat `messages.parts` as the durable application/UI
history. It SHALL preserve model-bearing stored parts and their order, omit
declared display-only parts except reasoning parts, which `reasoning-output`
returns to the provider for the Chat that stores them, and map each surviving
`data-context` part on a user message to one
ordinary SDK text part containing `data.text`. A `data-context` part stored on an
assistant message SHALL be mapped to one user-role message containing one text
part with `data.text`, emitted directly after the tool-result message of the
tool part that precedes it in stored order; it SHALL NOT be merged into the
assistant message's own content or into the tool-result message. It SHALL then pass the ordered
parts to the AI SDK rather than manually constructing a joined transcript.

This SHALL be an application-level best-effort invariant, not a promise of
provider-wire byte identity. SDK conversion, role grouping, and provider
serialization MAY evolve. The current ordinary assistant/tool projection SHALL
remain a documented exception pending #599 because stored parts do not prove
step boundaries.

The current top-level system prompt is outside message history and MAY change.
Compaction MAY replace only the prefix it explicitly supersedes, using the
materialized replacement history required by `model-system-prompts` and
`tool-calling`.

#### Scenario: Context data crosses the SDK boundary

- **WHEN** a stored user message contains non-empty `data-context.data.text`
- **THEN** the transition supplies one `{ type: "text", text: data.text }` part
  in the same position
- **AND** no producer renderer, sanitizer, sorter, or manual join runs

#### Scenario: An assistant-message context part crosses the SDK boundary

- **WHEN** a stored assistant message contains a tool part followed by a non-empty `data-context` part
- **THEN** replay emits the tool-call and tool-result pair and then one user-role message with that text
- **AND** the tool pair's replay budget is not charged for the context text

#### Scenario: SDK serialization changes

- **WHEN** an SDK or provider release changes its wire representation while
  accepting the same ordered UI parts
- **THEN** the application-level replay contract remains satisfied
- **AND** the system does not claim provider-wire or cache-byte identity

#### Scenario: Reasoning parts cross the boundary for their own Chat

- **WHEN** request assembly builds a Run's request from stored parts that include
  reasoning parts
- **THEN** those parts are passed to the AI SDK in their stored positions with any
  provider metadata they carry
- **AND** every other declared display-only part is still omitted
