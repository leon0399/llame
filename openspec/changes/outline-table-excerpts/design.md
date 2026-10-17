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
  the scan stops at the scope end, at the budget, or at end of file.
- `packages/native-file-tools/src/markdown-tables.ts` already recognizes root
  GFM tables over those same decided lines for the ranged read's header pair,
  and `MarkdownAncestorTracker` skips it while no line is requested — which is
  the outline reader's case today, so an outline has no table concept at all.
- Probe of the shipped build: `:outline` of `# Root` / `intro` / a four-row
  table emits `1: # Root` and `2: intro`; `:outline:4-4` of a file whose section
  opens with the table emits the header row only because the excerpt rule picked
  it, and no content row; `.agents/skills/iterative-review-refinement/SKILL.md`
  `:outline:129-130` emits line 126 for the same accidental reason.

## Goals / Non-Goals

**Goals:**

- Name each root table's shape in the outline: its header row, its first content
  row, and the last content row the scan decided — the same orientation a
  section gets from its excerpt line.
- Give a scope that starts inside a table that excerpt as the innermost unit of
  its ancestor chain.
- Keep the forward, bounded, verbatim contract: no lookahead past the scope end
  or the budget, one entry per emitted line, no synthesized text beyond the cut
  marker.

**Non-Goals:**

- Rows as outline entries, cell parsing, or alignment (proposal T3 and its
  non-goals).
- Tables inside blockquotes or list items (proposal T1).
- Any change to the ranged read's header pair, `:raw`, frontmatter handling, the
  root excerpt, or the bounds rules beyond counting three more lines per table.

## Decisions

### D1. The outline drives the same root-table tracker

`MarkdownRootTableTracker` already decides, per line, whether a root table is
open. It gains a read-only excerpt accessor — the open table's header row, its
first content row, and its latest content row — so the outline reads the same
recognition the ranged read ships and no second table scanner exists. The
outline keeps feeding the tracker every decided line; passing the scope's first
line additionally keeps the pair available for future callers without a second
scan.

- Alternative: parse the outline window with micromark. Rejected: it does not
  stream to the budget end and adds a runtime dependency.

### D2. Each excerpt is written when its table's extent is decided

The excerpt is written when the line that ends the table arrives, or when the
scan stops (scope end, budget, end of file). Writing it at the close keeps its
three coordinates increasing and places them before the next block's own line,
so source order holds without buffering anything but the three lines.

That fixes the last content row as "the last body row this scan decided": for a
table the scan runs past, that is the table's final row; in a scope's ancestor
chain, which is written before the first in-scope entry, it is the body row at
the scope's first line. The alternative — reading ahead to the table's end —
breaks the requirement that the scan stops at the scope end, and it would make a
scoped outline's cost proportional to a table it was asked not to read.

- Alternative: emit the chain's excerpt after the in-scope entries so the final
  row is known. Rejected: it makes the chain's coordinates non-monotonic against
  later entries.

### D3. A section that opens with a table has the table excerpt as its excerpt

When a section's first non-blank line is a root table's header row, the section's
recorded excerpt is the table excerpt itself, so the three lines are emitted once
in the entry stream and once in any ancestor rendering — never as a single
excerpt line _and_ a three-line unit. A table later in a section leaves the
section's excerpt line alone and adds its own excerpt at its position.

- Alternative: take the next non-blank line after the table as the section's
  excerpt too. Rejected: the section's first content _is_ the table; a line after
  it describes the section's continuation, not its opening.

### D4. The chain prepends the excerpt as its innermost unit

`ancestorEntries()` appends the table excerpt when the scope's first line is a
body row of a root table, after the heading units, and the existing "already
shown" filter drops any of its lines that lie at or after the scope's start.
`fitsAncestorChain()` measures the whole chain, so the three lines are admitted
or dropped as one unit, exactly as the ranged read treats its header pair.

### D5. Entries stay lines

Every excerpt line is one entry: it counts against the shared serialized result
cap and the 2,000-line ceiling, and an unscoped outline can still be cut between
the three lines. `nextOffset` keeps naming the first omitted line's source line,
so `:outline:<nextOffset + 1>-M` continues the read unchanged.

## Risks / Trade-offs

- [An outline grows by up to three lines per table] → The shared caps bound it,
  and an outline cut earlier than before loses trailing entries only. Accepted
  with proposal T2, whose whole point is that tables are visible where they sit.
- [A chain's last content row is a middle row] → Stated in the delta and here;
  a caller that needs the table's end reads it, which is what the ranged read
  with its header pair is for.
- [The excerpt rule disagrees with the oracle on an exotic table] → The excerpt
  rides on the recognition the ranged read already conformance-tests against
  `micromark-extension-gfm-table`; a disagreement found later is a recognition
  bug, fixed there.
