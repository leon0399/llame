## ADDED Requirements

### Requirement: Root GFM tables are an overlay on CommonMark lines

For the ranged Markdown ancestor requirement, a root GFM table SHALL be
recognized over the lines the CommonMark heading rules decide, without
changing any heading, section, or outline decision. Its header row and
delimiter row SHALL each be a line CommonMark decides is a root paragraph or
root link reference definition line, not part of a heading and not a lazy
continuation of a container paragraph.

#### Scenario: A table after a paragraph line has a header

- **WHEN** a paragraph line directly precedes a table header row and delimiter row, and a range starts at the table's second body row
- **THEN** the header row and delimiter row are emitted before the window
- **AND** the paragraph line is not emitted

#### Scenario: A table inside a container or its lazy continuation gets no header

- **WHEN** a range starts at a body row of a table inside a blockquote, or of rows that lazily continue a list item's paragraph
- **THEN** no header pair is emitted and the range keeps its existing behavior

### Requirement: Root GFM table delimiter rows

The header row SHALL be indented at most three columns and SHALL NOT be a body
row of an earlier table. A delimiter row SHALL directly follow it, be indented
at most three columns, and consist of one or more cells that are each one or more `-`
with optional edge colons and surrounding spaces or tabs. The header and delimiter rows
SHALL have the same cell count.

#### Scenario: Mismatched cell counts are not a table

- **WHEN** a header-looking row is followed by a delimiter row with a different number of cells, and a range starts two lines later
- **THEN** no header pair is emitted

#### Scenario: A list item is not a delimiter row

- **WHEN** `a | b` is followed by `- | -` and `1 | 2`, and a range starts at the third line
- **THEN** no header pair is emitted, because CommonMark decides `- | -` is a list item

#### Scenario: A setext underline is not a delimiter row

- **WHEN** `| a |` is followed by `---` and a range starts on the next line
- **THEN** `| a |` is a setext heading's text, emitted as that line's ancestor, and no header pair is emitted

### Requirement: Root GFM table cells

Cells SHALL be counted by splitting a row on every pipe not escaped by an odd
number of backslashes, including pipes inside code spans, after removing one
leading and one trailing pipe and, on line 1, one leading U+FEFF. A row that
is a single pipe SHALL have no cells.

#### Scenario: A pipe in a code span splits a cell

- **WHEN** a header row is ``| `a|b` | c |`` and the delimiter row has two cells, and a range starts two lines later
- **THEN** no header pair is emitted, because the header row has three cells

### Requirement: Root GFM table bodies

A table's body SHALL continue through each following line until a blank line
or a line that starts an ATX heading, a fence, a thematic break, a blockquote,
a list item, an HTML block, or indented code; any other line, including one
without a pipe or a link reference definition, SHALL be a body row.

#### Scenario: A line without a pipe continues the table

- **WHEN** a table's body rows are followed, without a blank line, by a line that has no pipe, and a range starts at that line
- **THEN** the table's header pair is emitted before the window

#### Scenario: A list item ends the table

- **WHEN** a table's body rows are followed by `2. item` and a range starts at that line
- **THEN** no header pair is emitted

### Requirement: Headings and ended blocks close root GFM tables

A line the CommonMark heading rules decide is part of a heading SHALL end the
table before it and belong to no table. When a table is ended by a line that
CommonMark decides is root paragraph text and that starts a non-empty list
item or an HTML block, that line and each line after it up to the next blank
line SHALL NOT start a table.

#### Scenario: Rows after a list item that ended a table are not a new table

- **WHEN** a table is ended by `2. item`, which is followed without a blank line by another header row, delimiter row, and body row, and a range starts at that body row
- **THEN** no header pair is emitted

#### Scenario: A table after an ATX heading that ended a table has a header

- **WHEN** a table is ended by `# H`, which is followed by another header row, delimiter row, and body row, and a range starts at that body row
- **THEN** the second table's header pair is emitted before the window

#### Scenario: A setext heading over table lines takes precedence

- **WHEN** a table's last body row is followed by `===` within the read window, and a range starts at a body row
- **THEN** the table's lines are that setext heading's text, and no header pair is emitted

## MODIFIED Requirements

### Requirement: Ranged Markdown reads prepend their ancestor headings

An ordinary, non-`:raw`, non-`:outline` ranged `read` of a `text/markdown`
source SHALL prepend the direct root-heading ancestor chain of each passage's
first requested source line N, shallowest first. The preceding context line at
N-1 remains shown but does not select headings. Each ancestor SHALL be rendered
from its own source lines with the ordinary one-based `N:` prefix followed by a
space. An ATX heading contributes its heading line; a setext heading
contributes all of its text lines plus its underline, verbatim. The chain SHALL
NOT include an excerpt line and SHALL NOT apply the outline reader's 120-code-
unit cut. A heading line already shown by the context-expanded window or an
earlier chain SHALL NOT be repeated. A heading whose own lines include line N,
such as a setext heading whose text line or underline is requested, is N's own
heading and SHALL NOT be emitted as N's ancestor.

When line N is a body row of a root GFM table, as defined by the root GFM table
requirements, the read SHALL also emit that table's header row and delimiter
row, verbatim with the ordinary prefix, after the ancestor chain and before the
window; a line of the pair already shown by the window or an earlier passage
SHALL NOT be repeated. A range whose N is the header or delimiter row, or that
starts outside a table, SHALL emit no header pair.

A single-range result that emits at least one ancestor or header line SHALL use the plural
`requestedRanges` and `shownRanges` fields. Its `requestedRanges` SHALL contain
only the requested source interval, while its `shownRanges` SHALL contain the
ancestor and header lines and the ordinary context-expanded window, merging adjacent
intervals. A range with no emitted ancestor or header line SHALL retain the singular
result shape. Comma-separated reads SHALL apply this rule independently to every
merged passage using that passage's first requested line, deduplicate by source
line, and keep the content in source order: a chain emits only ancestor and header
lines before its passage's first shown line, and a chain line that would precede
content already emitted SHALL be skipped. A chain heading whose earlier lines
an earlier passage already emitted therefore contributes only its remaining
lines, which directly follow those emitted lines, so a setext heading's text
lines and underline are never separated by other output.

Ancestor and header lines SHALL count against the shared 2,000-line ceiling
and serialized result bound. A header pair is the innermost unit of its
passage's chain and is admitted or dropped as one unit. If a passage's
complete chain plus all mandatory output through
the first requested line N does not fit, including the N-1 context line when it
is shown and not already emitted and line N, whole units SHALL be dropped
from the outermost end until the innermost remaining unit plus that mandatory
output fits. A setext heading's text lines and underline SHALL be dropped as
one unit. If even the innermost unit does not fit, no chain SHALL be emitted
and the passage window SHALL still be returned when it can fit. `nextOffset`
keeps its existing meaning for single- and multi-range reads and never
identifies a line emitted only as an ancestor or header. A continuation at
`nextOffset + 1` SHALL calculate a fresh chain, so an ancestor MAY reappear
across continuations. A trimmed or absent chain SHALL be silent and SHALL NOT
add a flag field.

A ranged read SHALL never read past its requested window. The Markdown scanner
SHALL end at the window end; a line whose role is undecided at that boundary
SHALL count as not a heading for this read. An open paragraph that might become
a setext heading and an unclosed line-one `---` block SHALL be replayed as
Markdown rather than resolved with later input.

The rule SHALL apply uniformly to host paths, `file://`, `kb://`, `skill://`,
and web renders labeled `text/markdown`, after existing permission admission
and source resolution. It SHALL preserve each source's existing identity,
Knowledge attribution and untrusted-content notice, web provenance, and
execution-time coordinates. `:raw`, `:outline`, directory reads, unselected
reads, empty files, non-Markdown reads, and `edit`/`write` post-edit previews
SHALL remain unchanged.

#### Scenario: A ranged read prepends its enclosing headings

- **WHEN** a Markdown file has `# Level one` at line 13, `## Level two` at line 32, `### Level three` at line 54, and a read requests `VISION.md:60-72`
- **THEN** the result emits the following source lines in order, including the ordinary context lines at 59 and 73:

  ```text
  13: # Level one
  32: ## Level two
  54: ### Level three
  59: <context line>
  60: ... through 72: <requested lines>
  73: <context line>
  ```

- **AND** the result reports `requestedRanges: [{startLine: 60, endLine: 72}]` and `shownRanges` covering `{13,13}`, `{32,32}`, `{54,54}`, and `{59,73}`

#### Scenario: Setext ancestors retain all text lines and the underline

- **WHEN** the first requested line of a Markdown passage is enclosed by a setext heading whose text occupies lines 9 and 10 and whose underline occupies line 11
- **THEN** all three source lines are emitted verbatim before the passage
- **AND** the three adjacent ancestor lines appear as one `{startLine: 9, endLine: 11}` interval in `shownRanges`

#### Scenario: A requested line inside a setext heading is not its own ancestor

- **WHEN** the first requested line of a Markdown range is a text line of a setext heading that begins before the preceding context line
- **THEN** that heading's earlier text lines are not emitted as ancestors
- **AND** only the headings enclosing that setext heading are prepended

#### Scenario: An ancestor adjacent to the context line merges

- **WHEN** an ancestor heading is immediately before the preceding context line for a requested Markdown range
- **THEN** the heading, context line, requested lines, and following context line are emitted once in source order
- **AND** the adjacent heading and context line are represented in one merged `shownRanges` interval

#### Scenario: A window starting on a heading does not repeat it

- **WHEN** the requested line of a Markdown range is itself a heading already present in the selected window
- **THEN** the direct ancestor chain selected by that requested line is emitted before the window
- **AND** that heading source line appears only once

#### Scenario: No enclosing heading keeps the singular shape

- **WHEN** an ordinary Markdown range starts in content before any root heading, or starts at line 1
- **THEN** the read returns its existing context-expanded content
- **AND** it retains singular `requestedRange` and `shownRange` fields and emits no ancestor line

#### Scenario: An edit preview of a Markdown file has no ancestors

- **WHEN** `edit` or `write` produces a post-edit preview for a Markdown file whose changed region has an enclosing heading
- **THEN** the preview retains its existing context and line-range behavior without ancestor headings
- **AND** the mutation result does not promote its singular `shownRange`

#### Scenario: Non-Markdown `.txt` remains unchanged

- **WHEN** an ordinary range selects content from a `.txt` file with heading-looking lines
- **THEN** the result has the existing text-read content and context behavior
- **AND** it emits no ancestor headings and does not promote its range fields

#### Scenario: `:raw` remains unchanged

- **WHEN** the model reads a Markdown range with `:raw`
- **THEN** the selected source bytes remain verbatim without context or generated prefixes
- **AND** no ancestor line is emitted

#### Scenario: `:outline` remains unchanged

- **WHEN** the model reads a scoped Markdown range with `:outline`
- **THEN** the result follows the outline representation's existing scope, ancestor, excerpt, and output rules
- **AND** ordinary ranged-read ancestors are not added a second time

#### Scenario: A comma read with two passages emits a shared ancestor once

- **WHEN** a Markdown file has one root heading enclosing two disjoint requested passages in different child sections and the model requests both in one comma selector
- **THEN** each passage is preceded by its direct ancestor chain, in source order
- **AND** the shared root heading is emitted once, while each distinct child heading is emitted once before its own passage
- **AND** `requestedRanges` excludes all ancestor lines and `shownRanges` includes them

#### Scenario: A setext ancestor straddling an earlier passage continues it

- **WHEN** an earlier passage of a comma-separated Markdown read shows a setext heading's leading text lines but not its underline, and that heading encloses a later passage's first requested line
- **THEN** the later passage's chain emits only the heading's unshown remaining lines, directly after the earlier passage's last line
- **AND** no heading line is repeated or emitted out of source order

#### Scenario: A continuation at `nextOffset + 1` gets its own chain

- **WHEN** a truncated Markdown range returns a `nextOffset` inside a section and the caller retries from `nextOffset + 1`
- **THEN** the retry emits the direct ancestor chain for the retry's first requested line when it fits
- **AND** the retry does not treat the earlier result's chain as carried state

#### Scenario: Outermost headings are dropped first when a chain does not fit

- **WHEN** the chain is `# Title`, `## Setup`, and `### Linux`, and the shared budget fits only one heading line plus all mandatory output through the first requested line, including a shown and not already emitted N-1 context line and line N
- **THEN** the result emits `### Linux` and the requested passage, without `# Title` or `## Setup`
- **AND** whole setext headings are dropped as units, and if even the deepest heading cannot fit the passage window still returns when it can without emitting a chain

#### Scenario: Web Markdown renders get ancestors and web `text/plain` does not

- **WHEN** the web read renders one locator as `text/markdown` and another as `text/plain`, both with the same ordinary range selector
- **THEN** the Markdown result includes its ancestor headings and the plain-text result does not
- **AND** both results retain their existing web `path`, `finalUrl`, `method`, adapter, notes, and truncation behavior

#### Scenario: A `kb://` ranged read gets ancestors and keeps Space attribution and notice

- **WHEN** the model reads a Markdown note through `kb://<space-id>/notes/guide.md:60-72`
- **THEN** the result includes the direct ancestor chain and ordinary context lines for that note
- **AND** it retains the Space identifier, display name, locator, and untrusted-content notice

#### Scenario: A range inside a table prepends the header pair

- **WHEN** a Markdown file has `# Iterative Review Refinement` at line 6, `## Common Rationalizations` at line 124, a table header row at line 126 and its delimiter row at line 127, and a read requests lines 129 through 130
- **THEN** the result emits lines 6, 124, 126, 127, and 128 through 131, in that order
- **AND** `requestedRanges` is `[{startLine: 129, endLine: 130}]` and `shownRanges` covers `{6,6}`, `{124,124}`, and `{126,131}`

#### Scenario: A range at the first body row emits only the header row

- **WHEN** a read requests a Markdown range whose first line is a table's first body row, so the delimiter row is the ordinary preceding context line
- **THEN** only the header row is emitted before the window, directly followed by the delimiter row
- **AND** the header row and the window form one merged `shownRanges` interval

#### Scenario: A comma read starting twice in one table emits its pair once

- **WHEN** a comma read's two passages both start at body rows of the same table
- **THEN** the header pair is emitted once, before the first passage
- **AND** the second passage emits no header line

#### Scenario: The header pair outlasts outer headings under a tight budget

- **WHEN** a range starts at a table body row under `# Title` and `## Setup`, and the shared budget fits only the header pair plus all mandatory output through the first requested line
- **THEN** the result emits the header pair and the passage, without `# Title` or `## Setup`
- **AND** if the header pair does not fit either, no chain is emitted and the passage window still returns when it can

### Requirement: Read representations are selected by media type and member

A representation SHALL be selected from a closed, compile-time table keyed by
the admitted content's media type and the requested member. The table SHALL
hold the `raw` and `outline` members; it
SHALL NOT be runtime-configurable, operator-loadable, or dynamically imported.
A member SHALL belong to one of two output classes: a `:` member returns
verbatim source lines with a shown range (`raw` without generated line
prefixes, as raw reads always have, and `outline` with the ordinary
line-number prefixes), and a future `?` member would return transformed
content with no prefixes and no shown range; no `?` member and no `?` grammar
exists yet. With no member named, reading SHALL remain unchanged except that an ordinary ranged Markdown read SHALL prepend the direct ancestor headings and any enclosing table header pair under the ranged Markdown ancestor requirement. A member
requested for a media type the table does not map SHALL fail with
`invalid_selector` naming the member's accepted media types, and the ordinary
read of that source SHALL remain available.

The media type SHALL be derived from the source, never from the body's
appearance: a host, `file://`, `kb://`, or `skill://` regular file by the
extension table `.md`, `.markdown`, `.mdown`, and `.mkd` to `text/markdown`,
with `.mdx` excluded and every other extension mapping to no
representation-eligible type; a web ladder result by its stage —
`text/markdown` for a `negotiated` response whose `Content-Type` is
`text/markdown` and for `alternate`, `md-suffix`, `readability`, and
`llms-txt`, the served type for `text` and for a `negotiated` `text/plain`
body, and none for `raw`; a web adapter result by the label the adapter
contract requires. A reader SHALL receive only the admitted decoded content as
a sequence of native lines, the source display identity, and the selector's
source scope; a file source SHALL feed those lines as it reads them rather
than decoding the whole file first. A reader SHALL NOT change source
admission, permission projection, owner resolution, executor binding, request
policy, or the source-specific result envelope. Readers over
bytes rather than decoded text SHALL define their own input contract rather
than widening this one.

#### Scenario: A Markdown file selects the outline reader

- **WHEN** the model calls `read` with an authorized Markdown file and the `:outline` member
- **THEN** the result has `representation: "outline"` and contains the deterministic outline
- **AND** the source is admitted exactly as it is for an ordinary read

#### Scenario: An omitted member keeps the existing read

- **WHEN** the model reads an authorized Markdown file without a member
- **THEN** the result uses the existing text representation and line-numbered source content
- **AND** no outline is appended or inferred; a ranged Markdown read prepends its ancestor headings and any enclosing table header pair under the ranged Markdown ancestor requirement.

#### Scenario: An unsupported media type names the accepted types

- **WHEN** the model requests `:outline` for an otherwise readable `.json`, `.mdx`, `.pdf`, `.txt`, or binary file, or for a web read whose result is `text`, `raw`, or a `negotiated` `text/plain` body
- **THEN** the tool returns `invalid_selector` naming `text/markdown` as the member's accepted media type
- **AND** an ordinary read of that source is unchanged

#### Scenario: Admission denies the submitted locator before any parse

- **WHEN** permission admission denies the submitted `:outline` locator, including a host rule that matches the selector-free submitted text
- **THEN** the tool returns the same `permission_denied` result as the ordinary read
- **AND** no media-type derivation or Markdown scan is attempted

#### Scenario: Web ladder Markdown supports outline

- **WHEN** a web read's result method is `alternate`, `md-suffix`, `readability`, or `llms-txt`, or is `negotiated` with a `text/markdown` response
- **THEN** `:outline` scans that rendered body and its line numbers refer to the rendered text
- **AND** the web envelope and provenance remain present

#### Scenario: A directory or catalog is not an outline document

- **WHEN** the model requests `:outline` on a host, `file://`, `kb://`, or `skill://` directory, on `skill://`, or on a web read whose adapter returned a directory result
- **THEN** the tool returns `invalid_selector`
- **AND** it does not reinterpret the listing as headings or return a listing page as outline content
