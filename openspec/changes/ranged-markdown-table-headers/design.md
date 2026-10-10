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
  a setext heading.

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

### D1. Tables are a scanner role, decided at the delimiter row

The scanner gains a root table leaf. At a root line that would continue or
open a paragraph, it tests whether the line is a delimiter row whose cell
count equals the cell count of the previous root line, which must itself be a
paragraph line or a paragraph start. If so, the previous line is retroactively
the header row, the paragraph ends before it, and the leaf stays open until a
blank line or a line that starts another block. Cell counting splits on
unescaped pipes outside code spans and ignores one leading and one trailing
pipe. A setext underline is decided before the table test, matching the
oracle. The header row's role was pending until the delimiter row; the window
end rule already treats a pending role as undecided, so a window ending on a
header row emits nothing.

- Alternative: parse the window with micromark at read time. Rejected: it reads
  the whole source rather than streaming to the window end, and adds a runtime
  dependency to a package that has one.

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
`mdast-util-gfm-table` as dev dependencies and, for a table fixture set,
compares the scanner's root table spans and header lines with the oracle's
root `table` nodes.

## Risks / Trade-offs

- [The scanner disagrees with the oracle on an edge] → The fixture set covers
  the probed behaviors; a disagreement found later is a scanner bug, fixed
  against the oracle.
- [Web renders whose tables are malformed] → A render with mismatched counts
  gets no header, as the oracle would; no worse than today.
- [A wide header row costs budget] → It is admitted as one unit and is the
  last unit dropped; when it does not fit, the passage returns without it.
