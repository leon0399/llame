# Design

## Context

- `packages/native-file-tools/src/markdown-outline.ts` reads Markdown outlines
  in one forward pass over the scanner's decided lines. It emits frontmatter
  lines, the root excerpt (the first non-blank line before the first root
  heading), and, per root heading, that heading's lines plus the first non-blank
  line of its section, recorded once per heading in `excerpts`. A scope builds
  its ancestor chain in `ancestorEntries()` and admits it whole through
  `fitsAncestorChain()`. `append()` measures the shared budget per emitted line
  and truncates between lines, `stripAndCutLine()` is the 120-code-unit cut, and
  `handleLine()` stops at the first line beyond the scope end.
- `packages/native-file-tools/src/markdown-tables.ts` recognizes root GFM tables
  over the same decided lines for the ranged read's header pair. The outline
  reader never feeds it today, because `MarkdownAncestorTracker.accept` skips
  its table tracker while no line is requested, which is the outline's case.
- The scanner decides a root paragraph's lines together, when the paragraph
  closes; a table's rows are that paragraph. The canonical outline bounds
  requirement says so: "A source that is one undecided run … is held until that
  run is decided." So the reader can see a table's last row without adding
  lookahead of its own, and it also sees lines past the scope end while that run
  is decided — which is why every emitted line, excerpt lines included, is
  filtered by the scope rather than by where the scan stopped.
- Probes of the shipped build (built `dist`, 2026-10-17): `:outline` of
  `# Root` / `intro` / a five-row table emits `1: # Root` and `2: intro`;
  `:outline:4-4` of a file whose section opens with the table emits the header
  row only because the excerpt rule picked it; and
  `.agents/skills/iterative-review-refinement/SKILL.md:outline:129-130` emits
  lines 6, 124, and 126, where 126 is section 124's excerpt and the table's rows
  run 128 through 135.

## Goals / Non-Goals

**Goals:**

- Name each root table's shape in the outline: its header row, its first content
  row, and its last content row — the orientation a section gets from its one
  excerpt line.
- Give a scope that starts inside a table the part of that excerpt which precedes
  its first line, so a scoped outline carries the column names.
- Keep the forward, verbatim contract: one entry per emitted line, no synthesized
  text beyond the cut marker, no change to where the scan stops.

**Non-Goals:**

- Rows as outline entries, cell parsing, alignment, or a delimiter row in an
  excerpt (proposal T3).
- Tables inside blockquotes or list items contributing an excerpt of their own
  (proposal T1).
- Any change to the ranged read's header pair, `:raw`, frontmatter handling, the
  root excerpt, or the bounds rules beyond counting up to three more lines per
  table.

## Decisions

### D1. The outline drives the same root-table tracker

`markdown-outline.ts` feeds a `MarkdownRootTableTracker` every decided line it
already hands the ancestor tracker, and `markdown-tables.ts` gains a read-only
accessor for the open table's excerpt lines — its header row, its first content
row, and its latest content row. One recognition implementation serves both
readers; the ranged read's `accept` contract is unchanged, so its conformance
fixtures keep passing untouched.

- Alternative: parse the outline window with micromark. Rejected: it does not
  stream to the budget end and adds a runtime dependency.

### D2. The excerpt is written when the table's run ends, and every line it names is scope-filtered

The outline writes an excerpt after the tracker has closed the table — the line
that ended it, or the end of the scan (scope end reached, budget spent, end of
file) — and it does so in the step that runs before `handleLine`, so the
excerpt's coordinates precede the closing line's own entry. The accessor reports
the table's header row, its first content row, and its latest content row; the
outline holds those three until it writes them.

"Last content row" is therefore the table's last decided row where the scan
reached the end of the run, and the row at the stop line where the scan stopped
inside it. Which of the three lines is emitted is then decided per line by the
scope: an excerpt line outside the scope is not emitted, exactly as any other
entry outside the scope is not. That is also why the reader may hold lines past
the scope end without violating anything: the shipped bounds rule already
decides a whole paragraph at a time, and the scope filter, not the stop line,
decides what is emitted.

- Alternative: put the write inside `handleLine`. Rejected: `handleLine` stops on
  the first line past the scope end, so a table closed at or after that line
  would never write its excerpt — including the case a scope inside a table
  needs.

### D3. A section that opens with a table has the table excerpt as its excerpt

When a section's first non-blank line is a root table's header row, the section's
recorded excerpt is the table excerpt, so those lines are emitted once in the
entry stream and once in any ancestor rendering — never as a single excerpt line
plus a three-line unit. A table later in its section leaves the section's excerpt
line alone and adds its own excerpt at its position.

- Alternative: also take the next non-blank line after the table as the section's
  excerpt. Rejected: the section's first content _is_ the table; a line after it
  describes the section's continuation.

### D4. A chain prepends only the excerpt lines that precede the scope

`ancestorEntries()` appends, when the scope's first line is a root table's
delimiter row or one of its body rows, that table's excerpt restricted to the
lines before the first in-scope line — its header row always, and its first
content row only when that row precedes the scope. The chain keeps its existing
"lines at or after the scope start follow the in-scope rule" filter and its
whole-chain admission, and it deduplicates the lines it already carries, so a
section whose excerpt is the same table cannot emit a line twice.

The last content row is absent from a chain by construction: it lies at or after
the scope's first line, and chain lines stop there. A caller that needs the
table's end reads it.

### D5. Entries stay lines

Every excerpt line is one entry: it counts against the shared serialized result
cap and the 2,000-line ceiling, and an outline can be cut between the three
lines. `nextOffset` keeps naming the first omitted line's source line, so
`:outline:<nextOffset + 1>-M` continues the read unchanged. The chain's admission
is unchanged — when the chain and the first in-scope entry do not fit, the chain
is omitted whole, excerpt lines included.

### D6. Container tables contribute nothing of their own

A table inside a blockquote or a list item is not a root table, so it
contributes no excerpt. A line of such a table can still be a section's or the
document's ordinary excerpt line, under the rule that takes the first non-blank
line "whatever that line is"; that is unchanged behavior, and the delta says so
rather than claiming the outline emits nothing for such a table.

## Risks / Trade-offs

- [An outline grows by up to three lines per table] → The shared caps bound it,
  and an outline cut earlier than before loses trailing entries only. Accepted
  with proposal T2, whose point is that tables are visible where they sit.
- [A chain never names the table's last content row] → Stated in the delta and
  here: the chain stops at the scope, and the entry stream carries the last row
  wherever the scope contains it.
- [Recognition disagrees with the oracle on an exotic table] → The excerpt rides
  on the recognition the ranged read already conformance-tests against
  `micromark-extension-gfm-table`; a disagreement found later is a recognition
  bug, fixed there.
