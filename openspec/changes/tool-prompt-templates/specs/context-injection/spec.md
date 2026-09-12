## MODIFIED Requirements

### Requirement: Server-authored context is injected as discrete items on one rail

Every server-authored contribution to a chat's model-visible conversation that is not part of the system prompt SHALL be injected as a **context item** on one rail. An item SHALL be rendered inside a single canonical `<system-reminder>` envelope, and SHALL NOT introduce a top-level delimiter name of its own.

A materialized compaction checkpoint SHALL remain a rail context item with producer `compaction` and form `checkpoint` for envelope and Run-receipt semantics. Its durable representation SHALL be the storage exception: a user-role replacement-history UI message containing one ordinary text part with the complete final canonical envelope, not a persisted `data-context` part. `model-system-prompts` SHALL own that storage and replay contract.

The wire role SHALL remain `user`. A provider-level role for injected context SHALL NOT be invented, and items SHALL NOT be emitted as additional conversation messages of their own where a message already exists to carry them: items attached to a turn SHALL be carried inside that turn's triggering user message.

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

#### Scenario: A compaction checkpoint replaces history

- **WHEN** compaction materializes replacement history for a superseded prefix
- **THEN** its first record is a user-role UI message containing one ordinary
  text part with the complete final checkpoint envelope
- **AND** the envelope and Run receipt retain producer `compaction` and form
  `checkpoint`, while the stored record is not a `data-context` part and replays
  without metadata reconstruction

Worker-attempt contributions intended for conversation history SHALL be staged in memory before target-model I/O and published in the triggering message only with successful turn completion. Failed or superseded attempts SHALL not append such parts. Legitimate accepted-message facts remain persisted-literal; accepting a user message is not publishing a failed attempt's context. Committed parts retain the exact prepared text and existing envelope/order.

### Requirement: Co-occurring items have a total author-time order

When more than one item is injected on the same turn, the authoring/request-preparation path SHALL
persist them in a fixed producer precedence order, ahead of the triggering user
text within the same message:

1. `effective-context-change`
2. `tool-availability`
3. `recency-digest`
4. `temporal`

When one producer contributes more than one item, those items SHALL be stored
in emission order. A producer added later SHALL extend this authoring list in
the rail specification.

Replay SHALL preserve the stored part order. It SHALL NOT re-sort historical
items through the current precedence list or merge adjacent text parts. The
compaction checkpoint is carried by replacement history of its own and follows
that capability's placement rule rather than this attached-item list.

#### Scenario: Several producers fire on one turn

- **WHEN** a model change, availability change, and chat-list change accompany
  one user message
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

When worker preparation adds attempt-owned items beside already persisted message facts, the final request SHALL apply this same producer order while preserving each producer's internal order and all user-authored content. Successful publication SHALL store that final ordering atomically; a failed attempt SHALL store no attempt-owned message parts.

### Requirement: Compaction is the rail's re-baseline boundary

Compaction SHALL be the single boundary at which rail state is re-established. A producer whose items express deltas against a baseline SHALL treat a newly active compaction checkpoint as starting a fresh baseline, rather than comparing across it. A producer whose contribution is a frozen prefix baseline SHALL re-resolve it at compaction and at no other time.

This rule SHALL be stated once for the rail and inherited, rather than derived independently per producer.

Standing context that is re-supplied on every request SHALL be excluded from the summary a compaction writes, so that a checkpoint does not freeze a stale copy of a value the next request supplies fresh. This exclusion SHALL be documented as resting on instruction and model compliance rather than structural enforcement.

#### Scenario: A delta producer crosses a compaction

- **WHEN** the first turn after a newly active checkpoint is prepared
- **THEN** a delta producer establishes a fresh baseline rather than comparing against pre-compaction state
- **AND** no transition is reported across the boundary

#### Scenario: A frozen baseline crosses a compaction

- **WHEN** a chat with a frozen prefix baseline is compacted
- **THEN** the baseline is re-resolved
- **AND** it is not re-resolved by any other event

Frozen per-chat digest and temporal baselines retain their owning lifecycles. This requirement SHALL not freeze owner-variable resolution, runtime tool catalogs, or descriptions across attempts. Availability comparisons use the previous successful turn's minimal id/state record within the current epoch; failed attempts never establish an epoch baseline.

### Requirement: An item is either persisted-literal or bind-time

Every item SHALL be one of two kinds:

- **persisted-literal** — durable storage carries the complete final text used
  for replay; or
- **bind-time** — the item is computed for one request and no durable historical
  text exists.

A persisted-literal item's metadata SHALL NOT be a source from which replay
reconstructs prose, framing, attributes, sanitization, or order. A persisted
context part with missing or empty text is inert stored data, not a third
rendering mode. A bind-time item SHALL NOT be persisted into message history,
because a stored statement about the present request could become false later.

#### Scenario: A persisted-derived item is replayed

- **WHEN** a conversation contains a context part with non-empty final text
- **THEN** replay uses that text directly
- **AND** renderer changes do not alter it

#### Scenario: A data-only item is replayed

- **WHEN** a stored context part lacks non-empty final text
- **THEN** it contributes no model-visible part
- **AND** metadata is not used to derive one

#### Scenario: A bind-time item is replayed

- **WHEN** a request is assembled for a turn that previously had a bind-time
  item
- **THEN** no stale copy of that item appears in history

An attempt-generated item intended for later conversation history SHALL be staged as a pending persisted-literal contribution. Its exact prepared text is used in the current request, then atomically committed on successful completion. A failure discards that pending contribution. This staging does not add a new wire-format item kind or permit a bind-time-only producer to persist into message history.

## ADDED Requirements

### Requirement: Successful Runs record the winning attempt's injected items

Each successfully completed Run SHALL record the winning attempt's context items injected into the final request it executed, as
they appeared in the final application request, together with each item's
producer, form, and residency. The record SHALL be owner-scoped and enforced at
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

## REMOVED Requirements

### Requirement: Every Run records the items it injected

**Reason**: Replaced by `Successful Runs record the winning attempt's injected items`; acceptance-time or failed-attempt publication semantics are retired.

**Migration**: Apply the replacement requirement with the worker-attempt cutover. Preserve unrelated scenarios and existing owner isolation; remove the obsolete binding/publication behavior.
