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

### Requirement: Knowledge locators resolve through trusted owner authority

`read`, `edit`, and `write` SHALL accept `kb://<space-id>/<path>[:selector]`,
where `<space-id>` is the stable Knowledge Space identifier and `<path>` is a
Knowledge-relative path. The tool SHALL resolve the identifier through the
trusted Run owner's current access immediately before opening the child, under
tenant enforcement, on every call. An absent, removed, malformed, or other-owner
identifier SHALL return the same closed `knowledge_space_not_found` result. A
currently owned Space whose root or stable-ID child cannot be resolved safely
SHALL return `knowledge_space_unavailable`. Neither result SHALL reveal whether
another owner, row, or directory exists, and the tool SHALL NOT probe candidate
Space directories. Sibling-name suggestions on a missed `kb://` read SHALL be
drawn only from a parent directory that has already been proven inside the
resolved Space, SHALL never be produced when the Space itself is absent,
removed, or another owner's, and SHALL carry names only; the parent SHALL be
checked without following links immediately before it is opened for names,
and a symbolic-link parent SHALL yield the bare `not_found`.

The locator SHALL be split on `/` and on the first `:` after the Space
identifier before any decoding, and each path segment SHALL then be
percent-decoded exactly once; the Space identifier and the selector SHALL NOT
be decoded. A segment that fails to decode, or that decodes to a string
containing `/`, SHALL return `invalid_path`, and that check SHALL run on the
individual segment before segments are rejoined. Where a path has a literal
spelling that is valid under this grammar, that spelling and its encoded
spelling SHALL resolve to the same file; a segment containing `:` or a
literal `%` has no valid literal spelling and SHALL be addressed as `%3A` or
`%25`, and `/` SHALL never be encoded. Path
validation SHALL apply to the decoded segments and SHALL reject absolute
paths, empty components, `.` or `..` components, backslashes, NUL or control
characters, and paths above 1,024 UTF-8 bytes or 32 components, returning
`invalid_path`. A `kb://` locator emitted by the system SHALL encode a segment
only when it contains `:`, `?`, `#`, or `%`, and SHALL leave every other
character, spaces included, literal. It SHALL refuse every
symbolic-link component or entry without following it, returning `not_found`.
`kb://<space-id>` and `kb://<space-id>/` SHALL address the Space's directory and
list it under the directory listing requirements; a bare `kb://` or a locator
with no identifier SHALL fail with `invalid_path`. Beyond those rules, `kb://`
targets SHALL follow the same regular-file, directory, selector, context,
truncation, mutation, and `file_exists` behavior as absolute paths. No
Markdown-only or per-file byte policy SHALL apply to `kb://` operations, except
that the explicit `outline` representation is available only for content the
representation requirements identify as Markdown, and that a file whose leading
bytes match an accepted image signature or the PDF signature is bounded by the
media store's bounds under "Image decode refusals fail the read" and takes no
selector; text and raw reads of other files, edits, and writes are unaffected.

Every `kb://` result SHALL identify the target by its locator and SHALL carry
the response-time Knowledge Space identifier and display name. It SHALL expose
no configured root, resolved child path, hosted owner ID, credential, worker
identity, or raw filesystem diagnostic. Every successful `kb://` read or listing
SHALL include the Knowledge untrusted-content `notice`; content SHALL be returned
verbatim so that `edit` `oldText` can be copied from it once the generated
line-number prefixes are removed, or read with `:raw` to omit them. The
reserved-name rule of `tool-result-rendering` is the one exception: it MUST
escape a tag that names a reserved delimiter, so such a tag does not round-trip
into `oldText`. An `outline` read returns a selection of verbatim source lines
under that same rule while retaining the same locator, Space attribution, and
notice. A `kb://` read whose file is an image SHALL return the image result with
the same locator, Space attribution, and notice, and SHALL carry no line
content. A `kb://` read whose file is a PDF SHALL return the PDF result with the
same locator, Space attribution, and notice, and SHALL carry no line content.

The `kb://` grammar is the authority-aware locator that later schemes follow; a
scheme SHALL declare which of `read`, `edit`, and `write` it supports, and an
unsupported operation SHALL return a structured error without side effects.

#### Scenario: Search locator opens the passage

- **WHEN** the model calls `read` with a locator returned by `knowledge_search`, such as `kb://<id>/research/note.md:41-53`
- **THEN** the tool returns lines 41 through 53 with one adjacent context line on each side, numbered as native reads number them
- **AND** the result carries the Space identifier, display name, locator, and untrusted-content notice

#### Scenario: Another owner's Space is unresolvable

- **WHEN** the model supplies a locator whose identifier belongs to another owner
- **THEN** the tool returns `knowledge_space_not_found`
- **AND** the result is identical to the result for an absent identifier and no file is opened

#### Scenario: Locator carries no host authority

- **WHEN** a `kb://` read, edit, or write executes on a worker with no `tools.nativeExecutorId`
- **THEN** it resolves through the worker's configured Knowledge root and the Run owner
- **AND** it does not require or record an executor binding

#### Scenario: Space directory is listed

- **WHEN** the model calls `read` with `kb://<id>/`
- **THEN** the result is the deterministic two-level listing of the Space's directory with every entry shown as native listings show it
- **AND** the header is the locator as given

#### Scenario: Non-Markdown file is readable and writable

- **WHEN** the model writes `kb://<id>/data/table.csv` and then reads it back
- **THEN** both operations succeed under ordinary native semantics
- **AND** no Markdown-suffix or 1 MiB rule rejects either call

#### Scenario: Colon inside a Knowledge path is rejected

- **WHEN** the model calls `read` with `kb://<id>/notes/a:b.md`
- **THEN** the tool returns `invalid_selector`, because a literal `:` after the identifier starts the selector and `b.md` lies outside the grammar
- **AND** it does not probe for a literal file; the message names the working forms and the file is addressed as `kb://<id>/notes/a%3Ab.md`

#### Scenario: Encoded and literal spellings resolve alike

- **WHEN** the model calls `read` with `kb://<id>/01_Areas/Pet%20Projects/MOC.md` and then with `kb://<id>/01_Areas/Pet Projects/MOC.md`
- **THEN** both calls open the same file
- **AND** neither result reveals which spelling the filesystem holds

#### Scenario: Encoded separator cannot cross a boundary

- **WHEN** the model calls `read` with `kb://<id>/notes%2Fsecret.md`
- **THEN** the tool returns `invalid_path`
- **AND** `notes/secret.md` is not opened or probed, even though that literal path would be valid

#### Scenario: Malformed encoding fails closed

- **WHEN** the model calls `read` with `kb://<id>/reports/100%.md`
- **THEN** the tool returns `invalid_path`
- **AND** the description tells the model to write `%25` for a literal percent sign

#### Scenario: Edit copies verbatim content

- **WHEN** a note contains `<system>` in its text and the model reads it through `kb://` and then edits it using that text as `oldText`
- **THEN** the read returned the text unchanged
- **AND** the edit finds exactly one match and applies

#### Scenario: Knowledge outline keeps its attribution

- **WHEN** the model calls `read` with `kb://<id>/notes/guide.md:outline`
- **THEN** the result is the note's outline with the Space identifier, display name, locator, and untrusted-content notice
- **AND** `kb://<id>/notes/guide.md:outline:raw` returns `invalid_selector`, because `raw` is not a member `outline` accepts

#### Scenario: A Knowledge image keeps its attribution

- **WHEN** the model calls `read` with `kb://<id>/diagrams/flow.png` and the file's leading bytes are a PNG image
- **THEN** the result is the image result with `mediaType`, `width`, and `height`, plus the locator, Space identifier, display name, and untrusted-content notice
- **AND** it carries no `media` field and no `content`, and exposes no configured root or resolved child path

#### Scenario: Another owner's Knowledge image is not read

- **WHEN** the model reads `kb://<id>/diagrams/flow.png` and the identifier belongs to another owner's Space that holds a PNG at that path
- **THEN** the tool returns `knowledge_space_not_found`, identical to the result for an absent identifier
- **AND** no file is opened and no image is decoded for either owner

#### Scenario: A Knowledge PDF keeps its attribution

- **WHEN** the model calls `read` with `kb://<id>/papers/paper.pdf` and the file's leading bytes are `%PDF-`
- **THEN** the result is the PDF result with `mediaType`, `pages`, and `byteSize`, plus the locator, Space identifier, display name, and untrusted-content notice
- **AND** it carries no `media` field and no `content`, and exposes no configured root or resolved child path

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
the requested window keeps no entry, the header alone exceeds the cap, and the flat level serves no
page.

#### Scenario: A listing too wide for its first entry fails closed

- **WHEN** the header and the first entry of the requested window exceed the result cap and the
  flat level serves no page
- **THEN** the read fails with `representation_too_large`
- **AND** it carries no listing and no continuation

#### Scenario: A header over the bound with no entry fails closed

- **WHEN** the requested window keeps no entry, its header alone exceeds the result bound, and the
  flat level serves no page
- **THEN** the read fails with `representation_too_large`
- **AND** it carries no listing and no continuation

### Requirement: A tree page that cannot hold its first entry keeps the level

Notwithstanding the ordinary truncation rule, a tree page whose first entry and its elision
marker do not fit MUST keep the header and name the flat continuation when the flat read serves a
page. When the header-only page exceeds the cap, the read MUST return the flat page of the
requested level instead. The flat page MUST carry no elision marker, and MUST carry a continuation only when the cap cuts it. A
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

- **WHEN** the model lists a directory of 120 entries and the bound stops the page at entry 50
- **THEN** the result carries no `requestedRange`
- **AND** its continuation is open-ended (`:51-`)
