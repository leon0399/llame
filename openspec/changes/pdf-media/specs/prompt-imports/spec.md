## ADDED Requirements

### Requirement: PDF targets import as PDF entries

An admitted prompt-import target whose native `read` returns a PDF SHALL become a PDF entry of the
same `prompt-imports` item, whose body SHALL be exactly the PDF result `read` returns for that
locator. PDF entries SHALL count toward the 8-target bound; PDF bytes SHALL NOT count toward the
128 KiB output bound. A target whose `read` refuses the PDF SHALL be named only as not imported.
Recovery SHALL reuse the persisted entry without rereading.

#### Scenario: A PDF target becomes a PDF entry

- **WHEN** a Chat bound to `/repo` sends a prompt containing `@paper.pdf`, the target is admitted, and
  native `read` of `/repo/paper.pdf` returns a PDF result for a 15-page, 2,215,244-byte PDF
- **THEN** the `prompt-imports` item holds a PDF entry whose body is exactly the PDF result that
  `read("/repo/paper.pdf")` returns: `status: "success"`, `kind: "pdf"`, `mediaType`
  `application/pdf`, `pages` 15, `byteSize` 2215244, and `path` `/repo/paper.pdf`, with no `media`
  field
- **AND** the item's persisted text contains no PDF bytes or encoded PDF data, and the stored user
  text is unchanged

#### Scenario: PDF entries count toward the target bound

- **WHEN** a prompt names nine distinct targets that survive probing, the first of which is a PDF
- **THEN** the first eight targets, the PDF included, are attempted
- **AND** the ninth target is listed once as omitted without a read

#### Scenario: PDF bytes do not consume the output bound

- **WHEN** a prompt imports a 2 MiB PDF followed by a text target, and the item's serialized text
  stays within 128 KiB
- **THEN** both targets are imported
- **AND** neither is listed as omitted

#### Scenario: A refused PDF is not imported

- **WHEN** an admitted target's bytes are a PDF of 101 pages, or an encrypted PDF
- **THEN** the item names that locator only as not imported
- **AND** no PDF entry is produced for it

#### Scenario: A PDF target with a selector is not imported

- **WHEN** an admitted target `@paper.pdf:1-20` names a PDF, so native `read` refuses it with
  `invalid_selector`
- **THEN** the item names that locator only as not imported
- **AND** no PDF entry is produced for it

### Requirement: Unstored PDF entries reach the model only in their attempt

A PDF target other than `media://` SHALL be imported without being stored, its entry carrying no
`media` locator, and the importing attempt's memory SHALL keep it as `media-attachments` defines.
That attempt's requests SHALL carry the PDF's file part or placeholder after the item's text, as the
epoch image window selects. Every later request, a retry or resume included, SHALL carry the PDF
not-retained placeholder for a model declaring `pdf` input and the PDF omitted placeholder otherwise.

#### Scenario: A PDF model receives the imported PDF after the item text

- **WHEN** the Run's model declares `pdf` input and the request's epoch image window attaches the
  imported PDF
- **THEN** the Run's requests carry the `prompt-imports` item's text followed immediately by a file
  part with `mediaType` `application/pdf` built from the original the attempt's memory holds for that
  entry

#### Scenario: A model without PDF input receives the omitted placeholder

- **WHEN** the Run's model does not declare `pdf` input and the prompt imported `@paper.pdf`, a
  15-page PDF
- **THEN** the request carries, immediately after the item's text, the placeholder
  `[pdf "paper.pdf" 15 pages, omitted: this model has no PDF input]`
- **AND** the request carries no file part for that entry

#### Scenario: An imported PDF beyond the window receives the limit placeholder

- **WHEN** the Run's model declares `pdf` input and the epoch image window does not attach the
  imported `@paper.pdf`, a 15-page PDF
- **THEN** the request carries, immediately after the item's text,
  `[pdf "paper.pdf" 15 pages, not attached: this context's PDF limit is reached]`
- **AND** the request carries no file part for that entry

#### Scenario: A later turn receives the PDF not-retained placeholder

- **WHEN** a later turn on a model that declares `pdf` input replays the user message whose
  `prompt-imports` item imported `@paper.pdf`, a 15-page PDF
- **THEN** the request carries, immediately after the item's text, the placeholder
  `[pdf "paper.pdf" 15 pages, not retained]`
- **AND** the request carries no file part for that entry

#### Scenario: A later turn without PDF input receives the omitted placeholder

- **WHEN** a later turn on a model that does not declare `pdf` input replays the user message whose
  `prompt-imports` item imported `@paper.pdf`, a 15-page PDF
- **THEN** the request carries, immediately after the item's text,
  `[pdf "paper.pdf" 15 pages, omitted: this model has no PDF input]`
- **AND** no placeholder in the request contains `not retained`

#### Scenario: Recovery reuses the persisted PDF entry

- **WHEN** a worker resumes the Run as a new attempt on a model that declares `pdf` input after a
  PDF target's import completed, and the PDF file then changed on disk
- **THEN** the PDF entry is reused as persisted, and the target is neither read nor parsed again and
  no new audit event is recorded for it
- **AND** the new attempt's requests carry the PDF not-retained placeholder for that entry

#### Scenario: An imported PDF is not stored

- **WHEN** owner A's prompt imports `@/repo/paper.pdf`, whose bytes are a PDF
- **THEN** no media object is created for owner A or any other owner
- **AND** the PDF entry carries no `media://` locator

### Requirement: PDF entries record a media locator privately

Each PDF entry's private payload entry SHALL record outcome `imported`, `kind` `pdf`, `mediaType`
`application/pdf`, `pages`, and `byteSize`. An entry imported from a `media://` target SHALL also
carry `media: "media://<id>"`; an entry imported without being stored SHALL carry no `media`. No PDF
entry SHALL carry a `thumbnail`, and a client SHALL never supply any of these keys.

#### Scenario: The payload records an unstored PDF's page count and size

- **WHEN** `@/repo/paper.pdf` is imported as a 15-page, 2,215,244-byte PDF
- **THEN** its private payload entry records outcome `imported`, `kind` `pdf`, `mediaType`
  `application/pdf`, `pages` 15, and `byteSize` 2215244
- **AND** it records no `media` and no `thumbnail` key

#### Scenario: The payload records a stored PDF's media locator

- **WHEN** `@media://<id>` is imported as a PDF the Run owner stored
- **THEN** its private payload entry records outcome `imported`, `kind` `pdf`, `mediaType`
  `application/pdf`, `pages`, `byteSize`, and `media` `media://<id>`
- **AND** it records no `thumbnail` key, and no new media object is stored

#### Scenario: A stored PDF import replays from the store in a later turn

- **WHEN** a later turn on a model that declares `pdf` input replays the item whose PDF entry records
  `media://<id>`, and the epoch image window attaches it
- **THEN** the request carries the item's text followed by a file part built from that object's
  stored original

## MODIFIED Requirements

### Requirement: Image entry payloads are validated exactly

The API's payload validator SHALL validate an entry without `kind` as an image entry and an entry
carrying `kind` `pdf` as a PDF entry, and SHALL reject as malformed any entry that departs from the
closed shape it claims.

#### Scenario: A malformed image entry is rejected

- **WHEN** a stored payload entry carries both `thumbnail` and `media`, or a `thumbnail` that is not
  a `data:image/webp;base64,` URL
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: An unstored image entry without its dimensions is rejected

- **WHEN** a stored payload entry carries `thumbnail` but lacks `width`, `height`, or `mediaType`,
  or carries only some of `width`, `height`, and `mediaType`
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: Out-of-range image entry fields are rejected

- **WHEN** a stored payload entry carries `width` 0, a non-integer `height`, or `mediaType`
  `image/svg+xml`
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: A media entry with dimensions is rejected

- **WHEN** a stored payload entry without `kind` carries `media` together with `width`, `height`, or
  `mediaType`
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: Well-formed PDF entries are accepted

- **WHEN** a stored payload entry carries `locator`, `outcome` `imported`, `kind` `pdf`, `mediaType`
  `application/pdf`, `pages` 15, and `byteSize` 2215244, with or without `resolved` and with or
  without `media`
- **THEN** the API's payload validator accepts it

#### Scenario: A malformed PDF entry is rejected

- **WHEN** a stored payload entry carries `kind` `pdf` together with `mediaType` `image/png`,
  `pages` 0 or 101, a missing `byteSize`, a `thumbnail`, `width`, or `truncated`
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: Image entry keys are accepted only in their closed domains

- **WHEN** any entry without `kind` reaches the payload validator
- **THEN** it accepts `thumbnail` only as a `data:image/webp;base64,` URL within the thumbnail size
  cap, `width` and `height` only as positive integers, and `mediaType` only as `image/png`,
  `image/jpeg`, `image/gif`, or `image/webp`
- **AND** it requires `width`, `height`, and `mediaType` together whenever any of the four keys is
  present, accepts those three with or without `thumbnail`, and rejects an entry carrying `media`
  with any of the four as malformed

#### Scenario: A PDF entry's keys are exactly its closed set

- **WHEN** any entry carrying `kind` `pdf` reaches the payload validator
- **THEN** the validator accepts it only with the keys `locator`, optional `resolved`, `outcome`
  `imported`, `kind` `pdf`, `mediaType` `application/pdf`, `pages` as an integer from 1 through 100,
  `byteSize` as a positive integer, and optional `media`
- **AND** it rejects as malformed a `kind` with any other value, and a PDF entry lacking one of its
  required keys or carrying `truncated`, `thumbnail`, `width`, `height`, or any other key

### Requirement: Image entry payloads are never sent to a model

Request assembly SHALL take the image or PDF part or placeholder from the entry, never from the
item's text, and SHALL never send a `thumbnail` to a model.

#### Scenario: A thumbnail never reaches the model

- **WHEN** a request carries a `prompt-imports` item with an image entry that records a `thumbnail`
- **THEN** no part of the request carries the `thumbnail` or any part of its data URL

#### Scenario: A PDF entry's part comes from the entry

- **WHEN** a request carries a `prompt-imports` item with a PDF entry
- **THEN** the PDF's file part or placeholder follows the item's text, built from the entry
- **AND** the item's text itself carries only the PDF result and no PDF bytes
