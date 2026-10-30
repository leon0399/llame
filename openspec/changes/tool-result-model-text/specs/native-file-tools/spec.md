# Spec Delta

## MODIFIED Requirements

### Requirement: Exact edit replaces one current unique match

`edit` MUST accept an absolute local path, a valid `file://` alias, a non-empty `oldText`, and
`newText`. While a Workspace is entered, it MUST also accept a relative local path resolved from
the Workspace root under the local path rules above. A file alias is always absolute and is decoded
before the native operation. `edit` MUST read the current file at execution time and MUST require
exactly one exact occurrence of `oldText`. A missing or ambiguous occurrence MUST fail without
mutation. An unrelated change elsewhere in the file MUST NOT block a correct unique replacement.
Calls that target the same path MUST execute one after the other in the host runtime. The operation
MUST keep the bytes outside the replacement. The result MUST carry post-edit `content` with two
adjacent live lines on each side when available, the post-edit line count as `lineCount`, and
`display` with `startLine`, `oldText`, and `newText`. The result MUST NOT carry a diff. No prior
read, snapshot tag, read hash, or permission rule is required in this iteration.

#### Scenario: Unrelated change does not block edit

- **WHEN** another writer changes a different paragraph after the model read, while `oldText` remains one exact match
- **THEN** edit replaces the match and preserves the unrelated change

#### Scenario: Changed target fails without mutation

- **WHEN** another writer changes the exact old text before edit executes
- **THEN** edit returns a stale/missing-target error
- **AND** it does not write the replacement

#### Scenario: Duplicate target fails closed

- **WHEN** `oldText` occurs more than once
- **THEN** edit returns an ambiguity error with no mutation
- **AND** it does not replace every occurrence implicitly

#### Scenario: Sequential same-path calls are first-writer-wins

- **WHEN** two edit calls both request `-Foo +Bar` and `-Foo +Baz` against the same current bytes
- **THEN** the first call applies
- **AND** the second call observes the changed bytes and fails without overwriting the first result

#### Scenario: File URL edit uses the decoded host target

- **WHEN** `edit` targets `file:///tmp/guide.md` with one matching `oldText`
- **THEN** it applies the exact unique replacement to `/tmp/guide.md`
- **AND** it reports the same post-edit region and decoded result identity as an edit naming `/tmp/guide.md`

#### Scenario: Workspace-relative edit uses the resolved local path

- **WHEN** the model edits `src/app.ts` while a Workspace is entered at `/work/project`
- **THEN** the host applies the edit to `/work/project/src/app.ts`
- **AND** the result identifies `/work/project/src/app.ts` as the path used

#### Scenario: The stored edit carries display data and no diff

- **WHEN** the model replaces lines 12-13 of a 40-line `src/app.ts` with three lines
- **THEN** the stored result carries `display` with `startLine` 12, the two replaced lines as `oldText`, and the three new lines as `newText`
- **AND** it carries `content` for lines 10 to 16, `lineCount` 41, and no `diff` key

### Requirement: Image reads return an image result

A native `read` MUST return an image result when the bytes it acquires are a PNG, JPEG, GIF, or
WebP image: a host path, `file:` alias, or Workspace-relative path, `kb://`, `skill://`, a web image
body, or `media://`. The model-facing result MUST carry `status: "success"`, `kind: "image"`, the
original's `mediaType`, `width`, and `height`, and the source's existing attribution fields, and no
`content` or image bytes. The result MUST NOT depend on the Run's model.

#### Scenario: A host PNG returns an image result

- **WHEN** the model reads `/work/shot.png`, a regular file whose bytes are a 1600 by 900 PNG image
- **THEN** the result has `status: "success"`, `kind: "image"`, `mediaType` `image/png`, `width` 1600, `height` 900, and `path` `/work/shot.png`
- **AND** it carries no `media` field, no `content`, and no encoding of the image bytes
- **AND** its stored tool output carries `display.thumbnail`, which the model never receives

#### Scenario: A skill image keeps the skill envelope

- **WHEN** the model reads `skill://pdf/assets/sample.png`, whose bytes are a PNG image
- **THEN** the result is the image result with the logical locator, selected source, `resolvedPath`, and `skillDirectory`
- **AND** it carries no `content`

#### Scenario: A model without image input still receives the envelope

- **WHEN** a Run whose model declares no image input reads `/work/shot.png`, whose bytes are a PNG image
- **THEN** the tool result is the same image result that a Run on a model declaring image input receives
- **AND** the image is decoded all the same, and its stored tool output carries the same `display.thumbnail`

### Requirement: Only a media read's image result carries a media locator

Only a `media://` read's image result MUST carry `media`, the stored object's locator. Every other
image result MUST carry no `media` field and no `media://` locator. It MUST be stored in its tool
output with the display-only thumbnail that `media-attachments` defines, as `display.thumbnail`,
when one fits its cap. That thumbnail never reaches the model.

#### Scenario: An unstored image result carries a thumbnail and no locator

- **WHEN** the model reads `https://example.test/shot.png`, which serves a PNG image
- **THEN** the result carries no `media` field and no `media://` locator
- **AND** its stored tool output carries `display.thumbnail`, which no model request carries

## ADDED Requirements

### Requirement: A write result carries no content

A successful `write` MUST store the mutated locator, the `created` or `replaced` marker, and the
written file's line count as `lineCount`. It MUST NOT store the written content or a diff. The owner
UI MUST render the written content from the call's `content` argument.

#### Scenario: A stored write is status only

- **WHEN** the model writes a 216-line file
- **THEN** the stored result carries `created: true` and `lineCount: 216`
- **AND** it carries no `content` and no `diff` key

### Requirement: A text read carries the source line count when it is known

A successful text read of a regular file, a web render, or a `kb://` or `skill://` file MUST
carry the source's line count as `lineCount`. A directory listing MUST carry its requested-level
entry count as `entryCount`. An outline MUST NOT carry `lineCount`, because its scan can stop
before the source end. A Machine read MUST carry the count the daemon reports and MUST omit it
when the daemon sends none.

#### Scenario: A ranged read reports the total

- **WHEN** the model reads `src/app.ts:12-40` of a 216-line file
- **THEN** the result carries `lineCount: 216`

#### Scenario: An outline carries no total

- **WHEN** the model reads `README.md:outline`
- **THEN** the result carries no `lineCount`

#### Scenario: An old daemon sends no count

- **WHEN** a Machine daemon that predates this field answers an `fs.read`
- **THEN** the hub result carries no `lineCount`
- **AND** the read succeeds with its other fields unchanged
