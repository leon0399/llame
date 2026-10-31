# media-attachments Specification

## Purpose

Lets an owner attach stored images and PDFs to a chat message, defines how every image and PDF
reference in a chat's history reaches a model as media or as a placeholder, retains the model bytes
of unstored tool-read and prompt-import media in their stored part until compaction, keeps those
bytes on the server, stores a display-only inline thumbnail for each unstored image, and keeps
text-only surfaces free of media content.

## Requirements

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
in submitted order.

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
items, its temporal row, then for each file part in stored order a label text part followed by that
file part's image or PDF, then the owner's text. A label SHALL be `Image n (media://<id>):` for an
image and `PDF n (media://<id>):` for a PDF, where `n` SHALL count that message's file parts of the
same kind from 1.

#### Scenario: Images precede the owner's text

- **WHEN** a user message stores text `compare these` and file parts for media `A` then `B`, and the
  request's model declares `image` input
- **THEN** after the message's rail items and temporal row the model receives
  `Image 1 (media://A):`, the model variant of `A`, `Image 2 (media://B):`, the model variant of `B`,
  and then `compare these`

#### Scenario: Labels restart in each message

- **WHEN** two user messages each carry one file part
- **THEN** each message's label reads `Image 1 (media://<id>):`

#### Scenario: Images and PDFs are counted separately

- **WHEN** a user message stores text `summarize` and file parts for image `A`, PDF `B` uploaded as
  `paper.pdf`, and image `C`, the request's model declares `image` and `pdf` input, and the epoch
  image window attaches all three
- **THEN** after the message's rail items and temporal row the model receives
  `Image 1 (media://A):`, the model variant of `A`, `PDF 1 (media://B):`, a file part carrying the
  original of `B` with media type `application/pdf` and filename `paper.pdf`,
  `Image 2 (media://C):`, the model variant of `C`, and then `summarize`

#### Scenario: Every file part carries its stored variant or original

- **WHEN** any request composes a user message that carries file parts
- **THEN** each image file part is the model variant, read from storage at request time
- **AND** each PDF file part is the original, read from storage at request time, sent as a file part
  with media type `application/pdf` and the stored name as its filename

### Requirement: Tool-result and prompt-import images reach the model with their text

A `read` result that carries an image MUST reach the model as a tool output that carries the
result's text and then the image. An image entry of a prompt-imports item MUST reach the model as
an image after the item's text. Each image MUST be the model variant. For a `media://` result or
entry, the system reads the stored variant from storage at request time. For each other result or
entry, the system uses the retained variant in its stored part.

#### Scenario: A read image reaches the model as tool output

- **WHEN** an earlier step of a Run read `/work/shot.png`, an image, and the request's model
  declares `image` input on a Responses or Messages wire
- **THEN** that tool result's output carries the result's text and the image's model variant

#### Scenario: A media read in an earlier turn reaches the model from the store

- **WHEN** a `read` result in an earlier turn carries `media://<id>` and the request's model
  declares `image` input on a Responses or Messages wire
- **THEN** that tool result's output carries the result's text and the stored model variant of
  `media://<id>`

### Requirement: Unstored images and PDFs are retained in their stored part

Each successful image or PDF `read` result without a `media` locator MUST keep its retained bytes
in `retainedMedia` in its stored part, under the per-message bound. Each such prompt-import entry
MUST do the same. For an
image, the retained bytes are the model variant, with its media type and dimensions. For a PDF,
they are the original. Retention MUST NOT depend on the locator scheme or the declared input.

#### Scenario: A read image is retained in its tool part

- **WHEN** a Run on a model that declares `image` input reads `/work/shot.png`, a 1600×900 PNG
- **THEN** the stored tool part keeps the model variant with its media type, width, and height
- **AND** the result's `kind`, `mediaType`, `width`, `height`, `path`, and `thumbnail` stay as
  `read` returned them

#### Scenario: A text-only model's read is retained

- **WHEN** a Run on a model that does not declare `image` input reads `/work/shot.png`
- **THEN** the stored tool part keeps the model variant of the image
- **AND** each request of that model carries the omitted placeholder for that read

#### Scenario: Every locator scheme is retained

- **WHEN** the model reads an image from a host path, a `file://`, `machine://`, `kb://`, or
  `skill://` locator, or an `http://` or `https://` locator
- **THEN** each stored tool part keeps the model variant of the image that its read returned

#### Scenario: A read PDF is retained

- **WHEN** a Run reads `/work/paper.pdf`, a 15-page PDF
- **THEN** the stored tool part keeps the original of the PDF

#### Scenario: A prompt-import entry is retained

- **WHEN** the owner's message imports `@shot.png`, a PNG, or `@paper.pdf`, a PDF
- **THEN** the stored entry of the `prompt-imports` item keeps the image's model variant or the
  PDF's original

### Requirement: Retained media reaches every later request of its epoch

A request MUST project a retained image or PDF from its stored part, as it projects a stored
object. This MUST apply to a later step, a later turn, a Continue Run, an owner fork, and a
compaction request. It MUST also apply to a reply that a settler rebuilt from the event log. The epoch image window MUST
select each retained reference as it selects each other reference.

#### Scenario: A later turn attaches a read image

- **WHEN** a turn on a model that declares `image` input follows a Run that read `/work/shot.png`,
  and the epoch image window attaches that reference
- **THEN** the request carries the retained model variant as an image part after that read's
  result text
- **AND** the later turn does not read the file again

#### Scenario: A later turn attaches a read PDF

- **WHEN** a turn on a model that declares `pdf` input follows a Run that read `/work/paper.pdf`,
  and the epoch image window attaches that reference
- **THEN** the request carries the retained original as a PDF after that read's result text

#### Scenario: A Continue Run attaches a kept read

- **WHEN** a failed reply holds a `read` result of `/work/shot.png`, and the owner continues the
  turn on a model that declares `image` input
- **THEN** the Continue Run's requests carry the retained model variant of that kept read when the
  epoch image window attaches it

#### Scenario: A rebuilt reply keeps its read

- **WHEN** a settler without the live part collector rebuilds a reply from the event log, and that
  reply holds a `read` result of `/work/shot.png`
- **THEN** the rebuilt tool part keeps the retained model variant
- **AND** a later turn on a model that declares `image` input attaches it when the epoch image
  window attaches the reference

#### Scenario: An owner fork attaches a read image

- **WHEN** the owner forks a chat whose copied rows hold a `read` result of `/work/shot.png`, and
  the fork's next turn uses a model that declares `image` input
- **THEN** the fork's request carries the retained model variant when the epoch image window
  attaches the reference

#### Scenario: A new attempt of the same Run reads again

- **WHEN** an attempt reads `/work/shot.png`, its worker stops, and the same Run starts a new
  attempt
- **THEN** the new attempt's requests carry no output of the earlier attempt, as `durable-runs`
  defines
- **AND** an image that the new attempt reads is retained in its own tool part

#### Scenario: A switch to a vision model attaches an earlier read

- **WHEN** a turn on a text-only model read `/work/shot.png`, and the next turn of the same epoch
  uses a model that declares `image` input
- **THEN** the next request carries the retained model variant when the epoch image window
  attaches the reference

### Requirement: Each read retains the bytes it read

Each `read` call and each import entry MUST keep its own retained bytes. Two reads of one file MUST
be two references, and the epoch image window MUST count each of them. When a file changes between
two reads, each read MUST replay with the bytes of its own read time.

#### Scenario: Two reads of one file attach twice

- **WHEN** a Run on a model that declares `image` input reads the unchanged file `/work/shot.png`
  in two steps, and the epoch image window attaches both references
- **THEN** each later request carries two image parts, one after each result's text
- **AND** the window counts two images

#### Scenario: A changed file keeps each version

- **WHEN** a Run reads `/work/shot.png`, the file then changes on disk, and a later step reads it
  again
- **THEN** each later request carries the first read's model variant after the first result
- **AND** it carries the second read's model variant after the second result

### Requirement: Retained bytes stay on the server

Retained bytes MUST NOT be in a client response, a stream frame, model-facing text, or an
application log. They MUST NOT be in a conversation read, a search index, a title input, or a
recency digest. They MUST NOT be in a public share or a shared fork. The chat history response and
the run event stream MUST remove them. Retained bytes leave the server only in an attached image or
PDF part of a provider request.

#### Scenario: The history response omits retained bytes

- **WHEN** the owner reads the messages of a chat whose reply holds a retained `read` image
- **THEN** the response carries the tool part with its result and its `thumbnail`
- **AND** no part of the response carries the retained bytes

#### Scenario: The stream omits retained bytes

- **WHEN** a live or replayed Run stream reports a `read` call that retained an image or a PDF
- **THEN** no stream frame carries the retained bytes

#### Scenario: The run event stream omits retained bytes

- **WHEN** the owner reads the events of a Run whose `tool.completed` or `run.continued` event holds
  retained bytes
- **THEN** each event frame carries its payload without the retained bytes

#### Scenario: Model-facing text omits retained bytes

- **WHEN** any request replays a retained `read` result or prompt-import entry
- **THEN** the result text and the item text carry no part of the retained bytes

#### Scenario: A prompt-import entry's bytes are not in the history response

- **WHEN** the owner reads the messages of a chat whose user message imported `@shot.png`
- **THEN** the image entry of the `prompt-imports` item carries its `thumbnail`, `width`, `height`,
  and `mediaType`
- **AND** it carries no retained bytes

### Requirement: Retained bytes count toward no text budget

The tool-result truncation cap, the replay budgets, the prompt-import output bound, and each
request-size estimate MUST exclude retained bytes. An attached image MUST keep its dimension
charge, and an attached PDF MUST keep its page charge.

#### Scenario: A large retained PDF does not clear its pair

- **WHEN** a later turn replays a `read` result whose retained original is 18 MiB, and the pair's
  text fits its replay budget
- **THEN** the system does not clear or drop the pair's payload because of the PDF

#### Scenario: Truncation does not cut retained bytes

- **WHEN** a `read` returns an image whose model variant is 3 MiB
- **THEN** the tool result is not marked `truncated` because of the model variant
- **AND** the retained bytes are complete

#### Scenario: Retained bytes do not change the estimate

- **WHEN** two otherwise identical requests each carry one retained 2000×1125 image, one model
  variant of 200 KiB and one of 3.7 MiB
- **THEN** both requests receive the same estimate

### Requirement: A result without retained bytes replays as its text

Some image or PDF results and import entries have no `media` locator and no `retainedMedia`. Each
of them MUST reach each request as its result text only. It MUST carry no image part, no file part,
and no placeholder. It MUST NOT count toward the epoch image window, and it MUST NOT fail the
request. It MUST NOT be an image or PDF reference. Results stored before retention have this form.

#### Scenario: An earlier result without retained bytes replays as text

- **WHEN** a later turn on a model that declares `image` input replays an image `read` result of
  `/work/shot.png` that has no `retainedMedia`
- **THEN** the request carries that result's text, which names `kind` `image`, its dimensions, and
  its path
- **AND** the request carries no image part and no placeholder for it, and the Run continues

#### Scenario: An import entry without retained bytes replays as text

- **WHEN** a later turn replays a `prompt-imports` item whose image entry has no `retainedMedia`
- **THEN** the request carries the item's text and no image part or placeholder for that entry

### Requirement: Retained bytes live and end with their chat

Retained bytes MUST be stored only in the chat's message parts and in the server-side run events of
the chat's Runs. A queue job MUST NOT carry them. The system MUST NOT create a media object for
them, and the media list MUST NOT show them. Deletion of the chat MUST delete them. An owner fork
MUST copy them with the rows that it copies.

#### Scenario: A retained read creates no media object

- **WHEN** the model reads `/work/shot.png`, a PNG image
- **THEN** the Run owner holds no media object for those bytes
- **AND** the owner's media list does not change

#### Scenario: Chat deletion deletes retained bytes

- **WHEN** the owner deletes a chat whose replies hold retained reads
- **THEN** no message part and no run event keeps those retained bytes

#### Scenario: A queue job carries no retained bytes

- **WHEN** the owner continues or regenerates a turn whose user message imported `@shot.png`
- **THEN** the queued job's copy of that message carries no retained bytes
- **AND** the Run's requests still attach the import from the stored message

#### Scenario: A shared fork copies no retained bytes

- **WHEN** another user forks a shared or public chat whose replies hold retained reads
- **THEN** the fork's rows carry no tool part and no retained bytes

### Requirement: Stored parts carry no request-built media data

A stored part MUST name a stored object only by its `media://` locator. It MUST NOT carry a
`data:` URL or base64 data that the system built for a request. The only media data that a stored
part carries MUST be the display-only `thumbnail` and the retained bytes.

#### Scenario: A completed vision Run stores no request data

- **WHEN** a Run sends an attached stored image and a `read` image to a vision model and completes
- **THEN** the stored user message part carries the attachment's `media://` locator and no bytes
- **AND** the stored tool part carries the read's result, its `thumbnail`, and its retained bytes,
  and no request-built `data:` URL

### Requirement: Retained bytes are bounded in each stored message

Each stored message MUST keep at most 29,360,128 bytes of retained base64 across all its parts. The
system MUST count the reads of a reply in the order that it settles them. A read or import entry
whose base64 would exceed the rest of that bound MUST keep no bytes. Its `retainedMedia` MUST then
be the record `{ "exceeded": true }`. The read or import itself MUST succeed.

#### Scenario: A read past the message bound keeps no bytes

- **WHEN** a Run on a model that declares `pdf` input settles ten reads of 20 MiB PDFs in one reply
- **THEN** the first settled read keeps its retained original, because its 27,962,028 base64 bytes
  fit
- **AND** the other nine reads keep no bytes, return their normal results, and record that the
  bound is exceeded

#### Scenario: A small read after a large one can still fit

- **WHEN** a reply already keeps 27,962,028 base64 bytes, and the Run then reads a 400 KiB image
  whose model variant is 300,000 bytes
- **THEN** that image keeps its retained bytes, because its 400,000 base64 bytes fit the rest of
  the bound

#### Scenario: The bound includes the kept parts of a Continue Run

- **WHEN** a Continue Run keeps a reply part that holds 27,962,028 retained base64 bytes, and the Run
  then reads a 20 MiB PDF
- **THEN** that read keeps no bytes and records that the bound is exceeded

#### Scenario: The live step, the event, and the stored part agree

- **WHEN** a read exceeds the bound in a live attempt
- **THEN** the next step of that attempt, its `tool.completed` event, its stored part, and a reply
  rebuilt from the event log all treat it as past the bound

### Requirement: A read past the message bound takes the limit placeholder

A result or import entry whose `retainedMedia` records an exceeded bound MUST reach each request as
the limit placeholder of its kind. On a model that does not declare its kind, it MUST reach the
request as the omitted placeholder. On a model that declares its kind, the window MUST treat it as
the first reference past a bound. So the window attaches no later reference of that epoch. It MUST count as
an unattached reference for the overflow trigger.

#### Scenario: A sixth large read takes the limit placeholder

- **WHEN** a Run on a vision model reads six images in one reply, each with a 5 MiB base64 model
  variant
- **THEN** the sixth read records that the bound is exceeded
- **AND** each later request of the epoch carries the sixth read as
  `[image "<locator>" <width>×<height>, not attached: this context's image limit is reached]`

#### Scenario: A text-only model receives the omitted placeholder for a read past the bound

- **WHEN** a request on a model that does not declare `pdf` input replays a PDF read that records an
  exceeded bound
- **THEN** the read reaches the model as the PDF omitted placeholder

### Requirement: No placeholder directs the model to read an image again

An image placeholder MUST NOT direct the model to read the image again. A compaction request, the
step at the step cap, and a Run whose `tools.allowed` omits `read` cannot act on such a directive.
The placeholder of an unstored image MUST name the exact locator of a later `read`.

#### Scenario: A compaction request carries no re-read directive

- **WHEN** a compaction request on a vision model summarizes a row whose `read` result is an
  unstored 1600×900 image of `/work/shot.png`, and the epoch image window does not attach it
- **THEN** that result reaches the summarizer as
  `[image "/work/shot.png" 1600×900, not attached: this context's image limit is reached]`
- **AND** no placeholder in the request tells the model to read an image again

### Requirement: Each image reference takes exactly one model-facing form

Each image reference MUST reach the model as exactly one form. A result with neither `media` nor
`retainedMedia` MUST NOT be a reference. The system MUST select the first form that applies, in this order:

- the unavailable placeholder, for a `media://` reference that does not resolve;
- the omitted placeholder, when the request's model does not declare `image` input;
- an image part, when the epoch image window attaches the reference;
- the limit placeholder, in all other cases.

#### Scenario: Missing image input outranks retention

- **WHEN** a text-only model's request replays a retained image `read` from an earlier turn
- **THEN** that read reaches the model as the omitted placeholder
- **AND** the request carries no image part for it

### Requirement: Image placeholders name the image by its locator

A placeholder MUST name a stored object by `media://<id> <name>`. `<name>` is its single-line
source label, as `media-store` defines. A placeholder MUST name an unstored image by its locator,
written as a JSON string literal. That locator is the one that the model gave to `read` or that the
owner wrote in the import marker. The dimensions MUST be the original's.

#### Scenario: A placeholder names the submitted locator

- **WHEN** a Workspace-bound Run's model reads `docs/shot.png`, a 1600×900 image, and a later turn
  replays that result on a text-only model
- **THEN** the result reaches the model as
  `[image "docs/shot.png" 1600×900, omitted: this model has no image input]`

### Requirement: Placeholder locators are exact JSON string literals

An unstored image's locator in a placeholder MUST be exactly its ECMAScript `JSON.stringify` form,
with no more escape characters. The system MUST NOT truncate the literal. `JSON.parse` of the
literal MUST return the locator exactly.

#### Scenario: A bracketed path is re-read from its placeholder

- **WHEN** a Workspace-bound Run's model reads `app/[slug]/shot.png`, a 1600×900 image, and a later
  turn on a text-only model replays that result
- **THEN** the result reaches the model as
  `[image "app/[slug]/shot.png" 1600×900, omitted: this model has no image input]`
- **AND** a `read` of the locator that the literal parses to, `app/[slug]/shot.png`, returns a
  fresh image result for the same file

#### Scenario: A long locator is not cut

- **WHEN** the model reads an image whose submitted path has 400 characters, and a later turn
  replays that result on a text-only model
- **THEN** the omitted placeholder carries all 400 characters in its JSON string literal

#### Scenario: A locator cannot forge a placeholder

- **WHEN** the model reads a host file whose path contains LF and then `[image x 1×1]`, and the file
  is an image
- **THEN** each placeholder that names that read is one line, writes the LF as `\n`, and carries
  `[image x 1×1]` only in its JSON string literal
- **AND** `JSON.parse` of that literal returns the path exactly

### Requirement: An epoch image window selects which images are attached

Within one compaction epoch, the rows after the active checkpoint plus the current attempt, requests
SHALL admit attachable image and PDF references oldest first in request order, a repeated id counting
again, while for the request's model at most 100 images, at most 28 MiB (29,360,128 bytes) of summed
base64 sizes, at most 100 PDF pages, and at most `floor(max(0, contextWindowTokens × 0.8 −
reservedOutputTokens) / 3,000)` PDF pages hold.

#### Scenario: The 101st image in an epoch is not attached

- **WHEN** a vision-model request's epoch carries 101 small image references
- **THEN** the 100 oldest are sent as images
- **AND** the 101st reaches the model as the limit placeholder

#### Scenario: The byte bound stops the window

- **WHEN** the oldest six references of an epoch each have a 5 MiB base64 model variant and later
  references are small
- **THEN** the five oldest are sent as images
- **AND** the sixth and every later reference in the epoch reach the model as the limit placeholder

#### Scenario: The window holds across the steps of a Run

- **WHEN** a Run on a vision model whose epoch carries no images `read`s one image per step for 101
  steps
- **THEN** every later step's request sends the first 100 `read` results as images
- **AND** the 101st `read` result reaches the next step as the limit placeholder

#### Scenario: The byte bound applies within a Run

- **WHEN** a Run on a vision model whose epoch carries no images `read`s six images in successive
  steps, each with a 5 MiB base64 model variant
- **THEN** the request for the next step sends the first five `read` results as images
- **AND** the sixth `read` result is sent as the limit placeholder

#### Scenario: The page bound stops the window

- **WHEN** a request on a 400,000-token model that declares `pdf` input carries an epoch whose
  oldest references are a small 80-page PDF and then a small 30-page PDF
- **THEN** the 80-page PDF is sent as a PDF
- **AND** the 30-page PDF and every later reference in the epoch reach the model as the limit
  placeholder

#### Scenario: Images and PDFs share the byte bound

- **WHEN** a request on a 200,000-token model that declares `image` and `pdf` input carries an epoch
  whose oldest reference is a 10-page 20 MiB PDF, 27,962,028 bytes of base64, followed by an image
  with a 2 MiB base64 model variant
- **THEN** the PDF is sent as a PDF
- **AND** the image reaches the model as the limit placeholder

#### Scenario: A PDF on a model without PDF input takes no window space

- **WHEN** a request on a model that declares `image` but not `pdf` input carries an epoch whose
  oldest reference is a stored 20 MiB PDF, followed by five images each with a 5 MiB base64 model
  variant
- **THEN** the PDF reaches the model as the omitted placeholder
- **AND** all five images are sent as images

#### Scenario: A stored 64-page PDF on a 200,000-token model takes the limit placeholder

- **WHEN** a request on a 200,000-token model that declares `pdf` input carries an epoch whose oldest
  references are a stored 64-page PDF and then a stored 5-page PDF
- **THEN** the 64-page PDF, over that model's 53-page bound, reaches the model as the PDF limit
  placeholder
- **AND** the 5-page PDF and every later reference in the epoch reach the model as the limit
  placeholder

#### Scenario: The first reference past any bound is refused for the rest of the epoch

- **WHEN** any request in an epoch would exceed any bound with its next attachable reference
- **THEN** that reference and every later reference in that epoch are not attached

#### Scenario: The page bound's terms and worked values apply to every request

- **WHEN** any request's PDF page bound is computed
- **THEN** 0.8 is the compaction window ratio that sets the default compaction threshold,
  `reservedOutputTokens` is the output reserve the request's fit check subtracts (0 when none is
  configured), and 3,000 is the tokens charged per page
- **AND** with no reserve the bound is 53 pages on a 200,000-token model, 34 on 128,000, and 100 on
  400,000 or more, and with a 64,000-token reserve it is 32 pages on a 200,000-token model

### Requirement: The byte bound is summed from variant sizes before loading

A reference's base64 size MUST be `4 × ceil(byteSize / 3)`. For an image, `byteSize` is the byte
size of its model variant. For a PDF, it is the byte size of its original. The epoch image window
MUST sum these sizes from descriptors and from retained bytes, before it loads stored bytes. This
sum MUST be independent of the dimension-based and page-based token estimates.

#### Scenario: Equal dimensions do not hide a byte overflow

- **WHEN** a vision-model epoch carries six owner attachments of identical 2000×2000 dimensions,
  and the `model.byteSize` of each model variant is 3,900,000 bytes
- **THEN** the window counts each as 5,200,000 base64 bytes from its descriptor, before it loads a
  variant
- **AND** the first five are sent as images, and the sixth reaches the model as the limit
  placeholder

#### Scenario: A PDF counts its original's size

- **WHEN** an epoch on a 200,000-token model that declares `image` and `pdf` input carries a stored
  10-page PDF whose descriptor `byteSize` is 20,971,520 bytes, and then an owner image whose
  `model.byteSize` is 1,200,000 bytes
- **THEN** the window counts the PDF as 27,962,028 base64 bytes and the image as 1,600,000, before
  it loads either
- **AND** the PDF is sent as a PDF, and the image reaches the model as the limit placeholder

#### Scenario: Each reference kind reports the byte size the window sums

- **WHEN** the epoch image window of a request sums the base64 size of a media reference
- **THEN** it takes the descriptor's `model.byteSize` for a stored image and the descriptor's
  `byteSize` for a stored PDF
- **AND** it takes the byte length of the retained model variant for an unstored image, and of the
  retained original for an unstored PDF

### Requirement: Only attachable references count toward the window

An attachable reference MUST be an owner file part, a `media://` tool result or prompt-import
entry, or a retained image or PDF. Its kind MUST be one that the request's model declares as
input: `image` for an image and `pdf` for a PDF. An unavailable or omitted reference, and a result
with neither `media` nor `retainedMedia`, MUST NOT count toward a bound of the epoch image window.

#### Scenario: A not-retained read does not count

- **WHEN** a vision-model epoch carries 99 attached owner attachments and an image `read` result
  that has no `retainedMedia`, and the owner sends a message that attaches one more image
- **THEN** all 100 owner attachments are sent as images
- **AND** the earlier read reaches the model as its result text only

#### Scenario: A not-retained PDF read does not count

- **WHEN** an epoch on a 400,000-token model that declares `pdf` input carries an 80-page PDF
  `read` result that has no `retainedMedia`, and the owner sends a message that attaches a stored
  80-page PDF
- **THEN** the owner's PDF is sent as a PDF
- **AND** the earlier read reaches the model as its result text only

#### Scenario: A PDF on a model without PDF input does not count

- **WHEN** an epoch on a model that declares `image` but not `pdf` input carries a stored 80-page
  PDF and 99 attached owner image attachments, and the owner sends a message that attaches one more
  image
- **THEN** all 100 owner images are sent as images
- **AND** the PDF reaches the model as the omitted placeholder

#### Scenario: Attachability covers every reference kind and its source

- **WHEN** the epoch of a request carries an owner file part, a `media://` tool result, a
  `media://` prompt-import entry, a retained image, or a retained PDF
- **THEN** a reference is attachable only when the request's model declares its kind as input,
  `image` for an image and `pdf` for a PDF
- **AND** a `media://` reference is attachable only when it resolves

### Requirement: Adding an image never changes an earlier attachment

Because admission is append-only within an epoch, adding a turn, a step, or an image reference SHALL
NOT change whether an earlier reference in that epoch is attached, so the request prefix stays
unchanged for prompt caching. The attached set SHALL NOT depend on which vision model the request
targets among models that declare the same `image` and `pdf` input and the same context window.

#### Scenario: Adding an image never changes an earlier image's attachment

- **WHEN** a vision-model request's epoch carries 100 attached owner attachments and the next turn
  attaches one more image
- **THEN** the next request sends the same 100 references as images in the same positions
- **AND** only the new reference reaches the model as the limit placeholder

#### Scenario: Switching between vision models keeps the attached set

- **WHEN** a turn switches from one vision model to another that declares the same `image` and `pdf`
  input and the same context window within the same epoch
- **THEN** the new model's request attaches exactly the references the same turn's request would
  attach on the previous model
- **AND** every reference beyond the epoch's bounds keeps the limit placeholder

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

For a model that declares `image`, an attachable image reference the epoch image window does not
attach SHALL reach the model, in the image's position and after any label, as
`[image <subject> <width>×<height>, not attached: this context's image limit is reached]`, with
`<subject>` as for the omitted placeholder. An attachable PDF reference the window does not attach
SHALL instead take the PDF limit placeholder.

#### Scenario: A vision model receives the limit placeholder

- **WHEN** a vision-model request's epoch carries 101 image references and the 101st is `shot.png`
  at 1600×900
- **THEN** the 101st reaches the model as
  `[image media://<id> shot.png 1600×900, not attached: this context's image limit is reached]`
- **AND** the 100 earlier references are sent as images

### Requirement: Image overflow compacts at the start of the next Run

A request prepared before a Run's first model step MUST count as at its compaction threshold when
two conditions are true. First, it carries an image or PDF reference that the epoch image window
does not attach because the epoch's bounds are reached. Second, a row before the triggering user
message holds a stored or retained reference of a kind that the request's model declares. A Run
MUST NOT compact after its first model step.

#### Scenario: Image overflow triggers compaction at the next Run

- **WHEN** a vision-model chat's epoch carries 100 attached owner attachments in earlier turns, the
  request fits the model's window, and the owner sends a message that attaches one more image
- **THEN** the threshold-triggered compaction runs on the Run's own model before its first model
  step
- **AND** the Run's request admits the triggering message's image under the new epoch and sends it
  as an image

#### Scenario: Overflow in the triggering message alone does not compact

- **WHEN** a vision-model chat's epoch carries no image or PDF before the triggering user message,
  and that message attaches 10 images whose 5 MiB base64 model variants exceed the byte bound
- **THEN** no compaction runs
- **AND** the five oldest images are sent as images, and the others reach the model as the limit
  placeholder

#### Scenario: An image read beyond the bounds inside a Run does not compact

- **WHEN** a Run on a vision model reads an image after its epoch's bounds are reached
- **THEN** that `read` result reaches the next step as the limit placeholder
- **AND** no compaction runs before the Run ends
- **AND** the next Run compacts before its first model step, because that read is a retained
  reference in an earlier row

#### Scenario: PDF overflow triggers compaction at the next Run

- **WHEN** a chat on a 400,000-token model that declares `pdf` input carries a stored 80-page PDF
  that an earlier turn of its epoch attached, the request fits the model's window, and the owner
  sends a message that attaches a stored 30-page PDF
- **THEN** the threshold-triggered compaction runs on the Run's own model before its first model
  step
- **AND** the Run's request admits the 30-page PDF under the new epoch and sends it as a PDF

#### Scenario: A stored PDF does not enable image overflow on a model without PDF input

- **WHEN** a chat on a model that declares `image` but not `pdf` input carries only a stored PDF in
  the rows before the triggering user message, and the images of that message exceed the epoch's
  bounds
- **THEN** no compaction runs
- **AND** the images that overflow reach the model as the limit placeholder

#### Scenario: A PDF over the model's page bound does not fail later turns

- **WHEN** a chat on a 200,000-token model that declares `pdf` input has a first message that
  attaches a stored 64-page PDF, and the owner sends a second message that fits the model's window
- **THEN** neither turn fails, and the first turn continues without compaction, with the PDF as
  the PDF limit placeholder in its request
- **AND** the second Run's threshold-triggered compaction runs before its first model step, because
  the PDF is a stored reference in an earlier row, and absorbs the first message's row

#### Scenario: The overflow trigger selects the compaction variant for its Run

- **WHEN** a request counts as at its compaction threshold because of overflow
- **THEN** it triggers the compaction variant that `model-system-prompts` selects for it

#### Scenario: An overflow compaction starts an epoch that admits oldest first again

- **WHEN** an overflow-triggered compaction completes
- **THEN** the new epoch admits images and PDFs oldest first again

#### Scenario: The stored reference must be of a declared input kind

- **WHEN** the earlier rows of a request that overflows hold a stored or retained image, or a
  stored or retained PDF
- **THEN** the image counts as that reference only on a model that declares `image` input
- **AND** the PDF counts as that reference only on a model that declares `pdf` input

### Requirement: A failed overflow compaction never fails the Run

When image or PDF overflow is the only trigger condition and its compaction fails or yields no usable
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

#### Scenario: A failed PDF overflow compaction does not fail the Run

- **WHEN** a Run's only trigger condition is PDF overflow and its summarization call throws
- **THEN** the Run proceeds without a checkpoint and the overflowing PDFs reach the model as the PDF
  limit placeholder

### Requirement: Unresolvable media references never fail a request

A `media://` reference the chat owner's store cannot resolve, because the id is unknown or belongs to
another owner, SHALL reach the model in its position as `[pdf media://<id> unavailable]` when it is a
PDF and as `[image media://<id> unavailable]` otherwise. It SHALL NOT count toward the epoch's
bounds, SHALL NOT fail the request, and SHALL put no bytes or descriptor field of any object into the
request.

#### Scenario: An unresolvable reference becomes an unavailable placeholder

- **WHEN** a stored file part references an id that does not exist
- **THEN** the model receives `[image media://<id> unavailable]` in its position
- **AND** the Run proceeds

#### Scenario: Another owner's id in stored history is not resolved

- **WHEN** a stored part in owner `B`'s chat references a media id owned by owner `A`
- **THEN** the model receives `[image media://<id> unavailable]`
- **AND** no bytes and no descriptor field of owner `A`'s media enter the request

#### Scenario: An unresolvable PDF reference names its kind

- **WHEN** a stored file part whose `mediaType` is `application/pdf` references an id the owner's
  store cannot resolve
- **THEN** the model receives `[pdf media://<id> unavailable]` in its position
- **AND** the Run proceeds

#### Scenario: Each reference kind reports whether it is a PDF

- **WHEN** any unresolvable `media://` reference is rendered
- **THEN** a file part is a PDF by its stored `mediaType` `application/pdf`, a prompt-import entry by
  its `pdf` kind, and a `read` result by its `pdf` kind, and every other reference is not

### Requirement: Chat Completions wires carry tool-result images in a following user message

On `openai-completions` and `opencode-go`, a tool message SHALL NOT carry image or PDF content: an
attached tool result keeps only its text envelope, or, when that envelope would be empty, a line
saying the file follows in the next message, and any other keeps its placeholder. The images and PDFs
of consecutive tool messages SHALL follow them in one user message starting
`Files from tool results:`, in tool-result order.

#### Scenario: A read image on Chat Completions arrives as an image part

- **WHEN** a vision model on an `openai-completions` provider receives a step request after an
  earlier step of the same Run produced two consecutive `read` results of `/work/a.png` and
  `media://<id>` that each carry an attached image
- **THEN** each tool message carries only its result text and no base64 text
- **AND** one user-role message follows them with `Files from tool results:`, then
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
- **AND** no `Files from tool results:` message and no image part is sent

#### Scenario: Images and PDFs move together

- **WHEN** a model that declares `image` and `pdf` input on an `opencode-go` provider receives a step
  request after consecutive attached `read` results of `/work/a.png` and `/work/paper.pdf`
- **THEN** neither tool message carries image or PDF content
- **AND** one user-role message follows them with `Files from tool results:`, then
  `Image from read "/work/a.png":` and the image, then `PDF from read "/work/paper.pdf":` and the
  PDF

#### Scenario: Every other wire keeps the file inside the tool output

- **WHEN** an attached tool-result image or PDF is sent on any wire other than `openai-completions`
  or `opencode-go`
- **THEN** the tool output itself keeps that image or PDF

### Requirement: Moved tool-result images are labelled by their locator

In the `Files from tool results:` message, each image SHALL be preceded by the text part
`Image from <toolName> <locator>:`, where `<locator>` is the JSON string literal of the image's
locator: the one the model submitted, or `media://<id>` for a `media://` read. Request-size
estimates SHALL count that header and those labels as text.

#### Scenario: The moved form's labels are sized as text

- **WHEN** a Chat Completions request moves one attached tool-result image into the trailing user
  message
- **THEN** its request-size estimate counts `Files from tool results:` and the image's
  `Image from <toolName> <locator>:` label as text, plus the image's dimension-based charge

### Requirement: The Chat Completions image transform applies within a Run

The Chat Completions tool-result image transform SHALL apply equally to `media://` tool results
from earlier turns and to tool results produced by earlier steps of the current Run. Applying it to
a request it has already transformed SHALL change nothing.

#### Scenario: A read in the current Run reaches the next step

- **WHEN** a vision model on an `opencode-go` provider reads an image in one step of a Run
- **THEN** the Run's next model step receives the image in a user-role message after the tool message
- **AND** that step's request carries exactly one `Files from tool results:` message for that read

### Requirement: Image bytes join a request only when attached

A Run's model-facing tool outputs MUST carry no image bytes. The retained model variant of an
unstored image MUST stay outside the tool output until the system composes a step's request. The
system MUST load the bytes of a `media://` reference from storage only for the references that the
epoch image window attaches.

#### Scenario: Only attached references reach a step's request

- **WHEN** a Run on a vision model whose epoch carries no images reads one image in each step for
  101 steps
- **THEN** the request for the next step carries image parts for the first 100 `read` results only
- **AND** that request does not carry the model variant bytes of the 101st `read` result

#### Scenario: Unattached stored references are not loaded

- **WHEN** an epoch carries more than 100 owner attachments
- **THEN** a request loads model-variant bytes from storage for the 100 attached references only

### Requirement: Unstored images carry a display-only inline thumbnail

Each image result without a `media` locator, and each prompt-import image entry without one, MUST
be stored with a thumbnail when one fits its cap. The thumbnail is a `data:image/webp;base64,` URL
of one WebP encode of the model variant. The encode flattens alpha onto white, fits 256 px on the
longest side without enlargement, and uses quality 60. A tool result MUST store it as `display.thumbnail`. A
prompt-import entry keeps its own `thumbnail` field.

#### Scenario: A large image yields a small thumbnail

- **WHEN** the model reads a 4000×1000 PNG from a host path
- **THEN** the stored tool output's `display.thumbnail` is a `data:image/webp;base64,` URL of a
  256×64 WebP of at most 65,536 characters

### Requirement: A thumbnail over its cap is omitted

When the thumbnail's data URL exceeds 65,536 characters, the system MUST NOT store a thumbnail: the
tool result carries no `display.thumbnail` key, and a prompt-import entry keeps its `width`,
`height`, and `mediaType`.

#### Scenario: A thumbnail over the cap is omitted

- **WHEN** the model reads an image whose single thumbnail encode yields a data URL longer than
  65,536 characters
- **THEN** the stored tool output carries no `display.thumbnail` key and keeps the result's
  `mediaType`, `width`, and `height`

### Requirement: Thumbnails are display-only

The system MUST NOT send a thumbnail to a model. A thumbnail MUST stay outside every observation,
truncation, and 128 KiB output budget. The system MUST NOT accept a thumbnail from a client. In a
tool result it lives under the `display` key that `tool-result-rendering` removes before any
rendering. Public shares and shared forks, which omit tool parts and prompt-import items, MUST
carry no thumbnail.

#### Scenario: A client cannot supply a thumbnail

- **WHEN** an owner message carries a part holding a `thumbnail` field or a `display` key
- **THEN** the request is rejected and nothing is persisted

#### Scenario: A public share carries no thumbnail

- **WHEN** an unauthenticated visitor reads a public share whose assistant message carries an image
  `read` result with a `display.thumbnail`
- **THEN** the response carries no tool part and no thumbnail

### Requirement: Title generation receives image placeholders

The title-generation input SHALL be the titled turn's user message text followed by one line per file
part of that message, in stored order, of the form `[image media://<id> <name>]` for an image and
`[pdf media://<id> <name>]` for a PDF, rendered from the stored part alone as `conversation-reads`
defines for its file-part lines. Title generation SHALL receive no image or PDF bytes. A message
carrying only file parts SHALL produce a title input made of those lines.

#### Scenario: An image-only first message can be titled

- **WHEN** an untitled chat's turn is triggered by a user message carrying one file part with
  `filename` `shot.png` and no text
- **THEN** the title-generation input is `[image media://<id> shot.png]`
- **AND** the title request contains no image part

#### Scenario: A PDF-only first message can be titled

- **WHEN** an untitled chat's turn is triggered by a user message carrying one PDF file part with
  `filename` `paper.pdf` and no text
- **THEN** the title-generation input is `[pdf media://<id> paper.pdf]`
- **AND** the title request contains no PDF file part

### Requirement: Compaction requests carry images as a Run would

A compaction request MUST carry the images of the compactable prefix under the same epoch window.
It MUST carry them as a Run request on the summarizing model carries them. When that model declares `image`
input, the request MUST carry image parts for the stored and retained references that the window
attaches. It MUST carry placeholders for all other references.

#### Scenario: A vision summarizer receives the prefix's attached images

- **WHEN** a window-triggered compaction runs on the model of a previous completed Run that declares
  `image` input, and the compactable prefix carries more image references than the epoch's bounds
  admit
- **THEN** the summary request carries the attached references as image parts built from their
  model variants, in the positions that the Run's own request uses
- **AND** each later reference appears as the limit placeholder

#### Scenario: A text-only summarizer receives placeholders

- **WHEN** a window-triggered compaction uses the model of a previous completed Run whose declared
  input is text only, and the compactable prefix carries an owner `file` part and an image `read`
  result of `/work/shot.png`
- **THEN** the file part appears as
  `[image media://<id> <name> <width>×<height>, omitted: this model has no image input]`, and the
  read appears as
  `[image "/work/shot.png" <width>×<height>, omitted: this model has no image input]`
- **AND** the request carries no image part

#### Scenario: A vision summarizer receives unstored images as not retained

- **WHEN** a compaction on a model that declares `image` input summarizes a prefix that holds an
  image `read` result of `/work/shot.png` with no `retainedMedia`
- **THEN** that result appears as its result text only
- **AND** the request carries no image part for it

#### Scenario: A vision summarizer receives a retained read image

- **WHEN** a compaction on a model that declares `image` input summarizes a prefix that holds a
  retained image `read` result of `/work/shot.png`, and the epoch image window attaches it
- **THEN** the summary request carries the retained model variant as an image part after that
  result's text

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

### Requirement: Each PDF reference takes exactly one model-facing form

Each PDF reference MUST reach the model as exactly one form. A result with neither `media` nor
`retainedMedia` MUST NOT be a reference. The system MUST select the first form that applies, in this order:

- `[pdf media://<id> unavailable]`, when the reference does not resolve;
- `[pdf <subject> <P> pages, omitted: this model has no PDF input]`, when the request's model does
  not declare `pdf` input;
- the PDF, when the epoch image window attaches it;
- `[pdf <subject> <P> pages, not attached: this context's PDF limit is reached]`, in all other
  cases.

#### Scenario: A model without PDF input receives the omitted placeholder

- **WHEN** a request's model declares `image` but not `pdf` input, and history carries a file part
  for a 15-page PDF uploaded as `paper.pdf`
- **THEN** the model receives `PDF 1 (media://<id>):` and then
  `[pdf media://<id> paper.pdf 15 pages, omitted: this model has no PDF input]`
- **AND** the request carries no PDF file part

#### Scenario: Missing PDF input outranks retention

- **WHEN** a request on a model that does not declare `pdf` input replays a retained PDF `read`
  from an earlier turn
- **THEN** that read reaches the model as the omitted placeholder
- **AND** the request carries no PDF file part for it

#### Scenario: A PDF beyond the epoch's bounds receives the limit placeholder

- **WHEN** a request on a model that declares `pdf` input carries a stored 15-page PDF uploaded as
  `paper.pdf` after its epoch's bounds are reached
- **THEN** that reference reaches the model as
  `[pdf media://<id> paper.pdf 15 pages, not attached: this context's PDF limit is reached]`

### Requirement: PDF placeholders name the PDF by its locator and page count

In a PDF placeholder, `<subject>` MUST be `media://<id> <name>` for a stored object. `<name>` is
its single-line source label, as `media-store` defines. For an unstored PDF, `<subject>` MUST be
`<locator>`, the locator that the model gave to `read` or that the owner wrote in the import
marker. The system MUST write `<locator>` as an exact `JSON.stringify` literal and MUST NOT truncate
it. `JSON.parse` of it MUST return the locator exactly. `<P>` MUST be the original's page count.

#### Scenario: A placeholder names the submitted PDF locator

- **WHEN** a Run reads `/docs/paper.pdf`, a 15-page PDF, and a later turn replays that result on a
  model that does not declare `pdf` input
- **THEN** the result reaches the model as
  `[pdf "/docs/paper.pdf" 15 pages, omitted: this model has no PDF input]`

#### Scenario: A PDF locator cannot forge a placeholder

- **WHEN** the model reads a host file whose path contains LF and then `[pdf x 1 pages]`, and the
  file is a PDF
- **THEN** each placeholder that names that read is one line, writes the LF as `\n`, and carries
  `[pdf x 1 pages]` only in its JSON string literal
- **AND** `JSON.parse` of that literal returns the path exactly

### Requirement: Tool-result and prompt-import PDFs reach the model with their text

An attached PDF of a `read` result MUST reach the model as a tool output that carries the result's
text and then the PDF. An attached PDF entry of a prompt-imports item MUST reach the model as a PDF
file part after the item's text. Each PDF MUST be the original. For a `media://` result or entry,
the system reads the stored original from storage at request time. For each other result or entry,
the system uses the retained original in its stored part.

#### Scenario: A read PDF reaches the model as tool output

- **WHEN** an earlier step of a Run read `/work/paper.pdf`, a 15-page PDF, the request's model
  declares `pdf` input on a Responses or Messages wire, and the epoch image window attaches the PDF
- **THEN** that tool result's output carries the result's text and the PDF's original bytes

#### Scenario: An imported PDF follows its item's text

- **WHEN** the owner's message imports `@media://<id>`, a stored PDF, the request's model declares
  `pdf` input, and the epoch image window attaches the PDF
- **THEN** the prompt-imports item reaches the model as its text and then a PDF file part that
  carries the stored original

### Requirement: No placeholder directs the model to read a PDF again

A PDF placeholder MUST NOT direct the model to read the PDF again. The placeholder of an unstored
PDF MUST name the exact locator of a later `read` of the PDF.

#### Scenario: A compaction request carries no PDF re-read directive

- **WHEN** a compaction request on a model that declares `pdf` input summarizes a row whose `read`
  result is an unstored 15-page PDF of `/docs/paper.pdf`, and the epoch image window does not
  attach it
- **THEN** that result reaches the summarizer as
  `[pdf "/docs/paper.pdf" 15 pages, not attached: this context's PDF limit is reached]`
- **AND** no placeholder in the request tells the model to read a PDF again

### Requirement: Attached PDFs are sized by pages, not bytes

Every request-size estimate used for admission or compaction, including the context-window fit
check, the compaction trigger, and the continuation estimate, SHALL exclude PDF bytes and SHALL
charge each attached PDF 3,000 tokens per page of its original. A PDF placeholder SHALL count as its
text.

#### Scenario: A 15-page PDF is charged by pages

- **WHEN** a request carries one attached 15-page PDF
- **THEN** the estimate charges that PDF 45,000 tokens

#### Scenario: PDF bytes do not change the estimate

- **WHEN** two otherwise identical requests each carry one attached 10-page PDF, one of 200 KiB and
  one of 18 MiB
- **THEN** both requests receive the same estimate

### Requirement: PDF bytes join a request only when attached

A Run's model-facing tool outputs MUST carry no PDF bytes. The retained original of an unstored PDF
MUST stay outside the tool output until the system composes a step's request. The system MUST load
the bytes of a `media://` PDF from storage only when the epoch image window attaches it.

#### Scenario: An unattached stored PDF is not loaded

- **WHEN** a request on a model that declares `pdf` input carries a stored PDF that the epoch image
  window does not attach
- **THEN** the request loads no bytes of that PDF from storage

### Requirement: Compaction requests carry PDFs as a Run would

A compaction request MUST carry the PDFs of the compactable prefix as a Run request on the
summarizing model carries them. It MUST use the same epoch window, with the bounds of the
summarizing model. When that model declares `pdf` input, the request MUST carry the PDFs of the stored and
retained references that the window attaches. It MUST carry placeholders for all other references.

#### Scenario: A summarizer without PDF input receives placeholders

- **WHEN** a window-triggered compaction uses a model that does not declare `pdf` input, and the
  compactable prefix carries an owner PDF file part and a PDF `read` result of `/docs/paper.pdf`
- **THEN** the file part appears as
  `[pdf media://<id> <name> <P> pages, omitted: this model has no PDF input]`, and the read
  appears as `[pdf "/docs/paper.pdf" <P> pages, omitted: this model has no PDF input]`
- **AND** the request carries no PDF file part

#### Scenario: A PDF summarizer receives the prefix's attached PDFs

- **WHEN** a compaction runs on a model that declares `pdf` input, and the compactable prefix
  carries a stored PDF that the epoch image window attaches
- **THEN** the summary request carries that PDF's original in the position that the Run's own
  request uses

#### Scenario: A PDF summarizer receives a retained read PDF

- **WHEN** a compaction on a model that declares `pdf` input summarizes a prefix that holds a
  retained PDF `read` result of `/docs/paper.pdf`, and the epoch image window attaches it
- **THEN** the summary request carries the retained original as a PDF after that result's text

### Requirement: Compaction keeps PDF locators verbatim

The summarization instruction SHALL direct the model to keep verbatim the locator of every PDF the
summary mentions, a `media://` locator or an unstored PDF's source locator. This rule SHALL yield to
the instruction's redaction rule in `model-system-prompts`, as the image-locator rule does.

#### Scenario: The instruction keeps PDF locators

- **WHEN** the summarization instruction is rendered
- **THEN** it directs the model to keep verbatim the locator of every PDF the summary mentions
- **AND** it still states that redaction takes precedence over verbatim quoting

### Requirement: Moved tool-result PDFs are labelled by their locator

In the `Files from tool results:` message, each PDF SHALL be preceded by the text part
`PDF from <toolName> <locator>:`, where `<locator>` is the JSON string literal of the PDF's locator:
the one the model submitted, or `media://<id>` for a `media://` read. Request-size estimates SHALL
count that label as text, plus the PDF's page-based charge.

#### Scenario: A moved PDF is labelled by its locator

- **WHEN** a model that declares `pdf` input on an `openai-completions` provider receives a step
  request after an earlier step read `/work/paper.pdf` and the PDF is attached
- **THEN** the tool message carries only the result text
- **AND** one user-role message follows it with `Files from tool results:`, then
  `PDF from read "/work/paper.pdf":` and the PDF

### Requirement: Attached PDFs use each wire's native document content

An attached PDF SHALL reach the provider as the original's base64 data with media type
`application/pdf`: an `input_file` item with filename and data on the Responses and Codex wires, a
`file` part with both on Chat Completions wires, and a `document` block on the Anthropic Messages
wire. Its filename SHALL be a stored PDF's stored name, else the last non-empty segment of the
submitted locator's path (a web URL's path), else `document.pdf`. No PDF SHALL be sent as text or
image.

#### Scenario: An owner PDF on the Messages wire is a document block

- **WHEN** a model that declares `pdf` input on an Anthropic Messages provider receives a user
  message with an attached stored PDF
- **THEN** that message's content carries a `document` block whose source is the original's base64
  data with media type `application/pdf`

#### Scenario: An owner PDF on the Responses wire is an input file

- **WHEN** a model that declares `pdf` input on a Responses provider receives a user message with an
  attached stored PDF uploaded as `paper.pdf`
- **THEN** that message's content carries an `input_file` item with filename `paper.pdf` and the
  original's base64 data

#### Scenario: A read PDF on the Responses wire is named by its path

- **WHEN** a model that declares `pdf` input on a Responses provider receives a step request after
  an earlier step read `/docs/paper.pdf` and the PDF is attached
- **THEN** that tool result's output carries an `input_file` item with filename `paper.pdf` and the
  original's base64 data

### Requirement: A PDF carries no thumbnail

A PDF `read` result and a prompt-import PDF entry SHALL be stored with no `thumbnail` key, whether or
not they carry a `media` locator.

#### Scenario: A read PDF stores no thumbnail

- **WHEN** the model reads `/work/paper.pdf`, a 15-page PDF
- **THEN** the stored tool output carries no `thumbnail` key
