# Spec Delta

## MODIFIED Requirements

### Requirement: Directory listing bounds favor the requested level

Each directory read for a listing MUST keep at most 10,000 entry names for ordering and MUST count
the entries beyond that budget. A requested directory over the budget MUST fail with
`directory_too_large`, the entry count, and no listing. A child directory over the budget MUST
render only its `- name/` line and one indented `… N entries` line with the exact count. The budget
MUST NOT cap the requested directory's own entries. Within the budget, a child directory MUST
render at most 20 entries in order, then one `… N more` line with the omitted count when any were
omitted. An empty child directory MUST render its `- name/` line alone, so a bare child line means
empty and an `… N entries` line means elided. When the rendered two-level listing exceeds the common
native result cap, the tool MUST replace whole child blocks from the last, each block by one
indented `… N entries` line with that child's total entry count, and MUST keep every requested-level
line. That marker MUST count toward the requested level size and MUST NOT occupy an entry index.
When the requested level and its markers still exceed the cap, ordinary truncation MUST apply over
the requested-level entries in order, each marker with its entry, and `nextOffset` MUST name the
next requested-level entry index not emitted. A range selector on a directory path MUST produce a
flat listing of the requested level: the header, then the selected entries by one-based entry
index, with no child entries and no context expansion, whether or not the two-level listing would
fit. `nextOffset` MUST name the next entry index of the requested level. A `:raw` selector on a
directory MUST fail with a selector error.

#### Scenario: Requested directory over the traversal budget fails closed

- **WHEN** the model reads a directory holding more than 10,000 entries
- **THEN** the tool returns `directory_too_large` with the entry count
- **AND** it emits no listing

#### Scenario: Child directory over the traversal budget is elided

- **WHEN** a child directory holds more than 10,000 entries
- **THEN** the listing shows that child's `- name/` line followed by `… N entries` with the exact count
- **AND** no entry of that child is rendered

#### Scenario: Large child directory is summarized

- **WHEN** a child directory holds more than 20 entries
- **THEN** the listing shows its first 20 entries in order followed by `… N more` with the exact omitted count

#### Scenario: Oversized listing keeps the requested level

- **WHEN** the rendered two-level listing exceeds the common result cap but the requested level fits
- **THEN** whole child blocks are replaced last-first by `… N entries` lines until the listing fits
- **AND** every requested-level entry remains present with no partially rendered child block
- **AND** an empty child directory still renders as a bare `- name/` line

#### Scenario: Oversized requested level pages by selector

- **WHEN** the requested directory's own entries alone exceed the common result cap
- **THEN** the result carries the ordinary truncation details with `nextOffset`
- **AND** a range selector such as `:201-400` on the same directory returns the header and entries 201 through 400 of the requested level only

#### Scenario: Range selector on a small directory is flat

- **WHEN** the model reads a directory whose two-level listing fits the cap, with the selector `:1-5`
- **THEN** content is the header followed by the first five requested-level entries
- **AND** no child directory entries appear

#### Scenario: Raw selector on a directory is rejected

- **WHEN** the model reads a directory path with the `:raw` selector
- **THEN** the tool returns a selector error and no listing

### Requirement: Exact edit replaces one current unique match

`edit` MUST accept an absolute local path, a valid `file://` alias, a non-empty `oldText`, and
`newText`. While a Workspace is entered, it MUST also accept a relative local path resolved from
the Workspace root under the local path rules above. A file alias is always absolute and is decoded
before the native operation. `edit` MUST read the current file at execution time and MUST require
exactly one exact occurrence of `oldText`. A missing or ambiguous occurrence MUST fail without
mutation. An unrelated change elsewhere in the file MUST NOT block a correct unique replacement.
Calls that target the same path MUST execute one after the other in the host runtime. The operation
MUST keep the bytes outside the replacement. The result MUST carry bounded post-edit `content`
with two adjacent live lines on each side when available, marked `truncated` when the bound cuts
it. It MUST carry `cut: true` for that same cut, so a cap that overwrites `truncated` cannot hide
it. It MUST carry the post-edit line count as `lineCount` and `display` with `startLine`,
`oldText`, and `newText`. The result MUST NOT carry a diff. No prior
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
WebP image. The source can be a host path, `file:` alias, or Workspace-relative path, `kb://`,
`skill://`, a web image body, or `media://`. The model-facing result MUST carry `status: "success"`, `kind: "image"`, the
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

A successful text read MUST carry the source's line count as `lineCount` when the count is
known. It is known for a web render, and for a regular file, `kb://` file, or `skill://` file of
at most 32 MiB, counted by a byte scan for line feeds without a decode. A larger file, and an
outline, MUST carry no `lineCount`. A directory listing MUST carry its requested-level entry count
as `entryCount`. A Machine read MUST carry the count the daemon reports and MUST omit it when the
daemon sends none.

#### Scenario: A ranged read reports the total

- **WHEN** the model reads `src/app.ts:12-40` of a 216-line file
- **THEN** the result carries `lineCount: 216`

#### Scenario: A large file carries no total

- **WHEN** the model reads `big.log:1-10` of a 2 GiB file
- **THEN** the result carries no `lineCount`
- **AND** the read does not scan the whole file

#### Scenario: Invalid bytes after the window do not fail the read

- **WHEN** the model reads `data.txt:1-10` of a 1 MiB file whose last line holds invalid UTF-8
- **THEN** the read succeeds with `lineCount` from the byte scan

#### Scenario: An outline carries no total

- **WHEN** the model reads `README.md:outline`
- **THEN** the result carries no `lineCount`

#### Scenario: An old daemon sends no count

- **WHEN** a Machine daemon that predates this field answers an `fs.read`
- **THEN** the hub result carries no `lineCount`
- **AND** the read succeeds with its other fields unchanged

### Requirement: A listing page that cannot advance fails closed

Notwithstanding the ordinary truncation rule, when the header and the first entry of the requested
window leave no room in the result cap and the flat level serves no page, the read MUST fail with
`representation_too_large` and MUST carry no listing and no continuation. The same MUST hold when
the requested window keeps no entry and the header alone exceeds the cap.

#### Scenario: A listing too wide for its first entry fails closed

- **WHEN** the header and the first entry of the requested window exceed the result cap
- **THEN** the read fails with `representation_too_large`
- **AND** it carries no listing and no continuation

#### Scenario: A header over the bound with no entry fails closed

- **WHEN** the requested window keeps no entry and its header alone exceeds the result bound
- **THEN** the read fails with `representation_too_large`
- **AND** it carries no listing and no continuation

### Requirement: A tree page that cannot hold its first entry keeps the level

Notwithstanding the ordinary truncation rule, a tree page whose first entry and its elision
marker do not fit MUST keep the header and name the flat continuation when the flat read serves a
page. When the header-only page exceeds the cap, the read MUST return the flat page of the
requested level instead. The flat page MUST carry no elision marker and its own continuation. A
flat level that serves no page MUST fail as the fail-closed rule states.

#### Scenario: A first entry that does not fit keeps the header

- **WHEN** the first requested-level entry and its elision marker do not fit the cap, the header
  alone fits with its continuation, and the flat read serves a page
- **THEN** the content is the header alone, with `truncated: true` and `nextOffset: 0`
- **AND** the continuation names the flat read

#### Scenario: A header page that does not fit returns the flat level

- **WHEN** the flat level fits the cap and the header alone with its continuation does not
- **THEN** the content is the flat page of the requested level, with no elision marker
- **AND** the result is not truncated and carries no continuation

### Requirement: An unselected read requests the whole source

A text file read with no line selector MUST report `requestedRange` from its first line to its
`lineCount` when the count is known and non-zero, so a read cut by the bound resumes to the end of
the source. When the count is unknown, `requestedRange` MUST end at line 2000, the read line
ceiling. An empty file and a directory listing MUST report no `requestedRange`; a listing's
continuation stays open-ended.

#### Scenario: An unselected read of a counted file requests every line

- **WHEN** the model reads `notes.txt` of a 3,000-line file and the bound cuts it at line 1500
- **THEN** the result carries `requestedRange` 1..3000 and `nextOffset: 1500`

#### Scenario: An empty file requests no range

- **WHEN** the model reads an empty `notes.txt`
- **THEN** the result carries `lineCount` 0
- **AND** it carries no `requestedRange`

#### Scenario: A listing reports no range

- **WHEN** the model reads a directory of two entries
- **THEN** the result carries no `requestedRange`
- **AND** its continuation is open-ended
