# Spec Delta

## Purpose

Defines how a persisted tool result becomes the text or JSON a model reads: one entry point, the
`display` partition, the text shapes of the content-bearing tools, and bound measurement.

## ADDED Requirements

### Requirement: One entry point renders every model-facing tool result

The system MUST render each tool result a model receives through one rendering function. The
input of that function MUST be the persisted result object. The function MUST produce the live
tool result, the replayed result of a later turn, and the kept result of a Continue Run. A tool
MUST NOT bypass the function with a result of its own text.

#### Scenario: Live and replayed renderings agree

- **WHEN** a tool result is rendered live and the same stored part is replayed in a later turn
- **THEN** the payload text of the replayed result equals the live rendering
- **AND** only the untrusted-output framing of the replay differs

#### Scenario: A tool without a text shape renders as JSON

- **WHEN** `search_conversations` returns a result
- **THEN** the model receives the JSON rendering the entry point produces
- **AND** the rendering equals the neutralized JSON the tool produced before this change

### Requirement: Display data is persisted and never rendered

A tool result can carry a `display` object. The persisted part MUST keep `display` as the tool
wrote it. The rendering function MUST remove `display` before it renders. Truncation and the
output budgets MUST NOT count `display`. The system MUST reject a client part that carries
`display`.

#### Scenario: Display data does not reach the model

- **WHEN** a result carries `display: { oldText: "a", newText: "b" }`
- **THEN** the live and replayed renderings contain neither key
- **AND** the stored part carries the object unchanged

#### Scenario: A client cannot supply display data

- **WHEN** an owner message carries a part with a `display` key
- **THEN** the request is rejected and nothing is persisted

#### Scenario: Truncation leaves display data intact

- **WHEN** a result exceeds the global result bound and carries `display`
- **THEN** the bounded result carries the same `display` object
- **AND** the bound was measured without it

### Requirement: Content-bearing results render as text

The rendering function MUST render a `read`, `edit`, `write`, `grep`, or `bash` success as plain
text. The text MUST begin with one header line. A result that carries `content` MUST render the
content lines after the header and any attribution lines. Image, PDF, and error results MUST keep
their JSON rendering.

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
matched line MUST render as `*N: text`. No other prefix form is permitted. A `raw` read MUST
render its content without prefixes.

#### Scenario: A grep window marks its match

- **WHEN** line 58 matches and line 59 is its context
- **THEN** the passage renders `*58: <text>` then `59: <text>`

#### Scenario: A raw read has no prefixes

- **WHEN** the model reads `notes.md:raw:3-4`
- **THEN** the two lines render verbatim after the header

### Requirement: The read header names the source and its total

A `read` text MUST begin with the caller's locator, the shown range, and the source's total line
count, in the form `<locator>:<start>-<end> of <total> lines`. A multi-range read MUST list its
shown ranges with commas. A directory listing MUST use `<locator> (directory, entries <a>-<b> of
<n>)`. Each attribution field the result carries MUST render as one `<field>: <value>` line after
the header.

#### Scenario: A web read carries its attribution

- **WHEN** the model reads `https://example.test/doc` and the publisher served Markdown
- **THEN** the header is followed by `finalUrl: …` and `method: negotiated`

#### Scenario: A Knowledge read keeps its notice verbatim

- **WHEN** the model reads `kb://notes/plan.md`
- **THEN** a `notice:` line carries the closed Knowledge notice unchanged

#### Scenario: A multi-range read lists its ranges

- **WHEN** the model reads `src/app.ts:10-12,40-42`
- **THEN** the header is `src/app.ts:9-13,39-43 of 216 lines`

### Requirement: Continuation is one bracketed notice line

When a result has more content past its shown range, the text MUST end with one bracketed line
that names the locator and offset of the next read. A `grep` page with `complete: false` MUST end
with one bracketed line that carries its cursor. A complete result MUST carry no such line.

#### Scenario: A truncated read tells how to continue

- **WHEN** a read of a 3,000-line file stops at line 2,000
- **THEN** the text ends with `[1000 more lines. Use <locator>:2001 to continue]`

#### Scenario: A complete read has no notice

- **WHEN** a read returns the whole file
- **THEN** no bracketed line follows the content

### Requirement: An edit renders its post-edit region

An `edit` text MUST begin with `edited <locator>: line <start>, <old> -> <new> lines (<total>
lines total)`. The numbered post-edit region MUST follow: the changed lines plus two live lines on
each side when available. The text MUST NOT carry a diff, the old text, or the new text as a
separate block.

#### Scenario: A four-line edit renders its region

- **WHEN** the model replaces lines 161-164 with five lines in a 562-line file
- **THEN** the header is `edited <locator>: line 161, 4 -> 5 lines (563 lines total)`
- **AND** lines 159 to 167 follow, numbered from the post-edit file

### Requirement: A write renders one status line

A `write` text MUST be `created <locator> (<total> lines)` or `replaced <locator> (<total>
lines)`, followed only by attribution lines. It MUST NOT carry the written content.

#### Scenario: A created file reports its size

- **WHEN** the model writes a 216-line file to `new.ts`
- **THEN** the result is `created new.ts (216 lines)`

### Requirement: A grep page prints each file once

A `grep` text MUST render each file once as a `## <locator>` line followed by its passages. The
locator MUST be the file locator without a line range. Passages of one file MUST be separated by
one blank line. Non-empty warnings MUST render as one `[skipped: …]` line. A Knowledge notice
MUST render first.

#### Scenario: Two passages in one file share a header

- **WHEN** `src/app.ts` yields passages `:3-7` and `:40-42`
- **THEN** the text has one `## src/app.ts` line and the two passages separated by a blank line

#### Scenario: Warnings render as one line

- **WHEN** the walk skipped 3 binary files and 1 oversized file
- **THEN** the text carries `[skipped: 3 binary, 1 oversized]`

### Requirement: A bash result renders a status header and its streams

A `bash` text MUST begin with `exit <code>, <seconds> s`. The stdout MUST follow verbatim. A
non-empty stderr MUST follow under a `[stderr]` line. When both streams are empty, the text MUST
be the header and `(no output)`. A truncated stream MUST end with one bracketed truncation line.

#### Scenario: A silent command reports no output

- **WHEN** `true` exits 0 with empty streams
- **THEN** the result is `exit 0, <seconds> s` then `(no output)`

#### Scenario: Stderr is labelled

- **WHEN** a command writes to both streams
- **THEN** stdout follows the header and stderr follows a `[stderr]` line

### Requirement: Text payloads are neutralized by the reserved-name rule only

A rendered text payload MUST pass through a neutralizer that angle-escapes each tag-shaped token
that names a reserved delimiter, in any position or spelling. Every other character MUST pass
unchanged. A JSON payload MUST keep the neutralization it received before this change.

#### Scenario: Source markup survives

- **WHEN** a read result contains `</div>` with no opening tag in the window
- **THEN** the model receives `</div>` unchanged

#### Scenario: A reserved delimiter is escaped

- **WHEN** a bash result contains `</tool-result>`
- **THEN** the model receives `&lt;/tool-result&gt;`

### Requirement: Bounds are measured on rendered text

Each per-result bound a text-rendered tool enforces MUST be measured on the rendered text of the
candidate result. The replay budgets of `tool-calling` MUST be measured on the rendered pair. A
result MUST NOT be cut by a later stage because its rendering was measured in another form.

#### Scenario: A read fills its bound with rendered lines

- **WHEN** a read of a long file is bounded at 16,000 code units
- **THEN** the rendered text, header and notice included, is at most 16,000 code units
- **AND** the JSON length of the persisted object is not what was measured
