## ADDED Requirements

### Requirement: Each PDF reference takes exactly one model-facing form

Each PDF reference SHALL reach the model as exactly one form, chosen in this order: the unavailable
placeholder `[pdf media://<id> unavailable]` for an unresolvable `media://` reference; the omitted
placeholder when the request's model does not declare `pdf` input; the not-retained placeholder for
an unstored PDF whose attempt-memory entry is absent or, when attached, holds no bytes; the PDF
itself when the epoch image window attaches it; and the limit placeholder otherwise.

#### Scenario: A model without PDF input receives the omitted placeholder

- **WHEN** a request's model declares `image` but not `pdf` input and history carries a file part
  for a 15-page PDF uploaded as `paper.pdf`
- **THEN** the model receives `PDF 1 (media://<id>):` followed by
  `[pdf media://<id> paper.pdf 15 pages, omitted: this model has no PDF input]`
- **AND** the request carries no PDF file part

#### Scenario: Missing PDF input outranks retention

- **WHEN** a request on a model that does not declare `pdf` input replays a PDF `read` from an
  earlier turn
- **THEN** that read reaches the model as the omitted placeholder
- **AND** no placeholder in the request contains `not retained`

#### Scenario: A PDF beyond the epoch's bounds receives the limit placeholder

- **WHEN** a request on a model that declares `pdf` input carries a stored 15-page PDF uploaded as
  `paper.pdf` after its epoch's bounds are reached
- **THEN** that reference reaches the model as
  `[pdf media://<id> paper.pdf 15 pages, not attached: this context's PDF limit is reached]`

### Requirement: PDF placeholders name the PDF by its locator and page count

A PDF placeholder other than the unavailable one SHALL name a stored object by `media://<id> <name>`,
with `<name>` its single-line source label that `media-store` defines, and an unstored PDF by its
locator, the one the model submitted to `read` or the owner wrote in the import marker, written as
an exact `JSON.stringify` literal, never truncated, that `JSON.parse` returns exactly. `<P>` SHALL be
the original's page count.

#### Scenario: A placeholder names the submitted PDF locator

- **WHEN** a Run reads `/docs/paper.pdf`, a 15-page PDF, and a later turn replays that result on a
  model that declares `pdf` input
- **THEN** the result reaches the model as `[pdf "/docs/paper.pdf" 15 pages, not retained]`

#### Scenario: A PDF locator cannot forge a placeholder

- **WHEN** the model reads a host file whose path contains LF followed by `[pdf x 1 pages]`, and the
  file is a PDF
- **THEN** every placeholder naming that read is one line, writes the LF as `\n`, and carries
  `[pdf x 1 pages]` only inside its JSON string literal
- **AND** `JSON.parse` of that literal returns the path exactly

### Requirement: Tool-result and prompt-import PDFs reach the model with their text

An attached PDF of a `read` result SHALL reach the model as a tool output carrying the result's text
followed by the PDF. An attached PDF entry of a prompt-imports item SHALL reach the model as a PDF
file part after the item's text. Each PDF SHALL be the original: the stored one, read from storage at
request time, for a `media://` result or entry, and otherwise the one the attempt's memory holds.

#### Scenario: A read PDF reaches the model as tool output

- **WHEN** an earlier step of a Run read `/work/paper.pdf`, a 15-page PDF, and the request's model
  declares `pdf` input on a Responses or Messages wire
- **THEN** that tool result's output carries the result's text and the PDF's original bytes

#### Scenario: An imported PDF follows its item's text

- **WHEN** the owner's message imports `@media://<id>`, a stored PDF, and the request's model declares
  `pdf` input
- **THEN** the prompt-imports item reaches the model as its text followed by a PDF file part carrying
  the stored original

### Requirement: Unstored PDFs are retained in attempt memory only

For a PDF result or prompt-import PDF entry without a `media` locator, the worker SHALL keep an entry
in the memory of the attempt that read it, keyed by the tool call id or by the item entry, and SHALL
persist it nowhere. The entry SHALL hold the locator and page count, and also the original's bytes
and byte size only when the attempt's model declares `pdf` input.

#### Scenario: A read PDF is attached in the later steps of its Run

- **WHEN** a Run on a model that declares `pdf` input reads `/work/paper.pdf`, a 15-page PDF, and
  continues for two more steps
- **THEN** both later steps' requests carry its original as a PDF when the epoch image window
  attaches it

#### Scenario: A model without PDF input retains no PDF bytes

- **WHEN** a Run on a model that does not declare `pdf` input reads `/work/paper.pdf`, a 15-page PDF
- **THEN** the attempt's memory keeps only the read's locator and page count
- **AND** that read reaches every later step as the omitted placeholder

### Requirement: A released PDF entry is sized and refused again

Each compose SHALL release the bytes of every unstored PDF the epoch image window does not attach.
Releasing a PDF entry's bytes SHALL keep its locator, byte size, and page count, so the window sizes
the reference again at every later compose of the attempt and leaves it unattached again. A PDF the
window attaches whose entry holds no bytes SHALL reach the model as the not-retained placeholder.

#### Scenario: A released PDF read stays unattached in later steps

- **WHEN** a Run on a model that declares `pdf` input, whose epoch carries no images or PDFs, reads
  an 80-page PDF and then a 30-page PDF in successive steps
- **THEN** the 30-page read's entry keeps its byte size and page count after its bytes are released
- **AND** every later step's request sends the 80-page read as a PDF and the 30-page read as the
  limit placeholder

### Requirement: An unstored PDF outside its attempt is not retained

A request composed where the current attempt's memory holds no entry for an unstored PDF (a later
turn, a retry or a resume, a compaction request, or a fork) SHALL carry, in the PDF's position,
`[pdf <locator> <P> pages, not retained]` when the request's model declares `pdf` input, and the
omitted placeholder otherwise. Such a PDF SHALL NOT count toward the epoch's bounds.

#### Scenario: A later turn receives the PDF not-retained placeholder

- **WHEN** a turn on a model that declares `pdf` input follows a Run that read `/docs/paper.pdf`, a
  15-page PDF
- **THEN** that read's result reaches the model as `[pdf "/docs/paper.pdf" 15 pages, not retained]`
- **AND** the request carries no PDF file part for it and the read does not count toward the
  epoch's bounds

#### Scenario: A retry does not hold the failed attempt's PDF

- **WHEN** an attempt on a model that declares `pdf` input reads a PDF and fails, and the Run is
  retried as a new attempt on the same worker or another
- **THEN** each of the retry's requests carries the not-retained placeholder for that PDF
- **AND** the PDF is attached again only after the retry's model reads it again

### Requirement: No placeholder directs the model to read a PDF again

No PDF placeholder SHALL direct the model to read the PDF again. The not-retained placeholder SHALL
name the exact locator a later `read` of the PDF takes.

#### Scenario: A compaction request carries no PDF re-read directive

- **WHEN** a compaction request on a model that declares `pdf` input summarizes a row whose `read`
  result is an unstored 15-page PDF of `/docs/paper.pdf`
- **THEN** that result reaches the summarizer as `[pdf "/docs/paper.pdf" 15 pages, not retained]`
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

### Requirement: Stored parts and run events never carry PDF bytes

Persisted message parts and run events SHALL name PDFs only by their `media://` locator or by their
source attribution. PDF bytes, their base64 form, and `data:` URLs built for a request SHALL NOT be
persisted to any message part or run event.

#### Scenario: A completed Run stores no PDF data

- **WHEN** a Run sends an attached stored PDF and a `read` PDF to a model that declares `pdf` input
  and completes
- **THEN** the stored user message part contains the attachment's `media://` locator and the stored
  tool part and its run events contain the read's source attribution, `pages`, and `byteSize`
- **AND** no stored part or run event contains PDF bytes, base64 PDF data, or a `data:` URL

### Requirement: PDF bytes join a request only when attached

A Run's live tool outputs SHALL carry no PDF bytes: an unstored PDF's original SHALL stay in the
attempt's memory outside the tool output until a step's request is composed, and a `media://`
PDF's bytes SHALL be loaded from storage only when the epoch image window attaches it.

#### Scenario: An unattached stored PDF is not loaded

- **WHEN** a request on a model that declares `pdf` input carries a stored PDF the epoch image window
  does not attach
- **THEN** the request loads no bytes of that PDF from storage

### Requirement: Compaction requests carry PDFs as a Run would

A compaction request SHALL carry the compactable prefix's PDFs as a Run request on the summarizing
model would under the same epoch window: PDFs for the stored references it attaches when that model
declares `pdf` input, and placeholders otherwise. Every unstored PDF in the prefix SHALL appear as
its not-retained or omitted placeholder.

#### Scenario: A summarizer without PDF input receives placeholders

- **WHEN** a window-triggered compaction uses a model that does not declare `pdf` input and the
  compactable prefix carries an owner PDF file part and a PDF `read` result of `/docs/paper.pdf`
- **THEN** the file part appears as
  `[pdf media://<id> <name> <P> pages, omitted: this model has no PDF input]` and the read as
  `[pdf "/docs/paper.pdf" <P> pages, omitted: this model has no PDF input]`
- **AND** the request carries no PDF file part

#### Scenario: A PDF summarizer receives the prefix's attached PDFs

- **WHEN** a compaction runs on a model that declares `pdf` input and the compactable prefix carries
  a stored PDF the epoch image window attaches
- **THEN** the summary request carries that PDF's original in the position the Run's own request
  would use

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

## MODIFIED Requirements

### Requirement: Attached images reach the model before the message text

Within one user message, the model-facing content SHALL be, in order: the message's context rail
items, its temporal row, then for each file part in stored order a label text part followed by that
file part's image or PDF, then the owner's text. An image file part's label SHALL be
`Image n (media://<id>):` and a PDF file part's label `PDF n (media://<id>):`, where `n` SHALL count
that message's file parts of the same kind from 1. Each image SHALL be the model variant, read from
storage at request time. Each PDF SHALL be the original, read from storage at request time, sent as a
file part with media type `application/pdf` and the stored name as its filename.

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
  `paper.pdf`, and image `C`, and the request's model declares `image` and `pdf` input
- **THEN** after the message's rail items and temporal row the model receives
  `Image 1 (media://A):`, the model variant of `A`, `PDF 1 (media://B):`, a file part carrying the
  original of `B` with media type `application/pdf` and filename `paper.pdf`,
  `Image 2 (media://C):`, the model variant of `C`, and then `summarize`

### Requirement: Attempt memory retains only the images the window attaches

An image entry SHALL hold the model variant's bytes and byte size when the attempt's model declares
`image` input, and only the locator and original dimensions otherwise; holding an entry SHALL
neither count nor cap anything. Each time a request is composed, the composer SHALL release the
bytes of every unstored reference the epoch image window does not attach, so after each compose the
attempt's retained bytes are those the window attached, at most 28 MiB of base64 in sum, however
many steps it runs.

#### Scenario: Retained bytes stay within the window's budget

- **WHEN** a Run on a vision model whose epoch carries no images `read`s ten images in successive
  steps, each with a 5 MiB base64 model variant
- **THEN** after each step's request is composed, the attempt's memory retains the model variants of
  the first five reads only, at most 28 MiB of base64 in sum
- **AND** it keeps only the locator, dimensions, and model-variant byte size of the other five, which
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

Releasing an image entry's bytes SHALL keep its locator, dimensions, and model-variant byte size, so
the epoch image window sizes the reference again at every later compose of the attempt and,
admission being append-only, leaves it unattached again. A reference the window attaches whose entry
holds no bytes SHALL reach the model as the not-retained placeholder; this is a guard that
append-only admission within an attempt makes unreachable in practice.

#### Scenario: A released read stays unattached in later steps

- **WHEN** a Run on a vision model whose epoch carries no images `read`s six images in successive
  steps, each with a 5 MiB base64 model variant, and then reads a small image
- **THEN** the sixth read's entry keeps its 5 MiB base64 byte size after its bytes are released
- **AND** every later step's request sends the first five reads as images and the sixth and seventh
  as the limit placeholder

### Requirement: An epoch image window selects which images are attached

Within one compaction epoch, the rows after the active checkpoint plus the current attempt, requests
SHALL admit attachable image and PDF references oldest first in request order, a repeated id
counting again, while at most 100 images, at most 100 PDF pages, and at most 28 MiB (29,360,128
bytes) of summed base64 sizes hold. The first reference that would exceed any bound, and every later
one in that epoch, SHALL NOT be attached.

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

- **WHEN** a request on a model that declares `pdf` input carries an epoch whose oldest references
  are a small 80-page PDF and then a small 30-page PDF
- **THEN** the 80-page PDF is sent as a PDF
- **AND** the 30-page PDF and every later reference in the epoch reach the model as the limit
  placeholder

#### Scenario: Images and PDFs share the byte bound

- **WHEN** a request on a model that declares `image` and `pdf` input carries an epoch whose oldest
  reference is a 20 MiB PDF, 27,962,028 bytes of base64, followed by an image with a 2 MiB base64
  model variant
- **THEN** the PDF is sent as a PDF
- **AND** the image reaches the model as the limit placeholder

#### Scenario: A PDF on a model without PDF input takes no window space

- **WHEN** a request on a model that declares `image` but not `pdf` input carries an epoch whose
  oldest reference is a stored 20 MiB PDF, followed by five images each with a 5 MiB base64 model
  variant
- **THEN** the PDF reaches the model as the omitted placeholder
- **AND** all five images are sent as images

### Requirement: The byte bound is summed from variant sizes before loading

A reference's base64 size SHALL be `4 × ceil(byteSize / 3)` of its model variant's byte size for an
image and of its original's byte size for a PDF: the media descriptor's `model.byteSize` for a stored
image, the descriptor's `byteSize` for a stored PDF, and the byte size its attempt-memory entry
records for an unstored image or PDF, which the entry keeps after its bytes are released. The epoch
image window SHALL sum these sizes from descriptors and attempt memory before any image or PDF bytes
are loaded, independently of the dimension-based and page-based token estimates.

#### Scenario: Equal dimensions do not hide a byte overflow

- **WHEN** a vision-model epoch carries six owner attachments of identical 2000×2000 dimensions
  whose model variants' `model.byteSize` are each 3,900,000 bytes
- **THEN** the window counts each as 5,200,000 base64 bytes from its descriptor, before loading any
  variant
- **AND** the first five are sent as images and the sixth reaches the model as the limit placeholder

#### Scenario: A PDF counts its original's size

- **WHEN** an epoch on a model that declares `image` and `pdf` input carries a stored PDF whose
  descriptor `byteSize` is 20,971,520 bytes, followed by an owner image whose `model.byteSize` is
  1,200,000 bytes
- **THEN** the window counts the PDF as 27,962,028 base64 bytes and the image as 1,600,000, before
  loading either
- **AND** the PDF is sent as a PDF and the image reaches the model as the limit placeholder

### Requirement: Only attachable references count toward the window

An attachable reference SHALL be one of a kind the request's model declares as input, `image` for an
image and `pdf` for a PDF: an owner file part, a `media://` tool result, or a `media://` prompt-import
entry that resolves, an unstored image whose entry in the current attempt's memory records a
model-variant byte size, or an unstored PDF whose entry in the current attempt's memory records its
byte size, its bytes released or not. A not-retained, unavailable, or omitted reference SHALL NOT
count toward any bound of the epoch image window.

#### Scenario: A not-retained read does not count

- **WHEN** a vision-model epoch carries 99 attached owner attachments and a `read` image from an
  earlier turn, and the owner sends a message attaching one more image
- **THEN** all 100 owner attachments are sent as images
- **AND** the earlier read reaches the model as the not-retained placeholder

#### Scenario: A not-retained PDF read does not count

- **WHEN** an epoch on a model that declares `pdf` input carries an 80-page PDF `read` from an earlier
  turn, and the owner sends a message attaching a stored 80-page PDF
- **THEN** the owner's PDF is sent as a PDF
- **AND** the earlier read reaches the model as the not-retained placeholder

#### Scenario: A PDF on a model without PDF input does not count

- **WHEN** an epoch on a model that declares `image` but not `pdf` input carries a stored 80-page
  PDF and 99 attached owner image attachments, and the owner sends a message attaching one more
  image
- **THEN** all 100 owner images are sent as images
- **AND** the PDF reaches the model as the omitted placeholder

### Requirement: Adding an image never changes an earlier attachment

Because admission is append-only within an epoch, adding a turn, a step, or an image reference SHALL
NOT change whether an earlier reference in that epoch is attached, so the request prefix stays
unchanged for prompt caching. The attached set SHALL NOT depend on which vision model the request
targets among models that declare the same `image` and `pdf` input.

#### Scenario: Adding an image never changes an earlier image's attachment

- **WHEN** a vision-model request's epoch carries 100 attached owner attachments and the next turn
  attaches one more image
- **THEN** the next request sends the same 100 references as images in the same positions
- **AND** only the new reference reaches the model as the limit placeholder

#### Scenario: Switching between vision models keeps the attached set

- **WHEN** a turn switches from one vision model to another that declares the same `image` and `pdf`
  input within the same epoch
- **THEN** the new model's request attaches exactly the references the same turn's request would
  attach on the previous model
- **AND** every reference beyond the epoch's bounds keeps the limit placeholder

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

Before a Run's first model step, a prepared request SHALL count as reaching its compaction threshold
when it carries an image or PDF reference that the epoch image window does not attach because its
epoch's bounds are reached and a stored image or PDF reference in a row before the triggering user
message. It SHALL trigger the compaction variant that `model-system-prompts` selects for it. The new
epoch SHALL admit images and PDFs oldest first again. A Run SHALL NOT compact after its first model
step. When PDF overflow is the only trigger condition, a failed compaction SHALL leave the Run to
proceed as image overflow does.

#### Scenario: Image overflow triggers compaction at the next Run

- **WHEN** a vision-model chat's epoch carries 100 attached owner attachments in earlier turns, the
  request fits the model's window, and the owner sends a message attaching one more image
- **THEN** the threshold-triggered compaction runs on the Run's own model before its first model
  step
- **AND** the Run's request admits the triggering message's image under the new epoch and sends it as
  an image

#### Scenario: Overflow in the triggering message alone does not compact

- **WHEN** a vision-model chat's epoch carries no image or PDF before the triggering user message
  and that message attaches 10 images whose 5 MiB base64 model variants exceed the byte bound
- **THEN** no compaction runs
- **AND** the five oldest images are sent as images and the rest reach the model as the limit
  placeholder

#### Scenario: An image read beyond the bounds inside a Run does not compact

- **WHEN** a Run on a vision model reads an image after its epoch's bounds are reached
- **THEN** that `read` result reaches the next step as the limit placeholder
- **AND** no compaction runs before the Run ends, and the next turn carries that result as the
  not-retained placeholder without counting it

#### Scenario: PDF overflow triggers compaction at the next Run

- **WHEN** a chat on a model that declares `pdf` input carries a stored 80-page PDF attached in an
  earlier turn of its epoch, the request fits the model's window, and the owner sends a message
  attaching a stored 30-page PDF
- **THEN** the threshold-triggered compaction runs on the Run's own model before its first model
  step
- **AND** the Run's request admits the 30-page PDF under the new epoch and sends it as a PDF

#### Scenario: A failed PDF overflow compaction does not fail the Run

- **WHEN** a Run's only trigger condition is PDF overflow and its summarization call throws
- **THEN** the Run proceeds without a checkpoint and the overflowing PDFs reach the model as the PDF
  limit placeholder

### Requirement: Unresolvable media references never fail a request

A `media://` reference the chat owner's store cannot resolve, because the id is unknown or belongs
to another owner, SHALL reach the model in its position as `[pdf media://<id> unavailable]` when it
is a PDF, which a file part shows by its stored `mediaType` `application/pdf`, a prompt-import entry
by its `pdf` kind, and a `read` result by its `pdf` kind, and as `[image media://<id> unavailable]`
otherwise. It SHALL NOT count toward the epoch's bounds, SHALL NOT fail the request, and SHALL put no
bytes or descriptor field of any object into the request.

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

### Requirement: Chat Completions wires carry tool-result images in a following user message

On `openai-completions` and `opencode-go`, a tool message SHALL NOT carry image or PDF content. A
tool result whose image or PDF is attached SHALL keep only its text envelope in the tool message, or,
when that envelope would be empty, a line saying the file follows in the next message; any other
keeps its placeholder. The images and PDFs of consecutive tool messages SHALL follow them in one user
message starting `Files from tool results:`, in tool-result order. Other wires keep images and PDFs
inside the tool output.

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
