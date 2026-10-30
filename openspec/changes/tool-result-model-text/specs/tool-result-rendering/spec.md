# Spec Delta

## Purpose

Defines how a stored tool part becomes the text or JSON a model reads: one rendering function, the
`display` partition, the text shapes of the content-bearing tools, neutralization, and bound
measurement on the rendering.

## ADDED Requirements

### Requirement: One rendering function produces every model-facing tool result

The system MUST render each tool result a model receives through one rendering function. The input
of that function MUST be the stored tool part. For a success that is the result object. For a
failure it is the error text and the rejected locator. The function MUST produce the live tool result, the replayed
result of a later turn, and the kept result of a Continue Run. A tool MUST NOT bypass the function
with a result of its own text.

#### Scenario: Live and replayed renderings agree

- **WHEN** a tool result is rendered live and the same stored part is replayed in a later turn
- **THEN** the payload text of the replayed result equals the live rendering
- **AND** only the untrusted-output framing of the replay differs

#### Scenario: A tool without a text shape renders as JSON

- **WHEN** `search_conversations` returns a result
- **THEN** the live result and the Continue result carry the JSON rendering as a JSON output
- **AND** the replayed result embeds the same JSON text in its framing

#### Scenario: A stored failure renders its error text

- **WHEN** a `bash` call failed with `command_failed` and its stored error text contains `</tool-result>`
- **THEN** the live and replayed renderings carry the error text with that tag escaped
- **AND** the outcome is `command_failed` on both

### Requirement: Display data is stored and never rendered

A tool result can carry a `display` object. The stored part MUST keep `display` as the tool wrote
it. The rendering function MUST remove `display` before it renders. The rendering function MUST
also remove a top-level `thumbnail` from an image result stored before `display` existed. The
system MUST NOT persist `display` from a client part.

#### Scenario: Display data does not reach the model

- **WHEN** a result carries `display: { oldText: "a", newText: "b" }`
- **THEN** the live and replayed renderings contain neither key
- **AND** the stored part carries the object unchanged

#### Scenario: A stored image part with a top-level thumbnail replays without it

- **WHEN** an image part stored before this contract carries `thumbnail` at its top level
- **THEN** the replayed result carries no `thumbnail` and no part of its data URL

#### Scenario: A client part cannot persist display data

- **WHEN** an owner message carries a part with a `display` key
- **THEN** that part is not persisted

### Requirement: The global result cap measures the rendering

The result cap that `tool-calling` applies to every tool result MUST be measured on the rendering
of the result, which is its serialized form. A tool that bounds its own rendering under that cap
MUST be recorded unchanged by the cap. `display` is outside the rendering and therefore outside
the cap.

#### Scenario: A read filled to its bound is recorded unchanged

- **WHEN** a read renders to exactly 16,000 code units, continuation line included
- **THEN** the stored part carries no `truncationNotice`
- **AND** the model receives the rendering unchanged

#### Scenario: An oversized JSON result is still cut

- **WHEN** an MCP tool returns a result whose JSON rendering exceeds the cap
- **THEN** the cap shrinks the result as before and records one `truncationNotice`

### Requirement: Results that carry content render as text

The rendering function MUST render a `read`, `edit`, `write`, `grep`, or `bash` success as plain
text. The text MUST begin with one header line. A result that carries `content` MUST render the
content lines after the header and the attribution lines. A result that carries a
`truncationNotice` MUST render it as one bracketed line at the end. A success without `content`,
other than `write` and `bash`, MUST keep its JSON rendering: image, PDF, and skill-catalog results.

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

### Requirement: The read header names the source, the shown lines, and the total

A `read` text MUST begin with `<locator>:<start>-<end>`, with the shown range of the result. A
multi-range read MUST list its shown ranges with commas. An outline MUST use `<locator>:outline:<start>-<end>`.
A directory listing MUST use `<locator> (directory, entries <a>-<b>)`. When the result carries
`lineCount`, the header MUST end with `of <lineCount> lines` after one space. A listing ends with
`of <entryCount>` the same way. A null shown range MUST render `<locator>: empty`.

#### Scenario: A multi-range read lists its ranges

- **WHEN** the model reads `src/app.ts:10-12,40-42` of a 216-line file
- **THEN** the header is `src/app.ts:9-13,39-43 of 216 lines`

#### Scenario: A result without a line count omits the total

- **WHEN** a read part stored before this contract carries no `lineCount`
- **THEN** the header is `<locator>:<start>-<end>` with no `of … lines` suffix

#### Scenario: An empty file has an empty header

- **WHEN** the model reads an empty file
- **THEN** the result is `<locator>: empty` and no content lines

### Requirement: Attribution fields render as lines after the header

After the header, a text result MUST render one `<field>: <value>` line for each attribution field
it carries. The fields and their order are: `realPath`, `finalUrl`, `method`, `adapter`, `notes`,
`knowledgeSpaceName`, `knowledgeSpaceId`, `notice`, `locator`, `sourceDirectory`, `resolvedPath`,
`skillDirectory`, `realSkillDirectory`, `skillPathInstruction`. A notice MUST render verbatim.

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
line that gives the selector of the next read. The selector MUST continue the request form from
line `nextOffset + 1`. When the result carries `lineCount`, the line MUST name the remaining count.
A `grep` page with `complete: false` MUST end with one bracketed line that carries its cursor.

#### Scenario: A truncated read tells how to continue

- **WHEN** a read of a 3,000-line file stops at line 2,000 and the result carries `lineCount` 3000
- **THEN** the text ends with `[1000 more lines. Use <locator>:2001-3000 to continue]`

#### Scenario: A ranged read that is not truncated has no notice

- **WHEN** the model reads `src/app.ts:150-189` of a 562-line file and the result is not truncated
- **THEN** no bracketed line follows the content

#### Scenario: An outline resumes in its own form

- **WHEN** a read of `README.md:outline:1-900` stops at source line 400
- **THEN** the text ends with `[Use README.md:outline:401-900 to continue]`

#### Scenario: A listing resumes at the next entry

- **WHEN** a directory listing of 120 entries stops at entry 50
- **THEN** the text ends with `[70 more entries. Use <locator>:51 to continue]`

#### Scenario: A multi-range read resumes with its remaining members

- **WHEN** a read of `:1-2500,4000-4010` stops at line 2,000
- **THEN** the text ends with `[Use <locator>:2001-2500,4000-4010 to continue]`

### Requirement: An edit renders its post-edit region

An `edit` text MUST begin with `edited <locator>: line <startLine>, <old> -> <new> lines`, with
the counts of the replaced and replacement lines. When the result carries `lineCount`, the header
continues with `(<lineCount> lines total)` after one space. The numbered post-edit `content` MUST follow. The text MUST NOT carry a
diff, the old text, or the new text as a separate block. A stored edit without `display` MUST
render its header from `shownRange` and omit the counts.

#### Scenario: A four-line edit renders its region

- **WHEN** the model replaces lines 161-164 with five lines in a 562-line file
- **THEN** the header is `edited <locator>: line 161, 4 -> 5 lines (563 lines total)`
- **AND** lines 159 to 167 follow, numbered from the post-edit file

#### Scenario: A stored edit without display data still renders

- **WHEN** an edit part stored before this contract carries `diff` and `content` and no `display`
- **THEN** the text is `edited <locator>: line <shownRange.startLine>` and the stored content lines
- **AND** the diff is not rendered

### Requirement: A write renders one status line

A `write` text MUST be `created <locator>` or `replaced <locator>`. When the result carries
`lineCount`, the line continues with `(<lineCount> lines)` after one space. Only attribution lines
can follow. It MUST NOT render
`content`, even when a stored part carries it.

#### Scenario: A created file reports its size

- **WHEN** the model writes a 216-line file to `new.ts`
- **THEN** the result is `created new.ts (216 lines)`

#### Scenario: A stored write with content renders status only

- **WHEN** a write part stored before this contract carries `content`
- **THEN** the text is `created <locator>` or `replaced <locator>` with no content lines

### Requirement: A grep page groups consecutive passages under one file line

A `grep` text MUST render each run of consecutive passages of one file under one `## <locator>`
line. That locator MUST be the file locator with no line range. `<locator>:<start>-<end>` built
from a rendered line number MUST be a valid `read` argument. Passages under one line MUST be separated by one
blank line. Non-empty warnings MUST render as one `[warnings: <count> <kind>, …]` line. A
Knowledge notice MUST render first.

#### Scenario: Two passages in one file share a header

- **WHEN** `src/app.ts` yields passages `:3-7` and `:40-42` in one scope
- **THEN** the text has one `## src/app.ts` line and the two passages separated by a blank line

#### Scenario: Overlapping scopes repeat the file line

- **WHEN** scopes `src/**` and `src/app.ts` both yield passages of `src/app.ts`
- **THEN** each scope's run of passages has its own `## src/app.ts` line, in scope order

#### Scenario: Warnings render as one line

- **WHEN** the walk skipped 3 binary files and stopped at the deadline
- **THEN** the text carries `[warnings: 3 binary, 1 deadline]`

### Requirement: A bash result renders a status header and its streams

A `bash` text MUST begin with `exit <code>`, then `, <seconds> s` with one decimal when the result
carries `wallTimeMs`. The stdout MUST follow verbatim. A non-empty stderr MUST follow under a
`[stderr]` line. When both streams are empty, the text MUST be the header and `(no output)`. A
`command_failed` message MUST be the same text shape with the non-zero exit code.

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

- **WHEN** a bash part stored before this contract carries no `wallTimeMs`
- **THEN** the header is `exit 0` with no time

### Requirement: Tool result payloads are neutralized by the reserved-name rule

The rendering function MUST pass each rendered payload, text or JSON string value, and each error
text through one neutralizer. The neutralizer MUST angle-escape each tag-shaped token that names a
reserved delimiter of `instance-config`, in any position, case, or spelling. It MUST NOT alter any
other character. No other neutralization MUST apply to a tool result on any path.

#### Scenario: Source markup survives

- **WHEN** a read result contains `</div>` with no opening tag in the window
- **THEN** the model receives `</div>` unchanged

#### Scenario: A reserved delimiter is escaped

- **WHEN** a bash result contains `</tool-result>`
- **THEN** the model receives `&lt;/tool-result&gt;`

#### Scenario: A JSON string value gets the same rule

- **WHEN** a `search_conversations` excerpt contains `</div>` and `<system-reminder>`
- **THEN** the model receives `</div>` unchanged and `&lt;system-reminder&gt;`

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
