# Spec Delta

## MODIFIED Requirements

### Requirement: Unstored images carry a display-only inline thumbnail

Each image result without a `media` locator, and each prompt-import image entry without one, MUST
be stored with a thumbnail when one fits its cap: a `data:image/webp;base64,` URL of one WebP
encode of the model variant, its alpha flattened onto white, resized to fit 256 px on its longest
side without enlargement, at quality 60. A tool result MUST store it as `display.thumbnail`. A
prompt-import entry keeps its own `thumbnail` field.

#### Scenario: A large image yields a small thumbnail

- **WHEN** the model reads a 4000×1000 PNG from a host path
- **THEN** the stored tool output's `display.thumbnail` is a `data:image/webp;base64,` URL of a
  256×64 WebP of at most 65,536 characters

### Requirement: A thumbnail over its cap is omitted

When the thumbnail's data URL exceeds 65,536 characters, the system MUST NOT store a thumbnail: the
tool result carries no `display.thumbnail` key, and a prompt-import entry keeps its `width`,
`height`, and `mediaType`.

#### Scenario: A thumbnail over the cap is omitted

- **WHEN** the model reads an image whose single thumbnail encode yields a data URL longer than
  65,536 characters
- **THEN** the stored tool output carries no `display.thumbnail` key and keeps the result's
  `mediaType`, `width`, and `height`

### Requirement: Thumbnails are display-only

The system MUST NOT send a thumbnail to a model. A thumbnail MUST stay outside every observation,
truncation, and 128 KiB output budget. The system MUST NOT persist a thumbnail from a client. In a
tool result it lives under the `display` key that `tool-result-rendering` removes before any
rendering. Public shares and shared forks, which omit tool parts and prompt-import items, MUST
carry no thumbnail.

#### Scenario: A client cannot supply a thumbnail

- **WHEN** an owner message carries a part holding a `thumbnail` field or a `display` key
- **THEN** the request is rejected or the part is discarded, and no thumbnail is persisted

#### Scenario: A public share carries no thumbnail

- **WHEN** an unauthenticated visitor reads a public share whose assistant message carries an image
  `read` result with a `display.thumbnail`
- **THEN** the response carries no tool part and no thumbnail
