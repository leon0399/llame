# Spec Delta

## Purpose

Defines how a tool result becomes the text or JSON a model reads: one rendering function, the
`display` partition, the text shapes of the content-bearing tools, neutralization, and bound
measurement on the rendering.

## ADDED Requirements

### Requirement: One rendering function produces every model-facing tool result

The system MUST render each tool result a model receives through one rendering function. The input
of that function MUST be the tool result object: a success object, or a failure object with its
type, message, and locators. Replay MUST rebuild the failure object from the stored outcome, error
text, and rejected locator. The function MUST produce the live result, the replayed result of a
later turn, and the kept result of a Continue Run. A tool MUST NOT bypass the function.

#### Scenario: Live and replayed renderings agree

- **WHEN** a tool result is rendered live and the same stored part is replayed in a later turn
- **THEN** the payload text of the replayed result equals the live rendering
- **AND** only the untrusted-output framing of the replay differs

#### Scenario: A tool without a text shape renders as JSON

- **WHEN** `search_conversations` returns a result
- **THEN** the live result and the Continue result carry the JSON rendering as a JSON output
- **AND** the replayed result embeds the same JSON text in its framing

#### Scenario: A failure renders as JSON with its type

- **WHEN** a `bash` call fails with `command_failed` and its message contains `</tool-result>`
- **THEN** the live rendering is the JSON failure object with `type: "command_failed"` and the tag escaped
- **AND** the replayed rendering is the same JSON rebuilt from the stored outcome and error text

#### Scenario: A media reference survives the rendering

- **WHEN** the model reads a PNG file live, and the part replays in a later turn
- **THEN** both renderings carry the JSON image text and the image reference the step composer attaches
- **AND** the native JSON rendering keeps the SDK output type `text`

### Requirement: Display data is stored and never rendered

A tool result can carry a `display` object. The stored part MUST keep `display` as the tool wrote
it. The rendering function MUST remove `display` before it renders. The rendering function MUST
also remove a top-level `thumbnail` from an image result stored without `display`. The system
MUST NOT accept `display` from a client.

#### Scenario: Display data does not reach the model

- **WHEN** a result carries `display: { oldText: "a", newText: "b" }`
- **THEN** the live and replayed renderings contain neither key
- **AND** the stored part carries the object unchanged

#### Scenario: A stored image part with a top-level thumbnail replays without it

- **WHEN** an image part stored without `display` carries `thumbnail` at its top level
- **THEN** the replayed result carries no `thumbnail` and no part of its data URL

#### Scenario: A client cannot supply display data

- **WHEN** an owner message carries a part with a `display` key
- **THEN** the request is rejected and nothing is persisted

### Requirement: The global result cap measures the rendering

The result cap that `tool-calling` applies to every tool result MUST be measured on the rendering
of the result, which is its serialized form. A tool that bounds its own rendering under that cap
MUST be recorded unchanged by the cap. The stored `display` object is not rendered as raw text, so
the cap MUST NOT count it. Text the rendering builds from `display` values MUST count: an edit
header names the stored start line and line counts.

#### Scenario: A read filled to its bound is recorded unchanged

- **WHEN** a read renders to exactly 16,000 code units, continuation line included
- **THEN** the stored part carries no `truncationNotice`
- **AND** the model receives the rendering unchanged

#### Scenario: A header built from display data is measured

- **WHEN** an edit result carries `display` and its rendering names the start line and counts
- **THEN** the cap measures those header characters, not the legacy header
- **AND** the stored `display` object itself is not counted

#### Scenario: An oversized JSON result is still cut

- **WHEN** an MCP tool returns a result whose JSON rendering exceeds the cap
- **THEN** the cap shrinks the result as before and records one `truncationNotice`

### Requirement: Results that carry content render as text

The rendering function MUST render a `read`, `edit`, `write`, `grep`, or `bash` success as plain
text. The text MUST begin with one header line. A result that carries `content` MUST render the
content lines after the header and the attribution lines. A result that carries a
`truncationNotice` MUST render it as one bracketed line at the end. Image, PDF, and skill-catalog
results MUST keep their JSON rendering.

#### Scenario: A file read renders as text

- **WHEN** the model reads `src/app.ts:12-40` of a 216-line file
- **THEN** the result starts with `src/app.ts:11-41 of 216 lines`
- **AND** the numbered lines follow with no JSON quoting

#### Scenario: An image read keeps JSON

- **WHEN** the model reads a PNG file
- **THEN** the result is the JSON image result with no `display` key

#### Scenario: A Machine variant renders the same way

- **WHEN** `read` runs on a Machine locator
- **THEN** the rendering is the text shape with the Machine locator in the header

#### Scenario: A cap notice renders as a line

- **WHEN** a stored `bash` part carries a `truncationNotice`
- **THEN** the text ends with that notice in brackets

### Requirement: Source lines use one prefix grammar

Each numbered source line MUST render as `N: text`, with `N` the one-based source line. A `grep`
matched line MUST render as `*N: text`. The renderer MUST NOT use another prefix form. A `raw`
read MUST render its content without prefixes.

#### Scenario: A grep window marks its match

- **WHEN** line 58 matches and line 59 is its context
- **THEN** the passage renders `*58: <text>` then `59: <text>`

#### Scenario: A raw read has no prefixes

- **WHEN** the model reads `notes.md:raw:3-4`
- **THEN** the two lines render verbatim after the header

### Requirement: The read header names the source and the shown lines

A `read` text MUST begin with one of these headers, with the shown range of the result:
`<locator>:<start>-<end>` for a single range, `<locator>:<a>-<b>,<c>-<d>` for a multi-range read,
`<locator>:raw:<start>-<end>` for a raw read, `<locator>:outline:<start>-<end>` for an outline.
A directory listing MUST render its stored content, whose first line is the path, with no extra
header. A null shown range MUST render `<locator>: empty` when the result is not truncated.

#### Scenario: A multi-range read lists its ranges

- **WHEN** the model reads `src/app.ts:10-12,40-42` of a 216-line file
- **THEN** the header is `src/app.ts:9-13,39-43 of 216 lines`

#### Scenario: A raw read names its form

- **WHEN** the model reads `notes.md:raw:3-4`
- **THEN** the header is `notes.md:raw:3-4 of 40 lines`

#### Scenario: An empty file has an empty header

- **WHEN** the model reads an empty file
- **THEN** the result is `<locator>: empty` and no content lines

#### Scenario: An oversized first line is reported, not emptied

- **WHEN** the first line of `x.min.js` exceeds the result bound and the result has a null shown range
- **THEN** the header is `x.min.js: line 1 exceeds the result bound and was skipped`
- **AND** the continuation line follows

### Requirement: A read stored without ranges names its locator alone

A `read` result that carries neither `shownRange` nor `shownRanges` MUST render the bare `<locator>`
as its header, followed by `of <lineCount> lines` after one space when the result stores the total. Such a result
MUST NOT render `<locator>: empty`: it carries content, and an `empty` header denies it. A result
whose `shownRange` is explicitly null MUST keep the `<locator>: empty` header.

#### Scenario: A part stored without range keys keeps its content visible

- **WHEN** a `read` part stored before the ranges were kept carries `content`, `lineCount` 216,
  and no `shownRange`, `shownRanges`, or `representation`
- **THEN** the header is `<locator> of 216 lines`
- **AND** the content lines follow, with no `empty` in the header

### Requirement: The read header carries the source total when it is stored

When a `read` result carries `lineCount`, its header MUST end with `of <lineCount> lines` after
one space. A header without `lineCount` MUST carry no suffix. A directory listing MUST NOT add a
total to its content; its continuation line names the remaining entries.

#### Scenario: A result without a line count omits the total

- **WHEN** a read part stored without `lineCount` renders
- **THEN** the header is `<locator>:<start>-<end>` with no `of … lines` suffix

#### Scenario: A ranged read reports the total

- **WHEN** the model reads `src/app.ts:12-40` and the result carries `lineCount` 216
- **THEN** the header is `src/app.ts:11-41 of 216 lines`

### Requirement: Attribution fields render as lines after the header

After the header, a text result MUST render one `<field>: <value>` line for each attribution field
it carries. The fields and their order are: `realPath`, `finalUrl`, `method`, `adapter`, `notes`,
`knowledgeSpaceName`, `knowledgeSpaceId`, `notice`, `locator`, `sourceDirectory`, `resolvedPath`,
`skillDirectory`, `realSkillDirectory`, `skillPathInstruction`. `adapter` MUST render `id route`
and `origin` when present. `notes` MUST render one line per entry. A notice MUST render verbatim.

#### Scenario: A web read carries its attribution

- **WHEN** the model reads `https://example.test/doc` and the publisher served Markdown
- **THEN** the header is followed by `finalUrl: …` and `method: negotiated`

#### Scenario: A Knowledge read keeps its notice verbatim

- **WHEN** the model reads `kb://notes/plan.md`
- **THEN** a `notice:` line carries the closed Knowledge notice unchanged

#### Scenario: Structured attribution fields render as one line each

- **WHEN** a web read result carries `adapter: { id: "github", route: "rewrite", origin: "…" }` and two `notes`
- **THEN** the text carries `adapter: github rewrite …` and one `notes:` line per entry

#### Scenario: The header is not part of the stored content

- **WHEN** a web read renders with a header and attribution lines
- **THEN** the stored `content` carries no header and no attribution line

### Requirement: Continuation is one bracketed notice line

When a result carries `truncated: true` and a `nextOffset`, the text MUST end with one bracketed
line with the selector of the next read: the request form from line `nextOffset + 1` to the stored
requested end, or open-ended `<n>-` once `nextOffset` has reached that end. When the result carries
`lineCount`, the line MUST name `lineCount - nextOffset` more lines. A `grep` page with
`complete: false` MUST end with one bracketed line that carries its cursor.

#### Scenario: A truncated read tells how to continue

- **WHEN** an unselected read of a 3,000-line file stops with `nextOffset` 2000 and `lineCount` 3000
- **THEN** the text ends with `[1000 more lines. Use <locator>:2001- to continue]`

#### Scenario: A cut inside the requested window resumes to the stored end

- **WHEN** an unselected read is cut by the bound with `nextOffset` 1500 and a stored requested end of 2000
- **THEN** the text ends with `[… Use <locator>:1501-2000 to continue]`
- **AND** an explicit `:1-2000` read cut at the same line ends the same way

#### Scenario: A ranged read that is not truncated has no notice

- **WHEN** the model reads `src/app.ts:150-189` of a 562-line file and the result is not truncated
- **THEN** no bracketed line follows the content

#### Scenario: A result without a line count omits the count

- **WHEN** a read part stored without `lineCount` is truncated with `nextOffset` 2000
- **THEN** the text ends with `[Use <locator>:2001- to continue]`

#### Scenario: An outline resumes in its own form

- **WHEN** a read of `README.md:outline:1-900` stops at source line 400
- **THEN** the text ends with `[Use README.md:outline:401-900 to continue]`

#### Scenario: A listing resumes at the next entry

- **WHEN** a directory listing of 120 entries stops with `nextOffset` 50 and `entryCount` 120
- **THEN** the text ends with `[70 more entries. Use <locator>:51- to continue]`

#### Scenario: A multi-range read resumes with its remaining members

- **WHEN** a read of `:1-2500,4000-4010` of a 5,000-line file stops with `nextOffset` 2000
- **THEN** the text ends with `[3000 more lines. Use <locator>:2001-2500,4000-4010 to continue]`

### Requirement: A locator without selector room states the remainder alone

A web locator that carries a query or a fragment takes no trailing selector, so a truncated file
`read` of it MUST NOT advise a selector read. Its continuation line MUST be
`[<count> more lines not shown; this locator takes no line selector]`, without the count when
`lineCount` is absent. A locator that takes a selector MUST keep the continuation read.

#### Scenario: A locator with a query states the remainder without advice

- **WHEN** a truncated read of `https://example.test/doc?version=1` stops with `nextOffset` 2000 and
  `lineCount` 3000
- **THEN** the text ends with `[1000 more lines not shown; this locator takes no line selector]`
- **AND** the text names no next read

#### Scenario: A selector-less locator stored without a total omits the count

- **WHEN** a truncated read of `https://example.test/doc#intro` carries no `lineCount`
- **THEN** the text ends with `[more lines not shown; this locator takes no line selector]`

### Requirement: An edit renders its post-edit region

An `edit` text MUST begin with `edited <locator>: line <startLine>, <old> -> <new> lines`, with
the counts of the replaced and replacement lines. When the result carries `lineCount`, the header
continues with `(<lineCount> lines total)` after one space. The numbered post-edit `content` MUST
follow. A `content` cut by the bound MUST end with `[region cut at the bound]`. The text MUST NOT
carry a diff, the old text, or the new text as a separate block.

#### Scenario: A four-line edit renders its region

- **WHEN** the model replaces lines 161-164 with five lines in a 562-line file
- **THEN** the header is `edited <locator>: line 161, 4 -> 5 lines (563 lines total)`
- **AND** lines 159 to 167 follow, numbered from the post-edit file

#### Scenario: A stored edit without display data still renders

- **WHEN** an edit part stored without `display` carries `diff`, `content`, and `shownRange` from line 11
- **THEN** the text is `edited <locator>: region from line 11` and the stored content lines
- **AND** the diff is not rendered

#### Scenario: A cut region is marked

- **WHEN** the post-edit region is cut by the result bound
- **THEN** the text ends with `[region cut at the bound]`

### Requirement: A write renders one status line

A `write` text MUST be `created <locator>` or `replaced <locator>`. When the result carries
`lineCount`, the line continues with `(<lineCount> lines)` after one space. Only attribution lines
can follow. The text MUST NOT render `content`, even when a stored part carries it.

#### Scenario: A created file reports its size

- **WHEN** the model writes a 216-line file to `new.ts`
- **THEN** the result is `created new.ts (216 lines)`

#### Scenario: A stored write with content renders status only

- **WHEN** a write part stored with `content` renders
- **THEN** the text is `created <locator>` or `replaced <locator>` with no content lines

### Requirement: A grep page groups consecutive passages under one file line

A `grep` text MUST render each run of consecutive passages of one file under one `## <locator>`
line, with the file locator and no line range. `<locator>:<start>-<end>` built from a rendered
line number MUST be a valid `read` argument. One blank line MUST separate passages under one
line. A capped twentieth passage MUST end with `[more passages in this file; read it to see
them]`. Non-empty warnings MUST render as one `[warnings: …]` line. A Knowledge notice MUST
render first.

#### Scenario: Two passages in one file share a header

- **WHEN** `src/app.ts` yields passages `:3-7` and `:40-42` in one scope
- **THEN** the text has one `## src/app.ts` line and the two passages separated by a blank line

#### Scenario: Overlapping scopes repeat the file line

- **WHEN** scopes `src/**` and `src/app.ts` both yield passages of `src/app.ts`
- **THEN** each scope's run of passages has its own `## src/app.ts` line, in scope order

#### Scenario: Warnings render as one line

- **WHEN** the walk skipped 3 binary files and stopped at the deadline
- **THEN** the text carries `[warnings: 3 binary, 1 deadline]`

#### Scenario: A capped file is marked

- **WHEN** one file holds 25 passages and the page carries its first 20
- **THEN** the twentieth passage ends with `[more passages in this file; read it to see them]`

### Requirement: A bash result renders a status header and its streams

A `bash` text MUST begin with `exit <code>`, then `, <seconds> s` with one decimal when the result
carries `wallTimeMs`. The stdout MUST follow verbatim. A non-empty stderr MUST follow under a
`[stderr]` line. When both streams are empty, the text MUST be the header and `(no output)`. A
result with `truncated: true` MUST end with `[output cut at the bound]`. A `command_failed`
message MUST be the same text shape with the non-zero exit code.

#### Scenario: A silent command reports no output

- **WHEN** `true` exits 0 after 12 ms
- **THEN** the result is `exit 0, 0.0 s` then `(no output)`

#### Scenario: Stderr is labelled

- **WHEN** a command writes to both streams
- **THEN** stdout follows the header and stderr follows a `[stderr]` line

#### Scenario: A failing command keeps the shape in its error

- **WHEN** `false` exits 1
- **THEN** the `command_failed` message is `exit 1, <seconds> s` then `(no output)`

#### Scenario: A stored bash part without wall time omits it

- **WHEN** a bash part stored without `wallTimeMs` renders
- **THEN** the header is `exit 0` with no time

#### Scenario: Cut output is marked

- **WHEN** a command's stdout is cut at the executor bound
- **THEN** the text ends with `[output cut at the bound]`

### Requirement: A grep passage cut at the page bound names the cursor

A passage the page cut to fit carries `cut: true` and MUST end with `[passage cut at the result
bound; continue with the cursor]`. A cut passage MUST NOT carry the capped-file notice unless it is
also the twentieth passage of its file.

#### Scenario: A cut passage does not claim a capped file

- **WHEN** the first passage of a page is cut at line 40 and its file holds no more than 20
  passages
- **THEN** that passage ends with `[passage cut at the result bound; continue with the cursor]`
- **AND** the text carries no `[more passages in this file; read it to see them]`

### Requirement: A timed-out command names no exit code

A `timed_out` text MUST begin with `timed out`, then `, <seconds> s` with one decimal when the
producer measured `wallTimeMs`. It MUST NOT name an exit code the command never reported. Its
streams follow the bash text shape.

#### Scenario: A timeout names its elapsed time

- **WHEN** a command is stopped by its deadline after 30.0 s with no output
- **THEN** the text is `timed out, 30.0 s` then `(no output)`

#### Scenario: A timeout before any command started names no time

- **WHEN** a call ends at its deadline before a command was spawned
- **THEN** the text is `timed out` then `(no output)`

### Requirement: Tool result payloads are neutralized by the reserved-name rule

The rendering function MUST pass each rendering through one neutralizer: a text rendering as a
whole, and every object key and string value of a JSON rendering. The neutralizer MUST
angle-escape each tag-shaped token that names a reserved delimiter of `instance-config`, in any
position, case, or spelling. It MUST NOT alter any other character. The system MUST NOT apply
another neutralization to a tool result on any path.

#### Scenario: Source markup survives

- **WHEN** a read result contains `</div>` with no opening tag in the window
- **THEN** the model receives `</div>` unchanged

#### Scenario: A reserved delimiter is escaped

- **WHEN** a bash result contains `</tool-result>`
- **THEN** the model receives `&lt;/tool-result&gt;`

#### Scenario: A JSON string value gets the same rule

- **WHEN** a `search_conversations` excerpt contains `</div>` and `<system-reminder>`
- **THEN** the model receives `</div>` unchanged and `&lt;system-reminder&gt;`

#### Scenario: A JSON object key gets the same rule

- **WHEN** an MCP result carries a `structuredContent` key named `<system-reminder>`
- **THEN** the live and replayed renderings carry that key escaped

### Requirement: Bounds are measured on the neutralized rendering

Each per-result bound a text-rendered tool enforces MUST be measured on the rendered text of the
candidate result after neutralization. The renderer and the neutralizer MUST be available to every
process that bounds a result, a Machine daemon included. A result MUST NOT be cut by a later stage
because its bound was measured in another form.

#### Scenario: A read fills its bound with rendered lines

- **WHEN** a read of a long file is bounded at 16,000 code units
- **THEN** the neutralized rendering, header and notice included, is at most 16,000 code units
- **AND** the JSON length of the stored object is not what was measured

#### Scenario: Escaping counts toward the bound

- **WHEN** a bounded read window contains ten `<skill>` tags
- **THEN** the sixty code units their escaping adds are inside the 16,000-unit bound
