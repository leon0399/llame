## MODIFIED Requirements

### Requirement: Results that carry content render as text

The function that renders results MUST render a `read`, `edit`, `write`, `grep`, `bash`,
or `web_search` success as plain text. An image, PDF, or skill-catalog result
MUST keep its JSON form. A file `read`, an `edit`, and a `write` MUST
begin with one header line. A `grep` text opens with its notice when it
carries one, or with its first `## <locator>` line. A file read and an `edit`
MUST render their `content` lines after the header and the attribution lines.

#### Scenario: A file read renders as text

- **WHEN** the model reads `src/app.ts:12-40` of a 216-line file
- **THEN** the result starts with `src/app.ts:L11-41 of 216 lines`
- **AND** the numbered lines follow with no JSON quotes

#### Scenario: An image read keeps JSON

- **WHEN** the model reads a PNG file
- **THEN** the result is the JSON image result with no `display` key

#### Scenario: A Machine variant renders the same way

- **WHEN** `read` runs on a Machine locator
- **THEN** the render is the text shape with the Machine locator in the header

#### Scenario: A grep page opens with its notice

- **WHEN** a `grep` result carries a Knowledge notice
- **THEN** the text starts with that notice, before the first `## <locator>` line

#### Scenario: A web search renders as text

- **WHEN** a `web_search` call returns three results
- **THEN** the model receives the text shape of `web_search` with no JSON quotes

### Requirement: The read header names the source and the shown lines

A `read` text MUST begin with one of these headers, with the shown range of the result. It can
also begin with the bare-locator header that its own requirement defines. Each range MUST carry the unit letter
`L` in the canonical spelling. The headers are these:

- `<locator>:L<start>-<end>` for a single range,
- `<locator>:L<a>-<b>,L<c>-<d>` for a multi-range read,
- `<locator>:raw:L<start>-<end>` for a raw read,
- `<locator>:outline:L<start>-<end>` for an outline.
  A null shown range MUST render `<locator>: empty` when the result is not truncated.

#### Scenario: A multi-range read lists its ranges

- **WHEN** the model reads `src/app.ts:10-12,40-42` of a 216-line file
- **THEN** the header is `src/app.ts:L9-13,L39-43 of 216 lines`

#### Scenario: A raw read names its form

- **WHEN** the model reads `notes.md:raw:3-4`
- **THEN** the header is `notes.md:raw:L3-4 of 40 lines`

#### Scenario: An empty file has an empty header

- **WHEN** the model reads an empty file
- **THEN** the result is `<locator>: empty` and no content lines

#### Scenario: An oversized first line is reported, not emptied

- **WHEN** the first line of `x.min.js` exceeds the result bound and the result has a null shown range
- **THEN** the header is `x.min.js: line 1 exceeds the result bound and was skipped`
- **AND** the continuation line follows

### Requirement: The read header carries the source total when it is stored

When a `read` result carries `lineCount`, its header MUST end with `of <lineCount> lines` after
one space. A header without `lineCount` MUST carry no suffix. A directory listing MUST NOT add a
total to its content; its continuation line names the entries that remain.

#### Scenario: A result without a line count omits the total

- **WHEN** a read part stored without `lineCount` renders
- **THEN** the header is `<locator>:L<start>-<end>` with no `of … lines` suffix

#### Scenario: A ranged read reports the total

- **WHEN** the model reads `src/app.ts:12-40` and the result carries `lineCount` 216
- **THEN** the header is `src/app.ts:L11-41 of 216 lines`

### Requirement: A count of one takes the singular noun

The `lines` and `entries` in every template of this capability are the plural form of a count.
This requirement governs their number. A count of one MUST take the singular, as in `1 line`,
`1 line total`, `of 1 line`, `1 more line`, and `1 more entry`. In an `edit` header, the noun MUST
follow the replacement count, so `2 -> 1 line` and `1 -> 2 lines`.

#### Scenario: One-line results use the singular

- **WHEN** the model writes a one-line file, then replaces its only line with one line
- **THEN** the texts are `replaced <locator> (1 line)` and
  `edited <locator>: line 1, 1 -> 1 line (1 line total)`
- **AND** a read of a two-line file cut after line 1 carries `[1 more line. Use <locator>:L2- to continue]`

### Requirement: Continuation is one bracketed notice line

When a `read` result carries `truncated: true` and a `nextOffset`, the text
MUST carry one bracketed line that names the next read, in the canonical
spelling. The next read starts at line `nextOffset + 1`. It ends at the stored
requested end while that end is not reached. It is open `L<n>-` in three
cases: the requested end is reached, the line reaches the stored `lineCount`,
or the result stores no line count. A directory listing stores no line count,
and its entries are lines. A locator that takes no selector states the
remainder alone.

#### Scenario: A truncated read tells how to continue

- **WHEN** an unselected read of a 3,000-line file stops with `nextOffset` 2000 and `lineCount` 3000
- **THEN** the text ends with `[1000 more lines. Use <locator>:L2001- to continue]`

#### Scenario: A cut inside the requested window resumes to the stored end

- **WHEN** the bound cuts an explicit `:1-2000` read of a 3,000-line file with `nextOffset` 1500
- **THEN** the text ends with `[1500 more lines. Use <locator>:L1501-2000 to continue]`

#### Scenario: A cut unselected read resumes to the end of the file

- **WHEN** the bound cuts an unselected read of a 3,000-line file with `nextOffset` 1500
- **THEN** the text ends with `[1500 more lines. Use <locator>:L1501- to continue]`

#### Scenario: A ranged read that is not truncated has no notice

- **WHEN** the model reads `src/app.ts:150-189` of a 562-line file and the result is not truncated
- **THEN** no bracketed line follows the content

#### Scenario: A result without a line count omits the count

- **WHEN** a read part stored without `lineCount` is truncated with `nextOffset` 2000
- **THEN** the text ends with `[Use <locator>:L2001- to continue]`

#### Scenario: An outline resumes in its own form

- **WHEN** a read of `README.md:outline:1-900` stops at source line 400
- **THEN** the text ends with `[Use README.md:outline:L401-900 to continue]`

#### Scenario: A listing resumes at the next entry

- **WHEN** a directory listing of 120 entries stops with `nextOffset` 50 and `entryCount` 120
- **THEN** the text ends with `[70 more entries. Use <locator>:L51- to continue]`
- **AND** the next read is open

### Requirement: The continuation count names the source lines after the cut

When a truncated result carries a `lineCount`, its bracketed line MUST name the source lines after
the cut, `lineCount - nextOffset`, before the read that continues it. The count MUST NOT claim to
be the members that the selector still requests. A multi-range read counts the gap that it skips.
A read cut inside its window counts lines after the end of the window.

#### Scenario: A multi-range read counts the source, not the remaining members

- **WHEN** a read of `:1-2500,4000-4010` of a 5,000-line file stops with `nextOffset` 2000
- **THEN** the text ends with `[3000 more lines. Use <locator>:L2001-2500,L4000-4010 to continue]`
- **AND** the selector requests 511 lines while the count names the 3,000 source lines after the cut

### Requirement: A bash result renders a status header and its streams

A `bash` success of a command that exited MUST begin with `exit <code>`. When the result carries
`wallTimeMs`, `, <seconds> s` with one decimal MUST follow. The stdout MUST
follow verbatim, and a non-empty stderr MUST follow under a `[stderr]` line.
When both streams are empty, the text MUST be the header and `(no output)`.
A stream that does not fit inline MUST render its head lines, one
omitted-range line, and its tail lines. The omitted-range line MUST name the read of the omitted
lines in the canonical selector spelling. The function MUST cut a line longer than its share by
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
- **THEN** the text shows its first 40 lines, `[lines 41-4880 omitted; read artifact://bash-<n>/stdout:L41-4880]`, and its last 120 lines

#### Scenario: A backgrounded result has no exit line

- **WHEN** a host command moves to the background as `job://bash-4`
- **THEN** the text names `job://bash-4` and the job tools, and it holds no `exit` header

### Requirement: An artifact notice is one bracketed line

The artifact notice MUST be one bracketed line that names each part as
`<locator> (<lines> lines)`, with a comma between two parts. A count of one
MUST read `1 line`. A `grep` or `web_search` notice MUST add
`; continue with <locator>:L<next>-`. `<next>` is the artifact line after the
last inline passage or result. A notice for artifact files MUST add
`; host files in <locator>`, where `<locator>` is the `machine://` locator of
the directory, or `; host files only on Machine <name>`.

#### Scenario: A notice without a host file

- **WHEN** `artifact://grep-7` has 4,812 lines, the inline part ends at line 200, and no file exists
- **THEN** the notice is `[full result: artifact://grep-7 (4812 lines); continue with artifact://grep-7:L201-]`

#### Scenario: A web notice continues after the inline results

- **WHEN** `artifact://web_search-4` holds 20 results and one answer, and the inline text shows results 1 to 10, which end at artifact line 40
- **THEN** the notice ends with `; continue with artifact://web_search-4:L41-]`

#### Scenario: A bash notice without a host file

- **WHEN** only the stdout of `bash-5` spills, its artifact has 5,000 lines, and no file exists
- **THEN** the notice is `[full result: artifact://bash-5/stdout (5000 lines)]`

#### Scenario: A notice with a host file

- **WHEN** a `bash` artifact has two files on the `machines.local` Machine `devl`
- **THEN** the notice names both parts with their line counts and then the directory as a `machine://devl/...` locator

### Requirement: The grep remainder line names the next files

The remainder line MUST read `[more: <files> files, <passages> passages; next:
<entries>]`. Each entry MUST be `<locator> (<locator of the artifact>:L<a>-<b>)`,
with a comma between two entries. The line MUST name at most ten files. It
MUST fit in 2,000 code units. An entry that does not fit MUST be left out.

#### Scenario: The remainder line names two files

- **WHEN** two files with 12 passages follow the inline part in `artifact://grep-3`
- **THEN** the line is `[more: 2 files, 12 passages; next: /r/a.ts (artifact://grep-3:L201-240), /r/b.ts (artifact://grep-3:L241-300)]`

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
- **THEN** the text begins with `job://bash-4/stdout:L1-4 of 40 lines`, with one context line
