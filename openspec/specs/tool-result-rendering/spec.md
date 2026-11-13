# tool-result-rendering

## Purpose

Defines how a tool result becomes the text or JSON a model reads: one rendering function, the
`display` partition, the text shapes of the content-bearing tools, neutralization, and bound
measurement on the rendering.

## Requirements

### Requirement: One rendering function produces every model-facing tool result

The system MUST render each tool result a model receives through one rendering function. The input
of that function MUST be the tool result object: a success object, or a failure object with its
type, message, and locators. Replay MUST rebuild the failure object from the stored outcome, error
text, and rejected locator. The function MUST produce the live result, the replayed result of a
later turn, and the kept result of a Continue Run. A call that the AI SDK refused before llame ran
it is the one exception. The SDK makes its live result, and `turn-replay` defines its replay. A tool MUST NOT bypass the function.

#### Scenario: Live and replayed renderings agree

- **WHEN** a tool result is rendered live and the same stored part is replayed in a later turn
- **THEN** the payload text of the replayed result equals the live rendering
- **AND** the replayed result has the output type of the live result, with no frame around it

#### Scenario: A tool without a text shape renders as JSON

- **WHEN** `search_conversations` returns a result
- **THEN** the live result, the Continue result, and the replayed result carry the JSON rendering as a JSON output

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
it. The rendering function MUST read the `display` values its shape needs, such as the start line
of an edit header, and MUST NOT emit a `display` key: the object never reaches the model. A
top-level `thumbnail` on an image result stored without `display` MUST NOT reach the model either.
The system MUST NOT accept `display` from a client.

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
of the result, which is its serialized form for a JSON-rendered tool and its text shape for a
text-rendered tool. A tool that bounds its own rendering under that cap
MUST be recorded unchanged by the cap. The cap MUST NOT count the stored `display`
object. Text the rendering builds from `display` values MUST count. The cap MUST NOT set a tool's `cut` field.

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

The rendering function MUST render a `read`, `edit`, `write`, `grep`, `bash`,
or `web_search` success as plain text. An image, PDF, or skill-catalog result
MUST keep its JSON rendering. A file `read`, an `edit`, and a `write` MUST
begin with one header line. A `grep` text opens with its notice when it
carries one, or with its first `## <locator>` line. A file read and an `edit`
MUST render their `content` lines after the header and the attribution lines.

#### Scenario: A file read renders as text

- **WHEN** the model reads `src/app.ts:12-40` of a 216-line file
- **THEN** the result starts with `src/app.ts:11-41 of 216 lines`
- **AND** the numbered lines follow with no JSON quotes

#### Scenario: An image read keeps JSON

- **WHEN** the model reads a PNG file
- **THEN** the result is the JSON image result with no `display` key

#### Scenario: A Machine variant renders the same way

- **WHEN** `read` runs on a Machine locator
- **THEN** the rendering is the text shape with the Machine locator in the header

#### Scenario: A grep page opens with its notice

- **WHEN** a `grep` result carries a Knowledge notice
- **THEN** the text starts with that notice, before the first `## <locator>` line

#### Scenario: A web search renders as text

- **WHEN** a `web_search` call returns three results
- **THEN** the model receives the text shape of `web_search` with no JSON quotes

### Requirement: A directory listing renders its content without a header

A directory listing MUST render its stored content, whose first line is the path, with no extra
header, and its attribution lines after the content.

#### Scenario: A listing opens with its path

- **WHEN** the model lists a directory of two entries
- **THEN** the text starts with the directory path
- **AND** no header line precedes it

### Requirement: A cap notice ends the text

A result that carries a `truncationNotice` MUST render it as one bracketed
line. That line MUST be the last line of the text. It MUST come after each
continuation line, cut line, and artifact notice line.

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

A `read` text MUST begin with one of these headers, with the shown range of the result, or with
the bare-locator header its own requirement defines:
`<locator>:<start>-<end>` for a single range, `<locator>:<a>-<b>,<c>-<d>` for a multi-range read,
`<locator>:raw:<start>-<end>` for a raw read, `<locator>:outline:<start>-<end>` for an outline.
A null shown range MUST render `<locator>: empty` when the result is not truncated.

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

A `read` result that carries neither `shownRange` nor `shownRanges` MUST render the bare
`<locator>` as its header. Such a result MUST NOT render `<locator>: empty`: it carries content,
and an `empty` header denies it. A result whose `shownRange` is explicitly null MUST keep the
`<locator>: empty` header.

#### Scenario: A part stored without range keys keeps its content visible

- **WHEN** a `read` part stored before the ranges were kept carries `content` and no
  `shownRange`, `shownRanges`, `lineCount`, or `representation`
- **THEN** the header is the bare `<locator>`, with no total
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

After the header, a file `read`, an `edit`, and a `write` MUST render one `<field>: <value>` line
for each attribution field the result carries. A directory listing MUST render those lines after
its content. A `grep` page MUST render its `notice` first, as `notice: <notice>`, and MUST NOT
render it as an attribution line.

#### Scenario: A web read carries its attribution

- **WHEN** the model reads `https://example.test/doc` and the publisher served Markdown
- **THEN** the header is followed by `finalUrl: …` and `method: negotiated`

#### Scenario: The header is not part of the stored content

- **WHEN** a web read renders with a header and attribution lines
- **THEN** the stored `content` carries no header and no attribution line

### Requirement: Attribution fields keep the listed order

The attribution fields MUST render in this order: `realPath`, `finalUrl`, `method`, `adapter`,
`notes`, `knowledgeSpaceName`, `knowledgeSpaceId`, `notice`, `locator`, `sourceDirectory`,
`resolvedPath`, `skillDirectory`, `realSkillDirectory`, `skillPathInstruction`. `adapter` MUST
render `id route` and `origin` when present. `notes` MUST render one line per entry. A notice MUST
keep its stored text.

#### Scenario: A Knowledge read keeps its notice verbatim

- **WHEN** the model reads `kb://notes/plan.md`
- **THEN** a `notice:` line carries the closed Knowledge notice unchanged

#### Scenario: Structured attribution fields render as one line each

- **WHEN** a web read result carries `adapter: { id: "github", route: "rewrite", origin: "…" }` and two `notes`
- **THEN** the text carries `adapter: github rewrite …` and one `notes:` line per entry

### Requirement: Framing values render on one line

These stored values MUST render on one line, and one line break in such a
value MUST become one space:

- the `read` header and continuation paths,
- the mutation locator that opens an `edit` or `write` rendering,
- a `grep` `## <locator>` header,
- each locator of a `grep` `[ignored …]` line, and the locator of a `grep`
  `[not searched to the end: …]` line,
- each attribution value and each `notes` entry,
- the truncation notice of a `read` or `edit` result.

The Knowledge `notice` of a `grep` result MUST NOT fold its line breaks.

#### Scenario: A path with a line break renders on one line

- **WHEN** a stored `read` part carries a path of `a\nb.ts` and is truncated
- **THEN** the header and the continuation line carry `a b.ts` on one line
- **AND** the path adds no unprefixed line

#### Scenario: A grep file line stays one line

- **WHEN** a stored `grep` passage locator carries the path `a\nb.ts`
- **THEN** its `## a b.ts` line carries one space in place of the break
- **AND** the path adds no unprefixed line

#### Scenario: A mutation path stays on its status line

- **WHEN** a stored `write` part carries the path `a\nb.ts`
- **THEN** its `created a b.ts` line carries one space in place of the break

#### Scenario: A cap notice with a line break stays one line

- **WHEN** a stored `read` or `edit` part carries a `truncationNotice` with a line break
- **THEN** the notice renders on one line with one space in place of the break

#### Scenario: A grep report locator stays on its line

- **WHEN** a stored `grep` result carries `unfinishedFile` with the path `a\nb.log`
- **THEN** the text carries `[not searched to the end: a b.log]` on one line

### Requirement: A count of one takes the singular noun

The `lines` and `entries` in every template of this capability are the plural form of a count,
and this requirement governs their number: a count of one MUST take the singular, as in `1 line`,
`1 line total`, `of 1 line`, `1 more line`, and `1 more entry`. In an `edit` header the noun MUST
follow the replacement count, so `2 -> 1 line` and `1 -> 2 lines`.

#### Scenario: One-line results use the singular

- **WHEN** the model writes a one-line file, then replaces its only line with one line
- **THEN** the texts are `replaced <locator> (1 line)` and
  `edited <locator>: line 1, 1 -> 1 line (1 line total)`
- **AND** a read of a two-line file cut after line 1 carries `[1 more line. Use <locator>:2- to continue]`

### Requirement: Continuation is one bracketed notice line

When a `read` result carries `truncated: true` and a `nextOffset`, the text
MUST carry one bracketed line that names the next read. The next read starts
at line `nextOffset + 1`. It ends at the stored requested end while that end
is not reached. It is open-ended `<n>-` in three cases: the requested end is
reached, the line reaches the stored `lineCount`, or the result stores no
line count. A directory listing stores no line count. A locator that takes no
selector states the remainder alone.

#### Scenario: A truncated read tells how to continue

- **WHEN** an unselected read of a 3,000-line file stops with `nextOffset` 2000 and `lineCount` 3000
- **THEN** the text ends with `[1000 more lines. Use <locator>:2001- to continue]`

#### Scenario: A cut inside the requested window resumes to the stored end

- **WHEN** an explicit `:1-2000` read of a 3,000-line file is cut by the bound with `nextOffset` 1500
- **THEN** the text ends with `[1500 more lines. Use <locator>:1501-2000 to continue]`

#### Scenario: A cut unselected read resumes to the end of the file

- **WHEN** an unselected read of a 3,000-line file is cut by the bound with `nextOffset` 1500
- **THEN** the text ends with `[1500 more lines. Use <locator>:1501- to continue]`

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
- **AND** the next read is open-ended

### Requirement: The continuation count names the source lines after the cut

When a truncated result carries a `lineCount`, its bracketed line MUST name the source lines after
the cut, `lineCount - nextOffset`, before the read that continues it. The count MUST NOT claim to
be the members the selector still requests: a multi-range read counts the gap it skips, and a read
cut inside its window counts past the window end.

#### Scenario: A multi-range read counts the source, not the remaining members

- **WHEN** a read of `:1-2500,4000-4010` of a 5,000-line file stops with `nextOffset` 2000
- **THEN** the text ends with `[3000 more lines. Use <locator>:2001-2500,4000-4010 to continue]`
- **AND** the selector requests 511 lines while the count names the 3,000 source lines after the cut

### Requirement: A locator without selector room states the remainder alone

A web locator that carries a query or a fragment takes no trailing selector, so a truncated file
`read` of it MUST NOT advise a selector read. Its continuation line MUST be
`[<count> more lines not shown; this locator takes no line selector]`, without the count when
`lineCount` is absent. A locator that takes a selector MUST keep the continuation read. A new
web read stores no fragment, so a fragment path belongs to a stored part only.

#### Scenario: A locator with a query states the remainder without advice

- **WHEN** a truncated read of `https://example.test/doc?version=1` stops with `nextOffset` 2000 and
  `lineCount` 3000
- **THEN** the text ends with `[1000 more lines not shown; this locator takes no line selector]`
- **AND** the text names no next read

#### Scenario: A selector-less stored part without a total omits the count

- **WHEN** a truncated read part stored before the fragment was dropped carries
  `https://example.test/doc#intro` and no `lineCount`
- **THEN** the text ends with `[more lines not shown; this locator takes no line selector]`

### Requirement: An edit renders its post-edit region

An `edit` text MUST begin with `edited <locator>: line <startLine>, <old> -> <new> lines`, with
the counts of the replaced and replacement lines. When the result carries `lineCount`, the header
adds `(<lineCount> lines total)` after one space. The numbered post-edit `content` MUST follow. A
`content` cut by the bound MUST carry `[region cut at the bound]`; an edit the cap alone shortened
MUST carry no region marker. The text MUST NOT carry a diff or the old and new text as a block.

#### Scenario: A four-line edit renders its region

- **WHEN** the model replaces lines 161-164 with five lines in a 562-line file
- **THEN** the header is `edited <locator>: line 161, 4 -> 5 lines (563 lines total)`
- **AND** lines 159 to 167 follow, numbered from the post-edit file

#### Scenario: A stored edit without display data still renders

- **WHEN** an edit part stored without `display` carries `diff`, `content`, and `shownRange` from line 11
- **THEN** the text is `edited <locator>: region from line 11` and the stored content lines
- **AND** the diff is not rendered

#### Scenario: A cut region is marked

- **WHEN** the edit bound cuts the post-edit region
- **THEN** the result carries `cut: true`
- **AND** the text ends with `[region cut at the bound]`

#### Scenario: A region cut by the bound and the cap keeps both lines

- **WHEN** the edit bound cuts the post-edit region and the shared cap then shortens the result
- **THEN** `[region cut at the bound]` is the next-to-last line
- **AND** the bracketed cap notice is the last line

#### Scenario: A cap-only cut adds no region marker

- **WHEN** the shared cap shortens an edit region its own bound did not cut
- **THEN** the text ends with the bracketed cap notice
- **AND** it carries no `[region cut at the bound]`

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

A `grep` text MUST render each run of consecutive passages of one file under
one `## <locator>` line. That line MUST hold the file locator and no line
range. Unless protected-key replacement changes the locator,
`<locator>:<start>-<end>` from a rendered line number MUST be a valid `read` argument.
One blank line MUST separate the passages under one line. A
capped twentieth passage MUST end with `[more passages in this file; read it
to see them]`. A Knowledge notice MUST render first.
For ranked output, explicit run boundaries MUST determine the headings.
Adjacent ranked runs of the same file MUST NOT merge.

After the passages, the text MUST render the lines below in this order. Each
line renders only when it applies:

- Non-empty warnings MUST render as one `[warnings: …]` line.
- A `ranking` field of `unavailable` MUST render one
  `[ranking unavailable; walk order]` line.
- An `ignored` field MUST render as one line of at most 2,000 code units. That
  line reads `[ignored <count> <noun>: <locators>; a scope that names one
  searches it]`. `<noun>` is `directory` for a count of one and `directories`
  in other cases. `<locators>` holds the first `ignored.locators` that fit in
  the line. A comma and one space separate two locators.
- When the count is larger than the rendered locators, `(+<rest> more)` MUST
  follow them after one space. When no locator fits, `(+<rest> more)` MUST
  follow the colon after one space. When `ignored.atLeast` is `true`,
  `<count>` MUST read `<count> or more` and the rest MUST read
  `(+<rest> or more)`.
- An `unfinishedFile` field MUST render as
  `[not searched to the end: <locator>]`.
- The remainder line MUST follow them. The artifact notice line MUST follow
  the remainder line.

#### Scenario: Two passages in one file share a header

- **WHEN** `src/app.ts` gives passages `:3-7` and `:40-42` in one scope
- **THEN** the text has one `## src/app.ts` line and the two passages, with a blank line between them

#### Scenario: Overlapping scopes repeat the file line

- **WHEN** scopes `src/**` and `src/app.ts` both give passages of `src/app.ts`
- **THEN** each run of passages of a scope has its own `## src/app.ts` line, in scope order

#### Scenario: Warnings render as one line

- **WHEN** the walk skipped 3 binary files and stopped at the call deadline
- **THEN** the text carries `[warnings: 3 binary, 1 deadline]`

#### Scenario: A failed rank call follows the warnings

- **WHEN** the walk skips 3 binary files, excludes 2 directories, and the result carries `ranking: "unavailable"`
- **THEN** the text carries `[warnings: 3 binary]`, then `[ranking unavailable; walk order]`, then the `[ignored …]` line
- **AND** the file blocks keep walk order

#### Scenario: A capped file is marked

- **WHEN** one file holds 25 passages and the result carries its first 20
- **THEN** the twentieth passage ends with `[more passages in this file; read it to see them]`

#### Scenario: Excluded directories render after the warnings

- **WHEN** `ignored` has count 7 and five locators `/r/a`, `/r/b`, `/r/c`, `/r/d`, and `/r/e`
- **THEN** the text carries `[ignored 7 directories: /r/a, /r/b, /r/c, /r/d, /r/e (+2 more); a scope that names one searches it]`
- **AND** that line comes after the `[warnings: …]` line and before the remainder line

#### Scenario: One excluded directory takes the singular

- **WHEN** `ignored` has count 1 and the locator `/r/node_modules`
- **THEN** the text carries `[ignored 1 directory: /r/node_modules; a scope that names one searches it]`

#### Scenario: A lower-bound count is marked

- **WHEN** `ignored` has count 1,000, five locators, and `atLeast: true`
- **THEN** the line starts with `[ignored 1000 or more directories:`
- **AND** the locators end with `(+995 or more)`

#### Scenario: An unfinished file is named

- **WHEN** the result carries `unfinishedFile` `/var/log/big.log`
- **THEN** the text carries `[not searched to the end: /var/log/big.log]`

### Requirement: A bash result renders a status header and its streams

A `bash` success of a command that exited MUST begin with `exit <code>`. When the result carries
`wallTimeMs`, `, <seconds> s` with one decimal MUST follow. The stdout MUST
follow verbatim, and a non-empty stderr MUST follow under a `[stderr]` line.
When both streams are empty, the text MUST be the header and `(no output)`.
A stream that does not fit inline MUST render its head lines, one
omitted-range line, and its tail lines. The function MUST cut a line longer than its share by
code units. The artifact notice line, when present, MUST end the text. A
`command_failed` or `timed_out` message MUST have the same shape.

A result whose executor bound cut a stream MUST carry `[output cut at the
bound]`. A result that only the cap shortened MUST NOT carry that line.

A `backgrounded` result has no exit code and no streams. Its text MUST be the fixed text of
`bash-execution` for that result, and it MUST NOT begin with `exit`.

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

- **WHEN** the executor bound cuts the stdout of a command
- **THEN** the text ends with `[output cut at the bound]`

#### Scenario: A result only the cap shortened carries no bound marker

- **WHEN** a command writes 20,000 characters to stdout, within the executor stream bound
- **THEN** the stdout renders as head lines, an omitted-range line, and tail lines
- **AND** the text carries no `[output cut at the bound]`

#### Scenario: A bound cut and a cap cut carry both lines

- **WHEN** the executor bound cuts stdout and the stdout does not fit inline
- **THEN** the text carries `[output cut at the bound]`
- **AND** it ends with the artifact notice line

#### Scenario: A long log keeps its tail

- **WHEN** stdout has 5,000 lines and does not fit inline
- **THEN** the text shows its first 40 lines, `[lines 41-4880 omitted; read artifact://bash-<n>/stdout:41-4880]`, and its last 120 lines

#### Scenario: A backgrounded result has no exit line

- **WHEN** a host command moves to the background as `job://bash-4`
- **THEN** the text names `job://bash-4` and the job tools, and it holds no `exit` header

### Requirement: A timed-out command names no exit code

A `timed_out` message MUST begin with `timed out`, then `, <seconds> s` with one decimal when the
producer measured `wallTimeMs`. It MUST NOT name an exit code the command never reported. Its
streams follow the bash text shape. The failure result stays a JSON object with this text as its
`message`.

#### Scenario: A timeout names its elapsed time

- **WHEN** a command is stopped by its deadline after 30.0 s with no output
- **THEN** the message is `timed out, 30.0 s` then `(no output)`
- **AND** the failure result is JSON with `type: "timed_out"` and that message

#### Scenario: A timeout before any command started names no time

- **WHEN** a call ends at its deadline before a command was spawned
- **THEN** the message is `timed out` then `(no output)`

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

### Requirement: A web search renders as numbered results

A `web_search` results text MUST render each result as one `## <rank>. <title>`
line. Its URL line MUST follow. Then one line MUST give its host, and its
`published` date when known. Its snippet MUST follow with a `>` mark and one space before each line. One blank line
MUST separate two results. The `engine` and `query` MUST render as one
`[engine: <id>; query: <query>]` line first.

#### Scenario: Three results render in rank order

- **WHEN** an engine returns three results
- **THEN** the text holds `## 1.`, `## 2.`, and `## 3.` lines in that order
- **AND** each URL is on its own line after its title

### Requirement: Web search answers render after the results

An `answer` output, and each `answers` entry of an aggregate, MUST render as
one `## Answer (<engine>)` line, then its answer text. A `>` mark and one
space MUST begin each answer line. Its citations MUST follow as `[<k>] <url>` lines in citation order. Each
note MUST render as one bracketed line after the answers.

#### Scenario: An aggregate answer follows the results

- **WHEN** an aggregate returns five results and one answer with two citations
- **THEN** the `## Answer (<engine>)` line follows the fifth result
- **AND** the citations render as `[1] <url>` and `[2] <url>`

### Requirement: Web text cannot forge structure

Title, snippet, and answer text MUST NOT start a line that the text shape
gives meaning to. The renderer MUST replace each line break inside a title
with one space. Every snippet and answer line MUST begin with a `>` mark and one space. A URL MUST
render as stored, except that the renderer MUST replace each line break inside
it with one space.

#### Scenario: A snippet cannot start a result

- **WHEN** a snippet contains a line `## 9. Fake result`
- **THEN** the text holds that line as `> ## 9. Fake result`

#### Scenario: A title with a line break stays on one line

- **WHEN** a title contains a line break
- **THEN** the title renders on one `## <rank>.` line with a space for the break

### Requirement: An artifact notice is one bracketed line

The artifact notice MUST be one bracketed line that names each part as
`<locator> (<lines> lines)`, with a comma between two parts. A count of one
MUST read `1 line`. A `grep` or
`web_search` notice MUST add `; continue with <locator>:<next>-`. `<next>` is
the artifact line after the last inline passage or result. A notice for
host files MUST add `; host files in <directory>`, or `; host files on the
llame host only`.

#### Scenario: A notice without a host file

- **WHEN** `artifact://grep-7` has 4,812 lines, the inline part ends at line 200, and no file exists
- **THEN** the notice is `[full result: artifact://grep-7 (4812 lines); continue with artifact://grep-7:201-]`

#### Scenario: A web notice continues after the inline results

- **WHEN** `artifact://web_search-4` holds 20 results and one answer, and the inline text shows results 1 to 10, which end at artifact line 40
- **THEN** the notice ends with `; continue with artifact://web_search-4:41-]`

#### Scenario: A bash notice without a host file

- **WHEN** only the stdout of `bash-5` spills, its artifact has 5,000 lines, and no file exists
- **THEN** the notice is `[full result: artifact://bash-5/stdout (5000 lines)]`

#### Scenario: A notice with a host file

- **WHEN** a `bash` artifact has two host files
- **THEN** the notice names both parts with their line counts and then the absolute directory

### Requirement: A grep passage cut at the inline bound names the artifact

A passage that the inline bound cut carries `cut: true`. It MUST carry
`[passage cut; the artifact holds the rest]` after its last line. A cut
twentieth passage MUST carry `[more passages in this file; read it to see
them]` in the next line. A cut passage that is not a twentieth passage MUST
NOT carry that notice.

#### Scenario: A cut passage does not claim a capped file

- **WHEN** the first passage is cut at line 40 and its file holds fewer than 20 passages
- **THEN** that passage carries `[passage cut; the artifact holds the rest]` after its last line
- **AND** the text carries no `[more passages in this file; read it to see them]`

#### Scenario: A cut twentieth passage carries both markers

- **WHEN** a file's twentieth passage is cut to fit the inline bound
- **THEN** the cut marker follows its last line
- **AND** the capped-file notice follows the cut marker

### Requirement: The grep remainder line names the next files

The remainder line MUST read `[more: <files> files, <passages> passages; next:
<entries>]`. Each entry MUST be `<locator> (<locator of the artifact>:<a>-<b>)`,
with a comma between two entries. The line MUST name at most ten files. It
MUST fit in 2,000 code units; an entry that does not fit is left out.

#### Scenario: The remainder line names two files

- **WHEN** two files with 12 passages follow the inline part in `artifact://grep-3`
- **THEN** the line is `[more: 2 files, 12 passages; next: /r/a.ts (artifact://grep-3:201-240), /r/b.ts (artifact://grep-3:241-300)]`

### Requirement: Artifact framing values render on one line

A line break in a value of the remainder line, the omitted-range line, the
artifact notice, or the `[engine: …; query: …]` line MUST render as one space.
The rule MUST be the same as for the framing values of "Framing values render
on one line".

#### Scenario: A query with a line break stays on one line

- **WHEN** a `web_search` query holds a line break
- **THEN** the `[engine: …; query: …]` line holds a space in its place

### Requirement: A left-out line counts what no artifact holds

When a result does not fit, no artifact stores it, and it carries no
omitted-range line, the text MUST end with one `[left out: <count> <noun>;
full result not stored]` line. `<noun>` is
`lines`, `files`, or `results`. An omitted-range line without an artifact MUST
read `[lines <a>-<b> omitted; full result not stored]`.

#### Scenario: A failed write keeps the bash tail inline

- **WHEN** a `bash` stdout of 5,000 lines does not fit and its artifact write fails
- **THEN** the text holds its head, `[lines 41-4880 omitted; full result not stored]`, and its tail

#### Scenario: A grep result without a reader counts its files

- **WHEN** a `grep` result leaves 140 files out and the Run cannot read artifacts
- **THEN** the text ends with `[left out: 140 files; full result not stored]`

### Requirement: A rank record is stored under display

A `grep` or `web_search` result that a rank call ordered MUST carry
`display.rerank`. The record MUST hold `model`, `order`, `scores`,
`latencyMs`, and `costUsd`. `order` MUST list every card key in the applied
order. `scores` MUST map each judged key to its answered score.

#### Scenario: A ranked grep result stores its record

- **WHEN** a `grep` call ranks 162 file runs
- **THEN** the stored part carries `display.rerank` with `model`, `order`, `scores`, `latencyMs`, and `costUsd`
- **AND** `order` holds 162 keys in the order that the text applies

#### Scenario: A ranked web search stores its record

- **WHEN** a `web_search` call ranks five results
- **THEN** the stored part carries `display.rerank` with five keys in `order`
- **AND** `scores` holds one score for each judged key

#### Scenario: A partial answer lists unjudged keys last

- **WHEN** a 300-card rank call has two requests and only the 256-card request answers every question
- **THEN** `order` holds all 300 keys, with the 256 judged keys first by score
- **AND** `scores` holds 256 keys

### Requirement: Ranked grep records preserve run boundaries

A ranked `grep` record MUST also hold `runLengths`, aligned with `order`.
Each length MUST count the full run's passages before the inline cut.
The text renderer, artifact blocks, and owner UI MUST preserve those boundaries.
For a truncated inline prefix, they MUST consume the lengths only through that prefix.

#### Scenario: Reordered same-file runs stay separate

- **WHEN** canonical runs `x:10`, `y:5`, and `x:20` reorder to `x:10`, `x:20`, and `y:5`
- **THEN** the record has three run lengths and the live text, artifact, and UI keep three runs with their original scores

#### Scenario: The last visible run is truncated

- **WHEN** the inline cut retains only the first passage of a three-passage run
- **THEN** the UI shows that passage with its run's score and creates no missing passages

### Requirement: A rank record names the served model and the call cost

In `display.rerank`, `model` MUST use the decision call's representative served id.
`latencyMs` MUST give whole-call latency.
`costUsd` MUST use the decision call's aggregate wire cost, including its unknown-cost rule.

#### Scenario: The served model id is stored, not the catalog id

- **WHEN** the catalog entry `jev` reaches an endpoint that answers as `jev-1.14`
- **THEN** `model` reads `jev-1.14`
- **AND** the record does not carry the catalog id

#### Scenario: An endpoint without cost stores a null cost

- **WHEN** the decision endpoint reports no cost for a rank call
- **THEN** `costUsd` is `null`
- **AND** the record still holds `model`, `latencyMs`, and `scores`

### Requirement: A rank record is display data only

The stored part MUST keep `display.rerank` as the tool wrote it.
Live and replayed text MUST NOT render that record or its fields as rank metadata.
This rule MUST NOT remove matching source text apart from required protected-key replacement.
A result without a rank call, or with a failed rank call, MUST NOT carry `display.rerank`.

#### Scenario: Rank data never reaches the model

- **WHEN** a ranked `grep` part renders live and replays in a later turn
- **THEN** neither text renders the record or its fields as rank metadata
- **AND** both texts keep the ranked inline passages in their applied order and the stored record stays unchanged

#### Scenario: Source text resembles rank metadata

- **WHEN** an uncut selected line contains the served model id, `rerank`, or a score
- **THEN** the live and replayed texts preserve that source line except for required protected-key replacement

#### Scenario: An unranked result carries no record

- **WHEN** a `web_search` call returns results and runs no rank call
- **THEN** the stored part carries no `display.rerank`
- **AND** the live and replayed texts are unchanged

#### Scenario: A failed rank call carries no record

- **WHEN** a `grep` call ranks 40 file runs and no card receives an answer
- **THEN** the stored part carries `ranking: "unavailable"` and no `display.rerank`

### Requirement: A grep ranking failure renders one framing line

When a `grep` result carries `ranking: "unavailable"`, the text MUST keep walk
order. The text MUST carry one framing line that reads
`[ranking unavailable; walk order]`. That line MUST render after the last file
block. That line MUST follow the `[warnings: …]` line when the result carries
one. That line MUST come before the `[ignored …]` line and before the
`[not searched to the end: …]` line. That line MUST NOT name a model or a
score. A result without the field MUST NOT carry the line.

#### Scenario: A failed rank call keeps walk order

- **WHEN** a walk finds 40 files and the result carries `ranking: "unavailable"`
- **THEN** the file blocks keep walk order
- **AND** the text carries `[ranking unavailable; walk order]` after the last file block

#### Scenario: The framing line follows the warnings

- **WHEN** a `grep` result carries a warnings line and `ranking: "unavailable"`
- **THEN** `[ranking unavailable; walk order]` follows the `[warnings: …]` line
- **AND** the line comes before the `[ignored …]` line and the artifact notice line

#### Scenario: The framing line names no model and no score

- **WHEN** a rank call to model `jev-1.14` fails
- **THEN** the text holds no `jev-1.14` and no score
- **AND** the failure adds no other line

### Requirement: A web search ranking failure renders one note

When the rank call of a `web_search` results outcome fails, the text MUST keep
engine order. The text MUST carry one note line that reads
`[rerank: unavailable]`. That line MUST render after the last result or
answer. That line MUST follow the removed-entry note and the engine notes.
That line MUST NOT name a model or a score.

#### Scenario: A failed rank call keeps engine order

- **WHEN** a `web_search` call returns five results and the rank call fails
- **THEN** the results keep engine order
- **AND** the text carries `[rerank: unavailable]` after the fifth result

#### Scenario: The note comes after the other notes

- **WHEN** the output carries a removed-entry note, an engine note, and a failed rank call
- **THEN** `[rerank: unavailable]` is the last note line
- **AND** the removed-entry note stays first

#### Scenario: The note names no model and no score

- **WHEN** a rank call to model `jev-1.14` fails
- **THEN** the text holds no `jev-1.14` and no score

### Requirement: The owner UI shows the rank record

The chat MUST show one rank badge on each ranked `grep` part and each ranked
`web_search` part. The badge MUST name the served model, the latency, and the
cost. The chat MUST show a judged item's score beside its row when that row is present.
It MUST NOT create rows for omitted results merely to show their scores.
A part without `display.rerank` MUST NOT show a badge or a score.
A failed rank call MUST show the note line or the framing line of that failure.

#### Scenario: A ranked grep part shows the badge and the scores

- **WHEN** a completed `grep` part carries `display.rerank` with 162 keys
- **THEN** the part shows one badge with the model, the latency, and the cost
- **AND** each judged file block shows its score

#### Scenario: A ranked web search part shows the badge and the scores

- **WHEN** a completed `web_search` part carries `display.rerank` with five keys
- **THEN** the part shows one badge with the model, the latency, and the cost
- **AND** each judged result row shows its score

#### Scenario: Omitted results need no score rows

- **WHEN** the record has 300 judged keys but the stored output holds only five result rows
- **THEN** the part shows those five rows with their scores and creates no rows for the omitted results

#### Scenario: A part without a record shows no badge

- **WHEN** a completed `grep` part carries no `display.rerank`
- **THEN** the part shows no badge and no score

#### Scenario: A failed rank call shows its line

- **WHEN** a `web_search` part carries the note `rerank: unavailable`
- **THEN** the part shows `[rerank: unavailable]` with the other notes

### Requirement: A job read renders as text

A `read` of a job output MUST render as a text read of that locator. It MUST use the read header
and the line prefixes of this capability. A `read` of a job record MUST begin with the locator line
and then hold one `<name>: <value>` line for each field of the record. A `read` of `job://` MUST
begin with the line `job://` and then render one line for each job. An empty list MUST render
`job://: empty`.

#### Scenario: A job record is plain text

- **WHEN** the model reads `job://bash-4` while the command runs
- **THEN** the text begins with `job://bash-4` and holds the line `state: running`

#### Scenario: A job output read has the read header

- **WHEN** the model reads `job://bash-4/stdout:1-3` from an output with 40 lines
- **THEN** the text begins with `job://bash-4/stdout:1-4 of 40 lines`, including one context line

### Requirement: Wait and stop results keep the JSON rendering

The rendering function MUST render a `wait` result and a `stop` result as JSON. The preview of
an output in a `wait` result MUST pass the delimiter neutralization of this capability, as every
tool result does.

#### Scenario: A wait result is one JSON object

- **WHEN** a `wait` returns with one settled job
- **THEN** the model receives one JSON object with `ended` and `jobs`
