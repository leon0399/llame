## MODIFIED Requirements

### Requirement: Every item declares metadata and persists its final model-facing text

Each context item SHALL declare the **producer** that authored it and MAY declare a **form** describing what kind of content it is. Producer answers who authored the item; form answers what kind of thing it is. The two SHALL be independent: several producers MAY share a form, and one producer MAY emit more than one form.

The form vocabulary SHALL be **semantic rather than visual**. It SHALL state what the content is, never how it is presented; ordering, emphasis, collapse behavior, and other presentation concerns SHALL NOT enter it. The vocabulary SHALL contain exactly the forms that have a producer:

- `notice` — a one-off account of something that happened; it supersedes nothing.
- `snapshot` — current state, where a later snapshot from the same producer supersedes an earlier one.
- `checkpoint` — a summary that supersedes this chat's own earlier history.

A form SHALL NOT be defined ahead of a producer that emits it. Anticipated forms without a producer SHALL be recorded as noncanonical research provenance rather than specified here.

Every newly authored persisted item SHALL also carry its complete final model-facing text block, including the canonical envelope, attributes, provenance line, producer body, and closing delimiter. That text SHALL be the sole authority for replay. Producer, form, Run linkage, and producer payload SHALL remain non-rendering metadata for machine behavior, owner-facing provenance, and inspection; no consumer SHALL regenerate or replace the persisted text from that metadata.

An absent or unrecognized form and an unrecognized producer SHALL NOT prevent a structurally valid persisted text block from replaying. The text is already fully framed by the trusted authoring path, so a reader SHALL treat unknown metadata as opaque rather than interpreting it. Validation of the persisted envelope shape SHALL remain strict, and producer-specific consumers SHALL validate known payloads before acting on them.

Pre-cutover context parts that carry semantic metadata but no persisted text SHALL be legacy. They SHALL remain stored but SHALL contribute no model-visible block on later requests and SHALL NOT be backfilled or re-rendered by the current producer renderer.

#### Scenario: Reader encounters an unrecognized producer with persisted text

- **WHEN** a persisted item carries a structurally valid final text block and names a producer the reader does not recognize
- **THEN** the block replays verbatim in its stored position
- **AND** the reader does not interpret the producer-specific payload

#### Scenario: Reader encounters an unrecognized producer

- **WHEN** a persisted item names a producer the reader does not recognize
- **THEN** a structurally valid stored text block replays verbatim while a legacy data-only item contributes no text
- **AND** neither case causes the reader to interpret the unknown payload

#### Scenario: Client supplies control metadata

- **WHEN** a client submits a message containing an item-shaped part
- **THEN** the part is discarded
- **AND** only server-derived state can author an item

#### Scenario: Reader encounters an unrecognized form

- **WHEN** a persisted item declares a form the reader does not recognize
- **THEN** its final text block replays verbatim
- **AND** no behavior is inferred from the form

#### Scenario: Reader encounters a legacy data-only item

- **WHEN** a pre-cutover context item has no persisted final text
- **THEN** it remains in storage but contributes no block to the model request
- **AND** the current renderer is not used to manufacture historical text for it

### Requirement: Co-occurring items have a total order

When more than one item is injected on the same turn, the authoring path SHALL persist them in a **fixed producer precedence order**, ahead of the triggering user text within the same message:

1. `effective-context-change`
2. `tool-availability`
3. `recency-digest`
4. `temporal`

This list governs items **attached to a turn**. A producer whose item is carried by a record of its own — the compaction checkpoint is the only one today — is ordered by its placement rule instead. A checkpoint necessarily leads the history it supersedes, which is a stronger constraint than any precedence order could express.

A producer added later SHALL be appended to this list, and the list SHALL be extended in the rail's own specification rather than negotiated between producers.

When one producer contributes **more than one item** on the same turn, those items SHALL be persisted in the order that producer emitted them, ahead of the next producer's items. An item SHALL NOT be merged into, or suppressed by, another item.

Replay SHALL preserve the stored part order exactly. It SHALL NOT re-sort historical items through the current producer precedence list, because changing that list must not reorder an already-authored conversation.

#### Scenario: Several producers fire on one turn

- **WHEN** a model change, an availability change, and a chat-list change all occur before one user message
- **THEN** their complete text blocks are persisted in the fixed producer precedence order
- **AND** every later replay preserves that stored order

#### Scenario: One producer contributes two items on one turn

- **WHEN** a producer emits a supersession and a later delta before the same user message
- **THEN** both are persisted under that producer's slot in emission order
- **AND** the delta does not precede the supersession it follows

#### Scenario: The precedence list changes later

- **WHEN** a later release adds a producer or changes author-time precedence
- **THEN** items created by that release follow the new authoring order
- **AND** items on existing messages remain in their original stored order

#### Scenario: A temporal item accompanies other items on one turn

- **WHEN** a turn carries both an availability change and the temporal item
- **THEN** the authoring path persists the temporal item last among the attached items, immediately ahead of the user's visible text
- **AND** later replay preserves that stored position and its own envelope

### Requirement: Reserved delimiter names are neutralized on untrusted rails

Content that llame did not author SHALL NOT be able to emit the rail's delimiter name as a tag when it is projected into model context. This SHALL apply to **visible user message text** and to **tool results**, which are respectively user-authored and remote-authored. The neutralization SHALL use the same two rules the instance-config capability defines for authored text: a value can never close a tag it did not open within that same value, and can never emit a reserved delimiter name as a tag at all.

Neutralization of visible user text and tool results SHALL apply at projection into model context and SHALL NOT alter their stored source content.

Untrusted values included in a context item SHALL instead be neutralized exactly once, before the complete final item text is persisted. Replay SHALL trust that server-authored persisted block and SHALL NOT scan, sanitize, or rewrite it again. A later security correction that must alter historical blocks requires an explicit reviewed data transition; it SHALL NOT occur silently as a side effect of changing a renderer.

**Assistant output SHALL NOT be neutralized.** A model does not treat its own prior turns as authoritative, so an envelope-shaped fragment there carries no authority; and assistant turns legitimately contain the delimiter name as subject matter, which neutralization would corrupt on replay.

#### Scenario: A user forges an envelope

- **WHEN** a user's message text contains the rail's delimiter name in tag form
- **THEN** the projected model context escapes it rather than emitting a second envelope
- **AND** the stored message is unchanged

#### Scenario: A context producer includes untrusted text

- **WHEN** a producer authors an item from a recalled title, excerpt, file, or other untrusted value
- **THEN** the value is neutralized before the complete item text is persisted
- **AND** later replay uses that persisted text without another neutralization pass

#### Scenario: A tool result contains an envelope

- **WHEN** a tool returns content containing the rail's delimiter name in tag form
- **THEN** the projected model context escapes it
- **AND** the recorded tool result is unchanged

#### Scenario: An assistant turn discusses the envelope

- **WHEN** an assistant turn legitimately contains the delimiter name, such as inside a code sample
- **THEN** the replayed text is byte-identical to what the model produced
- **AND** no neutralization is applied to it

### Requirement: An item is either persisted-literal or bind-time

Every item SHALL be one of two kinds, and its kind SHALL be determined by whether durable final model-facing text exists for it:

- **persisted-literal** — a durable part or owning record carries the complete final text block, which replays verbatim.
- **bind-time** — the item is computed while assembling one request and no durable final text exists. A bind-time item SHALL NOT be persisted into conversation history, because a stored statement about the present instant becomes false on replay.

A persisted-literal item MAY also carry structured metadata, but that metadata SHALL NOT be a source from which replay reconstructs prose, framing, attributes, sanitization, or order.

#### Scenario: A persisted-literal item is replayed

- **WHEN** a conversation containing a persisted-literal item is replayed by a later release
- **THEN** the stored complete text block is used directly
- **AND** renderer changes do not alter it

#### Scenario: A persisted-derived item is replayed

- **WHEN** a pre-cutover persisted-derived item carries semantic metadata but no final text
- **THEN** it contributes no model-visible block
- **AND** the current renderer is not used to derive historical prose from it

#### Scenario: A bind-time item is replayed

- **WHEN** a request is assembled for a turn that previously carried a bind-time item
- **THEN** no stale copy of that item appears in the replayed history

### Requirement: Every Run records the items it injected

Each Run SHALL record the context items injected into the request it executed, as they appeared in the final request, together with each item's producer, form, and residency. The record SHALL be **owner-scoped and enforced at the datastore**, and SHALL NOT be exposed to a non-owner, to a public share, to an ordinary transcript export, or to a search projection.

For a persisted-literal item, recording SHALL copy the same stored text block used by the final request and SHALL NOT invoke a renderer. For a bind-time item, the record SHALL capture the final computed text. The record SHALL therefore remain the authority for what a past Run injected even if conversation history is later compacted or deleted.

A legacy data-only item that contributed nothing SHALL still appear in the record for a later Run, marked as having contributed no text. Omitting it would turn the deliberate compatibility loss into an undetectable omission.

The record SHALL state what was **actually sent**. When a request is rebuilt before dispatch — as transition compaction does — the record SHALL reflect the rebuilt request rather than the discarded one, and a Run whose preparation fails before any request is made SHALL record nothing rather than a request the model never received.

The record SHALL be kept **separately from the effective-context snapshot**, which is addressed by its content and reused across Runs whose prompt, declarations, source, and availability manifest are identical, while injected items vary per turn under exactly those conditions.

An item whose content originates **outside the chat it was injected into** SHALL be documented as not erasable through that content's own source: deleting the source, or withdrawing consent for it, does not reach a record already written.

#### Scenario: A Run injects persisted items

- **WHEN** a Run executes with persisted-literal context items
- **THEN** its record lists the exact text blocks used by the final request, with producer, form, and residency
- **AND** the record is readable only by the chat's owner

#### Scenario: A Run injects items

- **WHEN** a Run executes with persisted-literal, bind-time, or omitted legacy items
- **THEN** its record states exactly what each item contributed to the final request, with producer, form, and residency
- **AND** the record is readable only by the chat's owner

#### Scenario: A renderer's wording changes

- **WHEN** a producer renderer changes after an item and a Run record were written
- **THEN** both the conversation replay and the earlier Run record retain the original item text
- **AND** neither is re-derived from the current renderer

#### Scenario: Two Runs share an effective-context snapshot

- **WHEN** two Runs bind the same content-addressed snapshot but inject different items
- **THEN** each Run records its own items
- **AND** snapshot reuse is unaffected

#### Scenario: A source of injected content is deleted

- **WHEN** content injected into one chat originated in another chat that is later deleted
- **THEN** the deletion does not remove that content from persisted blocks or records already written
- **AND** this limit is disclosed rather than implied

## RENAMED Requirements

- FROM: `### Requirement: Every item declares a producer and a form, and unknown values render as nothing`
- TO: `### Requirement: Every item declares metadata and persists its final model-facing text`
- FROM: `### Requirement: An item is either persisted-derived or bind-time`
- TO: `### Requirement: An item is either persisted-literal or bind-time`
