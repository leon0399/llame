---
summary: "Media store: owner images and PDFs in Postgres, ingest bounds, PDF parsing bounds, upload and fetch routes, message file parts, models[].input, the media window, sharp, growth, and the no-deletion gap"
read_when:
  - you are deploying a release that ships the media store or building its production image
  - you are sizing the database or backups for stored images
  - you are declaring which models accept images or PDFs
  - you are troubleshooting an image or PDF upload or fetch
  - you are sending images or PDFs in a chat message through the API
---

# Media store

The media store keeps images and PDFs that chat owners upload. Each upload is
one media object owned by exactly one owner, addressed as `media://<id>`, and
kept in the same Postgres database as the rest of the application state. This
release ships the store, its upload and fetch routes, image and PDF
attachments on owner messages, the per-model input declaration, and image and
PDF reads through `read`: local, `kb://`, and `skill://` files are prepared
without storing them, with model bytes kept only in the reading Run attempt's
memory. `media://<id>` reads an uploaded image or PDF across turns; see
[media://](../reference/locators/media.md).

There is nothing to enable: the store has no configuration keys, and its bounds
are fixed by the application. Models opt into receiving images and PDFs with
[`models[].input`](#model-input).

## Storage

Two tenant tables hold the store:

- `media_objects`: one row per object with its id, owner, detected format,
  original byte size, the SHA-256 digest of the original, a source label, and
  creation time. An image row also has the original's dimensions and the
  model variant's format, byte size, and dimensions; a PDF row has its page
  count instead. A check constraint enforces one shape or the other.
- `media_blobs`: one `bytea` row per `(media_id, variant)`, for the `original`
  and `model` variants. A PDF has only `original`.

Both tables have row-level security enabled and forced against the
authenticated owner, like every tenant table, so a query without an owner
identity sees nothing and one owner can never read or write another owner's
rows. The metadata row and both blobs are written in one transaction; a failed
ingest leaves no partial object.

The store lives in Postgres because API and worker processes share only the
database (see [horizontal scaling](scaling.md)). A local uploads directory
would need a new shared mount and move isolation from the datastore into path
checks; object storage would add required infrastructure for every
deployment. Keeping metadata and bytes in separate tables lets a later move to
object storage replace only `media_blobs` rows.

The migrations add both tables, then make the image-only columns nullable and
add `page_count` and the shape check; they touch no other table. Apply them
with `pnpm db:migrate` as for any release; no `db:provision-rls` change is
needed.

### Growth and backups

Every image costs its original, up to 20 MiB, plus its model variant, up to
3.75 MiB, in `media_blobs`; a PDF costs only its original, up to 20 MiB. Image
and PDF formats are mostly compressed already, so Postgres TOAST compression
saves little. `pg_dump` output, base backups, and WAL volume grow by the same
amount, and so do restore times. Watch the table with:

```sql
SELECT pg_size_pretty(pg_total_relation_size('media_blobs'));
```

Identical bytes uploaded again by the same owner reuse the existing object, so
re-pasting a screenshot costs nothing. Deduplication never crosses owners: two
owners uploading the same image store two objects.

## Ingest bounds

Every image and PDF passes one ingest path. The bounds below are code
constants, not configuration.

| Check        | Bound                                                                        | Refusal                  |
| ------------ | ---------------------------------------------------------------------------- | ------------------------ |
| Byte size    | at most 20 MiB, checked before decoding or parsing                           | `media_too_large`        |
| Dimensions   | an image: at most 40 megapixels, read from the header before decode          | `media_too_large`        |
| Pages        | a PDF: at most 100 pages, counted by parsing                                 | `media_too_large`        |
| Format       | PNG, JPEG, GIF, WebP, or PDF (`%PDF-`), detected by magic bytes              | `unsupported_media_type` |
| Decodability | an image must decode fully; a PDF must open, have a page, and be unencrypted | `unsupported_media_type` |

Size the API and worker memory for concurrent ingests, not upload bytes. A
40-megapixel image can upload as about 2 MiB but decodes to roughly 120–160 MB
of pixel buffers while its model variant is built, on top of the up to 20 MiB
the upload route holds for the request. Memory returns after each ingest, but
the request rate limit does not bound how many ingests run at once.

The filename, extension, and declared Content-Type never decide the format: a
JPEG named `notes.txt` is stored as `image/jpeg`, a PDF named `scan.png` as
`application/pdf`, and HTML named `shot.png` or `report.pdf` is refused. SVG
is refused. A refused input stores nothing.

The original is stored byte for byte, embedded metadata such as EXIF GPS
included, because only its owner can fetch it.

### PDFs

A PDF is refused as `unsupported_media_type` when it does not open (a user
password included), reports no pages, or is encrypted. It counts as encrypted
when it reports any permissions or when the bytes `/Encrypt` occur anywhere in
the file, so an owner-password PDF that opens without a password is refused
too. The scan has a deliberate false positive: an unencrypted PDF that carries
the text `/Encrypt` uncompressed, such as a document about PDF encryption, is
refused as well. So is a PDF whose parse exceeds a bound in
[PDF parsing](#pdf-parsing).

Ingest stores only a PDF's original and builds no model variant: an attached
PDF reaches a model as its original (see [PDF attachments](#pdf-attachments)).
`read` also returns a stored PDF from its `media://` locator; unstored PDF
reads retain bytes only in the reading attempt. See
[PDF reads](../reference/tools/read.md#pdf-result).

### Model variant

Ingest also builds the model variant of an image, the only form of an image
that will be sent to a model provider:

1. Apply the EXIF orientation and strip all embedded metadata.
2. Keep only the first frame of an animated GIF or WebP.
3. Scale so the long edge is at most 2,000 px, never upscaling.
4. Encode PNG. If that exceeds 3.75 MiB, encode JPEG at quality 85. If that
   still exceeds 3.75 MiB, scale down by 0.75 and re-encode JPEG until it
   fits.

### Source labels

Each object keeps a single-line source label: the upload filename. Control
characters become spaces, `[` and `]` become `(` and `)`, reserved delimiters
are neutralized, and the label is cut to 256 UTF-16 code units.

## Routes

All routes authenticate with the owner session cookie used by every other
owner route, so a same-site `<img>` element can load the byte routes. An
unauthenticated request is `401`. Another owner's id, an unknown id, and an id
that is not a canonical UUID all return the same `404`.

| Route                            | Returns                                  |
| -------------------------------- | ---------------------------------------- |
| `POST /api/v1/media`             | the descriptor of the uploaded object    |
| `GET /api/v1/media/:id`          | the descriptor                           |
| `GET /api/v1/media/:id/original` | the original bytes, unchanged            |
| `GET /api/v1/media/:id/model`    | the model variant bytes; `404` for a PDF |

The web client loads every chat thumbnail from `/model` and a lightbox image
from `/original`; it does not show PDF attachments yet. What the owner sees is
described under [`media://` behavior](../reference/locators/media.md#behavior).

### Upload

`POST /api/v1/media` takes a `multipart/form-data` body with exactly one file
in the `file` field:

```sh
curl -b "$SESSION_COOKIE" -F file=@screenshot.png https://llame.example/api/v1/media
```

It returns `201` with the descriptor for a new object and `200` with the
existing descriptor when the owner already stored the same bytes; the reused
object keeps its first name. No file or more than one file is `400`. The JSON
body limit of other routes is unchanged. Refusals carry a `code` and a
`message` naming what was detected:

| Refusal                                            | Status | `code`                   | `message`                                           |
| -------------------------------------------------- | ------ | ------------------------ | --------------------------------------------------- |
| a file over 20 MiB, before its type is detected    | `413`  | `media_too_large`        | `File exceeds 20 MiB`                               |
| an image over 40 megapixels                        | `413`  | `media_too_large`        | `Image exceeds 20 MiB or 40 megapixels`             |
| a PDF over 100 pages                               | `413`  | `media_too_large`        | `PDF exceeds 20 MiB or 100 pages`                   |
| an unsupported format or an undecodable image      | `415`  | `unsupported_media_type` | `Only PNG, JPEG, GIF, and WebP images are accepted` |
| an unopenable, encrypted, or page-less PDF         | `415`  | `unsupported_media_type` | `Only unencrypted PDFs that open are accepted`      |
| a PDF on a host that cannot apply the parse bounds | `415`  | `unsupported_media_type` | `PDF parsing is unavailable on this server`         |

The image descriptor has exactly `id`, `locator`, `mediaType`, `name`,
`width`, `height`, `byteSize`, and `model`, an object with the model variant's
`mediaType`, `width`, `height`, and `byteSize`. The PDF descriptor has exactly
`id`, `locator`, `mediaType` (`application/pdf`), `name`, `byteSize`, and
`pages`. Top-level fields describe the original. Neither exposes an owner
identifier or a digest.

### Fetch

The byte routes send the stored `Content-Type` with:

- `X-Content-Type-Options: nosniff`
- `Content-Disposition: inline`
- `Content-Security-Policy: sandbox`
- `Cache-Control: private, no-cache`
- a strong `ETag` derived from the original's SHA-256 digest and the variant

Bytes under an id never change. `no-cache` makes the browser revalidate every
reuse against the authenticated route, which checks the session and ownership
before it compares `If-None-Match` and answers `304` without a body. A browser
profile shared by two owners therefore never serves one owner's cached image
to the other. Proxies and CDNs in front of the API must not cache these
responses for other users; `private` already forbids shared caching.

`/model` of a PDF returns the same `404` as an unknown id, whatever its
`If-None-Match`, because a PDF has no model variant.

Browsers' built-in PDF viewers ignore `Content-Security-Policy`: Chromium
strips it from every `application/pdf` response before its viewer loads. For a
PDF, `sandbox` is therefore not a control. Chromium and Firefox render PDF bytes
in a viewer page, not as HTML, so a PDF cannot run script in the API origin,
but its links and actions still navigate as the signed-in owner. Only the owner
can fetch a PDF's bytes, so this exposes owners to PDFs they uploaded
themselves; treat an untrusted PDF the way you would any downloaded file.

## `media://` locators

A media locator is `media://` followed by the object id as a lower-case
canonical UUID, for example
`media://0192a5c4-7b1e-7c3d-9f00-1a2b3c4d5e6f`. Ids are UUIDv7. Upper-case hex
digits and bare `media://` do not resolve. A locator resolves only for the
owner who owns the object; for anyone else it is indistinguishable from an id
that does not exist.

## Message attachments

An owner message sent to `POST /api/v1/chats/:id/messages` may carry, beside
its text parts, up to 10 `file` parts that each reference an uploaded image or
PDF:

```json
{
  "modelId": "vision-model",
  "message": {
    "id": "0192a5c4-7b1e-7c3d-9f00-1a2b3c4d5e70",
    "parts": [
      {
        "type": "file",
        "mediaType": "image/png",
        "url": "media://0192a5c4-7b1e-7c3d-9f00-1a2b3c4d5e6f",
        "filename": "shot.png"
      },
      { "type": "text", "text": "What does this error mean?" }
    ]
  }
}
```

- A message needs at least one text part or one file part, so a message
  carrying only attachments is accepted. Text parts keep their bounds: at most
  50, each nonblank and at most 20,000 characters.
- `url` must be a [`media://` locator](#media-locators). A `data:` URL, an
  `http(s)` URL, bare `media://`, or 11 or more file parts reject the whole
  message with `400`.
- Every id must belong to the sender. The check runs under the sender's own
  identity before anything is written; an id owned by another owner and an id
  that does not exist both get the same `400`, and nothing is stored.
- The stored part's `mediaType` is the original's detected format and its
  `filename` is the object's stored name, whatever the client sent, so a PDF
  part is always stored as `application/pdf`. File parts are stored in the
  order they were sent.

Each message's attachments reach the model after its context items and before
its text, as described under [model input](#model-input). Owner forks copy
file parts unchanged and reference the same objects.

## Model input

`models[].input` declares the input modalities a model accepts:

```jsonc
{
  "id": "vision-model",
  // ...
  "input": ["text", "image", "pdf"],
}
```

Items come from the closed set `text`, `image`, and `pdf`. The list must
contain `text` and must not repeat an item; an absent `input` means
`["text"]`. An item outside the set, a list without `text`, or a repeated item
fails startup naming the model id and the field. llame does not check the
declaration against the provider: a model declared with `image` that rejects
images, or with `pdf` that rejects PDFs, fails the Run that sends it one with
the provider's error. `GET /api/v1/models` publishes the resolved `input` on
every entry, so clients can tell which models accept images and PDFs.

Every model request is composed from the stored `media://` references:

- A model that declares `image` receives each attached image as its model
  variant. An image attached to a user message follows that message's context
  items and comes before its text, labelled `Image n (media://<id>):`, where
  `n` counts the message's images from 1.
- Any other model receives
  `[image media://<id> <name> <width>×<height>, omitted: this model has no image input]`
  in the image's place, with the original's dimensions.
- A reference the chat owner's store cannot resolve, because the id is unknown
  or belongs to another owner, becomes `[image media://<id> unavailable]`, or
  `[pdf media://<id> unavailable]` for a PDF file part, and never fails the
  request.

### PDF attachments

A model that declares `pdf` receives each attached PDF as its original, read
from storage when the request is composed. In a user message the PDF takes its
file part's place among the attachments, labelled `PDF n (media://<id>):`,
where `n` counts the message's PDFs from 1 separately from its images: one
message reads `Image 1`, `PDF 1`, `Image 2`. The PDF is a file part with media
type `application/pdf` and the stored name as its filename.

Any other model receives
`[pdf media://<id> <name> <P> pages, omitted: this model has no PDF input]` in
the PDF's place, after its label, where `<P>` is the original's page count. A
PDF never reaches a model as text or as an image.

Each wire sends the original as base64 in its native document content:

| Provider `type`                     | PDF content                                 |
| ----------------------------------- | ------------------------------------------- |
| `openai-responses`                  | an `input_file` item with filename and data |
| `openai-completions`, `opencode-go` | a `file` part with filename and data        |
| `anthropic-messages`                | a `document` block                          |
| `openai-codex`                      | an `input_file` item with filename and data |

Declare `pdf` only on models whose provider accepts PDFs; a provider that
does not refuses the request with its own error. The ChatGPT Codex backend
behind `openai-codex` accepts `input_file`: a 15-page PDF sent to
`gpt-6.1-sol` was answered with its page count (checked 2026-10-14).

### Media window

Within one compaction epoch, the rows after the active checkpoint plus the
current attempt, images and PDFs are attached oldest first, in one order,
while three bounds hold together:

- at most 100 images;
- at most 28 MiB (29,360,128 bytes) of base64, summing image model variants
  and PDF originals; a 20 MiB PDF is 27,962,028 bytes of base64;
- at most the smaller of 100 PDF pages and
  `floor(max(0, contextWindowTokens × 0.8 − reserve) / 3,000)` pages, where
  `contextWindowTokens` is the request's model's and `reserve` is the output
  reserve `runs.maxOutputTokens` (0 when unset). With no reserve that is 53
  pages on a 200,000-token model, 34 on 128,000, and 100 from 375,000 up.

The page bound alone depends on configuration. Only a reference whose
kind the request's model declares counts: an image on a model without `image`
input and a PDF on a model without `pdf` input take the omitted placeholder
and consume no budget. The first reference past any bound, and every newer one
in that epoch, reaches the model as
`[image media://<id> <name> <width>×<height>, not attached: this context's image limit is reached]`
or `[pdf media://<id> <name> <P> pages, not attached: this context's PDF limit is reached]`.
Attachment never changes for an earlier reference, so the request prefix
stays stable for provider prompt caching.

Before a Run's first step, unattached images or PDFs count as reaching the
compaction threshold when an earlier message carries a stored reference of a
kind the model declares. The summary keeps the locator of every image or PDF
it mentions, `media://` or the path or URL it was read from, and the new epoch
attaches media again from the start. A failed compaction never fails the Run;
the placeholders stay until a later compaction succeeds.

Admission and compaction estimates leave image and PDF bytes out. Each image
is charged `ceil(width × height / 750)` tokens on its model variant's
dimensions, so a 2000×1125 variant counts as 3,000 tokens, and each attached
PDF 3,000 tokens per page, so a 15-page PDF counts as 45,000 tokens. Because
the page bound leaves 20% of the window and the output reserve free, attached
PDFs alone never make a request too large for its model.

### Text-only views

`conversation_read` follows a message's text with one line per attachment,
`[image media://<id> <name>]` for an image and `[pdf media://<id> <name>]`
for a PDF, and title generation receives the same lines after the turn's
text. Both read the stored filename and media type from the message alone,
without a media lookup. Search indexes no image or PDF data. Public shares
and shared forks carry only text parts: a shared fork drops a message whose
only content was attachments, and its new owner gains no access to the source
owner's media.

## `sharp` native dependency

Ingest decodes and encodes with `sharp`, which bundles prebuilt libvips
binaries. Linux builds exist for glibc (2.28 or later) and musl on x64 and
arm64; macOS and Windows builds also exist for development.

- Build the production image on a supported libc. A distroless or other base
  image without glibc or musl cannot load `sharp`, and every upload then fails.
- Install dependencies for the target platform. pnpm fetches only the host's
  prebuilt binary, so `node_modules` copied from a different OS, libc, or CPU
  architecture is missing the right one.

## PDF parsing

Ingest opens each PDF with `unpdf` (pdf.js) to count its pages and detect
encryption. The parse runs in a short-lived child process, at most two at
once per API or worker process, with others waiting for a slot. A child is
killed 10 s after it starts; a timeout, crash, or abnormal exit refuses the PDF
as `unsupported_media_type` without stopping the requesting process. The child
is the compiled `dist/media/pdf-parse-entry.js` the API build ships; a process
without that file refuses every PDF the same way and logs the missing artifact
at error level.

On Linux the child is started through `sh`, which applies two bounds before
`node` starts:

- an address-space limit of 2 GiB, or the host's hard limit when that is
  lower;
- `oom_score_adj` 1000, so the kernel prefers a parse child over the API or
  worker if the container runs out of memory. Under cgroup v2
  `memory.oom.group=1` the whole group dies instead.

The production image therefore needs `sh` and a writable
`/proc/self/oom_score_adj`. If either bound cannot be applied, or the hard
address-space limit is below 1.25 GiB (the child's start-up floor), no parser
starts: every PDF is refused with `PDF parsing is unavailable on this server`
and the requesting process logs the start failure, with the shell's stderr,
at error level. macOS and Windows development builds
start `node` directly and get only the time bound and the concurrency cap.

## Known gap: nothing deletes media

Media belongs to its owner, not to a chat or message, and this release ships
no way to delete it:

- deleting a chat deletes none of the media its messages reference, and an
  owner fork references the same objects instead of copying them;
- there is no delete route;
- an upload that no sent message references is kept.

An image or PDF uploaded by mistake, including one containing a secret, stays
stored and fetchable by its owner until a media library ships a delete action.
