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

When line N is a body row of a root-level GFM table, the read SHALL also emit
that table's header row and delimiter row, verbatim with the ordinary prefix,
after the ancestor chain and before the window; a line of the pair already
shown by the window or an earlier passage SHALL NOT be repeated. A root-level
GFM table starts at a line that is not indented four or more columns, is not
inside a container, fenced or indented code, or HTML block, and is followed by
a delimiter row with the same number of cells; when that line ends an open
paragraph, the paragraph ends before it. The table continues through each
following line until a blank line or a line that starts another block, so a
following line without a pipe is a body row. A range whose N is the header or
delimiter row, or that starts outside a table, SHALL emit no header pair.

A single-range result that emits at least one ancestor or header line SHALL use the plural
`requestedRanges` and `shownRanges` fields. Its `requestedRanges` SHALL contain
only the requested source interval, while its `shownRanges` SHALL contain the
ancestor and header lines and the ordinary context-expanded window, merging adjacent
intervals. A range with no emitted ancestor or header line SHALL retain the singular
result shape. Comma-separated reads SHALL apply this rule independently to every
merged passage using that passage's first requested line, deduplicate by source
line, and keep the content in source order: a chain emits only heading lines
before its passage's first shown line, and a chain line that would precede
content already emitted SHALL be skipped. A chain heading whose earlier lines
an earlier passage already emitted therefore contributes only its remaining
lines, which directly follow those emitted lines, so a setext heading's text
lines and underline are never separated by other output.

Ancestor and header lines SHALL count against the shared 2,000-line ceiling
and serialized result bound. A header pair is the innermost unit of its
passage's chain and is admitted or dropped as one unit. If a passage's
complete chain plus all mandatory output through
the first requested line N does not fit, including the N-1 context line when it
is shown and not already emitted and line N, whole headings SHALL be dropped
from the outermost end until the deepest remaining unit plus that mandatory
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

#### Scenario: A range starting on the delimiter row needs no header pair

- **WHEN** a read requests a Markdown range whose first line is a table's delimiter row
- **THEN** the header row appears once, as the ordinary preceding context line
- **AND** no header line is emitted before it

#### Scenario: A table after a paragraph line still has a header

- **WHEN** a paragraph line directly precedes a table header row and delimiter row, and a range starts at the table's second body row
- **THEN** the header row and delimiter row are emitted before the window
- **AND** the paragraph line is not emitted

#### Scenario: A line without a pipe continues the table

- **WHEN** a table's body rows are followed, without a blank line, by a line that has no pipe, and a range starts at that line
- **THEN** the table's header pair is emitted before the window

#### Scenario: Mismatched cell counts are not a table

- **WHEN** a header-looking row is followed by a delimiter row with a different number of cells, and a range starts two lines later
- **THEN** no header pair is emitted

#### Scenario: A table inside a blockquote gets no header pair

- **WHEN** a range starts at a body row of a table inside a blockquote
- **THEN** no header pair is emitted and the range keeps its existing behavior

#### Scenario: The header pair outlasts outer headings under a tight budget

- **WHEN** a range starts at a table body row under `# Title` and `## Setup`, and the shared budget fits only the header pair plus all mandatory output through the first requested line
- **THEN** the result emits the header pair and the passage, without `# Title` or `## Setup`
- **AND** if the header pair does not fit either, no chain is emitted and the passage window still returns when it can
