## ADDED Requirements

### Requirement: Root GFM table outline excerpts

For the Markdown outline, every root GFM table SHALL contribute a table excerpt
of, in source order: its header row; its first content row; and its last content
row, which is the last body row of that table the scan decided. When the first
and last content rows are that same line it SHALL be emitted once, and a table
with no content row SHALL contribute its header row alone.

#### Scenario: A table after prose contributes its excerpt

- **WHEN** a file holds `# Guide` on line 1, `Intro sentence.` on line 3, a root table whose header row is line 5, delimiter row is line 6, and content rows are lines 7 through 11, and `After.` on line 13
- **THEN** the outline content is `1: # Guide`, `3: Intro sentence.`, `5: <header row>`, `7: <first content row>`, `11: <last content row>`, and `13: After.`, in that order
- **AND** line 6 is not emitted, and the content rows 8, 9, and 10 are not emitted

#### Scenario: A table with one content row emits two lines

- **WHEN** a root table's header row is followed by a delimiter row and exactly one content row
- **THEN** the outline emits the header row and that content row, once each

#### Scenario: A table with no content row emits its header row alone

- **WHEN** a root table's header row is followed by a delimiter row and no content row
- **THEN** the outline emits the header row and not the delimiter row

### Requirement: Outline table excerpts are verbatim, cut source lines

Each table excerpt line SHALL be emitted verbatim with the ordinary line-number
prefix and cut at 120 UTF-16 code units with a trailing `…`, backing up one unit
rather than splitting a surrogate pair, exactly as an excerpt line is. The
excerpt SHALL NOT contain the table's delimiter row, and SHALL be emitted at the
table's position, before any later entry.

#### Scenario: A long first content row is cut

- **WHEN** a root table's first content row is longer than 120 code units
- **THEN** the outline emits its first 120 code units followed by `…`, or its first 119 when the 120th would split a surrogate pair

### Requirement: Outline table excerpts obey recognition and the scope

The excerpt's lines SHALL be source lines the root GFM table requirements
recognize as that table's header row or one of its body rows; a table whose
header row and delimiter row are not both decided SHALL contribute nothing. A
table inside a blockquote or a list item SHALL contribute nothing beyond the
excerpt line its section or the document takes from it. No excerpt line SHALL be
emitted outside the scope, and the requirements that bound where the scan stops
are unchanged.

#### Scenario: A table inside a container contributes nothing of its own

- **WHEN** a section holds a prose line and then a table whose rows all sit inside a blockquote or a list item
- **THEN** the outline emits the prose line as that section's excerpt and no line of that table

#### Scenario: A table whose delimiter row is not decided contributes nothing

- **WHEN** a header-looking row is the last decided line of the table-shaped run and a delimiter row never follows it
- **THEN** the outline emits no line of a table excerpt

## MODIFIED Requirements

### Requirement: Markdown outlines are verbatim structural lines

For Markdown content, `:outline` SHALL return, in source order and each with
its ordinary line-number prefix, exactly these source lines: the frontmatter
lines the frontmatter requirement selects; the first non-blank line of the
document that precedes the first root heading and is not itself a heading line
(the root excerpt); and, for every root heading, its heading lines (one line
for an ATX heading; every text line plus the underline for a setext heading)
followed by the first non-blank line of its section that is not a heading
line, whatever that line is; and, for every root table, the table excerpt the
root GFM table outline excerpt requirements define, each of its lines emitted
only where the scope admits it. A heading immediately followed by another
heading
or by the end of the document has no excerpt line. Each native line SHALL be
emitted at most once, even when a lone CR lets it hold more than one root
heading. Every emitted line SHALL be
the source line verbatim, cut at 120 UTF-16 code units with a trailing `…` when
longer, backing up one unit rather than splitting a surrogate pair; the only text the outline generates is that marker and the
frontmatter elision line. The output SHALL contain no synthesized heading
text, no section end coordinates, no summary, no body excerpt beyond the excerpt
lines named here and in the root GFM table outline excerpt requirements, and no
heading-name selector. A Markdown document with no root headings
SHALL return its frontmatter lines, if any, and its root excerpt, if any; an
empty document SHALL return the ordinary empty-file result with null ranges.

#### Scenario: An outline is the document's structural lines

- **WHEN** an authorized file holds `# Guide` on line 1, `Intro sentence.` on line 3, `## Install` on line 5, ` ```bash ` on line 7, `## Use` on line 12, and `### Flags` on line 14 with `Flag text.` on line 16
- **THEN** the outline content is `1: # Guide`, `3: Intro sentence.`, `5: ## Install`, `7: ```bash`, `12: ## Use`, `14: ### Flags`, `16: Flag text.` and nothing else
- **AND** `12: ## Use` has no excerpt line because its next line is a heading, and reading `:14-16` addresses the `Flags` section

#### Scenario: A setext heading shows its underline

- **WHEN** a file holds `Two` on line 8 and `===` on line 9
- **THEN** the outline contains `8: Two` followed by `9: ===`
- **AND** neither line is rewritten as `# Two`

#### Scenario: A long line is cut, not rewritten

- **WHEN** a heading or excerpt line is longer than 120 code units
- **THEN** the outline emits its first 120 code units followed by `…`, or its first 119 when the 120th would split a surrogate pair
- **AND** a line of exactly 120 code units is emitted whole

#### Scenario: A document without headings shows its opening line

- **WHEN** an authorized Markdown file has no root heading and its first non-blank line is line 3
- **THEN** the outline content is `3: <that line>` after any frontmatter lines
- **AND** the result is a successful read with `representation: "outline"`

#### Scenario: Duplicate headings are told apart by line

- **WHEN** a file contains `## Notes` at lines 10 and 40
- **THEN** the outline contains `10: ## Notes` and `40: ## Notes`, each with its own excerpt line
- **AND** no selector addresses either occurrence by name

#### Scenario: An outline names a section opening and a table's shape

- **WHEN** a file holds `# Guide` on line 1, `Intro sentence.` on line 3, and a root table whose header row is line 5, delimiter row is line 6, first content row is line 7, and last content row is line 11
- **THEN** the outline content is `1: # Guide`, `3: Intro sentence.`, `5: <header row>`, `7: <first content row>`, and `11: <last content row>`, in that order, and nothing else

#### Scenario: A table that opens a section replaces that section's excerpt line

- **WHEN** a root heading on line 1 is followed by a root table whose header row is line 2, delimiter row is line 3, first content row is line 5, and last content row is line 6
- **THEN** the outline emits line 1, then lines 2, 5, and 6
- **AND** line 2 is emitted once, not once as the section's excerpt line and again as the table excerpt's header row

### Requirement: Outline scope prepends the direct ancestors

`:outline:N-M` (and `:outline:N` for `N-N`, `:outline:N+K` for the `K` lines
from `N`, as ordinary `:N+K` selects, `:outline:N-` for the lines from `N`
through the source's last line, and `:outline:-K` for its last `K` lines, each
resolved against the source's count as an ordinary range member is) SHALL
restrict the emitted lines to those whose source line lies in the
scope, and SHALL prepend the direct ancestor chain of source line `N`: the
root headings whose sections contain `N`, from the shallowest to the deepest,
each rendered as an in-scope heading is (its heading lines and its excerpt
lines, which for a section a root table opens are that table's excerpt lines)
restricted to lines before `N`, because lines from `N` on follow the
in-scope rule, and each omitted when its own lines already lie in scope; and, when `N` is a root
table's delimiter row or one of its body rows, that table's excerpt restricted
to the lines before `N` — its header row always, and its first content row when
that row precedes `N` — as the innermost unit of the chain.
The ancestor chain is context: when the chain together with the first
in-scope entry does not fit the shared serialized result cap or the
2,000-line ceiling, the chain SHALL be omitted whole, so a continuation read
always advances. The omission is silent: `truncated` and `nextOffset` report
only in-scope output that was cut. A scope that holds no entry after its
chain is omitted SHALL return a successful outline with empty content and a
null shown range.
Frontmatter lines and the
root excerpt appear only when their source lines lie in scope. A scope that
begins past the source's last line SHALL fail as an ordinary range past the
end does. No comma-separated scope SHALL be accepted.

#### Scenario: A scope shows the headings it contains and what encloses them

- **WHEN** a file holds `# Title` at line 1, `## Setup` at line 30, `### Linux` at line 44, `### macOS` at line 70, and `## Use` at line 100, and the model reads `:outline:60-90`
- **THEN** the outline is the ancestor chain of line 60, `1: # Title`, `30: ## Setup`, and `44: ### Linux` with their excerpt lines before line 60, then `70: ### macOS` with its excerpt line
- **AND** `100: ## Use` is absent because line 100 lies outside the scope

#### Scenario: A single line answers with its ancestors

- **WHEN** the model reads `:outline:65` of that file
- **THEN** the outline is `1: # Title`, `30: ## Setup`, `44: ### Linux` with their excerpt lines
- **AND** nothing after line 65 is emitted

#### Scenario: An ancestor chain larger than the result is omitted

- **WHEN** a root setext heading has text on lines 1 through 3,000 and its `===` underline on line 3,001, its section holds `first body` on line 3,003, `## In scope` on line 3,550, and `scope body` on line 3,552, and the model reads `:outline:3500-3600`
- **THEN** the outline is `3550: ## In scope` and `3552: scope body`, without the omitted chain
- **AND** `truncated` is false, and an unscoped outline of the same file that is cut at the 2,000-line ceiling continues through `:outline:<nextOffset + 1>-M` without repeating a result

#### Scenario: A scope with no entry returns an empty outline

- **WHEN** the model reads `:outline:3500` of that file, whose line 3,500 lies in the heading's section body
- **THEN** the result is a successful outline with empty content, a null shown range, and `truncated: false`
- **AND** it carries no `nextOffset`

#### Scenario: A scope past the end is refused

- **WHEN** the model reads `:outline:500-600` of a 120-line file
- **THEN** the tool returns `invalid_selector` under the ordinary out-of-range rule
- **AND** no outline content is returned

#### Scenario: A scope reaches the last line or the tail of a source

- **WHEN** the model reads `:outline:60-` of the file whose `## Use` sits at line 100 and whose last line is 120
- **THEN** the outline carries the ancestor chain of line 60 and every entry whose source line lies in 60 through 120
- **AND** `:outline:-20` of that file is the same scope as `:outline:101-120`, with the chain of its first line prepended

#### Scenario: A scope inside a table prepends its header row and first content row

- **WHEN** a file holds `# Root` on line 1, a root table whose header row is line 3, delimiter row is line 4, first content row is line 5, and last content row is line 9, and the model reads `:outline:6-6`
- **THEN** the outline content is `1: # Root`, `3: <header row>`, and `5: <first content row>`, in that order, and nothing else
- **AND** `shownRange` covers 1 through 5

#### Scenario: A scope after a table an ancestor opens carries its excerpt lines

- **WHEN** a root heading on line 1 is followed by a root table whose header row is line 2, first content row is line 4, and last content row is line 5, and the model reads `:outline:7-7` where line 7 is prose in that heading's section
- **THEN** the outline content is `1: <heading line>`, `2: <header row>`, `4: <first content row>`, and `5: <last content row>`, in that order

#### Scenario: A scope that starts at the delimiter row prepends the header row alone

- **WHEN** the first line in scope is a root table's delimiter row
- **THEN** the chain's table unit is that table's header row, since its first content row does not precede `N`

#### Scenario: A table the scope contains contributes its whole excerpt

- **WHEN** a scope contains a root table's header row, its first content row, and its last content row
- **THEN** those three lines are emitted as entries at the table's position, in source order
- **AND** a line of the excerpt that lies in scope is emitted once, whether the chain or the table's own position would have carried it

### Requirement: Root GFM tables are an overlay on CommonMark lines

For the ranged Markdown ancestor requirement and the root GFM table outline
excerpt requirements, a root GFM table SHALL be recognized over the lines the CommonMark heading rules decide, without
changing any heading or section decision; a table excerpt changes which source
lines the outline emits, not which lines are headings or sections. Its header row and
delimiter row SHALL each be a line CommonMark decides is a root paragraph or
root link reference definition line, not part of a heading and not a lazy
continuation of a container paragraph.

#### Scenario: A table after a paragraph line has a header

- **WHEN** a paragraph line directly precedes a table header row and delimiter row, and a range starts at the table's second body row
- **THEN** the header row and delimiter row are emitted before the window
- **AND** the paragraph line is not emitted

#### Scenario: A table inside a container or its lazy continuation gets no header

- **WHEN** a range starts at a body row of a table inside a blockquote, or of rows that lazily continue the paragraph of a list item or blockquote, such as one started by `- sub` or `> q` on the line that ends a list
- **THEN** no header pair is emitted and the range keeps its existing behavior

#### Scenario: Outline excerpts restate no heading decision

- **WHEN** table-shaped lines are followed by a `===` underline and the model reads either the outline or a ranged read of them
- **THEN** those lines stay a setext heading's text, and the outline emits no table excerpt for them
