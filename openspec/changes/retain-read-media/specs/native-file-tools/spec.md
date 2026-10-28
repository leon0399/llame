## MODIFIED Requirements

### Requirement: Image reads are decoded without being stored

The worker MUST decode an image from a source other than `media://` with the `media-store` image
preparation. The worker MUST NOT write it to the media store, for a model read and for a
prompt-import read. The stored part MUST keep its model variant as the retained bytes that
`media-attachments` defines. Each such read MUST decode its bytes again and MUST reuse no image or
identifier from an earlier read.

#### Scenario: A read image creates no media object

- **WHEN** the model reads `/work/shot.png`, whose bytes are a PNG image
- **THEN** the Run owner holds no media object for those bytes
- **AND** the result names the image only by its `path`

#### Scenario: A prompt-import read is not stored either

- **WHEN** a prompt import reads `/work/shot.png` through `read` with system origin `prompt-import`
- **THEN** the result is the same image result that a model `read` returns
- **AND** no media object is created

#### Scenario: Re-reading an image decodes it again

- **WHEN** the model reads `/work/shot.png` in one turn and again in a later turn
- **THEN** the later read decodes the file again and returns an image result with no `media` field
- **AND** the later read's image is attachable in the later turn's Run
- **AND** the earlier read keeps its own retained bytes

### Requirement: PDF reads are parsed without being stored

The worker MUST parse a PDF from a source other than `media://` with the preparation that
`media-store` applies to an uploaded PDF. The worker MUST NOT write it to the media store, for a
model read and for a prompt-import read. The stored part MUST keep its original as the retained
bytes that `media-attachments` defines. Each such read MUST parse its bytes again and MUST reuse no
PDF or identifier from an earlier read.

#### Scenario: A read PDF creates no media object

- **WHEN** the model reads `/docs/paper.pdf`, whose bytes are a PDF
- **THEN** the Run owner holds no media object for those bytes
- **AND** the result names the PDF only by its `path`

#### Scenario: A prompt-import PDF read is not stored either

- **WHEN** a prompt import reads `/docs/paper.pdf` through `read` with system origin `prompt-import`
- **THEN** the result is the same PDF result that a model `read` returns
- **AND** no media object is created

#### Scenario: Re-reading a PDF parses it again

- **WHEN** the model reads `/docs/paper.pdf` in one turn and again in a later turn
- **THEN** the later read parses the file again and returns a PDF result with no `media` field
- **AND** the later read's PDF is attachable in the later turn's Run
- **AND** the earlier read keeps its own retained bytes

### Requirement: Web reads accept text and image bodies

A web read MUST accept only text bodies, image bodies, and PDF bodies. Text bodies are
`text/*` media types, `application/json`, `application/xml`, and any type whose
subtype carries a `+json` or `+xml` suffix, so `image/svg+xml` is a text body.
`text/markdown` MUST be handled as Markdown. An image body is a page response,
after any redirects, whose declared media type is `image/png`, `image/jpeg`,
`image/gif`, or `image/webp` and whose leading bytes match the PNG, JPEG, GIF,
or WebP signature; the format the bytes match, not the declared type, MUST
decide the result's `mediaType`. An image body MUST remain under the existing
5 MiB body bound, MUST end the ladder with `method` `image`, and MUST be
returned as the image result under the image read requirement, never as
content. A body declared as one of those image types whose leading bytes match
none of the four signatures MUST fail with `unsupported_media_type`, MUST
decode no image, and its body MUST NOT be returned as content. Any
selector on an image body, `:raw` included, MUST fail with `invalid_selector`
and MUST decode no image. A PDF body is a page response, after any redirects,
whose declared media type is `application/pdf` and whose leading bytes are
`%PDF-`. A PDF body MUST remain under the 20 MiB body bound the fetch-bound
requirement gives it, MUST end the ladder with `method` `pdf`, and MUST be
returned as the PDF result under the PDF read requirement, never as content. A
body declared `application/pdf` whose leading bytes are not `%PDF-` MUST fail
with `unsupported_media_type`, MUST parse no PDF, and its body MUST NOT be
returned as content. A PDF body over 100 pages MUST fail with
`media_too_large`, and a PDF body that is encrypted or does not open MUST fail
with `unsupported_media_type`. Any selector on a PDF body, `:raw` included,
MUST fail with `invalid_selector` under the PDF selector requirement. Every
other content type, `application/octet-stream` and `application/zip`
included, MUST fail with `unsupported_content_type` naming the received type,
and its body MUST NOT be returned as content. An adapter response, or an
alternate, suffix, or `llms.txt` probe response, with an image type or
`application/pdf` MUST count as a refused content
type. An adapter
response with a refused content type MUST disqualify that adapter with a
bounded `content_type` note and MUST not fail the source call. Only a
declared HTML type — `text/html` or `application/xhtml+xml` — MUST be
rendered. A `text/plain` body MUST be returned as served whatever it
contains, because a conversion guesses at structure and guessing on a body
the publisher declared as plain text costs more than it returns: a Markdown
file that opens with a block of inline HTML was extracted as an article and
lost every line after it. Any other accepted text body MUST be returned as
the content unchanged. Text MUST be decoded with the
charset from the `Content-Type`
parameter when present, else with a `<meta charset>` declaration found in the
first 2 KiB of the body, else as UTF-8.

#### Scenario: A JSON body is returned as text

- **WHEN** a locator serves `application/json`
- **THEN** the read returns the body text unchanged with `method` `text`
- **AND** a first response that is `text/plain` is returned unchanged with `method` `negotiated`

#### Scenario: A binary body is refused with its type named

- **WHEN** a locator serves `application/zip` or `application/octet-stream`
- **THEN** the read fails with `unsupported_content_type` naming that type
- **AND** no conversion or extraction is attempted

#### Scenario: Only a declared HTML type is rendered

- **WHEN** a response declares `text/plain` and its body is an HTML document
- **THEN** the body is returned as served with `method` `negotiated`, not extracted
- **AND** a `text/plain` README that opens with a block of inline HTML, such as `<div align="center">`, keeps every line

#### Scenario: A declared charset is honored

- **WHEN** a response declares `charset=iso-8859-1` and its body contains bytes outside ASCII
- **THEN** the returned text is decoded with that charset
- **AND** a response that declares no charset and carries no `<meta charset>` in its first 2 KiB is decoded as UTF-8

#### Scenario: An image body is returned as an image

- **WHEN** a locator serves `image/png` and the body's leading bytes are a PNG image of 1600 by 900 pixels
- **THEN** the read returns the image result with `method` `image`, `mediaType` `image/png`, `width` 1600, and `height` 900, and no `media` field
- **AND** the result carries no `content`, and the body is decoded without a media object
- **AND** the stored tool part keeps the image's retained bytes

#### Scenario: The bytes decide the image format

- **WHEN** a locator serves `image/png` and the body's leading bytes are a JPEG image
- **THEN** the read returns the image result with `mediaType` `image/jpeg`

#### Scenario: A declared image type over other bytes is refused

- **WHEN** a locator serves `image/png` and the body is an HTML document
- **THEN** the read fails with `unsupported_media_type`
- **AND** no image is decoded and no part of the body is returned as content

#### Scenario: A selector on a web image is refused

- **WHEN** the model reads `https://example.test/shot.png:raw` or `https://example.test/shot.png:1-5` and the locator serves `image/png` with PNG bytes
- **THEN** the read fails with `invalid_selector`
- **AND** no image is decoded and the raw bytes are not returned

#### Scenario: An SVG body stays text

- **WHEN** a locator serves `image/svg+xml`
- **THEN** the read returns the body text unchanged with `method` `text`
- **AND** no image is decoded

#### Scenario: An oversized image body fails the existing body bound

- **WHEN** a locator serves `image/png` with a body larger than 5 MiB
- **THEN** the read fails with `body_too_large`
- **AND** no image is decoded

#### Scenario: A PDF body is returned as a PDF result

- **WHEN** a locator serves `application/pdf` and the body is a 15-page PDF of 2,215,244 bytes that starts `%PDF-`
- **THEN** the read returns the PDF result with `method` `pdf`, `mediaType` `application/pdf`, `pages` 15, and `byteSize` 2215244, and no `media` field
- **AND** the result carries no `content`, and the body is parsed without a media object
- **AND** the stored tool part keeps the PDF's retained bytes

#### Scenario: A declared PDF over other bytes is refused

- **WHEN** a locator serves `application/pdf` and the body is an HTML document
- **THEN** the read fails with `unsupported_media_type`
- **AND** no PDF is parsed and no part of the body is returned as content

#### Scenario: A web PDF over the page bound or encrypted is refused

- **WHEN** a locator serves `application/pdf` with a 101-page PDF, and separately with an encrypted PDF
- **THEN** the first read fails with `media_too_large` and the second with `unsupported_media_type`
- **AND** neither returns a PDF result or any part of the body as content
