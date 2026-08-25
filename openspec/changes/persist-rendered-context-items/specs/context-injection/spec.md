## MODIFIED Requirements

### Requirement: Every item declares metadata and persists its final model-facing text

Each context item SHALL declare the **producer** that authored it and MAY
declare a **form** describing what kind of content it is. Producer answers who
authored the item; form answers what kind of thing it is. The two SHALL be
independent: several producers MAY share a form, and one producer MAY emit more
than one form.

The form vocabulary SHALL be semantic rather than visual and SHALL contain
exactly the forms that have a producer:

- `notice` — a one-off account of something that happened; it supersedes
  nothing.
- `snapshot` — current state, where a later snapshot from the same producer
  supersedes an earlier one.
- `checkpoint` — a summary that supersedes this chat's own earlier history.

A form SHALL NOT be defined ahead of a producer that emits it.

Every newly authored persisted context part SHALL use `type: "data-context"`,
retain `data.v: 1`, and carry its complete final model-facing text beneath
`data.text`. The text SHALL include the canonical envelope, attributes,
provenance, producer body, and closing delimiter. Writers SHALL require a
non-empty string.

`data.text` SHALL be the sole replay authority. Producer, form, Run linkage,
and payload SHALL remain non-rendering metadata for validated machine behavior,
owner UI, provenance, and inspection. A metadata/text disagreement SHALL NOT
cause text to be regenerated: text wins for model replay, while metadata
consumers validate and fail closed independently.

An unknown producer or form SHALL NOT prevent structurally valid non-empty text
from replaying. A stored context part with missing text or the empty string
SHALL remain stored but contribute no model-visible part. It SHALL NOT be
backfilled or rendered from metadata. Whitespace-only text SHALL survive
unchanged.

#### Scenario: Reader encounters unknown metadata with persisted text

- **WHEN** a context part carries non-empty text and names an unrecognized
  producer or form
- **THEN** its text replays verbatim in the stored position
- **AND** the reader does not interpret the unknown payload

#### Scenario: Reader encounters an unrecognized producer

- **WHEN** a context part has non-empty text and an unrecognized producer
- **THEN** the text replays verbatim in its stored position
- **AND** a data-only part contributes no model-visible text

#### Scenario: Reader encounters an unrecognized form

- **WHEN** a context part has non-empty text and an unrecognized form
- **THEN** the text replays verbatim in its stored position
- **AND** no behavior is inferred from the unknown form

#### Scenario: Text and metadata disagree

- **WHEN** persisted context text disagrees with producer metadata
- **THEN** the model receives the stored text unchanged
- **AND** machine behavior validates metadata without rewriting that text

#### Scenario: Existing metadata-only part is replayed

- **WHEN** an existing context part carries metadata but no non-empty text
- **THEN** it contributes no model-visible part
- **AND** no current renderer is invoked to manufacture historical prose

#### Scenario: Client supplies control metadata

- **WHEN** a client submits a message containing a context-item-shaped part
- **THEN** the part is discarded
- **AND** only server-derived state can author an item

### Requirement: Co-occurring items have a total author-time order

When more than one item is injected on the same turn, the accepting path SHALL
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

### Requirement: User-authored text is neutralized before persistence

Every client-submitted user text part SHALL be neutralized before it is stored,
using the reserved-delimiter rules the instance-config capability defines. The
sanitized stored value SHALL be the sole replay form; the application SHALL NOT
retain a second unsanitized transcript or sanitize the value again during later
request assembly.

Sanitization SHALL preserve message-part boundaries and order. Replay SHALL NOT
join text parts manually or prefix sender identifiers. Assistant output SHALL
NOT be neutralized and persisted reasoning SHALL remain display-only.

Tool-result neutralization and ordinary assistant/tool replay remain governed
by `tool-calling`; their current custom projection is an explicit best-effort
exception pending #599 rather than part of this change.

#### Scenario: A user forges an envelope

- **WHEN** a submitted user text part contains a reserved delimiter in tag form
- **THEN** the accepting path neutralizes it before persistence
- **AND** every later replay uses that stored sanitized text unchanged

#### Scenario: A message has several text parts

- **WHEN** an accepted user message contains several text parts
- **THEN** each sanitized part is stored and replayed in its original position
- **AND** the application does not concatenate the parts into a replacement
  string

#### Scenario: Two users participate in one chat

- **WHEN** stored user turns have different `senderUserId` values
- **THEN** later model replay uses each turn's stored parts without injecting
  sender labels

#### Scenario: Assistant output discusses the envelope

- **WHEN** an assistant turn contains the reserved delimiter as subject matter
- **THEN** its replayed visible text is not neutralized
- **AND** persisted reasoning remains excluded

#### Scenario: A tool result contains an envelope

- **WHEN** a tool result contains a reserved delimiter in tag form
- **THEN** the `tool-calling` projection neutralizes it under its existing
  contract
- **AND** this change does not redefine ordinary tool-part persistence

#### Scenario: An assistant turn discusses the envelope

- **WHEN** an assistant turn legitimately contains the reserved delimiter
- **THEN** its visible replay text is not neutralized
- **AND** display-only reasoning is still omitted

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

### Requirement: Every Run records the items it injected

Each Run SHALL record context items injected into the request it executed, as
they appeared in the final application request, together with each item's
producer, form, and residency. The record SHALL be owner-scoped and enforced at
the datastore, and SHALL NOT be exposed to a non-owner, public share, ordinary
transcript export, or search projection.

For a persisted item, recording SHALL copy the same stored text used by the
request and SHALL NOT invoke a renderer. A data-only or empty context part that
contributed nothing SHALL be omitted from the Run item record. A bind-time item
SHALL record its final computed text.

When request preparation rebuilds the request after transition compaction, the
record SHALL describe the rebuilt request. A Run whose preparation fails before
dispatch SHALL record no injected items.

The record SHALL remain separate from the reusable effective-context snapshot,
whose content address and lifecycle differ from turn-specific injected items.
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
- **THEN** it contributes neither a model part nor a Run context-item entry
- **AND** metadata is not rendered to fill either location

#### Scenario: Two Runs share an effective-context snapshot

- **WHEN** two Runs reuse one snapshot but inject different reminders
- **THEN** each Run records its own reminder text
- **AND** snapshot reuse is unaffected

#### Scenario: A source of injected content is deleted

- **WHEN** a reminder copied content from another chat that is later deleted
- **THEN** the persisted reminder and prior Run record remain unchanged
- **AND** the deletion limitation is not hidden

## ADDED Requirements

### Requirement: Stored parts cross a minimal SDK conversion boundary

Request assembly SHALL treat `messages.parts` as the durable application/UI
history. It SHALL preserve model-bearing stored parts and their order, omit
declared display-only parts, and map each surviving `data-context` part to one
ordinary SDK text part containing `data.text`. It SHALL then pass the ordered
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

#### Scenario: SDK serialization changes

- **WHEN** an SDK or provider release changes its wire representation while
  accepting the same ordered UI parts
- **THEN** the application-level replay contract remains satisfied
- **AND** the system does not claim provider-wire or cache-byte identity

## RENAMED Requirements

- FROM: `### Requirement: Every item declares a producer and a form, and unknown values render as nothing`
- TO: `### Requirement: Every item declares metadata and persists its final model-facing text`
- FROM: `### Requirement: Co-occurring items have a total order`
- TO: `### Requirement: Co-occurring items have a total author-time order`
- FROM: `### Requirement: Reserved delimiter names are neutralized on untrusted rails`
- TO: `### Requirement: User-authored text is neutralized before persistence`
- FROM: `### Requirement: An item is either persisted-derived or bind-time`
- TO: `### Requirement: An item is either persisted-literal or bind-time`
