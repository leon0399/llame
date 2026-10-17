# Proposal

## Why

A Markdown outline names sections but not tables. The outline emits, per root
heading, its heading lines plus the first non-blank line of its section,
whatever that line is, so a table appears only when it happens to be that line —
and never shows which columns the table has or how far its content runs. A
reader navigating a table-dense source (most web renders, many Knowledge notes)
must read rows to find out. [#1322](https://github.com/leon0399/llame/issues/1322)
asks for the table's shape to be visible the way a section's is; the ranged-read
change that shipped beside it deferred exactly this ("non-goals: `:outline`
naming the table a range falls in", and #1024's body item 6, "out of scope
unless the proposal finds the outline should also name the table a range falls
in").

Today, on `.agents/skills/iterative-review-refinement/SKILL.md`, `:outline`
shows `126: | Excuse | Reality |` only because line 126 is the first non-blank
line of section 124, and shows nothing about the table's content, which runs
from line 128 to line 135. A table that follows prose is invisible to the
outline entirely.

## What Changes

- `:outline` emits a **table excerpt** for every root table: the table's header
  row, its first content row, and its last content row, in source order, each
  verbatim with the ordinary `N:` prefix and each cut at 120 UTF-16 code units
  with a trailing `…` exactly as excerpt lines are.
- The table excerpt sits where the table sits: a section whose first non-blank
  line is a root table's header row emits the three lines in place of its single
  excerpt line, and a table that follows other content in its section still
  contributes its excerpt at its own position. No line is emitted twice.
- `:outline:N-M` whose `N` is a root table's delimiter row or one of its body
  rows prepends that table's excerpt restricted to the lines before `N` — its
  header row, and its first content row when that row precedes `N` — as the
  innermost unit of its ancestor chain, under the chain's existing whole-unit
  admission and its "already shown" dedup. A chain never names the table's last
  content row: that row is at or after `N`.
- Every table-excerpt line is still one entry: it counts against the shared
  serialized result cap and the 2,000-line ceiling, the outline is still cut
  between lines, and `nextOffset` still names the first omitted line's source
  line.
- Root tables only, matching #1024's T1: a table inside a blockquote or a list
  item contributes nothing. The delimiter row is not part of the excerpt; a
  table with one content row emits its header row and that row, and a table with
  no content rows emits its header row alone.
- Unchanged: `:raw`, ordinary ranged reads, comma reads, frontmatter handling,
  the root excerpt, unselected reads, directory reads, non-Markdown sources, and
  `edit`/`write` previews.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-file-tools`: "Markdown outlines are verbatim structural lines"
  additionally enumerates the table excerpt; "Outline scope prepends the direct
  ancestors" prepends the excerpt lines before the scope as the innermost chain
  unit; "Root GFM tables are an overlay on CommonMark lines" is widened to
  recognize a root table for these outline requirements too, and to say that an
  excerpt changes which lines the outline emits, not which lines are headings or
  sections.

## Impact

- `packages/native-file-tools`: `markdown-outline.ts` (emission, chain, and
  budget), `markdown-tables.ts` (expose the open table's excerpt lines
  alongside the header pair), and their tests.
- `apps/api/src/tools/native-files.test.ts`: the outline assertion of
  "keeps raw, outline, and non-Markdown reads free of the header pair" changes,
  because that fixture's outline gains the table's three lines and its
  `shownRange` grows; the test's point becomes that the outline carries the
  excerpt and not the ranged read's delimiter row.
- `docs/product/reference/selectors.md`, `CHANGELOG.md`.
- `CHANGELOG.md`.
- No API, schema, migration, or configuration change.

## Acceptance

- An outline of a Markdown file whose section holds prose and then a table emits
  the table's header row, first content row, and last content row at the table's
  position, in source order.
- `.agents/skills/iterative-review-refinement/SKILL.md:outline:129-130` emits
  lines 6, 124, 126, and 128, in that order, with `shownRange` covering 6 through
  128 and no line repeated; line 128 is the table's first content row, and its
  last content row, 135, is not in that scope.
- `:outline:125-135` of the same file emits lines 6, 124, 126, 128, and 135: the
  scope holds the table's header row, so all three excerpt lines are emitted,
  the last one as an in-scope entry.
- `:outline:127-130` emits lines 6, 124, 126, and 128: the scope starts at the
  delimiter row, so the chain carries the header row alone, and the table's own
  position emits its first content row because the scope holds it.
- A table inside a blockquote or list item changes nothing.
- A one-content-row table emits the header row and that row; a header-only table
  emits the header row.
- A cut outline still reports `truncated` and an `nextOffset` naming the first
  omitted line, and `:outline:<nextOffset + 1>-M` continues it.
- `:outline` of a source with no tables, and every other read shape named above,
  is byte-identical to today.

## Decisions for approval

- **T1 Root tables only.** Matches the ranged read's T1 and the root-heading
  ancestor rule; a table inside a container is not outline structure.
- **T2 Per-table entries.** Every root table contributes its excerpt where it
  sits — in the unscoped outline, in a scope that contains it, and as the
  innermost chain unit for a scope that starts inside it. Not only when a
  section's excerpt rule happens to land on the header row.
- **T3 Header row, first content row, last content row.** No delimiter row: the
  excerpt's purpose is orientation, not column parsing, which the ranged read's
  pair already serves.
- **T4 The 120-unit cut applies to each of the three lines**, with the same
  surrogate-pair backup the excerpt cut uses.
- **T5 The chain carries the excerpt lines that precede the scope**, admitted or
  dropped with the chain as a whole; every excerpt line is one entry for the cap
  and ceiling, so an outline can still be cut between them.
- **T6 One content row or none.** With a single content row the first and last
  rows are the same line, emitted once; with no content rows only the header row
  is emitted.

## Non-goals

- Rows as outline entries: the excerpt is not a table of contents for a table's
  rows, and the outline still never summarises cell contents.
- Alignment, cell parsing, or a delimiter row in the excerpt.
- Tables inside blockquotes or list items (T1).
- Any change to the ranged read's header pair, `:raw`, or `:outline`'s
  frontmatter, root-excerpt, and bounds rules beyond the three lines above.

## Assumptions and unresolved questions

- The scanner decides a table's rows as one root paragraph, so the reader sees a
  table's last row without lookahead of its own; it may also hold lines past the
  scope end while that run is decided, which is why every emitted line, excerpt
  lines included, is filtered by the scope rather than by where the scan
  stopped. Where the scan stops is unchanged.
- A table inside a container can still be a section's or the document's
  ordinary excerpt line, because that rule takes the first non-blank line
  "whatever that line is". The delta leaves that rule alone and claims only that
  such a table contributes no excerpt of its own.
