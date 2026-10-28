## MODIFIED Requirements

### Requirement: Tool observations survive into later turns as stored UI parts

The prospective cutover boundary in `context-injection` MUST govern the retention of failed
attempts. The system MUST NOT filter or rebuild the current conversation state retrospectively. A
failed, cancelled, expired, or superseded attempt keeps its partial output and context as the user
saw them. That record takes part in later model context and compaction like any other committed
turn, until a follow-up Run from `turn-actions` replaces the reply. A single failed tool call in a
committed successful attempt MUST still keep its normal paired failure observation.

The tool activity of a round MUST stay available to the model in later turns, in the bounded
replay contract below. The next turn MUST be able to show what a tool was asked and what it
returned or failed to return. The only exception is an older complete observation that the system
must omit to keep the hard budget.

Each replayed observation MUST carry the tool identity, the input while its payload fits, and the
structured outcome. Calls that were refused, cancelled, timed out, unavailable, execution-failed,
search-failed, or errored in another way MUST keep that outcome and MUST NOT disappear. Legacy
output-error parts with no structured outcome MUST map to the generic `error`, and the system MUST
NOT parse human prose for them. Structured cancellation metadata can recover `cancelled`.

Ordinary stored assistant parts MUST replay through the current conventional AI SDK tool-call and
tool-result projection. This stays until #599 sets the canonical persistence contract for UI
messages. Each
projected call MUST come with its matching result. A call with no real tool result also gets a
well-formed result. Credentials and unrelated payloads MUST NOT replay. The tool projection MUST
NOT carry provider-native reasoning or metadata. Persisted reasoning parts and their provider
metadata reach the provider only through the same-Chat replay of `reasoning-output`, outside this
projection and its budget.

The ordinary projection MUST stay:

- portable, through SDK tool-call and tool-result parts, not provider-specific structures;
- labelled untrusted inside the result content;
- neutralized, so remote-authored result content cannot forge a reserved structural boundary;
- bounded in JavaScript UTF-16 code units over the exact serialized text of the pair. The limits
  are 8,000 for each pair and 32,000 for each stored assistant turn. An image in a result counts only as its
  stored result text, with no `thumbnail` and no retained bytes;
- reduced so that it keeps pairing before budget, newer observations before older ones, and
  identity and outcome before payload; and
- stable for the same unchanged stored turn under the current explicit best-effort projector.

The system MUST clear payloads, oldest first, only when this makes the envelope smaller. When pairs
that cannot shrink more still go above a limit, the system MUST drop the oldest complete pairs
atomically until the projection fits. It adds one bounded omission count and marker. The system
MUST NOT emit a call or a result with no match.

The system MUST store an image in a tool result in the tool part as the native image result that
made it. The result MUST NOT carry the `media-store` media descriptor, image bytes, or base64 model
content. Only the result of a `media://` read names its image by a `media://` locator in `media`.
Each other image result has no `media` field. The system stores it with the display-only `thumbnail`
that `media-attachments` defines, when one fits its cap. The tool part MUST also keep the retained
bytes of that image beside the result, as `media-attachments` defines. The system MUST remove
`thumbnail` and the retained bytes from the model-facing output and from each replayed result.
`thumbnail` and the retained bytes MUST NOT count toward the UTF-16 budgets, and the system MUST NOT
accept them from a client. On replay, the text of the result MUST follow the projection above.
The image MUST become provider image content, built at request time, only when three conditions are
true. The model of the request declares `image` input, its model variant is available, and the
epoch image window of `media-attachments` attaches that reference. For a `media://` result, the
model variant is available from the media store. For each other image result, it is available from
the retained bytes in its stored tool part. This applies in a later step, a later turn, a Continue
Run, an owner fork, and a compaction request. It also applies to a reply rebuilt from the event log. A result without
`retainedMedia` MUST replay as its text only, with no image and no placeholder. For each other
result, when the three conditions are not all true, the replayed result MUST carry the image
placeholder of `media-attachments` in its text. A `media://` reference that does not resolve to media
of the Run owner MUST replay as the unavailable placeholder. These placeholders MUST NOT fail the
request. Image content MUST NOT count toward the UTF-16 budgets. An image MUST replay only with its
kept result payload. When the system clears a payload or drops a pair, it also removes the image
from the request.

Visible assistant text and kept tool occurrences MUST keep their current chronology. Ordinary
stored messages do not prove parallel or step boundaries. Thus consecutive calls MUST continue to
project conservatively as separate sequential matched pairs. This change MUST NOT generalize or
rewrite this behavior; #599 owns its research and refactor. The kept parts of a Continue Run from
`turn-actions` are not later-turn replay. That capability owns their projection, which groups each
kept step and applies no replay budget.

Tool activity MUST stay available to the model until a checkpoint absorbs it. A tool record MUST
NOT cross that boundary. A checkpoint message MUST carry no tool part. It MUST select and re-bound no
payload, and it MUST compute no budget again. There MUST be no semantic observation ledger, no
bounded replacement set, and no compacted tool record to read back. Absorbed tool activity stays
only as summary text. The `Errors and Corrections`, `Completed`, and `Critical References` content
of the summary carries it. Rows after the latest checkpoint MUST keep the ordinary bounded
projection above unchanged. Replay of those rows MUST NOT read the checkpoint.

Checkpoint text MUST stay owner-scoped like the checkpoint row that carries it. The system MUST NOT
rebuild a tool observation from summary prose or from the text of an older checkpoint. It MUST NOT
rebuild one from any inference about the contents of an absorbed turn.

The live tool loop MUST continue to observe its own results in the turn that produced them.

#### Scenario: A later turn can use an earlier tool result

- **WHEN** a tool returns a result and the user asks about it later
- **THEN** the later request carries its identity, its input when kept, its result, and its outcome through the conventional SDK form

#### Scenario: An unsuccessful call is projected as unsuccessful

- **WHEN** an earlier call was refused, cancelled, errored, or timed out
- **THEN** later replay carries a matched result that reports that outcome
- **AND** the system does not omit the call only because it failed

#### Scenario: A cancelled call is projected as cancelled

- **WHEN** an unsuccessful Run termination settled an earlier call
- **THEN** operational and UI replay report its matching `cancelled` result
- **AND** the persisted output of that failed attempt stays part of model history like any other committed turn
- **AND** it stays different from an error that a tool produced

#### Scenario: A tool call made during reasoning is projected

- **WHEN** the model called a tool while it produced reasoning output
- **THEN** the call and result observation follows the same replay contract
- **AND** the tool projection does not carry the reasoning part, which replays under `reasoning-output` at its own occurrence position

#### Scenario: Every replayed call has a matching replayed result

- **WHEN** a later request replays stored tool activity
- **THEN** each kept call has its result directly after it
- **AND** the system omits calls and results with no match atomically

#### Scenario: A call with no genuine result still carries a well-formed result

- **WHEN** a call was cancelled, refused, errored, or timed out before a real tool result existed
- **THEN** replay gives a well-formed result that carries that outcome
- **AND** it does not tell about the absence as unrelated assistant prose

#### Scenario: Provider reasoning and metadata are never replayed

- **WHEN** stored tool activity includes reasoning or provider metadata
- **THEN** portable observations stay available across model and provider switches
- **AND** the tool projection carries no reasoning or metadata of the original provider; `reasoning-output` governs reasoning replay

#### Scenario: A model or provider switch keeps observations but not provider metadata

- **WHEN** a Chat with tool activity continues on another model or provider
- **THEN** portable matched observations stay available through the target SDK conversion
- **AND** the tool projection excludes the metadata of the original provider
- **AND** replayed reasoning parts pass back unchanged, and `reasoning-output` omits before the request the ones that the target wire cannot carry
- **AND** the target provider ignores or drops the rest

#### Scenario: The projection is labelled untrusted

- **WHEN** the system replays a tool result
- **THEN** its own result content identifies it as untrusted tool output
- **AND** payload text that looks like an instruction has no authority

#### Scenario: Replayed content cannot escape its boundary

- **WHEN** a tool result tries to forge or close a reserved boundary
- **THEN** the replayed result is neutralized under the tool projection contract
- **AND** the structure around it stays intact

#### Scenario: The projection is stable across turns

- **WHEN** the same unchanged ordinary stored tool part replays two times
- **THEN** the current projector produces the same application content
- **AND** the system makes no tool part at a checkpoint boundary

#### Scenario: Interleaved text and tools retain chronology

- **WHEN** an assistant turn contains visible text, tool calls, and later text
- **THEN** the current projector keeps their occurrence order as separate text and sequential matched pairs
- **AND** the implementation refers to #599 and does not claim proven step boundaries

#### Scenario: Visible text does not consume the observation budget

- **WHEN** visible assistant text surrounds capped tool observations
- **THEN** visible text keeps its occurrence order outside the observation budget
- **AND** it does not cause the system to drop a pair that it otherwise keeps

#### Scenario: Hard limits preserve pairing and newest observations

- **WHEN** a serialized pair or turn goes above its hard limit
- **THEN** payloads clear only when this helps, then the system omits the oldest complete pairs until the result fits
- **AND** exactly one bounded omission marker stays, and the counts of calls and results stay equal

#### Scenario: Absorbed tool activity crosses a checkpoint only as summary text

- **WHEN** a checkpoint message absorbs a range of history that contains tool activity
- **THEN** that activity is available to later requests only as summary text
- **AND** the checkpoint message carries no tool record, and replay of the rows above it uses the ordinary bounded projection

#### Scenario: Recursive compaction consumes the prior checkpoint's stored text

- **WHEN** a later checkpoint supersedes an earlier checkpoint
- **THEN** its summary input is the stored text of the earlier checkpoint, then the rows that it newly absorbs
- **AND** it writes no list of tool records, and it carries no record forward

#### Scenario: A checkpoint without stored text cannot recover absorbed observations

- **WHEN** an active checkpoint message has no valid non-empty stored text
- **THEN** request preparation fails closed
- **AND** the system invents no tool observation from summary prose or from any ledger

#### Scenario: The live loop still observes its own tool results

- **WHEN** a tool executes during a Run
- **THEN** its result stays available in the tool loop of that same Run

#### Scenario: An image result is stored without image data

- **WHEN** a `read` of `/work/shot.png` returns an image result
- **THEN** the stored tool part carries that native image result, with `kind: "image"`, `mediaType`, `width`, `height`, and `path`, and no `media` field
- **AND** its stored output carries the display-only `thumbnail` and no other image data, and no `provenance`, `byteSize`, or `model` descriptor field
- **AND** the tool part keeps the retained model variant beside the result

#### Scenario: A media read result is stored as a media reference

- **WHEN** a `read` of `media://<id>` returns an image result
- **THEN** the stored tool part carries that native image result with `media` `media://<id>`
- **AND** it carries no `thumbnail`, no image bytes, and no base64 data

#### Scenario: An attached image result replays as image content

- **WHEN** a later step of the Run that read `/work/shot.png`, on a model that declares `image` input, replays its image result
- **AND** the epoch image window attaches the reference
- **THEN** the replayed result carries its text and the image as provider image content built from the retained model variant in its stored tool part
- **AND** the call stays directly paired with its result

#### Scenario: A media read result replays from the store in a later turn

- **WHEN** a later turn on a model that declares `image` input replays a stored `media://<id>` image result, and the epoch image window attaches its reference
- **THEN** the replayed result carries its text and the image as provider image content built from the stored model variant

#### Scenario: An earlier turn's image read replays as not retained

- **WHEN** a later turn on a model that declares `image` input replays the stored image result of `read("/work/shot.png")` for a 1600×900 image, and that tool part has no `retainedMedia`
- **THEN** the text of the replayed result carries the fields of the result and no placeholder
- **AND** the request carries no image content for that result

#### Scenario: An earlier turn's retained image read replays as image content

- **WHEN** a later turn on a model that declares `image` input replays the stored image result of `read("/work/shot.png")`, and the epoch image window attaches its reference
- **THEN** the replayed result carries its text and the image as provider image content built from the retained model variant
- **AND** the call stays directly paired with its result

#### Scenario: An unattached image result replays as a placeholder

- **WHEN** a request replays an image result
- **AND** its reference is outside the bounds of the epoch image window, or the model of the request does not declare `image` input
- **THEN** the text of the replayed result carries the matching image placeholder with the locator of the image
- **AND** the request carries no image content for that result

#### Scenario: Image content does not consume the observation budget

- **WHEN** the model variant of a replayed image result would serialize as base64 longer than 8,000 UTF-16 code units
- **AND** the text of the pair fits in the budget
- **THEN** the system does not clear or drop the payload of the pair because of the image
- **AND** the budgets measure only the text of the pair, with no `thumbnail` and no retained bytes

#### Scenario: A thumbnail never reaches the model

- **WHEN** an image result stored with a `thumbnail` reaches the model live in its Run, or replays in a later request
- **THEN** no part of any request carries the `thumbnail` or any part of its data URL

#### Scenario: A dropped pair carries no image

- **WHEN** the hard budget drops an older complete pair whose result carries an image
- **THEN** neither the pair nor its image content is in the request
- **AND** the single omission marker counts the omission

#### Scenario: A replayed image reference never resolves another owner's media

- **WHEN** a stored tool part replayed in the Run of user A references a media id that user B owns
- **THEN** the replayed result carries the unavailable placeholder, and the request continues
- **AND** no image bytes or descriptor fields of the object of user B reach the request

#### Scenario: A follow-up Run replaces the record of a failed attempt

- **WHEN** a failed reply holds a settled tool pair and an unfinished step, and the owner regenerates the turn
- **THEN** after the Regenerate Run dispatches, later turns do not replay that tool pair or that step

### Requirement: PDF tool observations are stored and replayed like image results

The system MUST store a PDF in a tool result in the tool part as the native PDF result. The result
MUST NOT carry a media descriptor, PDF bytes, or base64 content. The tool part MUST keep the
retained original of an unstored PDF beside the result, as `media-attachments` defines. On replay,
its text MUST follow the ordinary projection. The PDF MUST become provider file content, built from
its original at request time, only when three conditions are true. The request's model declares
`pdf` input, the original is available, and the epoch image window attaches it. A result without
`retainedMedia` MUST replay as its text only, with no file content and no placeholder. For each other
result, when the three conditions are not all true, its text MUST carry the matching PDF
placeholder.

#### Scenario: A PDF result is stored without PDF data

- **WHEN** a `read` of `/work/paper.pdf` returns a PDF result
- **THEN** the stored tool part carries that native PDF result, with `status: "success"`,
  `kind: "pdf"`, `mediaType` `application/pdf`, `pages`, `byteSize`, and `path`, and no `media` field
- **AND** its stored output carries no `thumbnail`, no PDF bytes, and no base64 data
- **AND** the tool part keeps the retained original beside the result

#### Scenario: A media read PDF result is stored as a media reference

- **WHEN** a `read` of `media://<id>` returns a PDF result
- **THEN** the stored tool part carries that native PDF result with `media` `media://<id>`
- **AND** it carries no `thumbnail`, no PDF bytes, and no base64 data

#### Scenario: An attached PDF result replays as file content

- **WHEN** a later step of the Run that read `/work/paper.pdf`, on a model that declares `pdf` input,
  replays its PDF result and the epoch image window attaches the reference
- **THEN** the replayed result carries its text and the PDF as provider file content built from the
  retained original in its stored tool part
- **AND** the call remains immediately paired with its result

#### Scenario: A media read PDF result replays from the store in a later turn

- **WHEN** a later turn on a model that declares `pdf` input replays a stored `media://<id>` PDF result
  whose reference the epoch image window attaches
- **THEN** the replayed result carries its text and the PDF as provider file content built from the
  stored original

#### Scenario: An earlier turn's PDF read replays as not retained

- **WHEN** a later turn, a Continue Run, a compaction request, or a fork on a model that declares
  `pdf` input replays the stored PDF result of `read("/work/paper.pdf")` for a 15-page PDF, and
  that tool part has no `retainedMedia`
- **THEN** the replayed result's text carries the fields of the result and no placeholder
- **AND** the request carries no file content for that result and does not fail

#### Scenario: An earlier turn's retained PDF read replays as file content

- **WHEN** a later turn on a model that declares `pdf` input replays the stored PDF result of
  `read("/work/paper.pdf")`, and the epoch image window attaches its reference
- **THEN** the replayed result carries its text and the PDF as provider file content built from the
  retained original

#### Scenario: A model without PDF input receives the omitted placeholder

- **WHEN** a request whose model declares `image` but not `pdf` input replays the PDF result of
  `read("/work/paper.pdf")` for a 15-page PDF
- **THEN** the replayed result's text carries
  `[pdf "/work/paper.pdf" 15 pages, omitted: this model has no PDF input]`
- **AND** the request carries no file content for that result

#### Scenario: A PDF result beyond the window replays as the limit placeholder

- **WHEN** a request on a model that declares `pdf` input replays the PDF result of
  `read("/work/paper.pdf")` for a 15-page PDF whose reference is beyond the epoch image window's
  bounds
- **THEN** the replayed result's text carries
  `[pdf "/work/paper.pdf" 15 pages, not attached: this context's PDF limit is reached]`
- **AND** the request carries no file content for that result

#### Scenario: PDF content does not consume the observation budget

- **WHEN** a replayed PDF result's original would serialize as base64 longer than 8,000 UTF-16 code
  units, and the pair's text fits within the budget
- **THEN** the pair's payload is neither cleared nor dropped on account of the PDF
- **AND** the budgets measure only the pair's text, with no retained bytes

#### Scenario: A dropped pair carries no PDF

- **WHEN** the hard budget drops an older complete pair whose result carries a PDF
- **THEN** neither the pair nor its file content appears in the request
- **AND** the omission is counted by the single omission marker

#### Scenario: A replayed PDF reference never resolves another owner's media

- **WHEN** a stored `media://<id>` PDF result replayed in user A's Run references a media id owned by
  user B
- **THEN** the replayed result carries `[pdf media://<id> unavailable]` and the request proceeds
- **AND** no PDF bytes or descriptor fields of user B's object reach the request
