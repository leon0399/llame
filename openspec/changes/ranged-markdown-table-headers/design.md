# Design

## Context

- `packages/native-file-tools/src/markdown-structure.ts` is a streaming
  CommonMark scanner, bounded to the read window, that classifies each line as
  frontmatter, blank, heading, or content. It has no table concept: table rows
  are paragraph text to it.
- `MarkdownAncestorTracker` (`markdown-ancestors.ts`) keeps the open heading
  stack and snapshots it at each requested line. `admitAncestorChain` turns the
  snapshot into groups, outermost first, and admits the longest suffix of
  groups that fits with the passage's mandatory lines; `markdown-range.ts`
  reuses it per comma passage.
- Heading recognition is proven by `markdown-structure.conformance.test.ts`
  against `mdast-util-from-markdown` and the CommonMark spec examples.
- A probe of `micromark-extension-gfm-table` 2.1.2 with
  `mdast-util-from-markdown` 2.0.2 showed: a table starts after a paragraph
  line and ends that paragraph; a delimiter row with a different cell count
  leaves everything a paragraph; a following line without a pipe is still a
  body row; a heading ends the table; a table inside a blockquote is a child of
  the blockquote; four-space indentation makes code; and `a` followed by `-` is
  a setext heading. Every unescaped pipe splits a cell, inside code spans too;
  a list item, HTML block, or indented code line ends a table even where it could
  not interrupt a paragraph; and lazy continuation lines after a container are
  not a root table.

## Goals / Non-Goals

**Goals:**

- Recognize root-level GFM tables in the existing scanner pass, with no
  lookahead past the window.
- Reuse the ancestor admission, plural promotion, comma ordering, and
  continuation rules unchanged.

**Non-Goals:**

- Cell parsing beyond the cell count, alignment, or any table rendering.
- Tables inside containers (proposal T1).

## Decisions

### D1. Tables are an overlay on the scanner's decided lines

The CommonMark scanner stays the authority for headings, sections, and
outlines. It reports, for each decided content line, whether the line is root
paragraph text (not frontmatter, code, HTML, container content, or a lazy
continuation of a container paragraph). A table tracker consumes those decided
lines in order:

- a root paragraph or link reference definition line, indented at most three
  columns, followed by such a line that is a delimiter row with the same cell
  count opens a table; a line that is part of a heading, including a setext
  underline, is never a header or delimiter row, so a setext decision always
  wins;
- the table stays open through each following line until a blank line or a
  line that starts an ATX heading, fence, thematic break, blockquote, list
  item, HTML block, or indented code, the oracle's ending set rather than the
  narrower paragraph-interruption set; that ending line and the lines after it
  up to the next blank line cannot open a table, because GFM continues the
  list item or HTML block there;
- a line decided as part of a heading closes the table and belongs to none of
  it.

Cells split on every pipe not escaped by an odd number of backslashes, code
spans included, as the oracle does. Because the tracker sees lines only after
the scanner decides them, a setext underline later in the window turns earlier
table lines into heading text before the tracker sees them; past the window
end, the existing rule treats an undecided line as not a heading.

Where GFM and this overlay differ, the overlay keeps CommonMark's heading
decision (proposal T4): table lines followed by `===` or `---` are a setext
heading here and a table plus a body row or thematic break under GFM. A round-2 comparison of
this definition with the oracle on 177 adversarial inputs left exactly those
setext cases as disagreements.

- Alternative: let tables win over setext headings as GFM does. Rejected: it
  changes shipped heading sections, `:outline` entries, and ancestor chains
  under the CommonMark boundaries requirement.
- Alternative: parse the window with micromark at read time. Rejected: it does
  not stream to the window end, and adds a runtime dependency.

### D2. The tracker snapshots the open table's header pair

`MarkdownAncestorTracker` records, beside each requested line's heading chain,
the open root table's header row and delimiter row when the requested line is
one of that table's body rows. `admitAncestorChain` appends the pair as the
innermost group, so the existing outermost-first trimming gives proposal T2
and the existing "already shown" and source-order checks give deduplication.
Because a heading ends a table, every heading in the chain precedes the header
row, so the chain stays in source order.

### D3. The oracle grows a GFM table mode

The conformance test adds `micromark-extension-gfm-table` and
`mdast-util-gfm-table` as dev dependencies. For fixtures where GFM and
CommonMark agree on every heading, it compares the tracker's root table spans
and header lines with the oracle's root `table` nodes. Fixtures for the D1
divergences assert the CommonMark heading result and no table instead.

## Risks / Trade-offs

- [The scanner disagrees with the oracle on an edge] → The fixture set covers
  the probed behaviors; a disagreement found later is a scanner bug, fixed
  against the oracle.
- [Web renders whose tables are malformed] → A render with mismatched counts
  gets no header, as the oracle would; no worse than today.
- [A wide header row costs budget] → It is admitted as one unit and is the
  last unit dropped; when it does not fit, the passage returns without it.
