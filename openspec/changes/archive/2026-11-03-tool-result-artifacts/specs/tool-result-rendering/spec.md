## MODIFIED Requirements

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

### Requirement: A grep page groups consecutive passages under one file line

A `grep` text MUST render each run of consecutive passages of one file under
one `## <locator>` line. That line holds the file locator and no line range.
`<locator>:<start>-<end>` from a rendered line number MUST be a valid `read`
argument. One blank line MUST separate the passages under one line. A capped
twentieth passage MUST end with `[more passages in this file; read it to see
them]`. A Knowledge notice MUST render first.

After the passages, the text MUST render the lines below in this order. Each
line renders only when it applies:

- Non-empty warnings MUST render as one `[warnings: …]` line.
- An `ignored` field MUST render as one line of at most 2,000 code units:
  `[ignored <count> <noun>: <locators>; a scope that names one searches it]`.
  `<noun>` is `directory` for a count of one and `directories` in other cases.
  `<locators>` holds the first `ignored.locators` that fit in the line. A
  comma and one space separate two locators.
- When the count is larger than the rendered locators, `(+<rest> more)`
  follows them after one space. When no locator fits, `(+<rest> more)`
  follows the colon after one space. When `ignored.atLeast` is `true`,
  `<count>` is `<count> or more` and the rest is `(+<rest> or more)`.
- An `unfinishedFile` field MUST render as
  `[not searched to the end: <locator>]`.
- The remainder line and then the artifact notice line follow them.

#### Scenario: Two passages in one file share a header

- **WHEN** `src/app.ts` gives passages `:3-7` and `:40-42` in one scope
- **THEN** the text has one `## src/app.ts` line and the two passages, with a blank line between them

#### Scenario: Overlapping scopes repeat the file line

- **WHEN** scopes `src/**` and `src/app.ts` both give passages of `src/app.ts`
- **THEN** each run of passages of a scope has its own `## src/app.ts` line, in scope order

#### Scenario: Warnings render as one line

- **WHEN** the walk skipped 3 binary files and stopped at the call deadline
- **THEN** the text carries `[warnings: 3 binary, 1 deadline]`

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

### Requirement: A cap notice ends the text

A result that carries a `truncationNotice` MUST render it as one bracketed
line. That line MUST be the last line of the text. It MUST come after each
continuation line, cut line, and artifact notice line.

#### Scenario: A cap notice renders as a line

- **WHEN** a stored `bash` part carries a `truncationNotice`
- **THEN** the text ends with that notice in brackets

### Requirement: A bash result renders a status header and its streams

A `bash` success MUST begin with `exit <code>`. When the result carries
`wallTimeMs`, `, <seconds> s` with one decimal MUST follow. The stdout MUST
follow verbatim, and a non-empty stderr MUST follow under a `[stderr]` line.
When both streams are empty, the text MUST be the header and `(no output)`.
A stream that does not fit inline MUST render its head lines, one
omitted-range line, and its tail lines. A line longer than its share MUST be
cut by code units. The artifact notice line, when present, MUST end the text. A
`command_failed` or `timed_out` message MUST have the same shape.

A result whose executor bound cut a stream MUST carry `[output cut at the
bound]`. A result that only the cap shortened MUST NOT carry that line.

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: A grep passage cut at the page bound names the cursor

**Reason**: The `grep` cursor is removed.

**Migration**: "A grep passage cut at the inline bound names the artifact"
keeps both markers with the artifact in place of the cursor.
