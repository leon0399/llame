---
summary: "Media store: owner images in Postgres, ingest bounds, upload and fetch routes, message file parts, models[].input, sharp, growth, and the no-deletion gap"
read_when:
  - you are deploying a release that ships the media store or building its production image
  - you are sizing the database or backups for stored images
  - you are declaring which models accept images
  - you are troubleshooting an image upload or fetch
  - you are sending images in a chat message through the API
---

# Media store

The media store keeps images that chat owners upload. Each image is one media
object owned by exactly one owner, addressed as `media://<id>`, and kept in the
same Postgres database as the rest of the application state. This release
ships the store, its upload and fetch routes, image attachments on owner
messages, the per-model image input declaration, and image reads through
`read`: a local, `kb://`, or `skill://` image file is ingested with provenance
`read`, and `media://<id>` re-reads a stored image (see
[media://](../reference/locators/media.md)).

There is nothing to enable: the store has no configuration keys, and its bounds
are fixed by the application. Models opt into receiving images with
[`models[].input`](#model-image-input).

## Storage

Two tenant tables hold the store:

- `media_objects`: one row per image with its id, owner, detected format,
  original byte size and dimensions, the model variant's format, byte size,
  and dimensions, the SHA-256 digest of the original, provenance (`upload`,
  `read`, or `prompt-import`), a source label, and creation time.
- `media_blobs`: one `bytea` row per `(media_id, variant)`, for the `original`
  and `model` variants.

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

The migration adds both tables and touches no existing table. Apply it with
`pnpm db:migrate` as for any release; no `db:provision-rls` change is needed.

### Growth and backups

Every image costs its original, up to 20 MiB, plus its model variant, up to
3.75 MiB, in `media_blobs`. Image formats are already compressed, so Postgres
TOAST compression saves little. `pg_dump` output, base backups, and WAL volume
grow by the same amount, and so do restore times. Watch the table with:

```sql
SELECT pg_size_pretty(pg_total_relation_size('media_blobs'));
```

Identical bytes uploaded again by the same owner reuse the existing object, so
re-pasting a screenshot costs nothing. Deduplication never crosses owners: two
owners uploading the same image store two objects.

## Ingest bounds

Every image passes one ingest path. The bounds below are code constants, not
configuration.

| Check        | Bound                                                     | Refusal                  |
| ------------ | --------------------------------------------------------- | ------------------------ |
| Byte size    | at most 20 MiB, checked before decoding                   | `image_too_large`        |
| Dimensions   | at most 40 megapixels, read from the header before decode | `image_too_large`        |
| Format       | PNG, JPEG, GIF, or WebP, detected by magic bytes          | `unsupported_media_type` |
| Decodability | the image must decode fully                               | `unsupported_media_type` |

Size the API and worker memory for concurrent ingests, not upload bytes. A
40-megapixel image can upload as about 2 MiB but decodes to roughly 120–160 MB
of pixel buffers while its model variant is built, on top of the up to 20 MiB
the upload route holds for the request. Memory returns after each ingest, but
the request rate limit does not bound how many ingests run at once.

The filename, extension, and declared Content-Type never decide the format: a
JPEG named `notes.txt` is stored as `image/jpeg`, and HTML named `shot.png` is
refused. SVG is refused. A refused input stores nothing.

The original is stored byte for byte, embedded metadata such as EXIF GPS
included, because only its owner can fetch it.

### Model variant

Ingest also builds the model variant, the only form of an image that will be
sent to a model provider:

1. Apply the EXIF orientation and strip all embedded metadata.
2. Keep only the first frame of an animated GIF or WebP.
3. Scale so the long edge is at most 2,000 px, never upscaling.
4. Encode PNG. If that exceeds 3.75 MiB, encode JPEG at quality 85. If that
   still exceeds 3.75 MiB, scale down by 0.75 and re-encode JPEG until it
   fits.

### Source labels

Each object keeps a single-line source label: the upload filename, or the
locator an image was read from. Control characters become spaces, `[` and `]`
become `(` and `)`, reserved delimiters are neutralized, and the label is cut
to 256 UTF-16 code units. A web locator keeps only its scheme, host, port, and
path, so URL credentials, query tokens, and fragments are never stored.

## Routes

All routes authenticate with the owner session cookie used by every other
owner route, so a same-site `<img>` element can load the byte routes. An
unauthenticated request is `401`. Another owner's id, an unknown id, and an id
that is not a canonical UUID all return the same `404`.

| Route                            | Returns                              |
| -------------------------------- | ------------------------------------ |
| `POST /api/v1/media`             | the descriptor of the uploaded image |
| `GET /api/v1/media/:id`          | the descriptor                       |
| `GET /api/v1/media/:id/original` | the original bytes, unchanged        |
| `GET /api/v1/media/:id/model`    | the model variant bytes              |

The web client loads every chat thumbnail (an owner attachment, a `read` image
result in its tool card, a prompt-import image) from `/model`. Activating a
thumbnail opens a lightbox over every image of the loaded transcript in
transcript order (only the unsent images when opened from the composer). Each
slide's sizes, formats, provenance, and locator come from
`GET /api/v1/media/:id`, and a toggle switches the shown image between
`/model` and `/original`.

### Upload

`POST /api/v1/media` takes a `multipart/form-data` body with exactly one file
in the `file` field:

```sh
curl -b "$SESSION_COOKIE" -F file=@screenshot.png https://llame.example/api/v1/media
```

It returns `201` with the descriptor for a new object and `200` with the
existing descriptor when the owner already stored the same bytes; the reused
object keeps its first provenance and name. No file or more than one file is
`400`. An unsupported or undecodable image is `415` with `code`
`unsupported_media_type`; a file over 20 MiB or 40 megapixels is `413` with
`code` `image_too_large`, whether the upload limit or ingest detects it. The
JSON body limit of other routes is unchanged.

The descriptor has exactly `id`, `locator`, `provenance`, `mediaType`, `name`,
`width`, `height`, `byteSize`, and `model`, an object with the model variant's
`mediaType`, `width`, `height`, and `byteSize`. Top-level fields describe the
original. It exposes no owner identifier and no digest.

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

## `media://` locators

A media locator is `media://` followed by the object id as a lower-case
canonical UUID, for example
`media://0192a5c4-7b1e-7c3d-9f00-1a2b3c4d5e6f`. Ids are UUIDv7. Upper-case hex
digits and bare `media://` do not resolve. A locator resolves only for the
owner who owns the object; for anyone else it is indistinguishable from an id
that does not exist.

## Message attachments

An owner message sent to `POST /api/v1/chats/:id/messages` may carry, beside
its text parts, up to 10 `file` parts that each reference an uploaded image:

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
  carrying only images is accepted. Text parts keep their bounds: at most 50,
  each nonblank and at most 20,000 characters.
- `url` must be a [`media://` locator](#media-locators). A `data:` URL, an
  `http(s)` URL, bare `media://`, or 11 or more file parts reject the whole
  message with `400`.
- Every id must belong to the sender. The check runs under the sender's own
  identity before anything is written; an id owned by another owner and an id
  that does not exist both get the same `400`, and nothing is stored.
- The stored part's `mediaType` is the original's detected format and its
  `filename` is the object's stored name, whatever the client sent. File parts
  are stored in the order they were sent.

Each message's images reach the model after its context items and before its
text, as described under [model image input](#model-image-input). Owner forks
copy file parts unchanged and reference the same objects.

## Model image input

`models[].input` declares the input modalities a model accepts:

```jsonc
{
  "id": "vision-model",
  // ...
  "input": ["text", "image"],
}
```

Items come from the closed set `text` and `image`. The list must contain
`text` and must not repeat an item; an absent `input` means `["text"]`. An
item outside the set, a list without `text`, or a repeated item fails startup
naming the model id and the field. llame does not check the declaration
against the provider: a model declared with `image` that rejects images fails
the Run that sends it one with the provider's error. `GET /api/v1/models`
publishes the resolved `input` on every entry, so clients can tell which
models accept images.

Every model request is composed from the stored `media://` references:

- A model that declares `image` receives each attached image as its model
  variant. An image attached to a user message follows that message's context
  items and comes before its text, labelled `Image n (media://<id>):`, where
  `n` counts the message's images from 1.
- Any other model receives
  `[image media://<id> <name> <width>×<height>, omitted: this model has no image input]`
  in the image's place, with the original's dimensions.
- A reference the chat owner's store cannot resolve, because the id is unknown
  or belongs to another owner, becomes `[image media://<id> unavailable]` and
  never fails the request.

### Image window

Within one compaction epoch, the rows after the active checkpoint plus the
current attempt, images are attached oldest first while two bounds hold: at
most 100 images and at most 24 MiB of base64 model variants. Both are code
constants. The first image past either bound, and every newer one in that
epoch, reaches the model as
`[image media://<id> <name> <width>×<height>, not attached: this context's image limit is reached]`.
Attachment never changes for an earlier image, so the request prefix stays
stable for provider prompt caching.

Before a Run's first step, unattached images on a vision model count as
reaching the compaction threshold when an earlier message carries an image.
The summary keeps the `media://` locator of every image it mentions, and the
new epoch attaches images again from the start. A failed compaction never
fails the Run; the placeholders stay until a later compaction succeeds.

Admission and compaction estimates leave image bytes out and charge each image
`ceil(width × height / 750)` tokens on its model variant's dimensions, so a
2000×1125 variant counts as 3,000 tokens.

### Text-only views

`conversation_read` follows a message's text with one
`[image media://<id> <name> <width>×<height>]` line per attached image. Search
indexes no image data. Public shares and shared forks carry only text parts:
a shared fork drops a message whose only content was images, and its new owner
gains no access to the source owner's media.

## `sharp` native dependency

Ingest decodes and encodes with `sharp`, which bundles prebuilt libvips
binaries. Linux builds exist for glibc (2.28 or later) and musl on x64 and
arm64; macOS and Windows builds also exist for development.

- Build the production image on a supported libc. A distroless or other base
  image without glibc or musl cannot load `sharp`, and every upload then fails.
- Install dependencies for the target platform. pnpm fetches only the host's
  prebuilt binary, so `node_modules` copied from a different OS, libc, or CPU
  architecture is missing the right one.

## Known gap: nothing deletes media

Media belongs to its owner, not to a chat or message, and this release ships
no way to delete it:

- deleting a chat deletes none of the media its messages reference, and an
  owner fork references the same objects instead of copying them;
- there is no delete route;
- an upload that no sent message references is kept.

An image pasted by mistake, including one containing a secret, stays stored
and fetchable by its owner until a media library ships a delete action.
