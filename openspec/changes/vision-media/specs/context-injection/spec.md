## MODIFIED Requirements

### Requirement: Stored parts cross a minimal SDK conversion boundary

Request assembly SHALL treat `messages.parts` as the durable application/UI
history. It SHALL preserve model-bearing stored parts and their order, except
for the placement of owner `file` parts stated below, omit declared display-only
parts except reasoning parts, which `reasoning-output`
returns to the provider for the Chat that stores them, and map each surviving
`data-context` part on a user message to one
ordinary SDK text part containing `data.text`, followed, for each image entry
that `prompt-imports` attaches to that item, by either one image part built from
the referenced object's model variant or the image placeholder text part, chosen
by the epoch image window and the request model's declared input as `media-attachments`
requires. A `data-context`
part stored on an
assistant message SHALL be mapped to one user-role message containing one text
part with `data.text`, emitted directly after the tool-result message of the
tool part that precedes it in stored order, or in its stored position when that
tool pair was omitted by the replay budget; it SHALL NOT be merged into the
assistant message's own content or into the tool-result message. A `data-context`
part on a `checkpoint` row SHALL be mapped to one user-role message containing one
text part with `data.text`, emitted in place of the rows through that checkpoint's
absorbed-through sequence and ahead of every later user and assistant row.
Selection is by that boundary rather than by the checkpoint row's own sequence: a
Run SHALL take the latest checkpoint whose absorbed-through sequence is below the
triggering user message's sequence, because a checkpoint published before the step
sits above the user row it was published for. It SHALL then pass the ordered parts
to the AI SDK rather than manually constructing a joined transcript.

Each owner `file` part on a user message SHALL be mapped at request time from the
media object it references; a stored part SHALL carry only its `media://`
reference and never image bytes. Within that message, the mapped file parts SHALL
follow every mapped `data-context` part, the temporal row included, and precede
the message's first text part, in the file parts' stored order, while every other
part keeps its stored relative order. Each file part SHALL map to one text part
`Image n (media://<id>):`, with `n` counting that message's file parts from 1,
followed by either one image part built from the object's model variant or the
image placeholder text part, chosen by the epoch image window and the request model's
declared input as `media-attachments` requires.

A stored tool part whose result is an image result (`kind: "image"`) SHALL map to
a tool output of type `content` carrying the result's text followed by one image
part built from the referenced object's model variant when `media-attachments`
selects an image part for that reference; otherwise its output SHALL carry the
result's text followed by the image placeholder and no image part. The transport
of image outputs on Chat Completions wires is specified by `media-attachments`.

Media references SHALL resolve only within the Run owner's media. A reference that
does not resolve for that owner SHALL contribute no byte or descriptor field of
any media object to the request and SHALL map to the unavailable placeholder that
`media-attachments` defines.

This SHALL be an application-level best-effort invariant, not a promise of
provider-wire byte identity. SDK conversion, role grouping, and provider
serialization MAY evolve. The current ordinary assistant/tool projection SHALL
remain a documented exception pending #599 because stored parts do not prove
step boundaries.

The current top-level system prompt is outside message history and MAY change.
A checkpoint MAY replace only the prefix it explicitly supersedes, through the
coverage boundary and replay-selection rule required by `model-system-prompts`;
no other stored form of superseded history is replayed.

#### Scenario: A checkpoint row crosses the SDK boundary

- **WHEN** a chat's effective history is replayed for one triggering user message
- **THEN** the checkpoint supplied as one user-role message carrying its stored
  text is the latest checkpoint whose absorbed-through sequence is below that user
  message's sequence
- **AND** no user or assistant row through that checkpoint's absorbed-through
  sequence is supplied

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

#### Scenario: Owner attachments are placed after context items and before text

- **WHEN** a stored user message holds an activation item, its temporal row, one text part, and two
  file parts stored after the text, the request model declares `image` input, and the epoch image
  window attaches both references
- **THEN** the request supplies, in order, the activation text, the temporal row text,
  `Image 1 (media://<first id>):`, the first object's image part, `Image 2 (media://<second id>):`,
  the second object's image part, and then the owner's text
- **AND** each image part carries the referenced object's model variant, while the stored parts
  still carry only their `media://` references

#### Scenario: A text-only model receives labelled placeholders for attachments

- **WHEN** a stored user message holds one text part and one file part and the request model's
  `input` lacks `image`
- **THEN** the file part maps to `Image 1 (media://<id>):` followed by the image placeholder text part
  ahead of the owner's text
- **AND** no image part is supplied for that message

#### Scenario: An image read result crosses as tool content

- **WHEN** a stored assistant message holds a `read` tool part whose result is an image result, the
  request model declares `image` input, and the epoch image window attaches the reference
- **THEN** the tool-result message carries an output of type `content` holding the result's text
  followed by one image part built from the referenced object's model variant

#### Scenario: An image read result for a text-only model carries a placeholder

- **WHEN** the same stored tool part is replayed to a model whose `input` lacks `image`
- **THEN** the tool output carries the result's text followed by the image placeholder
- **AND** it carries no image part

#### Scenario: A prompt-import image crosses as an image part or a placeholder

- **WHEN** a stored user message holds a `data-context` item to which `prompt-imports` attaches one
  image entry, and the request is replayed once to a model declaring `image` input with the
  reference attached by the epoch image window and once to a model whose `input` lacks `image`
- **THEN** the first request supplies the item's text followed by one image part built from the
  referenced object's model variant
- **AND** the second supplies the item's text followed by the image placeholder text part and no
  image part for that entry

#### Scenario: Another owner's media never enters the request

- **WHEN** a stored file part or image result in owner A's chat references a media object owned by
  owner B
- **THEN** no byte, dimension, name, or media type of B's object appears in A's request
- **AND** the reference maps to the unavailable placeholder

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

A compaction checkpoint SHALL declare producer `compaction`, form `checkpoint`,
and rail residency on an ordinary persisted `data-context` part, and SHALL
carry the complete final canonical envelope beneath `data.text` like every
other persisted item. It SHALL NOT need a second storage shape to preserve its
semantic form.

`data.text` SHALL be the sole replay authority, except that the conversion
boundary emits the image parts or placeholders of a `prompt-imports` item from
the `media` locators in its payload, after `data.text`. Producer, form, Run linkage,
and payload SHALL remain non-rendering metadata for validated machine behavior,
owner UI, provenance, and inspection. A metadata/text disagreement SHALL NOT
cause text to be regenerated: text wins for model replay, while metadata
consumers validate and fail closed independently.

An unknown producer or form SHALL NOT prevent structurally valid non-empty text
from replaying. A stored context part with missing text or the empty string
SHALL remain stored but contribute no model-visible part. It SHALL NOT be
backfilled or rendered from metadata. Whitespace-only text SHALL survive
unchanged.

A `checkpoint` row is the one exception to that inertness. A checkpoint message
whose `data.text` is empty or missing SHALL fail request preparation closed
rather than replay as an inert part, because an inert checkpoint would hide every
row it absorbed and silently shrink the model-visible history. It SHALL NOT be
backfilled or reconstructed from its raw summary either.

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
- **AND** a `checkpoint` row is not treated as one of those inert parts: its
  request fails preparation instead of replaying without the rows it absorbed

#### Scenario: Client supplies control metadata

- **WHEN** a client request contains a context-item-shaped part
- **THEN** request validation rejects the message
- **AND** no client-authored part is persisted or trusted
- **AND** only server-derived state can author an item

#### Scenario: Service-level defense encounters control metadata

- **WHEN** a direct service caller bypasses request validation and supplies
  parts containing a context-item-shaped part
- **THEN** the part is discarded while the remaining user text parts retain
  their order
- **AND** the message is rejected before database work when neither a user text
  part nor a file part remains
- **AND** only server-derived state can author an item

#### Scenario: Service-level defense keeps an image-only message

- **WHEN** a direct service caller bypasses request validation and supplies a context-item-shaped
  part alongside one file part referencing the caller's own media and no text part
- **THEN** the forged part is discarded and the message is accepted with its file part
- **AND** only server-derived state can author an item

#### Scenario: Service-level defense does not count another owner's media

- **WHEN** a direct service caller supplies a context-item-shaped part alongside one file part
  referencing media owned by a different owner and no text part
- **THEN** the message is rejected before any row is written
- **AND** no part referencing the other owner's media is persisted
