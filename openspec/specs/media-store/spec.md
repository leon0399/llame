# media-store Specification

## Purpose

Defines the owner-owned media store of uploaded images and PDFs: each image has original and model
variants, and each PDF has only its original. Image preparation (formats, bounds, and the model
variant) and PDF validation are shared with unstored reads. It also defines per-owner deduplication,
the upload and fetch routes, the `media://` locator grammar and owner-only resolution, retention
without deletion, and datastore-enforced tenant isolation.

## Requirements

### Requirement: A media object contains owner-owned metadata and media-type-specific byte variants

Every stored image or PDF SHALL be one media object owned by exactly one owner, taken only from the
authenticated request context, and only an owner upload SHALL create one. It SHALL carry a UUIDv7
`id`, the original's detected format and byte size, the original's SHA-256 digest, a source label,
and its creation time, and no provenance, and SHALL keep its byte variants apart from the
metadata.

#### Scenario: An ingested image has both variants

- **WHEN** an owner uploads a valid 800×600 PNG
- **THEN** one media object exists with its digest, its source label, and both the `original` and
  `model` byte variants
- **AND** its original is recorded as `image/png`, 800×600

#### Scenario: An ingested PDF has only its original

- **WHEN** an owner uploads a valid, unencrypted 15-page PDF
- **THEN** one media object exists with its digest, its source label, and only the `original` byte
  variant
- **AND** its original is recorded as `application/pdf` with 15 pages and no dimensions

#### Scenario: A client cannot choose the owner

- **WHEN** an upload request carries an owner identifier field
- **THEN** the object, if created, is owned by the authenticated caller only

#### Scenario: An image object carries its variant fields

- **WHEN** any owner upload creates an image object
- **THEN** the object carries the original's dimensions and the model variant's format, byte size,
  and dimensions
- **AND** it keeps both its `original` and `model` byte variants

#### Scenario: A PDF object's fields are closed

- **WHEN** any owner upload creates a PDF object
- **THEN** the object carries its page count, between 1 and 100
- **AND** it carries no dimensions and no model variant
- **AND** it keeps only its `original` bytes

### Requirement: The media descriptor is a closed shape

The media descriptor SHALL take one of two closed shapes, chosen by `mediaType`, with its top-level
fields describing the original, and neither shape SHALL expose an owner identifier, a digest, or
provenance.

#### Scenario: Descriptor fields are closed

- **WHEN** an owner requests the descriptor of an owned 800×600 PNG
- **THEN** the response contains exactly the descriptor fields, with `mediaType` `image/png`,
  `width` 800, and `height` 600
- **AND** it contains no owner identifier, no SHA-256 digest, and no provenance

#### Scenario: PDF descriptor fields are closed

- **WHEN** an owner requests the descriptor of an owned 15-page PDF
- **THEN** the response contains exactly `id`, `locator`, `mediaType` `application/pdf`, `name`,
  `byteSize`, and `pages` 15
- **AND** it contains no `width`, no `height`, no `model`, no owner identifier, no SHA-256 digest,
  and no provenance

#### Scenario: An image descriptor's fields are exactly its closed set

- **WHEN** any owner request returns the descriptor of an image object
- **THEN** it contains exactly `id`, `locator` (`media://<id>`), `mediaType`, `name` (the source
  label), `width`, `height`, `byteSize`, and `model`
- **AND** its `model` object contains exactly `mediaType`, `width`, `height`, and `byteSize`

#### Scenario: A PDF descriptor's fields are exactly its closed set

- **WHEN** any owner request returns the descriptor of a PDF object
- **THEN** it contains exactly `id`, `locator` (`media://<id>`), `mediaType` (`application/pdf`),
  `name` (the source label), `byteSize`, and `pages`

### Requirement: Source labels are single-line and bounded

The source label SHALL be the uploaded filename. Before it is stored, every control character, CR
and LF included, SHALL become a space, then `[` and `]` SHALL become `(` and `)`, then the
reserved-delimiter rules the `instance-config` capability defines SHALL neutralize it, and it SHALL
be cut to at most 256 UTF-16 code units at a code-point boundary, so every stored label is a single
line. Image placeholders name a stored object by this label.

#### Scenario: A long source label is cut

- **WHEN** an owner uploads an image whose filename is 400 characters long
- **THEN** the stored `name` is at most 256 UTF-16 code units and ends on a code-point boundary

#### Scenario: A source label cannot forge a delimiter

- **WHEN** an uploaded filename contains a reserved delimiter in tag form
- **THEN** the stored `name` carries it neutralized

#### Scenario: A filename with a newline is stored on one line

- **WHEN** an owner uploads an image whose filename is `shot` followed by LF and
  `[image media://x evil.png 1×1].png`
- **THEN** the stored `name` is the single line `shot (image media://x evil.png 1×1).png`
- **AND** a placeholder built from it is one line and contains no forged `[image` placeholder

### Requirement: Ingest detects PNG, JPEG, GIF, and WebP by magic bytes

Ingest SHALL be the single path by which an owner upload creates a media object. It SHALL decide the
format only from the leading magic bytes and accept PNG (`image/png`), JPEG (`image/jpeg`), GIF
(`image/gif`), WebP (`image/webp`), and PDF (`application/pdf`, bytes starting `%PDF-`). Every other
input, SVG and HTML included, SHALL be refused as `unsupported_media_type`. A declared filename,
extension, or Content-Type SHALL NOT decide or override the format.

#### Scenario: SVG is refused

- **WHEN** an owner ingests an SVG document
- **THEN** ingest refuses it as `unsupported_media_type`

#### Scenario: HTML renamed to PNG is refused

- **WHEN** an owner uploads an HTML file named `shot.png` declared as `image/png`
- **THEN** ingest refuses it as `unsupported_media_type`

#### Scenario: Declared type does not override magic bytes

- **WHEN** an owner uploads a valid JPEG named `notes.txt` declared as `text/plain`
- **THEN** the object is stored with `mediaType` `image/jpeg`

#### Scenario: A PDF is detected by its magic bytes

- **WHEN** an owner uploads a valid, unencrypted PDF named `scan.png` declared as `image/png`
- **THEN** the object is stored with `mediaType` `application/pdf`

#### Scenario: HTML renamed to PDF is refused

- **WHEN** an owner uploads an HTML file named `report.pdf` declared as `application/pdf`
- **THEN** ingest refuses it as `unsupported_media_type`

### Requirement: A refused input stores nothing

An input whose magic bytes match an accepted format but which cannot be decoded SHALL be refused as
`unsupported_media_type`. Every refused input SHALL create no media object and store no bytes.

#### Scenario: Unsupported input leaves no object

- **WHEN** an owner ingests an SVG document
- **THEN** no media object and no bytes are stored

#### Scenario: Corrupt image with valid magic is refused

- **WHEN** an owner uploads a file that starts with the PNG signature and is truncated after the
  header
- **THEN** ingest refuses it as `unsupported_media_type` and stores nothing

### Requirement: Ingest bounds are enforced before full decode

Ingest SHALL refuse an input larger than 20 MiB before decoding or parsing it, read an image's
dimensions from its header and refuse an image above 40 megapixels before a full decode, and refuse
a PDF of more than 100 pages after parsing its structure. Every such refusal SHALL be
`media_too_large` and SHALL create no media object. These bounds SHALL be fixed by the application
and SHALL NOT be configurable.

#### Scenario: A 21 MiB file is refused

- **WHEN** an owner ingests a 21 MiB PNG
- **THEN** ingest refuses it as `media_too_large` without decoding it
- **AND** no media object is created

#### Scenario: A 41-megapixel image is refused before decode

- **WHEN** an owner ingests a small PNG whose header declares 41 megapixels
- **THEN** ingest refuses it as `media_too_large` with the message
  `Image exceeds 20 MiB or 40 megapixels` without decoding its pixel data

#### Scenario: An image at the bound is accepted

- **WHEN** an owner ingests a valid image of exactly 40 megapixels and at most 20 MiB
- **THEN** ingest stores it

#### Scenario: A 21 MiB PDF is refused before parsing

- **WHEN** an owner ingests a 21 MiB PDF
- **THEN** ingest refuses it as `media_too_large` without parsing it
- **AND** no media object is created

#### Scenario: A 101-page PDF is refused

- **WHEN** an owner ingests a valid, unencrypted 101-page PDF of 2 MiB
- **THEN** ingest refuses it as `media_too_large` with the message `PDF exceeds 20 MiB or 100 pages`
- **AND** no media object is created

#### Scenario: A PDF at the bounds is accepted

- **WHEN** an owner ingests a valid, unencrypted PDF of exactly 100 pages and at most 20 MiB
- **THEN** ingest stores it

#### Scenario: Every bound refusal is media_too_large and creates no media object

- **WHEN** any ingest input exceeds a bound and is refused
- **THEN** the refusal is `media_too_large` and no media object is created
- **AND** its message names what was detected: `Image exceeds 20 MiB or 40 megapixels` for an image
  over the byte or pixel bound, `PDF exceeds 20 MiB or 100 pages` for a PDF over the byte or page
  bound, and `File exceeds 20 MiB` for an input refused before its format is detected

### Requirement: The original is stored unchanged

Ingest SHALL store the original bytes exactly as received, including any embedded metadata. The
`/original` route SHALL return those bytes unchanged.

#### Scenario: Original bytes round-trip

- **WHEN** an owner uploads a JPEG carrying EXIF GPS metadata and fetches `/original`
- **THEN** the returned bytes are identical to the uploaded bytes, EXIF included

### Requirement: The model variant is normalized

Ingest SHALL build the model variant of an image from the original by applying the EXIF
orientation, removing all embedded metadata, taking the first frame of an animated GIF or WebP, and
scaling so the long edge is at most 2,000 px without upscaling. A PDF SHALL have no model variant:
ingest SHALL NOT build or store one, and the PDF's original is the bytes a model receives.

#### Scenario: Large image is scaled to the long-edge bound

- **WHEN** an owner ingests a 4000×1000 PNG
- **THEN** the model variant is 2000×500

#### Scenario: Small image is not upscaled

- **WHEN** an owner ingests a 300×200 PNG
- **THEN** the model variant is 300×200

#### Scenario: EXIF orientation is applied and metadata stripped

- **WHEN** an owner ingests a 1200×800 JPEG with EXIF orientation 6 and GPS metadata
- **THEN** the model variant is 800×1200
- **AND** the model variant carries no EXIF or other embedded metadata

#### Scenario: Animated image keeps its first frame

- **WHEN** an owner ingests an animated GIF
- **THEN** the model variant is a single still image of the first frame

#### Scenario: A PDF gets no model variant

- **WHEN** an owner ingests a valid, unencrypted PDF
- **THEN** no model variant is built or stored for it
- **AND** its stored `original` bytes are identical to the uploaded bytes

### Requirement: The model variant is PNG or JPEG of at most 3.75 MiB

Ingest SHALL encode the normalized model variant as PNG. When the PNG exceeds 3.75 MiB, it SHALL
encode JPEG at quality 85. When the JPEG still exceeds 3.75 MiB, it SHALL scale the image down by a
factor of 0.75 and re-encode JPEG, repeating until it fits.

#### Scenario: Small image stays PNG

- **WHEN** an owner ingests a 300×200 JPEG
- **THEN** the model variant is `image/png`

#### Scenario: Oversized PNG falls back to JPEG

- **WHEN** the PNG encoding of a 2000×2000 photographic image exceeds 3.75 MiB
- **THEN** the model variant is `image/jpeg` of at most 3.75 MiB

#### Scenario: Oversized JPEG is scaled down

- **WHEN** the quality-85 JPEG encoding of a model variant still exceeds 3.75 MiB
- **THEN** the stored model variant is smaller than 2,000 px on its long edge and at most 3.75 MiB

### Requirement: Image preparation is shared with unstored image reads

The magic-byte detection, the decode refusals, the byte and pixel bounds, and the model-variant
rules of this capability MUST form one image preparation. Ingest MUST apply it before it stores an
upload. A `read` or prompt import of an image that is not a `media://` locator MUST apply the same
preparation. It MUST create no media object, MUST write no bytes to the media store, and MUST give
no `media://` locator. Its stored part keeps the model variant as the retained bytes that
`media-attachments` defines.

#### Scenario: A read image is prepared like an upload and stored nowhere

- **WHEN** a Run reads a host file whose bytes are a 4000×1000 PNG
- **THEN** its model variant is 2000×500, as an upload of the same bytes makes it
- **AND** no media object exists for those bytes, and no `media://` locator names them

### Requirement: Ingest commits atomically

The metadata and the byte variants of a new object, both `original` and `model` for an image and
the `original` alone for a PDF, SHALL be written in one transaction, so a failure leaves no partial
object.

#### Scenario: Ingest failure leaves no partial object

- **WHEN** writing the model variant fails after the original was processed
- **THEN** no metadata and no byte variant of that object exist

#### Scenario: PDF ingest failure leaves no partial object

- **WHEN** writing a PDF's original bytes fails after its metadata was prepared
- **THEN** no metadata and no bytes of that object exist

### Requirement: Identical images deduplicate within one owner

When a new ingest's original SHA-256 digest matches an existing object of the same owner, ingest
SHALL return that object unchanged instead of creating another, so the same bytes yield the same
`media://` locator. At most one object SHALL exist per owner and digest, including under concurrent
ingests.

#### Scenario: Re-uploading the same bytes reuses the object

- **WHEN** an owner uploads the same PNG twice
- **THEN** both responses carry the same `id`
- **AND** the second response keeps the first object's `name`

#### Scenario: Concurrent identical ingests yield one object

- **WHEN** one owner ingests the same bytes in two concurrent requests
- **THEN** both return the same `id` and one object exists

### Requirement: Deduplication never crosses owners

An identical image ingested by another owner SHALL create that owner's own object, and no response
SHALL reveal that another owner holds the same bytes.

#### Scenario: Another owner's identical image is not reused

- **WHEN** owner A has uploaded a PNG and owner B uploads the same bytes
- **THEN** owner B receives a new `id` distinct from owner A's
- **AND** owner B's response is indistinguishable from a first upload of those bytes

### Requirement: Owners upload one image per request

`POST /api/v1/media` SHALL accept an authenticated `multipart/form-data` request carrying exactly
one file, ingest it with the filename as source label, and return the media
descriptor: `201 Created` when a new object was created, `200 OK` when an existing object was
reused. A request with no file or more than one file SHALL return `400`. An unauthenticated request
SHALL return `401` and store nothing.

#### Scenario: Upload returns the descriptor

- **WHEN** an authenticated owner posts one valid PNG
- **THEN** the API returns `201` with the descriptor, whose `locator` is `media://<id>`

#### Scenario: Two files are refused

- **WHEN** an owner posts a multipart body carrying two files
- **THEN** the API returns `400` and stores nothing

#### Scenario: Unauthenticated upload is refused

- **WHEN** a request without a session posts an image
- **THEN** the API returns `401` and no media object is created

### Requirement: Upload refusals and body limits

An `unsupported_media_type` refusal SHALL return `415` and a `media_too_large` refusal SHALL return
`413`, each carrying that error code and the refusal's message. The upload route SHALL bound the file
at the media store's byte bound and answer a file over it `413` with the same `media_too_large` body
shape as any ingest refusal, whichever layer detects the overflow. The JSON body limit of other
routes SHALL remain unchanged.

#### Scenario: Refusals map to HTTP statuses

- **WHEN** an owner posts an SVG, then a 21 MiB PNG
- **THEN** the first returns `415` with `unsupported_media_type`
- **AND** the second returns `413` with `media_too_large`, the same body shape an ingest refusal
  returns, and no media object is created

#### Scenario: An oversized PDF is refused before detection

- **WHEN** an owner posts a 25 MiB PDF and the route's byte bound refuses it before its format is
  detected
- **THEN** the API returns `413` with `media_too_large` and the message `File exceeds 20 MiB`
- **AND** no media object is created

#### Scenario: PDF refusals map to HTTP statuses

- **WHEN** an owner posts a valid 101-page PDF of 2 MiB, then an encrypted PDF
- **THEN** the first returns `413` with `media_too_large` and the message
  `PDF exceeds 20 MiB or 100 pages`
- **AND** the second returns `415` with `unsupported_media_type`, and no media object is created

#### Scenario: JSON body limit is unchanged

- **WHEN** a JSON request to another API route exceeds the existing JSON body limit
- **THEN** it is refused as before

#### Scenario: A file refused before detection carries the byte-bound message

- **WHEN** the upload route refuses any file before its format is detected
- **THEN** the refusal carries the message `File exceeds 20 MiB`

### Requirement: Owners fetch descriptors and bytes of their own media

`GET /api/v1/media/:id` SHALL return the descriptor of an owned object.
`GET /api/v1/media/:id/original` and `GET /api/v1/media/:id/model` SHALL return that variant's bytes
with `Content-Type` set to its stored media type and the closed safe header set. Because a PDF has no
model variant, `GET /api/v1/media/:id/model` of an owned PDF SHALL return the same `404` response as
an unknown id, whatever its `If-None-Match` header.

#### Scenario: Model bytes carry safe headers

- **WHEN** an owner fetches `/api/v1/media/<id>/model` for an owned PNG
- **THEN** the response carries the model variant's bytes and its stored `Content-Type`
- **AND** it carries `nosniff`, `inline`, `sandbox`, `Cache-Control: private, no-cache`, and a strong
  `ETag`

#### Scenario: PDF original bytes carry safe headers

- **WHEN** an owner fetches `/api/v1/media/<id>/original` for an owned PDF
- **THEN** the response carries the uploaded PDF bytes with `Content-Type: application/pdf`
- **AND** it carries `nosniff`, `inline`, `sandbox`, `Cache-Control: private, no-cache`, and a strong
  `ETag`

#### Scenario: A PDF has no model route

- **WHEN** an owner fetches `/api/v1/media/<id>/model` for an owned PDF, with or without an
  `If-None-Match` header carrying the ETag the route would derive for that variant
- **THEN** the API returns the same `404` response as for an unknown id, never `304`

#### Scenario: Any variant's bytes carry the closed safe header set

- **WHEN** any owner request returns the bytes of any variant of an owned object
- **THEN** the response carries `Content-Type` set to that variant's stored media type,
  `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`,
  `Content-Security-Policy: sandbox`, `Cache-Control: private, no-cache`, and a strong `ETag`
  derived from the object's SHA-256 digest and the variant name

#### Scenario: An object's bytes never change

- **WHEN** any owner fetches any variant of an owned object, at any later time and however many
  requests have intervened
- **THEN** the bytes returned for that id and variant are the same bytes as before

### Requirement: Cached media bytes revalidate against the authenticated route

Every reuse of a cached `/original` or `/model` response SHALL revalidate against the authenticated
route. The route SHALL authenticate and resolve ownership before it evaluates `If-None-Match`, and
SHALL return `304` without bytes only to the owner whose `If-None-Match` matches the variant's
`ETag`, so a browser profile shared by two owners never serves one owner's bytes to the other.

#### Scenario: A matching validator returns 304

- **WHEN** an owner refetches `/api/v1/media/<id>/model` with `If-None-Match` set to the `ETag` of
  an earlier response for that variant
- **THEN** the API returns `304` with no body

#### Scenario: A shared browser profile does not reuse another owner's bytes

- **WHEN** owner A loads `/api/v1/media/<id>/original` in a browser profile, and owner B then signs
  in to that profile and requests the same URL
- **THEN** the browser revalidates its cached entry against the API instead of reusing it
- **AND** owner B receives the same `404` response as for an unknown id and none of owner A's bytes

### Requirement: Owners list their own media newest first

`GET /api/v1/media` SHALL return one newest-first page of the authenticated owner's image and PDF
descriptors as `{ items, nextCursor }`, holding only objects created before the canonical media id
`before` when given. `limit` SHALL default to 48 and range from 1 to 100; an invalid `limit` or
`before` SHALL return `400`. `nextCursor` SHALL be the last item's id while older objects remain,
else `null`. Another owner's objects SHALL never appear in a page.

#### Scenario: Pages walk the owner's media newest first

- **WHEN** an owner with three objects lists with `limit=2`, then with `before` set to the returned
  `nextCursor`
- **THEN** the first page holds the two newest objects and a `nextCursor`
- **AND** the second page holds the oldest object and `nextCursor` is `null`

#### Scenario: Another owner's media never appears

- **WHEN** owner B stores an object after owner A's, and owner A lists
- **THEN** owner A's pages hold none of owner B's objects
- **AND** owner B's pages hold none of owner A's objects

### Requirement: Media routes admit only the authenticated owner

The media routes SHALL authenticate with the same session cookie as other owner routes, so a
same-site image element can load them. An unauthenticated request SHALL return `401`. Another
owner's id, an unknown id, and an id that is not a canonical UUID SHALL return the same `404`
response.

#### Scenario: Cookie-only request loads bytes

- **WHEN** a request carries only the owner's session cookie
- **THEN** `/original` returns the original bytes

#### Scenario: Unauthenticated fetch is refused

- **WHEN** a request without a session fetches a descriptor, `/original`, or `/model`
- **THEN** the API returns `401` and no bytes

#### Scenario: Another owner's id is indistinguishable from missing

- **WHEN** owner B fetches the descriptor, `/original`, or `/model` of owner A's object
- **THEN** each returns the same `404` response as for an unknown id
- **AND** no metadata or bytes are disclosed

### Requirement: `media://` locators have one canonical grammar

A media locator SHALL be `media://` followed by a lower-case canonical UUID
(`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` over `0-9a-f`) and nothing else, after a consumer has split
off any selector it supports. Bare `media://` SHALL be reserved and SHALL NOT resolve to any object
or listing. A locator that does not match the grammar, upper-case hex digits included, SHALL NOT
resolve.

#### Scenario: Bare scheme is reserved

- **WHEN** a consumer resolves `media://`
- **THEN** it is an invalid locator, not a listing

#### Scenario: Upper-case locator is invalid

- **WHEN** a consumer resolves an owned object's locator with its hex digits upper-cased
- **THEN** it is an invalid locator and does not resolve

### Requirement: `media://` locators resolve only the owner's media

Resolution SHALL use only the current owner's identity and SHALL return the object only when that
owner owns it. Another owner's id and an id that does not exist SHALL yield the same not-found
outcome.

#### Scenario: Canonical locator resolves for its owner

- **WHEN** owner A resolves `media://<id>` for an object A owns
- **THEN** resolution returns that object

#### Scenario: Another owner's locator is not found

- **WHEN** owner B resolves the locator of owner A's object
- **THEN** resolution yields the same not-found outcome as an id that does not exist

### Requirement: Media is retained without deletion

Media objects SHALL belong to their owner, not to a chat or message. Messages and forks SHALL
reference objects by id; a fork SHALL reference the same objects as its source and SHALL NOT copy
them. Deleting a chat SHALL NOT delete any media object. The API SHALL expose no operation that
deletes a media object, and an upload that no sent message references SHALL be retained.

#### Scenario: Chat deletion keeps media

- **WHEN** an owner deletes a chat whose messages reference a media object
- **THEN** the object's descriptor and both variants remain fetchable

#### Scenario: Fork references the same object

- **WHEN** an owner forks a chat whose message references `media://<id>`
- **THEN** the forked message references the same `media://<id>`
- **AND** no new media object is created

#### Scenario: No delete route

- **WHEN** an owner sends `DELETE /api/v1/media/<id>` for an owned object
- **THEN** the request does not delete it and the object remains fetchable

#### Scenario: Unsent upload is retained

- **WHEN** an owner uploads an image and never sends a message referencing it
- **THEN** the object remains fetchable by its owner

### Requirement: Media isolation is enforced in the datastore

Media metadata and bytes SHALL be stored in tenant-owned PostgreSQL state with row-level security
ENABLED and FORCED against the current authenticated owner, with explicit owner predicates kept as
defense-in-depth. A query without a current owner identity SHALL see and change nothing. Negative
isolation tests SHALL prove the datastore alone blocks cross-owner reads and writes.

#### Scenario: Missing identity sees nothing

- **WHEN** media metadata or bytes are queried without a current authenticated owner identity
- **THEN** no row is visible or mutable

#### Scenario: Datastore blocks a cross-owner read

- **WHEN** a query in owner B's tenant scope selects owner A's media id without an owner predicate
- **THEN** no metadata and no bytes are returned

#### Scenario: Datastore blocks a cross-owner insert

- **WHEN** a write in owner B's tenant scope inserts metadata or bytes owned by owner A
- **THEN** the datastore rejects the write

### Requirement: PDF preparation is shared with unstored PDF reads

The `%PDF-` magic-byte check, the structural parse, and the 20 MiB and 100-page bounds MUST be part
of one PDF preparation. The refusal of unopenable and encrypted PDFs MUST be part of it too. Ingest MUST apply it before it
stores an upload. A `read` or prompt import of a PDF that is not a `media://` locator MUST apply the
same preparation. It MUST create no media object, MUST write no bytes to the media store, and MUST
give no `media://` locator. Its stored part keeps the original as the retained bytes that
`media-attachments` defines.

#### Scenario: A read PDF is prepared like an upload and stored nowhere

- **WHEN** a Run reads a host file whose bytes are a valid, unencrypted 15-page PDF
- **THEN** the read reports 15 pages, as an upload of the same bytes records
- **AND** no media object exists for those bytes, and no `media://` locator names them

#### Scenario: A read PDF over the page bound is refused like an upload

- **WHEN** a Run reads a host file whose bytes are a valid 101-page PDF
- **THEN** the read is refused as `media_too_large`, as an upload of the same bytes is refused
- **AND** no media object, no stored bytes, and no retained bytes exist for it

#### Scenario: An imported encrypted PDF is refused like an upload

- **WHEN** a prompt imports a host path whose bytes are an encrypted PDF
- **THEN** the import is refused as `unsupported_media_type`, as an upload of the same bytes is
  refused
- **AND** no media object, no stored bytes, and no retained bytes exist for it

### Requirement: Unopenable or encrypted PDFs are refused

An input whose bytes start with `%PDF-` but which cannot be opened, which reports fewer than 1 page,
or which is encrypted, SHALL be refused as `unsupported_media_type` with the message
`Only unencrypted PDFs that open are accepted`. A PDF SHALL count as encrypted when it reports any
permissions or when the byte sequence `/Encrypt` occurs anywhere in its bytes, whether or not it
opens without a password. Every such refusal SHALL create no media object and store no bytes.

#### Scenario: A truncated PDF is refused

- **WHEN** an owner uploads a file that starts with `%PDF-` and is truncated before its end
- **THEN** ingest refuses it as `unsupported_media_type` and stores nothing

#### Scenario: A PDF signature followed by garbage is refused

- **WHEN** an owner uploads a file whose bytes are `%PDF-` followed by bytes that form no PDF
- **THEN** ingest refuses it as `unsupported_media_type` and stores nothing

#### Scenario: A PDF with no pages is refused

- **WHEN** an owner uploads a file that starts with `%PDF-` and whose page tree reports 0 pages
- **THEN** ingest refuses it as `unsupported_media_type` with the message
  `Only unencrypted PDFs that open are accepted`
- **AND** no media object and no bytes are stored

#### Scenario: A PDF that needs a user password is refused

- **WHEN** an owner uploads a PDF that opens only with a user password
- **THEN** ingest refuses it as `unsupported_media_type` with the message
  `Only unencrypted PDFs that open are accepted`
- **AND** no media object and no bytes are stored

#### Scenario: A PDF encrypted with only an owner password is refused

- **WHEN** an owner uploads a PDF encrypted with an owner password and no user password, which opens
  without a password
- **THEN** ingest refuses it as `unsupported_media_type`
- **AND** no media object and no bytes are stored

#### Scenario: An encrypted PDF that reports no permissions is refused

- **WHEN** an owner uploads an encrypted PDF whose encryption dictionary has no permissions entry,
  so it opens without a password and reports no permissions
- **THEN** ingest refuses it as `unsupported_media_type`
- **AND** no media object and no bytes are stored

#### Scenario: An unencrypted PDF with the literal text is refused

- **WHEN** an owner uploads an unencrypted PDF whose uncompressed content stream contains the text
  `/Encrypt`
- **THEN** ingest refuses it as `unsupported_media_type`
- **AND** no media object and no bytes are stored

### Requirement: PDF parsing is bounded in time and memory

A PDF parse SHALL run in a child process separate from the API and Run workers, at most two at once
per requesting process, for at most 10 seconds from its start.
On Linux it SHALL cap address space at min(2 GiB, the host hard limit), refuse to start below
1.25 GiB, and set `oom_score_adj=1000`. Bound or child failures SHALL be refused as
`unsupported_media_type` without storing, stopping, or stalling the requester. OOM survival is
preferential, not guaranteed under group-kill policies.

#### Scenario: A parse past the time bound is refused

- **WHEN** an owner uploads, or a Run reads, a file that starts with `%PDF-` and whose structure
  takes longer than 10 seconds to parse
- **THEN** the input is refused as `unsupported_media_type` with the message
  `Only unencrypted PDFs that open are accepted`
- **AND** nothing is stored

#### Scenario: An address-space allocation failure is isolated from the requester

- **WHEN** an owner on a Linux host uploads a file that starts with `%PDF-` whose parse fails an
  allocation because of its address-space limit
- **THEN** the upload is refused as `unsupported_media_type` and nothing is stored
- **AND** the API process that received it keeps serving later requests

#### Scenario: A slow parse does not stall other requests

- **WHEN** one PDF's parse runs for several seconds
- **THEN** other requests served by the requesting process keep completing during it

#### Scenario: Concurrent parses wait for a free slot

- **WHEN** an owner sends five concurrent uploads of PDFs that each parse within 10 seconds
- **THEN** at most two of their parses run at once
- **AND** each upload is answered, and none is refused for waiting

#### Scenario: A parse process that cannot start is not blamed on the file

- **WHEN** an owner uploads a valid PDF on a Linux host that cannot apply the parse bounds, or whose
  address-space hard limit is below 1.25 GiB
- **THEN** the upload is refused as `unsupported_media_type` with the message
  `PDF parsing is unavailable on this server`, and nothing is stored
- **AND** the requesting process records the start failure at error level and keeps serving
