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
line of section 124, and shows nothing about the table's content. A table that
follows prose is invisible to the outline entirely.

## What Changes

- `:outline` emits a **table excerpt** for every root table: the table's header
  row, its first content row, and its last content row, in source order, each
  verbatim with the ordinary `N:` prefix and each cut at 120 UTF-16 code units
  with a trailing `…` exactly as excerpt lines are.
- The table excerpt sits where the table sits: a section whose first non-blank
  line is a root table's header row emits the three lines in place of its single
  excerpt line, and a table that follows other content in its section still
  contributes its excerpt at its own position. No line is emitted twice.
- `:outline:N-M` whose `N` is a body row of a root table prepends that table's
  excerpt as the innermost unit of its ancestor chain, before the in-scope
  entries, under the chain's existing whole-unit admission ("the chain is
  omitted whole" when it does not fit) and its "already shown" dedup.
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
  ancestors" prepends the table excerpt as the innermost chain unit; "Outline
  output obeys explicit bounds" names the excerpt's three lines as chain units
  for the whole-unit admission.

## Impact

- `packages/native-file-tools`: `markdown-outline.ts` (emission, chain, and
  budget), `markdown-tables.ts` (expose the open table's excerpt lines
  alongside the header pair), their tests, and
  `docs/product/reference/selectors.md`.
- `CHANGELOG.md`.
- No API, schema, migration, or configuration change.

## Acceptance

- An outline of a Markdown file whose section holds prose and then a table emits
  the table's header row, first content row, and last content row at the table's
  position, in source order.
- `.agents/skills/iterative-review-refinement/SKILL.md:outline:129-130` emits
  lines 6, 124, 126, 128, and 131, with `shownRange` covering them and no line
  repeated.
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
- **T5 The three lines are one chain unit** for the scope's ancestor admission,
  admitted or dropped whole; they are three entries for the cap and ceiling, so
  an unscoped outline can still be cut between them.
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

- The scan still stops at the scope end or when the budget is spent, so a table
  that continues past either contributes the rows the scan decided and no
  lookahead is added. In a scope's chain the excerpt is written before the
  in-scope entries, so its third line is the last content row decided at that
  moment rather than the table's final row; the design records this as a
  deliberate limit and the reviewers should falsify it with a case where the
  table ends inside the scope.
- Whether the section excerpt rule, for a section that opens with a table, takes
  the next non-blank line after the table as well, or stops at the table (T2
  says the three lines replace the one line) — the delta fixes the second, and
  the design should say why the first is worse.
