## ADDED Requirements

### Requirement: Image targets import as image entries

An admitted prompt-import target whose native `read` returns an image SHALL become an image entry of
the same `prompt-imports` item, whose body SHALL be exactly the image result `read` returns for that
locator. The request SHALL carry that image's part or placeholder, as the epoch window selects,
after the item's text. Image entries SHALL count toward the 8-target bound; image bytes SHALL NOT
count toward the 128 KiB output bound. Recovery SHALL reuse the persisted media id without
rereading.

#### Scenario: An image target becomes an image entry

- **WHEN** a Chat bound to `/repo` sends a prompt containing `@shot.png`, the target is admitted, and
  native `read` of `/repo/shot.png` returns a PNG image result for `media://<id>` at 1600×900
- **THEN** the `prompt-imports` item holds an image entry whose body is exactly the image result that
  `read("/repo/shot.png")` returns: `status: "success"`, `kind: "image"`, `media` `media://<id>`,
  `mediaType` `image/png`, `width` 1600, `height` 900, and `path` `/repo/shot.png`
- **AND** the item's persisted text contains no image bytes or encoded image data, and the stored
  user text is unchanged

#### Scenario: A vision model receives the imported image after the item text

- **WHEN** the Run's model declares `image` input and the request's epoch image window attaches the
  imported image
- **THEN** the request carries the `prompt-imports` item's text followed immediately by an image part
  built from that media object's model variant

#### Scenario: A text-only model receives the placeholder

- **WHEN** the Run's model declares text-only input and the prompt imported an image target
- **THEN** the request carries, immediately after the item's text, the placeholder
  `[image media://<id> <name> <width>×<height>, omitted: this model has no image input]`
- **AND** the request carries no image part

#### Scenario: Image entries count toward the target bound

- **WHEN** a prompt names nine distinct targets that survive probing, the first of which is an image
- **THEN** the first eight targets, the image included, are attempted
- **AND** the ninth target is listed once as omitted without a read

#### Scenario: Image bytes do not consume the output bound

- **WHEN** a prompt imports an image whose model variant exceeds 128 KiB followed by a text target,
  and the item's serialized text stays within 128 KiB
- **THEN** both targets are imported
- **AND** neither is listed as omitted

#### Scenario: Recovery reuses the persisted media id

- **WHEN** a worker resumes after an image target's import completed and the image file then changed
  on disk
- **THEN** the image entry reuses the persisted `media://<id>`
- **AND** the target is neither read nor ingested again and no new audit event is recorded for it

#### Scenario: A denied image target is not imported

- **WHEN** the silent `read` pre-evaluation rejects `@/tmp/shot.png`
- **THEN** the item names that locator only as not imported, through the normal audited denied
  `read`
- **AND** no probe, ingest, media object, or image entry is produced for it

#### Scenario: A refused image is not imported

- **WHEN** an admitted target's bytes are a PNG over the 40-megapixel ingest ceiling
- **THEN** the item names that locator only as not imported
- **AND** no media object or image entry is produced for it

#### Scenario: The imported image belongs only to the Run owner

- **WHEN** owner A's prompt imports an image as `media://<id>`
- **THEN** that media object is owned by owner A
- **AND** owner B resolves nothing for that id through the media routes or a `media://` read

### Requirement: Image entries record their media locator privately

Each image entry's private payload entry SHALL record `media: "media://<id>"` with outcome
`imported`. The conversion boundary SHALL take the image part or placeholder from that locator, and
the owner chip SHALL open the image from it, never from the item's text.

#### Scenario: The payload records the image's media locator

- **WHEN** an image target is imported as `media://<id>`
- **THEN** its private payload entry records outcome `imported` and `media` `media://<id>`
- **AND** the owner chip opens that image from the payload, not from the item's text

### Requirement: Media locators are prompt-import targets

A `media://` target SHALL resolve as native `read` resolves it and SHALL be silently pre-evaluated
and probed like a `kb://` target, the probe being a lookup of the Run owner's media. An unknown id or
another owner's id SHALL remain prose. A `media://` target SHALL trigger no instruction-file load,
and the denial, output-bound, and work-bound rules for host and Knowledge targets SHALL apply to it.

#### Scenario: A typed media locator imports a stored image

- **WHEN** a prompt contains `@media://<id>` naming an image the Run owner stored, and the target is
  admitted
- **THEN** the item holds an image entry for `media://<id>` without ingesting a new object
- **AND** no instruction-file load is triggered by the target

#### Scenario: Another owner's media locator stays prose

- **WHEN** owner A's prompt contains `@media://<id>` naming an image owner B stored
- **THEN** the marker remains prose and nothing is imported
- **AND** no read, audit event, or owner disclosure concerning owner B's object is produced

#### Scenario: A denied media target is audited and never counted

- **WHEN** the silent `read` pre-evaluation rejects `@media://<id>`
- **THEN** the normal audited `read` path records it as denied without a lookup
- **AND** it is neither counted toward the 8-target bound nor listed as omitted
