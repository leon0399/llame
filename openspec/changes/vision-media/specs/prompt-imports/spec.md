## ADDED Requirements

### Requirement: Image targets import as image entries

An admitted prompt-import target whose native `read` returns an image SHALL become an image entry of
the same `prompt-imports` item, whose body SHALL be exactly the image result `read` returns for that
locator. Image entries SHALL count toward the 8-target bound; image bytes and an entry's `thumbnail`
SHALL NOT count toward the 128 KiB output bound. Recovery SHALL reuse the persisted entry without
rereading.

#### Scenario: An image target becomes an image entry

- **WHEN** a Chat bound to `/repo` sends a prompt containing `@shot.png`, the target is admitted, and
  native `read` of `/repo/shot.png` returns a 1600×900 PNG image result
- **THEN** the `prompt-imports` item holds an image entry whose body is exactly the image result that
  `read("/repo/shot.png")` returns: `status: "success"`, `kind: "image"`, `mediaType` `image/png`,
  `width` 1600, `height` 900, and `path` `/repo/shot.png`, with no `media` field
- **AND** the item's persisted text contains no image bytes or encoded image data, and the stored
  user text is unchanged

#### Scenario: Image entries count toward the target bound

- **WHEN** a prompt names nine distinct targets that survive probing, the first of which is an image
- **THEN** the first eight targets, the image included, are attempted
- **AND** the ninth target is listed once as omitted without a read

#### Scenario: Image bytes do not consume the output bound

- **WHEN** a prompt imports an image whose model variant exceeds 128 KiB followed by a text target,
  and the item's serialized text stays within 128 KiB
- **THEN** both targets are imported
- **AND** neither is listed as omitted, and the image entry's `thumbnail` is not counted

#### Scenario: A denied image target is not imported

- **WHEN** the silent `read` pre-evaluation rejects `@/tmp/shot.png`
- **THEN** the item names that locator only as not imported, through the normal audited denied
  `read`
- **AND** no probe, decode, or image entry is produced for it

#### Scenario: A refused image is not imported

- **WHEN** an admitted target's bytes are a PNG over the 40-megapixel ceiling
- **THEN** the item names that locator only as not imported
- **AND** no image entry is produced for it

### Requirement: Unstored image entries reach the model only in their attempt

A target other than `media://` SHALL be imported without being stored: its entry carries no `media`
locator, and the importing attempt's memory SHALL keep it as `media-attachments` defines. That
attempt's requests SHALL carry the image's part or placeholder after the item's text, as the epoch
window selects. Every later request, a retry or resume included, SHALL carry the not-retained
placeholder for a model that declares `image` input and the omitted placeholder otherwise.

#### Scenario: A vision model receives the imported image after the item text

- **WHEN** the Run's model declares `image` input and the request's epoch image window attaches the
  imported image
- **THEN** the Run's requests carry the `prompt-imports` item's text followed immediately by an image
  part built from the model variant the attempt's memory holds for that entry

#### Scenario: A text-only model receives the placeholder

- **WHEN** the Run's model declares text-only input and the prompt imported `@shot.png`, a 1600×900
  image
- **THEN** the request carries, immediately after the item's text, the placeholder
  `[image "shot.png" 1600×900, omitted: this model has no image input]`
- **AND** the request carries no image part

#### Scenario: A later turn receives the not-retained placeholder

- **WHEN** a later turn on a model that declares `image` input replays the user message whose
  `prompt-imports` item imported `@shot.png`, a 1600×900 image
- **THEN** the request carries, immediately after the item's text, the placeholder
  `[image "shot.png" 1600×900, not retained: read it again to view it]`
- **AND** the request carries no image part for that entry

#### Scenario: A later text-only turn receives the omitted placeholder

- **WHEN** a later turn on a model that does not declare `image` input replays the user message
  whose `prompt-imports` item imported `@shot.png`, a 1600×900 image
- **THEN** the request carries, immediately after the item's text,
  `[image "shot.png" 1600×900, omitted: this model has no image input]`
- **AND** no placeholder in the request contains `not retained`

#### Scenario: Recovery reuses the persisted entry

- **WHEN** a worker resumes the Run as a new attempt on a model that declares `image` input after an
  image target's import completed, and the image file then changed on disk
- **THEN** the image entry is reused as persisted, and the target is neither read nor decoded again
  and no new audit event is recorded for it
- **AND** the new attempt's requests carry the not-retained placeholder for that entry

#### Scenario: An imported image is not stored

- **WHEN** owner A's prompt imports `@/repo/shot.png`, whose bytes are a PNG image
- **THEN** no media object is created for owner A or any other owner
- **AND** the image entry carries no `media://` locator

### Requirement: Image entries record a thumbnail or a media locator privately

Each image entry's private payload entry SHALL record outcome `imported` and exactly one of two
keys: `thumbnail`, the display-only thumbnail that `media-attachments` defines, for an entry
imported without being stored, or `media: "media://<id>"` for an entry imported from a `media://`
target. A client SHALL never supply either key.

#### Scenario: The payload records an unstored image's thumbnail

- **WHEN** `@/repo/shot.png` is imported as an image
- **THEN** its private payload entry records outcome `imported` and a `thumbnail` that is a
  `data:image/webp;base64,` URL, and no `media` key

#### Scenario: The payload records a stored image's media locator

- **WHEN** `@media://<id>` is imported as an image
- **THEN** its private payload entry records outcome `imported` and `media` `media://<id>`, and no
  `thumbnail`

### Requirement: Image entry payloads are validated and never sent to a model

The payload validators SHALL accept `thumbnail` only as a `data:image/webp;base64,` URL within the
thumbnail size cap, and SHALL reject an entry carrying both keys like any other malformed entry. The
conversion boundary SHALL take the image part or placeholder from the entry, never from the item's
text, and SHALL never send a `thumbnail` to a model. The owner chip SHALL render a `thumbnail`
directly and SHALL open a `media` locator's image from the media routes.

#### Scenario: A malformed image entry is rejected

- **WHEN** a stored payload entry carries both `thumbnail` and `media`, or a `thumbnail` that is not
  a `data:image/webp;base64,` URL
- **THEN** both payload validators reject that payload as malformed

#### Scenario: A thumbnail never reaches the model

- **WHEN** a request carries a `prompt-imports` item with an image entry that records a `thumbnail`
- **THEN** no part of the request carries the `thumbnail` or any part of its data URL

#### Scenario: The owner chip shows the entry's image

- **WHEN** the owner views a chip whose payload holds one image entry with a `thumbnail` and one with
  `media` `media://<id>`
- **THEN** the chip renders the first from its `thumbnail` without a media route request
- **AND** it opens the second from that payload's locator, not from the item's text

### Requirement: Media locators are prompt-import targets

A `media://` target SHALL resolve as native `read` resolves it and SHALL be silently pre-evaluated
and probed like a `kb://` target, the probe being a lookup of the Run owner's media. An unknown id or
another owner's id SHALL remain prose. A `media://` target SHALL trigger no instruction-file load,
and the denial, output-bound, and work-bound rules for host and Knowledge targets SHALL apply to it.

#### Scenario: A typed media locator imports a stored image

- **WHEN** a prompt contains `@media://<id>` naming an image the Run owner stored, and the target is
  admitted
- **THEN** the item holds an image entry for `media://<id>` without storing a new object
- **AND** no instruction-file load is triggered by the target

#### Scenario: A media import replays from the store in a later turn

- **WHEN** a later turn on a model that declares `image` input replays the item whose image entry
  records `media://<id>`, and the epoch image window attaches it
- **THEN** the request carries the item's text followed by an image part built from that object's
  stored model variant

#### Scenario: Another owner's media locator stays prose

- **WHEN** owner A's prompt contains `@media://<id>` naming an image owner B stored
- **THEN** the marker remains prose and nothing is imported
- **AND** no read, audit event, or owner disclosure concerning owner B's object is produced

#### Scenario: A denied media target is audited and never counted

- **WHEN** the silent `read` pre-evaluation rejects `@media://<id>`
- **THEN** the normal audited `read` path records it as denied without a lookup
- **AND** it is neither counted toward the 8-target bound nor listed as omitted
