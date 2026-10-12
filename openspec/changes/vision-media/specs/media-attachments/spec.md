## Purpose

Lets an owner attach stored images to a chat message, defines how every image reference in a chat's
history reaches a model as an image or as a placeholder, retains unstored tool-read and
prompt-import images in the reading attempt's memory only, keeps text-only surfaces free of image
content, and gives the web client composer thumbnails, sent-message thumbnails, inline thumbnails
for unstored images, and a lightbox over the images of one row.

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
after the item's text. Each image SHALL be the model variant: the stored one, read from storage at
request time, for a `media://` result or entry, and otherwise the one the attempt's memory holds.

#### Scenario: A read image reaches the model as tool output

- **WHEN** an earlier step of a Run read `/work/shot.png`, an image, and the request's model
  declares `image` input on a Responses or Messages wire
- **THEN** that tool result's output carries the result's text and the image's model variant

#### Scenario: A media read in an earlier turn reaches the model from the store

- **WHEN** a `read` result in an earlier turn carries `media://<id>` and the request's model
  declares `image` input on a Responses or Messages wire
- **THEN** that tool result's output carries the result's text and the stored model variant of
  `media://<id>`

### Requirement: Unstored images are retained in attempt memory only

For an image result or prompt-import image entry without a `media` locator, the worker SHALL keep an
entry in the memory of the attempt that read it, keyed by the tool call id or by the item entry, and
SHALL persist it nowhere. Later steps of that attempt SHALL attach a retained model variant under the
epoch image window.

#### Scenario: A read image is attached in the later steps of its Run

- **WHEN** a Run on a vision model reads `/work/shot.png`, an image, and continues for two more
  steps
- **THEN** both later steps' requests carry its model variant as an image part when the epoch image
  window attaches it

### Requirement: Every attempt starts with empty image memory

Every attempt SHALL start with empty memory: a Run's first attempt, a retry, and a resume alike, on
the same worker or another. An attempt's memory SHALL be dropped when the attempt ends, and attempts
SHALL never share memory, a superseded attempt that is still running included.

#### Scenario: A same-worker retry starts empty

- **WHEN** an attempt that read an image fails and the Run is retried on the same worker
- **THEN** the retry attempt's memory holds no entry for that image
- **AND** the retry's requests carry the same placeholder a retry on another worker would

### Requirement: Attempt memory retains only the images the window attaches

An entry SHALL hold the model variant's bytes and byte size when the attempt's model declares
`image` input, and only the locator and original dimensions otherwise; holding an entry SHALL
neither count nor cap anything. Each time a request is composed, the composer SHALL release the
bytes of every unstored reference the epoch image window does not attach, so after each compose the
attempt's retained bytes are those the window attached, at most 24 MiB of base64 in sum, however
many steps it runs.

#### Scenario: Retained bytes stay within the window's budget

- **WHEN** a Run on a vision model whose epoch carries no images `read`s ten images in successive
  steps, each with a 5 MiB base64 model variant
- **THEN** after each step's request is composed, the attempt's memory retains the model variants of
  the first four reads only, at most 24 MiB of base64 in sum
- **AND** it keeps only the locator, dimensions, and model-variant byte size of the other six, which
  reach the model as the limit placeholder

#### Scenario: A text-only model's read retains no bytes

- **WHEN** a Run on a model that does not declare `image` input reads `/work/shot.png`, a 1600×900
  image
- **THEN** the attempt's memory keeps only the read's locator and dimensions
- **AND** that read reaches every later step as the omitted placeholder

#### Scenario: A compacting attempt admits its prompt import in the new epoch

- **WHEN** a vision-model chat's epoch carries 100 attached owner attachments in earlier turns, and
  the owner's next message imports `@shot.png`, so the attempt compacts before its first model step
- **THEN** the import's model variant is retained
- **AND** the attempt's first request sends it as an image under the new epoch

### Requirement: A released entry is sized and refused again

Releasing an entry's bytes SHALL keep its locator, dimensions, and model-variant byte size, so the
epoch image window sizes the reference again at every later compose of the attempt and, admission
being append-only, leaves it unattached again. A reference the window attaches whose entry holds no
bytes SHALL reach the model as the not-retained placeholder; this is a guard that append-only
admission within an attempt makes unreachable in practice.

#### Scenario: A released read stays unattached in later steps

- **WHEN** a Run on a vision model whose epoch carries no images `read`s five images in successive
  steps, each with a 5 MiB base64 model variant, and then reads a small image
- **THEN** the fifth read's entry keeps its 5 MiB base64 byte size after its bytes are released
- **AND** every later step's request sends the first four reads as images and the fifth and sixth as
  the limit placeholder

### Requirement: An unstored image outside its attempt is not retained

A request composed where the current attempt's memory holds no entry for an unstored image (a later
turn, a retry or a resume, which starts a new attempt on any worker, a compaction request, or a
fork) SHALL carry, in the image's position, the not-retained placeholder
`[image <locator> <width>×<height>, not retained]` when the request's
model declares `image` input, and the omitted placeholder otherwise.

#### Scenario: A later turn receives the not-retained placeholder

- **WHEN** a turn on a vision model follows a Run that read `/work/shot.png`, a 1600×900 image
- **THEN** that read's result reaches the model as
  `[image "/work/shot.png" 1600×900, not retained]`
- **AND** the request carries no image part for it

#### Scenario: A new attempt does not hold an earlier attempt's images

- **WHEN** a Run on a vision model read an image and is then retried or resumed as a new attempt, on
  the same worker or another, while the superseded attempt may still be running in the same process
- **THEN** each of the new attempt's requests carries the not-retained placeholder for that image
- **AND** the image is attached again only after the new attempt's model reads it again

#### Scenario: A later text-only turn receives the omitted placeholder

- **WHEN** a turn on a model that does not declare `image` input follows a Run that read
  `/work/shot.png`, a 1600×900 image
- **THEN** that read's result reaches the model as
  `[image "/work/shot.png" 1600×900, omitted: this model has no image input]`

### Requirement: No placeholder directs the model to read an image again

No image placeholder SHALL direct the model to read the image again. A compaction request, the step
at the step cap, and a Run whose `tools.allowed` omits `read` cannot act on such a directive, and
the `read` tool description tells the model that an image read outside `media://` is read again in
a later turn; the not-retained placeholder names the exact locator for that read.

#### Scenario: A compaction request carries no re-read directive

- **WHEN** a compaction request on a vision model summarizes a row whose `read` result is an
  unstored 1600×900 image of `/work/shot.png`
- **THEN** that result reaches the summarizer as `[image "/work/shot.png" 1600×900, not retained]`
- **AND** no placeholder in the request tells the model to read an image again

### Requirement: Each image reference takes exactly one model-facing form

Each image reference SHALL reach the model as exactly one of these forms, chosen in this order: the
unavailable placeholder for a `media://` reference that does not resolve; the omitted placeholder
when the request's model does not declare `image` input; the not-retained placeholder for an
unstored image whose attempt-memory entry is absent or, when the window attaches it, holds no
bytes; an image part when the epoch image window attaches it; and the limit placeholder otherwise.

#### Scenario: Missing image input outranks retention

- **WHEN** a text-only model's request replays an image `read` from an earlier turn
- **THEN** that read reaches the model as the omitted placeholder
- **AND** no placeholder in the request contains `not retained`

### Requirement: Image placeholders name the image by its locator

A placeholder SHALL name a stored object by `media://<id> <name>`, with `<name>` its single-line
source label that `media-store` defines, and an unstored image by its locator, the one the model
submitted to `read` or the owner wrote in the import marker, written as a JSON string literal. Its
dimensions SHALL be the original's.

#### Scenario: A placeholder names the submitted locator

- **WHEN** a Workspace-bound Run's model reads `docs/shot.png`, a 1600×900 image, and a later turn
  replays that result on a vision model
- **THEN** the result reaches the model as
  `[image "docs/shot.png" 1600×900, not retained]`

### Requirement: Placeholder locators are exact JSON string literals

An unstored image's locator in a placeholder SHALL be exactly its ECMAScript `JSON.stringify` form,
with no further escaping. The literal SHALL never be truncated, and `JSON.parse` of it SHALL return
the locator exactly.

#### Scenario: A bracketed path is re-read from its placeholder

- **WHEN** a Workspace-bound Run's model reads `app/[slug]/shot.png`, a 1600×900 image, and a later
  turn on a vision model replays that result
- **THEN** the result reaches the model as
  `[image "app/[slug]/shot.png" 1600×900, not retained]`
- **AND** a `read` of the locator that literal parses to, `app/[slug]/shot.png`, returns a fresh
  image result for the same file, attached in that Run when the epoch image window admits it

#### Scenario: A long locator is not cut

- **WHEN** the model reads an image whose submitted path is 400 characters long and a later turn
  replays that result on a vision model
- **THEN** the not-retained placeholder carries all 400 characters inside its JSON string literal

#### Scenario: A locator cannot forge a placeholder

- **WHEN** the model reads a host file whose path contains LF followed by `[image x 1×1]`, and the
  file is an image
- **THEN** every placeholder naming that read is one line, writes the LF as `\n`, and carries
  `[image x 1×1]` only inside its JSON string literal
- **AND** `JSON.parse` of that literal returns the path exactly

### Requirement: An epoch image window selects which images are attached

Within one compaction epoch, the rows after the active checkpoint plus the current attempt, requests
SHALL admit attachable image references oldest first in request order, a repeated id counting
again, while at most 100 images and at most 24 MiB (25,165,824 bytes) of summed base64 model
variants hold. The first reference that would exceed either bound, and every later one in that
epoch, SHALL NOT be attached.

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

### Requirement: The byte bound is summed from variant sizes before loading

A reference's base64 size SHALL be `4 × ceil(byteSize / 3)` of its model variant's byte size: the
media descriptor's `model.byteSize` for a stored object, and the byte size its attempt-memory entry
records for an unstored image, which the entry keeps after its bytes are released. The epoch image
window SHALL sum these sizes from descriptors and attempt memory before any image bytes are loaded,
independently of the dimension-based token estimate.

#### Scenario: Equal dimensions do not hide a byte overflow

- **WHEN** a vision-model epoch carries five owner attachments of identical 2000×2000 dimensions
  whose model variants' `model.byteSize` are each 3,900,000 bytes
- **THEN** the window counts each as 5,200,000 base64 bytes from its descriptor, before loading any
  variant
- **AND** the first four are sent as images and the fifth reaches the model as the limit placeholder

### Requirement: Only attachable references count toward the window

An attachable reference SHALL be an owner file part, a `media://` tool result, or a `media://`
prompt-import entry that resolves, or an unstored image whose entry in the current attempt's memory
records a model-variant byte size, its bytes released or not. A not-retained or unavailable
reference SHALL NOT count toward either bound of the epoch image window.

#### Scenario: A not-retained read does not count

- **WHEN** a vision-model epoch carries 99 attached owner attachments and a `read` image from an
  earlier turn, and the owner sends a message attaching one more image
- **THEN** all 100 owner attachments are sent as images
- **AND** the earlier read reaches the model as the not-retained placeholder

### Requirement: Adding an image never changes an earlier attachment

Because admission is append-only within an epoch, adding a turn, a step, or an image reference SHALL
NOT change whether an earlier reference in that epoch is attached, so the request prefix stays
unchanged for prompt caching. The attached set SHALL NOT depend on which vision model the request
targets.

#### Scenario: Adding an image never changes an earlier image's attachment

- **WHEN** a vision-model request's epoch carries 100 attached owner attachments and the next turn
  attaches one more image
- **THEN** the next request sends the same 100 references as images in the same positions
- **AND** only the new reference reaches the model as the limit placeholder

#### Scenario: Switching between vision models keeps the attached set

- **WHEN** a turn switches from one vision model to another within the same epoch
- **THEN** the new model's request attaches exactly the references the same turn's request would
  attach on the previous model
- **AND** every reference beyond the epoch's bounds keeps the limit placeholder

### Requirement: Attempt boundaries release unstored images from the window

Append-only admission SHALL have two exceptions: the end of an attempt, and the start of a new
attempt, a retry or a resume on any worker, whose memory starts empty. At either, the unstored images
an earlier attempt held SHALL become not-retained in later requests and leave the window, and the
references after them SHALL be admitted again oldest first.

#### Scenario: A Run's unstored images leave the window when it ends

- **WHEN** a Run on a vision model attaches two owner attachments and then reads one image, and the
  owner sends the next turn
- **THEN** the next request sends both attachments as images in the same positions
- **AND** the read reaches the model as the not-retained placeholder and does not count toward the
  epoch's bounds

#### Scenario: A retry frees the window space of the failed attempt's reads

- **WHEN** a vision-model epoch carries 99 attached owner attachments, an attempt reads one image,
  which is attached as the 100th, and then fails, and the retry attempt reads another image
- **THEN** the retry's requests carry the failed attempt's read as the not-retained placeholder
  without counting it
- **AND** they send the retry's own read as an image

### Requirement: A text-only model receives an omitted placeholder for every image

When the request's model does not declare `image` in its `input`, every image reference other than
an unavailable one SHALL reach the model, in the image's position and after any
`Image n (media://<id>):` label, as
`[image <subject> <width>×<height>, omitted: this model has no image input]`, with `<subject>` as
the placeholder locator requirements define and the original's dimensions.

#### Scenario: A text-only model receives placeholders only

- **WHEN** a request's model does not declare `image` input and history carries a file part for a
  1600×900 PNG uploaded as `shot.png`
- **THEN** the model receives `Image 1 (media://<id>):` followed by
  `[image media://<id> shot.png 1600×900, omitted: this model has no image input]`
- **AND** the request contains no image part

#### Scenario: A text-only model is never told about the image limit

- **WHEN** a text-only model's request carries more image references than the epoch's bounds admit,
  and an image read in an earlier turn
- **THEN** every resolvable reference, including those beyond the bounds and the earlier read, uses
  the `omitted: this model has no image input` form, and an unresolvable one keeps
  `[image media://<id> unavailable]`
- **AND** no placeholder in the request contains `image limit is reached` or `not retained`

#### Scenario: A text-only model receives a read image's placeholder by locator

- **WHEN** a request's model does not declare `image` input and an earlier step of the Run read
  `/work/shot.png`, a 1600×900 image
- **THEN** that read's result reaches the model as
  `[image "/work/shot.png" 1600×900, omitted: this model has no image input]`

### Requirement: An image beyond the epoch's bounds is not attached

For a model that declares `image`, an attachable reference the epoch image window does not attach
SHALL reach the model, in the image's position and after any label, as
`[image <subject> <width>×<height>, not attached: this context's image limit is reached]`, with
`<subject>` as for the omitted placeholder.

#### Scenario: A vision model receives the limit placeholder

- **WHEN** a vision-model request's epoch carries 101 image references and the 101st is `shot.png`
  at 1600×900
- **THEN** the 101st reaches the model as
  `[image media://<id> shot.png 1600×900, not attached: this context's image limit is reached]`
- **AND** the 100 earlier references are sent as images

### Requirement: Image overflow compacts at the start of the next Run

Before a Run's first model step, a prepared request on a model that declares `image` input SHALL
count as reaching its compaction threshold when it carries a reference not attached because the
epoch's bounds are reached and a stored image reference in a row before the triggering user
message. It SHALL trigger the compaction variant that `model-system-prompts` selects for it. The
new epoch SHALL admit images oldest first again. A Run SHALL NOT compact after its first model step.

#### Scenario: Image overflow triggers compaction at the next Run

- **WHEN** a vision-model chat's epoch carries 100 attached owner attachments in earlier turns, the
  request fits the model's window, and the owner sends a message attaching one more image
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
- **AND** no compaction runs before the Run ends, and the next turn carries that result as the
  not-retained placeholder without counting it

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

A `media://` reference the chat owner's store cannot resolve, because the id is unknown or belongs
to another owner, SHALL reach the model as `[image media://<id> unavailable]` in its position. It
SHALL NOT count toward the epoch's image bounds, SHALL NOT fail the request, and SHALL put no bytes
or descriptor field of any object into the request.

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
result whose image is attached SHALL keep only its text envelope in the tool message, or, when that
envelope would be empty, a line saying the image follows in the next message; any other keeps its
placeholder. The images of consecutive tool messages SHALL follow them in one user message starting
`Images from tool results:`, in tool-result order. Other wires keep images inside the tool output.

#### Scenario: A read image on Chat Completions arrives as an image part

- **WHEN** a vision model on an `openai-completions` provider receives a step request after an
  earlier step of the same Run produced two consecutive `read` results of `/work/a.png` and
  `media://<id>` that each carry an attached image
- **THEN** each tool message carries only its result text and no base64 text
- **AND** one user-role message follows them with `Images from tool results:`, then
  `Image from read "/work/a.png":` and the first image, then `Image from read "media://<id>":` and
  the second image

#### Scenario: A tool-result placeholder stays in the tool message

- **WHEN** a tool result's image is beyond the epoch's bounds on an `openai-completions` request
- **THEN** the tool message carries the placeholder
- **AND** no user-role image message is added for it

#### Scenario: A text-only Chat Completions model gets no image message

- **WHEN** an `openai-completions` model that does not declare `image` has a `read` image result
  within the epoch's bounds in its Run
- **THEN** its tool message carries the result text and the `omitted: this model has no image input`
  placeholder
- **AND** no `Images from tool results:` message and no image part is sent

### Requirement: Moved tool-result images are labelled by their locator

In the `Images from tool results:` message, each image SHALL be preceded by the text part
`Image from <toolName> <locator>:`, where `<locator>` is the JSON string literal of the image's
locator: the one the model submitted, or `media://<id>` for a `media://` read. Request-size
estimates SHALL count that header and those labels as text.

#### Scenario: The moved form's labels are sized as text

- **WHEN** a Chat Completions request moves one attached tool-result image into the trailing user
  message
- **THEN** its request-size estimate counts `Images from tool results:` and the image's
  `Image from <toolName> <locator>:` label as text, plus the image's dimension-based charge

### Requirement: The Chat Completions image transform applies within a Run

The Chat Completions tool-result image transform SHALL apply equally to `media://` tool results
from earlier turns and to tool results produced by earlier steps of the current Run. Applying it to
a request it has already transformed SHALL change nothing.

#### Scenario: A read in the current Run reaches the next step

- **WHEN** a vision model on an `opencode-go` provider reads an image in one step of a Run
- **THEN** the Run's next model step receives the image in a user-role message after the tool message
- **AND** that step's request carries exactly one `Images from tool results:` message for that read

### Requirement: Stored parts never carry model image bytes

Persisted message parts, including user file parts, tool results, and context items, SHALL name
images only by their `media://` locator or by their source attribution. Image bytes, base64 model
variants, and `data:` URLs built for a request SHALL NOT be persisted to any message part; the only
image data a part may carry is the display-only `thumbnail` of an unstored image.

#### Scenario: A completed vision Run stores no model image data

- **WHEN** a Run sends an attached image and a `read` image to a vision model and completes
- **THEN** the stored user message part contains the attachment's `media://` locator and the stored
  tool part contains the read's source attribution and its `thumbnail`
- **AND** no stored part contains base64 model-variant data or a `data:` URL other than that
  `thumbnail`

### Requirement: Image bytes join a request only when attached

A Run's live tool outputs SHALL carry no image bytes: an unstored image's model variant SHALL stay in
the attempt's memory outside the tool output until a step's request is composed, and a `media://`
reference's bytes SHALL be loaded from storage only for the references the epoch image window
attaches.

#### Scenario: Only attached references reach a step's request

- **WHEN** a Run on a vision model whose epoch carries no images `read`s one image per step for 101
  steps
- **THEN** the request for the next step carries image parts for the first 100 `read` results only
- **AND** the 101st `read` result's model variant bytes are not sent in that request and the
  attempt's memory does not retain them

#### Scenario: Unattached stored references are not loaded

- **WHEN** an epoch carries more than 100 owner attachments
- **THEN** a request loads model-variant bytes from storage for the 100 attached references only

### Requirement: Unstored images carry a display-only inline thumbnail

Each image result without a `media` locator, and each prompt-import image entry without one, SHALL
be stored with a `thumbnail` when one fits its cap: a `data:image/webp;base64,` URL of one WebP
encode of the model variant, its alpha flattened onto white, resized to fit 256 px on its longest
side without enlargement, at quality 60.

#### Scenario: A large image yields a small thumbnail

- **WHEN** the model reads a 4000×1000 PNG from a host path
- **THEN** the stored tool output's `thumbnail` is a `data:image/webp;base64,` URL of a 256×64 WebP
  of at most 65,536 characters

### Requirement: A thumbnail over its cap is omitted

When the thumbnail's data URL exceeds 65,536 characters, no `thumbnail` SHALL be stored: the tool
result carries no `thumbnail` key, and a prompt-import entry keeps its `width`, `height`, and
`mediaType`. The web client SHALL show such an image as a tile with its dimensions only.

#### Scenario: A thumbnail over the cap is omitted

- **WHEN** the model reads an image whose single thumbnail encode yields a data URL longer than
  65,536 characters
- **THEN** the stored tool output carries no `thumbnail` key and keeps the result's `mediaType`,
  `width`, and `height`
- **AND** the `read` tool card shows a tile with the image's dimensions and no image

### Requirement: Thumbnails are display-only

`thumbnail` SHALL never be sent to a model, SHALL be excluded from every observation, truncation,
and 128 KiB output budget, and SHALL never be accepted from a client. Public shares and shared
forks, which omit tool parts and prompt-import items, SHALL carry no `thumbnail`.

#### Scenario: A client cannot supply a thumbnail

- **WHEN** an owner message carries a part holding a `thumbnail` field
- **THEN** the request is rejected and nothing is persisted

#### Scenario: A public share carries no thumbnail

- **WHEN** an unauthenticated visitor reads a public share whose assistant message carries an image
  `read` result with a `thumbnail`
- **THEN** the response carries no tool part and no `thumbnail`

### Requirement: Title generation receives image placeholders

The title-generation input SHALL be the titled turn's user message text followed by one line per file
part of that message, in stored order, of the form `[image media://<id> <name>]`, rendered from the
stored part alone as `conversation-reads` defines for its image lines. Title generation SHALL receive
no image bytes. A message carrying only file parts SHALL produce a title input made of those lines.

#### Scenario: An image-only first message can be titled

- **WHEN** an untitled chat's turn is triggered by a user message carrying one file part with
  `filename` `shot.png` and no text
- **THEN** the title-generation input is `[image media://<id> shot.png]`
- **AND** the title request contains no image part

### Requirement: Compaction requests carry images as a Run would

A compaction request SHALL carry the compactable prefix's images as a Run request on the summarizing
model would under the same epoch window: image parts for the stored references it attaches when
that model declares `image` input, and placeholders otherwise. Every unstored image in the prefix
SHALL appear as its not-retained or omitted placeholder, because compaction runs before any step of
the Run.

#### Scenario: A vision summarizer receives the prefix's attached images

- **WHEN** a window-triggered compaction runs on a previous completed Run's model that declares
  `image` input and the compactable prefix carries more image references than the epoch's bounds
  admit
- **THEN** the summary request carries the attached references as image parts built from their model
  variants, in the positions the Run's own request would use
- **AND** every later reference appears as the limit placeholder

#### Scenario: A text-only summarizer receives placeholders

- **WHEN** a window-triggered compaction uses a previous completed Run's model whose declared input
  is text only and the compactable prefix carries an owner `file` part and an image `read` result
  of `/work/shot.png`
- **THEN** the file part appears as
  `[image media://<id> <name> <width>×<height>, omitted: this model has no image input]` and the
  read as `[image "/work/shot.png" <width>×<height>, omitted: this model has no image input]`
- **AND** the request carries no image part

#### Scenario: A vision summarizer receives unstored images as not retained

- **WHEN** a compaction on a model that declares `image` input summarizes a prefix holding an image
  `read` result of `/work/shot.png`
- **THEN** that result appears as the not-retained placeholder naming `"/work/shot.png"`
- **AND** the request carries no image part for it

### Requirement: Compaction keeps images re-readable

The summarization instruction SHALL direct the model to keep verbatim the locator of every image the
summary mentions, a `media://` locator or an unstored image's source locator; a later `read` of that
locator returns a fresh image result in the new epoch.

#### Scenario: The instruction keeps media locators

- **WHEN** the summarization instruction is rendered
- **THEN** it directs the model to keep verbatim the locator of every image the summary mentions,
  `media://` or source locator alike
- **AND** the instruction remains only in the trailing user message, leaving the bound prompt and
  compactable prefix unchanged

#### Scenario: A kept locator is re-read into the new epoch

- **WHEN** a checkpoint absorbed an image whose locator its summary kept, and a later Run on a
  vision model `read`s that locator
- **THEN** the `read` returns a fresh image result
- **AND** that result is sent as an image when the new epoch's bounds admit it

### Requirement: Kept image locators yield to redaction

The image-locator rule of the summarization instruction SHALL defer to the instruction's redaction
rule in `model-system-prompts`: a credential, token, or other secret inside a locator, such as a URL
query parameter, becomes `[REDACTED]`, because redaction takes precedence over verbatim quoting. An
unstored image's locator passes through no source-label sanitizing, so redaction is the only guard
keeping such a secret out of the summary.

#### Scenario: A credential in a kept locator is redacted

- **WHEN** the summarization instruction is rendered
- **THEN** it states that the image-locator rule yields to redaction, so a kept locator such as
  `https://example.test/a.png?token=secret` is written as `https://example.test/a.png?token=[REDACTED]`
- **AND** it still states that redaction takes precedence over verbatim quoting

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
carry one file part per thumbnail, in the order the images were added, and MAY carry no text.

#### Scenario: A pasted screenshot uploads immediately

- **WHEN** the owner pastes a clipboard image into the composer with a vision model selected
- **THEN** a thumbnail appears and an upload request starts before send

#### Scenario: An image-only message is sent

- **WHEN** two uploaded thumbnails are attached, the textarea is empty, and the owner sends
- **THEN** the sent message carries two file parts in the order they were added and no text part

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

### Requirement: Composer thumbnails can be removed

Each composer thumbnail SHALL reveal a remove action on hover and on keyboard focus. Thumbnails SHALL
keep the order in which the images were added and SHALL offer no reordering. The composer SHALL hold
at most 10 thumbnails; images added beyond the tenth SHALL NOT be added or uploaded.

#### Scenario: Thumbnails keep the order they were added

- **WHEN** the owner adds images `A` and `B`, removes `A`, adds `C`, and sends
- **THEN** the thumbnails read `B`, `C`
- **AND** the sent message's file parts are in the order `B`, `C`

#### Scenario: Remove is reachable by keyboard

- **WHEN** a thumbnail receives keyboard focus
- **THEN** its remove action is visible and operable
- **AND** activating it removes the thumbnail from the composer

#### Scenario: The eleventh image is not added

- **WHEN** 10 thumbnails are attached and the owner drops one more image
- **THEN** the composer still holds 10 thumbnails and no upload starts for the dropped image

### Requirement: A text-only model blocks image attachments

When the selected model does not declare `image` in its published `input`, the composer's attach
picker SHALL be disabled, and a pasted or dropped image SHALL be refused with a toast
`<model label> has no image input`, where the label is the model's `name`, or its `id` when it
publishes no `name`. Thumbnails already attached SHALL remain, and send SHALL stay disabled, with
the same reason shown inline in the composer, until a model declaring `image` is selected or every
thumbnail is removed.

#### Scenario: Attaching under a text-only model is refused

- **WHEN** the selected model named `Fast Text` declares only `text` input and the owner pastes an
  image
- **THEN** no thumbnail is added and no upload starts
- **AND** a toast reads `Fast Text has no image input`

#### Scenario: The picker is disabled under a text-only model

- **WHEN** the selected model declares only `text` input
- **THEN** the composer's attach picker is disabled

#### Scenario: Switching to a text-only model disables send

- **WHEN** two thumbnails are attached and the owner selects a text-only model named `Fast Text`
- **THEN** both thumbnails remain in order, send is disabled, and the composer shows
  `Fast Text has no image input`
- **AND** send becomes enabled after a vision model is selected again

### Requirement: Sent messages show read-only thumbnails

A user message carrying file parts SHALL show the same square thumbnails, in stored order and without
remove actions, above the user bubble. Each thumbnail SHALL load the model variant from
`GET /api/v1/media/:id/model` lazily. A message without text SHALL show its thumbnails and no empty
bubble.

#### Scenario: A reloaded chat shows its attachments

- **WHEN** the owner reloads a chat whose user message carries two file parts
- **THEN** two read-only thumbnails appear above that message's bubble in stored order
- **AND** each loads from its `/model` route

### Requirement: Read tool cards and prompt-import chips show image thumbnails

The `read` tool card of an image result and the prompt-import chip of an image entry SHALL show the
image as a thumbnail. A `thumbnail` field SHALL render directly as an `<img>` whose `src` is that
data URL, with no media route request; a `media://` result or entry SHALL load its thumbnail from
`GET /api/v1/media/:id/model`.

#### Scenario: An unstored read image renders its inline thumbnail

- **WHEN** the owner views a chat whose `read` tool card holds an image result with a `thumbnail`
- **THEN** the card shows an `<img>` whose `src` is that `thumbnail`
- **AND** no media route is requested for it

### Requirement: A lightbox spans the images of one row

Activating an image thumbnail SHALL open a modal lightbox dialog on that image whose slides are the
images of the same row only, in their row order: a message's attachments, a `read` result's image, a
prompt-import chip's image entries, or the composer's uploaded thumbnails. A composer thumbnail that
is still uploading or has failed, and an unstored image shown as a dimensions-only tile, SHALL NOT
open it.

#### Scenario: Navigation stays within the opened row

- **WHEN** a message carries attachments `A` and `B`, a later `read` result carries an image, and
  the owner opens `A`
- **THEN** pressing the right arrow key shows `B`
- **AND** no slide of that lightbox shows the `read` image

#### Scenario: The composer lightbox spans uploaded thumbnails only

- **WHEN** the composer holds two uploaded thumbnails and one still uploading, and the owner opens an
  uploaded one
- **THEN** the lightbox slides are the two uploaded thumbnails
- **AND** the uploading thumbnail does not open the lightbox

### Requirement: The lightbox navigates and closes by keyboard and buttons

Previous and next buttons and the left and right arrow keys SHALL move between the row's slides. The
dialog SHALL show the image within the viewport with its caption below, and SHALL close from its
close button or `Escape`, returning focus to the thumbnail that opened it.

#### Scenario: Escape returns focus

- **WHEN** the owner opens the lightbox from a thumbnail and presses `Escape`
- **THEN** the lightbox closes
- **AND** focus returns to that thumbnail

### Requirement: The lightbox zooms between fit and natural size

A slide SHALL first show the image fitted within the dialog, centred, never enlarged past its natural
size. When its natural size exceeds that fit, clicking the image, or its zoom button, SHALL toggle
between the fit and the natural size; at natural size the dialog's panel SHALL scroll natively to
pan. An image whose natural size already fits SHALL offer no zoom button and SHALL not respond to a
click.

#### Scenario: A click toggles natural size

- **WHEN** the owner opens a 4000×3000 attachment and clicks the image
- **THEN** the image shows at 4000×3000 and the panel scrolls to pan it
- **AND** clicking it again fits it within the dialog

#### Scenario: An image that already fits offers no zoom

- **WHEN** the owner opens an unstored read's 256×254 thumbnail in the lightbox
- **THEN** the image shows centred at 256×254 with no zoom button
- **AND** clicking it leaves it unchanged

### Requirement: Each lightbox slide shows one image source

A stored image's slide (an owner attachment, an uploaded composer thumbnail, a `media://` read, or a
`media://` prompt import) SHALL load `GET /api/v1/media/:id/original`; an unstored image's slide
SHALL show its `thumbnail`. No slide SHALL offer a variant control or request a media descriptor.

#### Scenario: An attachment slide loads its original

- **WHEN** the owner opens a sent message's uploaded attachment `media://<id>`
- **THEN** the slide loads `/api/v1/media/<id>/original` and requests no descriptor
- **AND** the caption is `media://<id>` and the slide offers no variant control

#### Scenario: An unstored read image is a thumbnail slide

- **WHEN** the owner opens the image a `read` of `/work/shot.png` returned, a 1600×900 PNG
- **THEN** the slide shows that result's `thumbnail` and no variant control
- **AND** the caption is `1600×900 PNG · /work/shot.png`

### Requirement: Lightbox captions name the image's locator

The caption SHALL be `<width>×<height> <FORMAT> · <locator>`, with the original's dimensions and
format, when the row already carries them (a `read` image result, an unstored prompt-import entry's
payload, or a composer thumbnail's upload descriptor), and `<locator>` alone otherwise. A stored
image's locator is `media://<id>`; an unstored image's is, as plain text, the one the model
submitted to `read` or the owner wrote in the import marker, not the resolved `path`.

#### Scenario: A composer slide captions its upload descriptor

- **WHEN** the owner opens an uploaded composer thumbnail whose upload returned a 1600×900 PNG
  `media://<id>`
- **THEN** the slide loads `/api/v1/media/<id>/original`
- **AND** the caption is `1600×900 PNG · media://<id>`

#### Scenario: A relative locator captions its slide as submitted

- **WHEN** a Chat is bound to `/repo`, and the owner opens the image a `read` of `docs/shot.png`
  returned or the image a `@shot.png` import marker imported, each a 1600×900 PNG
- **THEN** the captions are `1600×900 PNG · docs/shot.png` and `1600×900 PNG · shot.png`
- **AND** neither caption shows the resolved `/repo/` path, and the import's dimensions and format
  come from its payload entry's `width`, `height`, and `mediaType`
