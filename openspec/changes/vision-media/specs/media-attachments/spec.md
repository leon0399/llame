## Purpose

Lets an owner attach stored images to a chat message, defines how every media reference in a chat's
history reaches a model as an image or as a placeholder, keeps text-only surfaces free of
image content, and gives the web client composer thumbnails, sent-message thumbnails, and a chat-wide
lightbox.

## ADDED Requirements

### Requirement: Owner messages accept up to 10 media file parts

An owner message SHALL accept, alongside its text parts, at most 10 parts of the shape
`{ type: "file", mediaType, url, filename? }` whose `url` is `media://` followed by a lower-case
canonical UUID. Any other `url` SHALL reject the whole message. A message SHALL contain at least one
text part or one file part. Text parts SHALL keep their existing bounds. A rejected message SHALL
persist no message row and start no Run.

#### Scenario: An image-only message is accepted

- **WHEN** the owner sends a message whose only part is one file part referencing their own media
- **THEN** the message is accepted and a Run starts
- **AND** the stored user message carries that file part and no text part

#### Scenario: A message with neither text nor file parts is rejected

- **WHEN** the owner sends a message with an empty `parts` array
- **THEN** the request is rejected
- **AND** no message row is persisted

#### Scenario: Eleven file parts are rejected

- **WHEN** the owner sends one text part and 11 file parts that each reference their own media
- **THEN** the request is rejected
- **AND** no message row is persisted

#### Scenario: A non-media URL is rejected

- **WHEN** the owner sends a file part whose `url` is `data:image/png;base64,iVBORw0KGgo=`
- **THEN** the request is rejected
- **AND** no message row is persisted

### Requirement: Stored file parts take their labels from the stored media

The server SHALL persist each file part with `mediaType` set to the stored original's media type and
`filename` set to the media's stored `name`, whatever the client sent. File parts SHALL be persisted
in submitted order, which is the composer's thumbnail order.

#### Scenario: Client labels are replaced by stored values

- **WHEN** the owner sends a file part with `mediaType: "image/gif"` and `filename: "x.gif"` for a
  stored PNG uploaded as `shot.png`
- **THEN** the stored part carries `mediaType: "image/png"` and `filename: "shot.png"`

#### Scenario: File parts keep submitted order

- **WHEN** the owner sends file parts referencing media `A`, `B`, and `C` in that order
- **THEN** the stored message carries the file parts in the order `A`, `B`, `C`

### Requirement: Attached media must belong to the sender

Before any message row is written, the server SHALL resolve every file part's media id under the
sender's own authority. An id that belongs to another owner, or that does not exist, SHALL reject the
whole message, and the two cases SHALL produce the same response.

#### Scenario: Another owner's media id is rejected

- **WHEN** owner `B` sends a message with a file part referencing a media id owned by owner `A`
- **THEN** the request is rejected
- **AND** no message row is persisted and no Run starts
- **AND** owner `A`'s media is unchanged and no part of it appears in owner `B`'s chat

#### Scenario: A foreign id and an unknown id are indistinguishable

- **WHEN** owner `B` sends one message referencing a media id owned by owner `A`, and another
  referencing an id that does not exist
- **THEN** both responses carry the same status and error body

### Requirement: Attached images reach the model before the message text

Within one user message, the model-facing content SHALL be, in order: the message's context rail
items, its temporal row, then for each file part in stored order a text part
`Image n (media://<id>):` followed by that file part's image, then the owner's text. `n` SHALL count
that message's file parts from 1. Each image SHALL be the model variant, read from storage at request
time.

#### Scenario: Images precede the owner's text

- **WHEN** a user message stores text `compare these` and file parts for media `A` then `B`, and the
  request's model declares `image` input
- **THEN** after the message's rail items and temporal row the model receives
  `Image 1 (media://A):`, the model variant of `A`, `Image 2 (media://B):`, the model variant of `B`,
  and then `compare these`

#### Scenario: Labels restart in each message

- **WHEN** two user messages each carry one file part
- **THEN** each message's label reads `Image 1 (media://<id>):`

### Requirement: Tool-result and prompt-import images reach the model with their text

A `read` result that carries an image SHALL reach the model as a tool output carrying the result's
text followed by the image. An image entry of a prompt-imports item SHALL reach the model as an image
after the item's text. Each image SHALL be the model variant, read from storage at request time.

#### Scenario: A read image reaches the model as tool output

- **WHEN** a `read` result in history carries `media://<id>` and the request's model declares `image`
  input on a Responses or Messages wire
- **THEN** that tool result's output carries the result's text and the image of `media://<id>`

### Requirement: An epoch image window selects which images are attached

Within one compaction epoch, the rows after the active checkpoint plus the current attempt, requests
SHALL admit resolvable media references (owner file parts, tool results, and prompt-imports items)
oldest first in request order, a repeated id counting again, while at most 100 images and at most
24 MiB (25,165,824 bytes) of summed base64 model variants hold. The first reference that would
exceed either bound, and every later one in that epoch, SHALL NOT be attached.

#### Scenario: The 101st image in an epoch is not attached

- **WHEN** a vision-model request's epoch carries 101 small image references
- **THEN** the 100 oldest are sent as images
- **AND** the 101st reaches the model as the limit placeholder

#### Scenario: The byte bound stops the window

- **WHEN** the oldest five references of an epoch each have a 5 MiB base64 model variant and later
  references are small
- **THEN** the four oldest are sent as images
- **AND** the fifth and every later reference in the epoch reach the model as the limit placeholder

#### Scenario: The window holds across the steps of a Run

- **WHEN** a Run on a vision model whose epoch carries no images `read`s one image per step for 101
  steps
- **THEN** every later step's request sends the first 100 `read` results as images
- **AND** the 101st `read` result reaches the next step as the limit placeholder

#### Scenario: The byte bound applies within a Run

- **WHEN** a Run on a vision model whose epoch carries no images `read`s five images in successive
  steps, each with a 5 MiB base64 model variant
- **THEN** the request for the next step sends the first four `read` results as images
- **AND** the fifth `read` result is sent as the limit placeholder

### Requirement: Adding an image never changes an earlier attachment

Because admission is append-only within an epoch, adding a turn, a step, or an image reference SHALL
NOT change whether an earlier reference in that epoch is attached, so the request prefix stays
unchanged for prompt caching. The attached set SHALL NOT depend on which vision model the request
targets.

#### Scenario: Adding an image never changes an earlier image's attachment

- **WHEN** a vision-model request's epoch carries 100 attached image references and the next turn
  attaches one more image
- **THEN** the next request sends the same 100 references as images in the same positions
- **AND** only the new reference reaches the model as the limit placeholder

#### Scenario: Switching between vision models keeps the attached set

- **WHEN** a turn switches from one vision model to another within the same epoch
- **THEN** the new model's request attaches exactly the references the previous request attached
- **AND** every reference beyond the epoch's bounds keeps the limit placeholder

### Requirement: A text-only model receives an omitted placeholder for every image

When the request's model does not declare `image` in its `input`, every resolvable media reference
SHALL reach the model, in the image's position and after any `Image n (media://<id>):` label, as
`[image media://<id> <name> <width>×<height>, omitted: this model has no image input]`, where
`<name>` is the media's stored, neutralized name and the dimensions are the original's.

#### Scenario: A text-only model receives placeholders only

- **WHEN** a request's model does not declare `image` input and history carries a file part for a
  1600×900 PNG uploaded as `shot.png`
- **THEN** the model receives `Image 1 (media://<id>):` followed by
  `[image media://<id> shot.png 1600×900, omitted: this model has no image input]`
- **AND** the request contains no image part

#### Scenario: A text-only model is never told about the image limit

- **WHEN** a text-only model's request carries more image references than the epoch's bounds admit
- **THEN** every resolvable reference, including those beyond the bounds, uses the
  `omitted: this model has no image input` form, and an unresolvable one keeps
  `[image media://<id> unavailable]`
- **AND** no placeholder in the request contains `image limit is reached`

### Requirement: An image beyond the epoch's bounds is not attached

For a model that declares `image`, a resolvable reference the epoch image window does not attach
SHALL reach the model, in the image's position and after any label, as
`[image media://<id> <name> <width>×<height>, not attached: this context's image limit is reached]`.
No placeholder SHALL direct the model to read the image again, because a re-read would meet the same
limit.

#### Scenario: A vision model receives the limit placeholder

- **WHEN** a vision-model request's epoch carries 101 image references and the 101st is `shot.png`
  at 1600×900
- **THEN** the 101st reaches the model as
  `[image media://<id> shot.png 1600×900, not attached: this context's image limit is reached]`
- **AND** the 100 earlier references are sent as images

### Requirement: Image overflow compacts at the start of the next Run

Before a Run's first model step, a prepared request on a model that declares `image` input SHALL
count as reaching its compaction threshold when it carries a reference not attached because the
epoch's bounds are reached and an image reference in a row before the triggering user message. It
SHALL trigger the compaction variant that `model-system-prompts` selects for it. The new epoch SHALL
admit images oldest first again. A Run SHALL NOT compact after its first model step.

#### Scenario: Image overflow triggers compaction at the next Run

- **WHEN** a vision-model chat's epoch carries 100 attached images in earlier turns, the request
  fits the model's window, and the owner sends a message attaching one more image
- **THEN** the threshold-triggered compaction runs on the Run's own model before its first model
  step
- **AND** the Run's request admits the triggering message's image under the new epoch and sends it as
  an image

#### Scenario: Overflow in the triggering message alone does not compact

- **WHEN** a vision-model chat's epoch carries no image before the triggering user message and that
  message attaches 10 images whose 5 MiB base64 model variants exceed the byte bound
- **THEN** no compaction runs
- **AND** the four oldest images are sent as images and the rest reach the model as the limit
  placeholder

#### Scenario: An image read beyond the bounds inside a Run does not compact

- **WHEN** a Run on a vision model reads an image after its epoch's bounds are reached
- **THEN** that `read` result reaches the next step as the limit placeholder
- **AND** no compaction runs before the Run ends

### Requirement: A failed overflow compaction never fails the Run

When image overflow is the only trigger condition and its compaction fails or yields no usable
summary, the Run SHALL proceed without a checkpoint and the overflowing references SHALL keep the
limit placeholder. The trigger SHALL be evaluated again before every Run's first model step, so
those references stay unattached only until the next Run whose compaction succeeds and starts a new
epoch.

#### Scenario: A failed overflow compaction keeps the limit placeholder

- **WHEN** a Run's only trigger condition is image overflow and its summarization call throws
- **THEN** the Run proceeds without a checkpoint and the overflowing images reach the model as the
  limit placeholder
- **AND** the next Run evaluates the trigger again and, when its compaction succeeds, admits
  images oldest first under the new epoch

### Requirement: Unresolvable media references never fail a request

A reference the chat owner's store cannot resolve, because the id is unknown or belongs to another
owner, SHALL reach the model as `[image media://<id> unavailable]` in its position. It SHALL NOT
count toward the epoch's image bounds, SHALL NOT fail the request, and SHALL put no bytes or
descriptor field of any object into the request.

#### Scenario: An unresolvable reference becomes an unavailable placeholder

- **WHEN** a stored file part references an id that does not exist
- **THEN** the model receives `[image media://<id> unavailable]` in its position
- **AND** the Run proceeds

#### Scenario: Another owner's id in stored history is not resolved

- **WHEN** a stored part in owner `B`'s chat references a media id owned by owner `A`
- **THEN** the model receives `[image media://<id> unavailable]`
- **AND** no bytes and no descriptor field of owner `A`'s media enter the request

### Requirement: Chat Completions wires carry tool-result images in a following user message

On `openai-completions` and `opencode-go`, a tool message SHALL NOT carry image content. A tool
result whose image is attached SHALL carry its text and the line
`(image attached below)`; any other keeps its placeholder. The images of consecutive tool messages
SHALL follow them in one user message starting `Images from tool results:`, in tool-result order.
Other wires keep images inside the tool output.

#### Scenario: A read image on Chat Completions arrives as an image part

- **WHEN** a vision model on an `openai-completions` provider receives a request whose history has two
  consecutive tool results that each carry an image
- **THEN** each tool message carries its text and `(image attached below)` and no base64 text
- **AND** one user-role message follows them with `Images from tool results:` and both images

#### Scenario: A tool-result placeholder stays in the tool message

- **WHEN** a tool result's image is beyond the epoch's bounds on an `openai-completions` request
- **THEN** the tool message carries the placeholder
- **AND** no user-role image message is added for it

#### Scenario: A text-only Chat Completions model gets no image message

- **WHEN** an `openai-completions` model that does not declare `image` has a `read` image result
  within the epoch's bounds
- **THEN** its tool message carries the result text and the `omitted: this model has no image input`
  placeholder, without `(image attached below)`
- **AND** no `Images from tool results:` message and no image part is sent

### Requirement: The Chat Completions image transform applies within a Run

The Chat Completions tool-result image transform SHALL apply equally to tool results from earlier
turns and to tool results produced by earlier steps of the current Run. Applying it to a request it
has already transformed SHALL change nothing.

#### Scenario: A read in the current Run reaches the next step

- **WHEN** a vision model on an `opencode-go` provider reads an image in one step of a Run
- **THEN** the Run's next model step receives the image in a user-role message after the tool message
- **AND** that step's request carries exactly one `Images from tool results:` message for that read

### Requirement: Stored parts never carry image bytes

Persisted message parts, including user file parts, tool results, and context items, SHALL reference
images only by `media://` locator. Image bytes, base64 strings, and `data:` URLs built for a request
SHALL NOT be persisted to any message part. A Run's live tool outputs SHALL likewise carry `media://`
references, not image bytes, until a step's request is composed; that request SHALL load bytes only
for the references its epoch image window attaches, never for any other reference.

#### Scenario: A completed vision Run stores references only

- **WHEN** a Run sends an attached image and a `read` image to a vision model and completes
- **THEN** the stored user and assistant message parts contain the `media://` locators
- **AND** they contain no base64 image data and no `data:` URL

#### Scenario: Only attached references are loaded for a step

- **WHEN** a Run on a vision model whose epoch carries no images `read`s one image per step for 101
  steps
- **THEN** the request for the next step carries image parts for the first 100 `read` results only
- **AND** the 101st `read` result's model variant bytes are not loaded for that request

### Requirement: Title generation receives image placeholders

The title-generation input SHALL be the titled turn's user message text followed by one line per file
part of that message, in stored order, of the form `[image media://<id> <name> <width>×<height>]`.
Title generation SHALL receive no image bytes. A message carrying only file parts SHALL produce a
title input made of those lines.

#### Scenario: An image-only first message can be titled

- **WHEN** an untitled chat's turn is triggered by a user message carrying one file part for a
  1600×900 PNG named `shot.png` and no text
- **THEN** the title-generation input is `[image media://<id> shot.png 1600×900]`
- **AND** the title request contains no image part

### Requirement: Compaction keeps images re-readable

A compaction request SHALL carry the compactable prefix's images as a Run request on the summarizing
model would under the same epoch window: image parts for the references it attaches when that model
declares `image` input, and placeholders otherwise. The summarization instruction SHALL direct the
model to keep verbatim the `media://` locator of every image the summary mentions; a later `read` of
that locator returns a fresh image result in the new epoch.

#### Scenario: A vision summarizer receives the prefix's attached images

- **WHEN** a window-triggered compaction runs on a previous completed Run's model that declares
  `image` input and the compactable prefix carries more image references than the epoch's bounds
  admit
- **THEN** the summary request carries the attached references as image parts built from their model
  variants, in the positions the Run's own request would use
- **AND** every later reference appears as the limit placeholder

#### Scenario: A text-only summarizer receives placeholders

- **WHEN** a window-triggered compaction uses a previous completed Run's model whose declared input
  is text only and the compactable prefix carries owner `file` parts and image `read` results
- **THEN** every image in the summary request appears as its placeholder
  `[image media://<id> <name> <width>×<height>, omitted: this model has no image input]`
- **AND** the request carries no image part

#### Scenario: The instruction keeps media locators

- **WHEN** the summarization instruction is rendered
- **THEN** it directs the model to keep verbatim the `media://` locator of every image the summary
  mentions
- **AND** the instruction remains only in the trailing user message, leaving the bound prompt and
  compactable prefix unchanged

#### Scenario: A kept locator is re-read into the new epoch

- **WHEN** a checkpoint absorbed an image whose `media://` locator its summary kept, and a later
  Run on a vision model `read`s that locator
- **THEN** the `read` returns a fresh image result
- **AND** that result is sent as an image when the new epoch's bounds admit it

### Requirement: Image parts are sized by dimensions, not bytes

Every request-size estimate used for admission or compaction, including the context-window fit
check, the compaction trigger, and the continuation estimate, SHALL exclude image bytes and SHALL
charge each image part `ceil(width × height / 750)` tokens, computed from its model variant's
dimensions. A placeholder SHALL count as its text.

#### Scenario: A large screenshot fits a large window

- **WHEN** a request on a model with `contextWindowTokens` 200,000 carries one image part whose model
  variant is 2000×1125 and otherwise fits the window
- **THEN** the estimate charges that image 3,000 tokens
- **AND** the request is admitted and that image alone does not trigger compaction

#### Scenario: Variant bytes do not change the estimate

- **WHEN** two otherwise identical requests each carry one 2000×1125 model variant, one of 200 KiB and
  one of 3.7 MiB
- **THEN** both requests receive the same estimate

### Requirement: Search, the recency digest, and public shares carry no image content

Search SHALL index nothing from a file part, including its name and locator. The recency digest SHALL
render no excerpt for a chat whose first user message has no text, even when it carries file parts. A
public share read SHALL omit file parts and keep the message text.

#### Scenario: An attachment filename is not searchable

- **WHEN** an owner's only message carrying `quarterly.png` is a file part with that name
- **THEN** searching the owner's chats for `quarterly` does not match that message

#### Scenario: A public share omits attachments

- **WHEN** an unauthenticated visitor reads a public share whose user message carries text and a file
  part
- **THEN** the response carries the text
- **AND** it carries no file part and no `media://` locator

### Requirement: The composer attaches images as uploading thumbnails

The web composer SHALL show attached images as a row of square thumbnails inside the existing input
card, above the textarea, and leave the composer, toolbar, and bubble designs otherwise unchanged.
Pasting clipboard images, choosing files with the picker, and dropping files SHALL each add one
thumbnail per image and upload it immediately through `POST /api/v1/media`. On send, the message SHALL
carry one file part per thumbnail, in thumbnail order, and MAY carry no text.

#### Scenario: A pasted screenshot uploads immediately

- **WHEN** the owner pastes a clipboard image into the composer with a vision model selected
- **THEN** a thumbnail appears and an upload request starts before send

#### Scenario: An image-only message is sent

- **WHEN** two uploaded thumbnails are attached, the textarea is empty, and the owner sends
- **THEN** the sent message carries two file parts in thumbnail order and no text part

### Requirement: Composer uploads show their state and gate send

While an upload is in flight its thumbnail SHALL show a progress overlay. A failed upload SHALL show
an error overlay with a retry action that uploads the same file again. Send SHALL stay disabled while
any thumbnail is uploading or failed.

#### Scenario: Send waits for uploads

- **WHEN** one thumbnail is still uploading
- **THEN** it shows a progress overlay and send is disabled
- **AND** send becomes enabled once the upload succeeds

#### Scenario: A failed upload can be retried

- **WHEN** an upload fails
- **THEN** the thumbnail shows an error overlay with a retry action and send is disabled
- **AND** choosing retry uploads the same file again

### Requirement: Composer thumbnails can be removed and reordered

Each composer thumbnail SHALL reveal a remove action on hover and on keyboard focus. Thumbnails SHALL
reorder by dragging, and by `Alt+ArrowLeft` and `Alt+ArrowRight` while a thumbnail has focus, which
moves it one position and keeps focus on it. The composer SHALL hold at most 10 thumbnails; images
added beyond the tenth SHALL NOT be added or uploaded.

#### Scenario: Keyboard reorder changes sent order

- **WHEN** thumbnails `A`, `B` are attached, the owner focuses `B`, presses `Alt+ArrowLeft`, and sends
- **THEN** the thumbnails read `B`, `A` with focus on `B`
- **AND** the sent message's file parts are in the order `B`, `A`

#### Scenario: Remove is reachable by keyboard

- **WHEN** a thumbnail receives keyboard focus
- **THEN** its remove action is visible and operable
- **AND** activating it removes the thumbnail from the composer

#### Scenario: The eleventh image is not added

- **WHEN** 10 thumbnails are attached and the owner drops one more image
- **THEN** the composer still holds 10 thumbnails and no upload starts for the dropped image

### Requirement: A text-only model blocks image attachments

When the selected model does not declare `image` in its published `input`, the composer SHALL refuse
paste, picker, and drop attachments and SHALL show `<model label> has no image input`, where the label
is the model's `name`, or its `id` when it publishes no `name`. Attached thumbnails SHALL keep their
order, and send SHALL stay disabled until a model declaring `image` is selected or every thumbnail is
removed.

#### Scenario: Attaching under a text-only model is refused

- **WHEN** the selected model named `Fast Text` declares only `text` input and the owner pastes an
  image
- **THEN** no thumbnail is added and no upload starts
- **AND** the composer shows `Fast Text has no image input`

#### Scenario: Switching to a text-only model disables send

- **WHEN** two thumbnails are attached and the owner selects a text-only model
- **THEN** both thumbnails remain in order and send is disabled
- **AND** send becomes enabled after a vision model is selected again

### Requirement: Sent messages show read-only thumbnails

A user message carrying file parts SHALL show the same square thumbnails, in stored order and without
remove or reorder actions, above the user bubble. Each thumbnail SHALL load the model variant from
`GET /api/v1/media/:id/model` lazily. A message without text SHALL show its thumbnails and no empty
bubble.

#### Scenario: A reloaded chat shows its attachments

- **WHEN** the owner reloads a chat whose user message carries two file parts
- **THEN** two read-only thumbnails appear above that message's bubble in stored order
- **AND** each loads from its `/model` route

### Requirement: A lightbox spans every image in the chat

Activating any image thumbnail, including an attachment, a `read` image result's tool card thumbnail,
or a prompt-import image, SHALL open a lightbox on that image. Its slides SHALL be every image in the
chat in transcript order. Opened from the composer, it SHALL span the unsent thumbnails only. It SHALL
support wheel and pinch zoom, move between slides with the left and right arrow keys, and close on
`Escape`, returning focus to the thumbnail that opened it.

#### Scenario: Arrow keys cross messages and tool results

- **WHEN** a chat has an attachment in its first message and a `read` image result in a later
  turn, and the owner opens the attachment
- **THEN** pressing the right arrow key shows the `read` image

#### Scenario: The composer lightbox spans unsent thumbnails only

- **WHEN** the chat already shows sent images and the owner opens an unsent composer thumbnail
- **THEN** the lightbox slides are the composer's thumbnails only

#### Scenario: Escape returns focus

- **WHEN** the owner opens the lightbox from a thumbnail and presses `Escape`
- **THEN** the lightbox closes
- **AND** focus returns to that thumbnail

### Requirement: The lightbox shows either variant with its provenance

A segmented control SHALL switch the shown image between the `original` and `model` variants. A
caption SHALL show the shown variant's dimensions and format, the image's provenance (`upload`,
`read`, or `prompt-import`), and its `media://` locator.

#### Scenario: The variant toggle switches the image and caption

- **WHEN** the owner switches the toggle between `original` and `model` on a 4000×3000 JPEG whose
  model variant is a 2000×1500 PNG
- **THEN** the shown image loads from the matching `/original` or `/model` route
- **AND** the caption shows 4000×3000 JPEG for `original` and 2000×1500 PNG for `model`

#### Scenario: The caption names provenance and locator

- **WHEN** the owner views an image returned by `read`
- **THEN** the caption shows provenance `read` and that image's `media://` locator
