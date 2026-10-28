## ADDED Requirements

### Requirement: Unstored image entries are retained in their item

A target other than `media://` MUST be imported without a media object. Its entry carries no
`media` locator and MUST keep the retained bytes that `media-attachments` defines. The importing
attempt and each later request of the epoch MUST carry the image's part or placeholder after the
item's text. The epoch image window selects the form.

#### Scenario: A vision model receives the imported image after the item text

- **WHEN** the Run's model declares `image` input, and the epoch image window of the request
  attaches the imported image
- **THEN** the Run's requests carry the text of the `prompt-imports` item and then an image part
  built from the retained model variant of that entry

#### Scenario: A text-only model receives the placeholder

- **WHEN** the Run's model declares text-only input, and the prompt imported `@shot.png`, a
  1600×900 image
- **THEN** the request carries, directly after the item's text, the placeholder
  `[image "shot.png" 1600×900, omitted: this model has no image input]`
- **AND** the request carries no image part

#### Scenario: A later turn receives the retained image

- **WHEN** a later turn on a model that declares `image` input replays the user message whose
  `prompt-imports` item imported `@shot.png`, and the epoch image window attaches that entry
- **THEN** the request carries, directly after the item's text, an image part built from the
  retained model variant

#### Scenario: Recovery reuses the persisted entry

- **WHEN** a worker resumes the Run as a new attempt on a model that declares `image` input after an
  image target's import completed, and the image file then changed on disk
- **THEN** the system reuses the image entry as persisted, does not read or decode the target again,
  and records no new audit event for it
- **AND** the new attempt's requests carry the retained model variant of the first import when the
  epoch image window attaches it

#### Scenario: An imported image is not stored as a media object

- **WHEN** owner A's prompt imports `@/repo/shot.png`, whose bytes are a PNG image
- **THEN** no media object is created for owner A or for any other owner
- **AND** the image entry carries no `media://` locator

### Requirement: Unstored PDF entries are retained in their item

A PDF target other than `media://` MUST be imported without a media object. Its entry carries no
`media` locator and MUST keep the retained original that `media-attachments` defines. The importing
attempt and each later request of the epoch MUST carry the PDF's file part or placeholder after the
item's text. The epoch image window selects the form.

#### Scenario: A PDF model receives the imported PDF after the item text

- **WHEN** the Run's model declares `pdf` input, and the epoch image window of the request attaches
  the imported PDF
- **THEN** the Run's requests carry the text of the `prompt-imports` item and then a file part with
  `mediaType` `application/pdf` built from the retained original of that entry

#### Scenario: A model without PDF input receives the omitted placeholder

- **WHEN** the Run's model does not declare `pdf` input, and the prompt imported `@paper.pdf`, a
  15-page PDF
- **THEN** the request carries, directly after the item's text, the placeholder
  `[pdf "paper.pdf" 15 pages, omitted: this model has no PDF input]`
- **AND** the request carries no file part for that entry

#### Scenario: An imported PDF beyond the window receives the limit placeholder

- **WHEN** the Run's model declares `pdf` input, and the epoch image window does not attach the
  imported `@paper.pdf`, a 15-page PDF
- **THEN** the request carries, directly after the item's text,
  `[pdf "paper.pdf" 15 pages, not attached: this context's PDF limit is reached]`
- **AND** the request carries no file part for that entry

#### Scenario: A later turn receives the retained PDF

- **WHEN** a later turn on a model that declares `pdf` input replays the user message whose
  `prompt-imports` item imported `@paper.pdf`, and the epoch image window attaches that entry
- **THEN** the request carries, directly after the item's text, a file part built from the retained
  original

#### Scenario: Recovery reuses the persisted PDF entry

- **WHEN** a worker resumes the Run as a new attempt on a model that declares `pdf` input after a
  PDF target's import completed, and the PDF file then changed on disk
- **THEN** the system reuses the PDF entry as persisted, does not read or parse the target again,
  and records no new audit event for it
- **AND** the new attempt's requests carry the retained original of the first import when the epoch
  image window attaches it

#### Scenario: An imported PDF is not stored as a media object

- **WHEN** owner A's prompt imports `@/repo/paper.pdf`, whose bytes are a PDF
- **THEN** no media object is created for owner A or for any other owner
- **AND** the PDF entry carries no `media://` locator

## MODIFIED Requirements

### Requirement: Image entries record a thumbnail or a media locator privately

Each image entry's private payload entry MUST record outcome `imported` and one of two forms. An
entry imported without a media object MUST carry the original's `width`, `height`, and
`mediaType`, and its `retainedMedia`. It MUST also carry `thumbnail`, the display-only thumbnail
that `media-attachments` defines, when one fits its cap. An entry imported from a `media://` target
MUST carry `media: "media://<id>"` and none of those five keys. A client MUST never supply any of
these keys.

#### Scenario: The payload records an unstored image's thumbnail and dimensions

- **WHEN** `@/repo/shot.png` is imported as a 1600×900 PNG image
- **THEN** its private payload entry records outcome `imported`, a `thumbnail` that is a
  `data:image/webp;base64,` URL, `width` 1600, `height` 900, and `mediaType` `image/png`
- **AND** it records the image's `retainedMedia` and no `media` key

#### Scenario: An unstored image over the thumbnail cap keeps its dimensions

- **WHEN** `@/repo/shot.png` is imported as an image whose single thumbnail encode gives a data URL
  longer than 65,536 characters
- **THEN** its private payload entry records outcome `imported`, `width`, `height`, `mediaType`, and
  `retainedMedia`, and no `thumbnail`
- **AND** the API's payload validator accepts it

#### Scenario: The payload records a stored image's media locator

- **WHEN** `@media://<id>` is imported as an image
- **THEN** its private payload entry records outcome `imported` and `media` `media://<id>`
- **AND** it records no `thumbnail`, `width`, `height`, `mediaType`, or `retainedMedia`

### Requirement: Image entry payloads are validated exactly

The API's payload validator MUST validate an entry without `kind` as an image entry. It MUST
validate an entry that carries `kind` `pdf` as a PDF entry. It MUST reject as malformed an entry
that does not agree with the closed shape that it claims. It MUST reject as malformed an entry that
carries `kind` with a different value.

#### Scenario: A malformed image entry is rejected

- **WHEN** a stored payload entry carries both `thumbnail` and `media`, or a `thumbnail` that is not
  a `data:image/webp;base64,` URL
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: An unstored image entry without its dimensions is rejected

- **WHEN** a stored payload entry carries `thumbnail` or `retainedMedia` but no `width`, `height`,
  or `mediaType`, or carries only some of `width`, `height`, and `mediaType`
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: Out-of-range image entry fields are rejected

- **WHEN** a stored payload entry carries `width` 0, a non-integer `height`, or `mediaType`
  `image/svg+xml`
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: A media entry with dimensions is rejected

- **WHEN** a stored payload entry without `kind` carries `media` together with `width`, `height`,
  `mediaType`, or `retainedMedia`
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: Well-formed PDF entries are accepted

- **WHEN** a stored payload entry carries `locator`, `outcome` `imported`, `kind` `pdf`, `mediaType`
  `application/pdf`, `pages` 15, and `byteSize` 2215244, with or without `resolved`, and with
  either `media` or `retainedMedia` or neither
- **THEN** the API's payload validator accepts it

#### Scenario: A malformed PDF entry is rejected

- **WHEN** a stored payload entry carries `kind` `pdf` together with `mediaType` `image/png`,
  `pages` 0 or 101, no `byteSize`, a `thumbnail`, `width`, or `truncated`
- **THEN** the API's payload validator rejects that payload as malformed

#### Scenario: Image entry keys are accepted only in their closed domains

- **WHEN** an entry without `kind` reaches the payload validator
- **THEN** it accepts `thumbnail` only as a `data:image/webp;base64,` URL in the thumbnail size cap,
  `width` and `height` only as positive integers, and `mediaType` only as `image/png`,
  `image/jpeg`, `image/gif`, or `image/webp`
- **AND** it accepts `retainedMedia` only as an object of a `mediaType` of `image/png` or
  `image/jpeg`, positive integer `width` and `height`, and non-empty base64 `data`
- **AND** it requires `width`, `height`, and `mediaType` together when one of the five keys is
  present, accepts those three with or without `thumbnail` and `retainedMedia`, and rejects an
  entry that carries `media` with one of the five as malformed

#### Scenario: A PDF entry's keys are exactly its closed set

- **WHEN** an entry that carries `kind` `pdf` reaches the payload validator
- **THEN** the validator accepts it only with the keys `locator`, optional `resolved`, `outcome`
  `imported`, `kind` `pdf`, `mediaType` `application/pdf`, `pages` as an integer from 1 through 100,
  `byteSize` as a positive integer, and either optional `media` or optional `retainedMedia`
- **AND** it accepts `retainedMedia` only as an object of `mediaType` `application/pdf` and
  non-empty base64 `data`
- **AND** it rejects as malformed a PDF entry without one of its required keys, or one that carries
  both `media` and `retainedMedia`, `truncated`, `thumbnail`, `width`, `height`, or another key

### Requirement: PDF entries record a media locator privately

Each PDF entry's private payload entry MUST record outcome `imported`, `kind` `pdf`, `mediaType`
`application/pdf`, `pages`, and `byteSize`. An entry imported from a `media://` target MUST also
carry `media: "media://<id>"`. An entry imported without a media object MUST carry no `media` and
MUST carry its `retainedMedia`. A PDF entry MUST NOT carry a `thumbnail`, and a client MUST never
supply any of these keys.

#### Scenario: The payload records an unstored PDF's page count and size

- **WHEN** `@/repo/paper.pdf` is imported as a 15-page, 2,215,244-byte PDF
- **THEN** its private payload entry records outcome `imported`, `kind` `pdf`, `mediaType`
  `application/pdf`, `pages` 15, `byteSize` 2215244, and its `retainedMedia`
- **AND** it records no `media` and no `thumbnail` key

#### Scenario: The payload records a stored PDF's media locator

- **WHEN** `@media://<id>` is imported as a PDF that the Run owner stored
- **THEN** its private payload entry records outcome `imported`, `kind` `pdf`, `mediaType`
  `application/pdf`, `pages`, `byteSize`, and `media` `media://<id>`
- **AND** it records no `thumbnail` or `retainedMedia` key, and no new media object is stored

#### Scenario: A stored PDF import replays from the store in a later turn

- **WHEN** a later turn on a model that declares `pdf` input replays the item whose PDF entry records
  `media://<id>`, and the epoch image window attaches it
- **THEN** the request carries the item's text and then a file part built from the stored original
  of that object

## REMOVED Requirements

### Requirement: Unstored image entries reach the model only in their attempt

**Reason**: An unstored image entry now keeps its retained bytes, so it reaches each request of its
epoch.

**Migration**: See `Unstored image entries are retained in their item`.

### Requirement: Unstored PDF entries reach the model only in their attempt

**Reason**: An unstored PDF entry now keeps its retained original, so it reaches each request of its
epoch.

**Migration**: See `Unstored PDF entries are retained in their item`.
