## ADDED Requirements

### Requirement: PDF preparation is shared with unstored PDF reads

The `%PDF-` magic-byte check, the structural parse, the 20 MiB and 100-page bounds, and the refusal
of unopenable and encrypted PDFs SHALL form one PDF preparation. Ingest SHALL apply it before
storing an upload. A `read` or prompt import of a PDF that is not a `media://` locator SHALL apply
the same preparation without storing anything: it SHALL create no media object, write no bytes, and
yield no `media://` locator.

#### Scenario: A read PDF is prepared like an upload and stored nowhere

- **WHEN** a Run reads a host file whose bytes are a valid, unencrypted 15-page PDF
- **THEN** the read reports 15 pages, as an upload of the same bytes would record
- **AND** no media object exists for those bytes and no `media://` locator names them

#### Scenario: A read PDF over the page bound is refused like an upload

- **WHEN** a Run reads a host file whose bytes are a valid 101-page PDF
- **THEN** the read is refused as `media_too_large`, as an upload of the same bytes would be
- **AND** no media object and no bytes are stored

#### Scenario: An imported encrypted PDF is refused like an upload

- **WHEN** a prompt imports a host path whose bytes are an encrypted PDF
- **THEN** the import is refused as `unsupported_media_type`, as an upload of the same bytes would be
- **AND** no media object and no bytes are stored

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

A PDF parse SHALL run in a process separate from the API and Run workers, at most two at once per
requesting process, each under a 10-second bound from its start. On Linux it SHALL also run under an
address-space limit of 2 GiB, or the host's lower hard limit when that is at least 1.25 GiB, marked
as the first process killed when memory runs out; under a lower hard limit it SHALL NOT start. A
parse over a bound, or exiting abnormally, SHALL be refused as `unsupported_media_type`, store
nothing, and not stop or stall the requesting process.

#### Scenario: A parse past the time bound is refused

- **WHEN** an owner uploads, or a Run reads, a file that starts with `%PDF-` and whose structure
  takes longer than 10 seconds to parse
- **THEN** the input is refused as `unsupported_media_type` with the message
  `Only unencrypted PDFs that open are accepted`
- **AND** nothing is stored

#### Scenario: A parse that runs out of memory is refused and the process keeps serving

- **WHEN** an owner on a Linux host uploads a file that starts with `%PDF-` whose parse allocates
  beyond its address-space limit
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

## MODIFIED Requirements

### Requirement: A media object is owner-owned metadata plus original and model bytes

Every stored image or PDF SHALL be one media object owned by exactly one owner, taken only from the
authenticated request context, and only an owner upload SHALL create one. It SHALL carry a UUIDv7
`id`, the original's detected format and byte size, the original's SHA-256 digest, a source label,
and its creation time, and no provenance. An image object SHALL also carry the original's
dimensions and the model variant's format, byte size, and dimensions, and SHALL keep its `original`
and `model` byte variants apart from the metadata. A PDF object SHALL also carry its page count,
between 1 and 100, SHALL carry no dimensions and no model variant, and SHALL keep only its
`original` bytes apart from the metadata.

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

### Requirement: The media descriptor is a closed shape

The media descriptor SHALL take one of two closed shapes, chosen by `mediaType`. The image
descriptor SHALL contain exactly `id`, `locator` (`media://<id>`), `mediaType`, `name` (the source
label), `width`, `height`, `byteSize`, and `model`, an object of exactly `mediaType`, `width`,
`height`, and `byteSize` for the model variant. The PDF descriptor SHALL contain exactly `id`,
`locator` (`media://<id>`), `mediaType` (`application/pdf`), `name` (the source label), `byteSize`,
and `pages`. Top-level fields describe the original. Neither descriptor SHALL expose an owner
identifier, a digest, or provenance.

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

### Requirement: Ingest bounds are enforced before full decode

Ingest SHALL refuse an input larger than 20 MiB before decoding or parsing it. It SHALL read an
image's dimensions from the image header and refuse an image above 40 megapixels before a full
decode. It SHALL refuse a PDF of more than 100 pages after parsing its structure. Every one of these
refusals SHALL be `media_too_large` and SHALL create no media object. Its message SHALL name what was
detected: `Image exceeds 20 MiB or 40 megapixels` for an image, `PDF exceeds 20 MiB or 100 pages`
for a PDF, and `File exceeds 20 MiB` for an input refused before its format is detected. These
bounds SHALL be fixed by the application and SHALL NOT be configurable.

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

### Requirement: Upload refusals and body limits

An `unsupported_media_type` refusal SHALL return `415` and a `media_too_large` refusal SHALL return
`413`, each carrying that error code and the refusal's message. The upload route SHALL bound the
file at the media store's byte bound, and a file over it SHALL be answered `413` with the same
`media_too_large` body shape as any ingest refusal, whichever layer detects the overflow; a file
refused before its format is detected SHALL carry the message `File exceeds 20 MiB`. The JSON body
limit of other routes SHALL remain unchanged.

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

### Requirement: Owners fetch descriptors and bytes of their own media

`GET /api/v1/media/:id` SHALL return the descriptor of an owned object.
`GET /api/v1/media/:id/original` and `GET /api/v1/media/:id/model` SHALL return that variant's bytes
with `Content-Type` set to its stored media type, `X-Content-Type-Options: nosniff`,
`Content-Disposition: inline`, `Content-Security-Policy: sandbox`, `Cache-Control: private, no-cache`,
and a strong `ETag` derived from the object's SHA-256 digest and the variant name. The bytes under
an id SHALL never change. Because a PDF has no model variant, `GET /api/v1/media/:id/model` of an
owned PDF SHALL return the same `404` response as an unknown id, whatever its `If-None-Match`
header, while its `/original` SHALL be served like any other variant.

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
