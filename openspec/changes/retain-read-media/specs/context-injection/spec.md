## MODIFIED Requirements

### Requirement: Stored parts cross a minimal SDK conversion boundary

Request assembly MUST use `messages.parts` as the durable application and UI history. It MUST keep
the model-bearing stored parts and their order. Owner `file` parts are the one exception, and their
placement follows below. It MUST omit declared display-only parts, except reasoning parts.
`reasoning-output` returns reasoning parts to the provider for the Chat that stores them.

Request assembly MUST map each remaining `data-context` part on a user message to one ordinary SDK
text part that contains `data.text`. `prompt-imports` can attach image and PDF entries to that
item. After the text part, each image entry MUST map to one image part or to the image placeholder
text part. The image part is built from the image's model variant. Each PDF entry MUST map to one
file part, built from the PDF's original, or to the PDF placeholder text part. The form of each
entry follows from three things, as `media-attachments` requires. These are the availability of the
variant or original, the epoch image window, and the declared input of the request model.

Request assembly MUST map a `data-context` part on an assistant message to one user-role message
with one text part that contains `data.text`. It MUST emit that message directly after the
tool-result message of the tool part before it in stored order. When the replay budget omitted that
tool pair, it MUST emit the message in its stored position. It MUST NOT merge the text into the
assistant message's own content or into the tool-result message.

Request assembly MUST map a `data-context` part on a `checkpoint` row to one user-role message with
one text part that contains `data.text`. It MUST emit that message in place of the rows through the
checkpoint's absorbed-through sequence, before each later user and assistant row. That boundary
selects the checkpoint, not the checkpoint row's own sequence. A Run MUST take the latest checkpoint
whose absorbed-through sequence is below the sequence of the triggering user message. The reason is
that a checkpoint published before the step sits above the user row that it was published for.
Request assembly MUST then give the ordered parts to the AI SDK. It MUST NOT build a joined
transcript manually.

Request assembly MUST map each owner `file` part on a user message at request time from the media
object that it references. A stored `file` part MUST carry only its `media://` reference and never
image or PDF bytes. In that message, the mapped file parts MUST go, in their stored order, directly
after the last mapped `data-context` part, the temporal row included. When the message has no such
part, they MUST go at the start of the message. All other parts MUST keep their stored relative
order. Each image file part MUST map to one text part `Image n (media://<id>):`. Each file part whose
`mediaType` is `application/pdf` MUST map to one text part `PDF n (media://<id>):`. `n` counts the
file parts of the same kind in that message, from 1. After an image label, request assembly MUST
emit one image part built from the object's model variant, or the image placeholder text part.
After a PDF label, it MUST emit one file part built from the object's original, or the PDF
placeholder text part. That file part has `mediaType` `application/pdf` and the stored name as
`filename`. The epoch image
window and the declared input of the request model select each form, as `media-attachments`
requires.

A stored tool part whose result is an image result (`kind: "image"`) MUST map to a tool output of
type `content`. `media-attachments` can select an image part for that reference. Then the output
carries the result's text and then one image part built from the image's model variant. In other
cases, the output MUST carry the result's text and then the image placeholder, with no image part.
For a `media://` result or image entry, the model variant is the stored object's. For each other
image, it is the retained model variant in the stored part. A result without retained bytes is not
a reference, so its output MUST carry only the result's text. The display-only `thumbnail` of an
image result or image entry MUST NOT cross the boundary. Its retained bytes MUST cross it only as an
attached image part.

A stored tool part whose result is a PDF result (`kind: "pdf"`) MUST map to a tool output of type
`content`. `media-attachments` can select a file part for that reference. Then the output carries
the result's text and then one file part built from the PDF's original. In other cases, the output
MUST carry the result's text and then the PDF placeholder, with no file part. For a `media://`
result or PDF entry, the original is the stored object's. For each other PDF, it is the retained
original in the stored part. A result without retained bytes is not a reference, so its output MUST
carry only the result's text. `media-attachments` specifies the transport of image and PDF outputs
on Chat Completions wires.

Media references MUST resolve only in the media of the Run owner. A `media://` reference that does
not resolve for that owner MUST add no byte or descriptor field of a media object to the request. It
MUST map to the unavailable placeholder that `media-attachments` defines, or to the PDF unavailable
placeholder for a PDF reference.

This MUST be an application-level best-effort invariant. It is not a promise of byte identity on
the provider wire. SDK conversion, role grouping, and provider serialization can change. The
current ordinary assistant and tool projection MUST stay a documented exception until #599, because
stored parts do not prove step boundaries.

The current top-level system prompt is outside message history and can change. A checkpoint can
replace only the prefix that it explicitly supersedes. It does this through the coverage boundary
and the replay-selection rule that `model-system-prompts` requires. The system MUST NOT replay a
different stored form of superseded history.

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

- **WHEN** a later step of the Run that read an image replays that `read` tool part, the request
  model declares `image` input, and the epoch image window attaches the reference
- **THEN** the tool-result message carries an output of type `content` holding the result's text
  followed by one image part built from the retained model variant in the stored tool part
- **AND** the output carries no `thumbnail`

#### Scenario: An image read result for a text-only model carries a placeholder

- **WHEN** the same stored tool part is replayed to a model whose `input` lacks `image`
- **THEN** the tool output carries the result's text followed by the image placeholder
- **AND** it carries no image part

#### Scenario: An earlier turn's image read result carries the not-retained placeholder

- **WHEN** a later turn on a model that declares `image` input replays a stored `read` tool part
  whose result is an image result with no `media` field and no retained bytes
- **THEN** the tool output carries only the result's text
- **AND** it carries no image part and no placeholder

#### Scenario: An earlier turn's retained image read result crosses as tool content

- **WHEN** a later turn on a model that declares `image` input replays a stored `read` tool part
  that keeps retained bytes, and the epoch image window attaches the reference
- **THEN** the tool output carries the result's text and then one image part built from the
  retained model variant
- **AND** the output text carries no `thumbnail` and no retained bytes

#### Scenario: A prompt-import image crosses as an image part or a placeholder

- **WHEN** a stored user message holds a `data-context` item to which `prompt-imports` attaches one
  image entry, and the Run that imported it sends a request to a model declaring `image` input with
  the reference attached by the epoch image window, and a later Run replays it to a model whose
  `input` lacks `image`
- **THEN** the first request supplies the item's text followed by one image part built from the
  image's model variant
- **AND** the second supplies the item's text followed by the image placeholder text part and no
  image part for that entry

#### Scenario: Another owner's media never enters the request

- **WHEN** a stored file part or `media://` image or PDF result in owner A's chat references a media
  object owned by owner B
- **THEN** no byte, dimension, page count, name, or media type of B's object appears in A's request
- **AND** the reference maps to the unavailable placeholder, or to `[pdf media://<id> unavailable]`
  for a PDF reference

#### Scenario: Images and a PDF in one message are labelled by kind

- **WHEN** a stored user message holds one text part and file parts for two images followed by one
  PDF, the request model declares `image` and `pdf` input, and the epoch image window attaches all
  three references
- **THEN** the request supplies, ahead of the owner's text, `Image 1 (media://<first id>):`, the
  first image part, `Image 2 (media://<second id>):`, the second image part,
  `PDF 1 (media://<pdf id>):`, and one file part with `mediaType` `application/pdf` and the stored
  name as `filename`, built from that object's original
- **AND** the stored parts still carry only their `media://` references

#### Scenario: A model without PDF input receives a labelled PDF placeholder

- **WHEN** a stored user message holds one text part and one file part referencing a stored 15-page
  PDF named `paper.pdf`, and the request model's `input` lacks `pdf`
- **THEN** the file part maps to `PDF 1 (media://<id>):` followed by
  `[pdf media://<id> paper.pdf 15 pages, omitted: this model has no PDF input]` ahead of the owner's
  text
- **AND** no file part is supplied for that message

#### Scenario: A PDF read result crosses as tool content

- **WHEN** a later step of the Run that read a PDF replays that `read` tool part, the request model
  declares `pdf` input, and the epoch image window attaches the reference
- **THEN** the tool-result message carries an output of type `content` holding the result's text
  followed by one file part built from the retained original in the stored tool part

#### Scenario: An earlier turn's PDF read result carries the not-retained placeholder

- **WHEN** a later turn on a model that declares `pdf` input replays a stored `read` tool part whose
  result is a PDF result with no `media` field and no retained bytes
- **THEN** the tool output carries only the result's text
- **AND** it carries no file part and no placeholder

#### Scenario: An earlier turn's retained PDF read result crosses as tool content

- **WHEN** a later turn on a model that declares `pdf` input replays a stored `read` tool part that
  keeps retained bytes, and the epoch image window attaches the reference
- **THEN** the tool output carries the result's text and then one file part built from the retained
  original

#### Scenario: A prompt-import PDF crosses as a file part or a placeholder

- **WHEN** a stored user message holds a `data-context` item to which `prompt-imports` attaches one
  PDF entry, and the Run that imported it sends a request to a model declaring `pdf` input with the
  reference attached by the epoch image window, and a later Run replays it to a model whose `input`
  lacks `pdf`
- **THEN** the first request supplies the item's text followed by one file part built from the PDF's
  original
- **AND** the second supplies the item's text followed by the PDF omitted placeholder text part and
  no file part for that entry
