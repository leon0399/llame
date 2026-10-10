## Why

A ranged Markdown `read` that starts inside a table shows its ancestor
headings and the requested rows, but not the table's header row, so the model
cannot tell which column a cell belongs to without a second read
([#1024](https://github.com/leon0399/llame/issues/1024)):

```text
6: # Iterative Review Refinement
124: ## Common Rationalizations
128: | "Codex found nothing this round, we're done" | One reviewer is one reviewer. ...
129: | "I've done 3 rounds, that's enough" | Convergence is empirical. ...
130: | "The fix is obvious, I'll skip verification" | A meaningful fraction ...
131: | "Reviewer said X is wrong, so X is wrong" | Verify against the primary source. ...
```

Web pages rendered to Markdown carry many GFM tables, so web reads gain the
most.

## What Changes

- When a passage's first requested line N is a body row of a root-level GFM
  table, the read also emits that table's header row and delimiter row, after
  the ancestor headings and before the window, skipping any of the two already
  shown.
- Root GFM tables are recognized as an overlay on the Markdown scanner's
  decided lines: a root paragraph line followed by a delimiter row with the
  same cell count, then rows until a blank line or the start of another block.
  CommonMark heading decisions are unchanged. Recognition is checked against
  micromark's GFM table extension wherever the two agree on headings.
- The header pair joins the existing admission budget as the innermost unit:
  when the budget is tight, outer headings are dropped first and the header
  pair last, as one unit.
- Comma reads, plural range promotion, `nextOffset`, continuations, and
  unchanged surfaces follow the ancestor rule as it stands.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-file-tools`: "Ranged Markdown reads prepend their ancestor
  headings" also prepends the enclosing table's header rows; five new
  requirements define root GFM table recognition; "Read representations are
  selected by media type and member" names the header pair in its exception.

## Impact

- `packages/native-file-tools`: `markdown-structure.ts` (table recognition),
  `markdown-ancestors.ts` and `markdown-range.ts` (admission and emission).
- Dev dependencies `micromark-extension-gfm-table` and `mdast-util-gfm-table`
  for the conformance oracle.
- `docs/product/reference` read behavior page; `CHANGELOG.md`.
- No API, schema, or configuration change.

## Acceptance

- `read("…/SKILL.md:129-130")` on the issue's file emits lines 6, 124, 126,
  127, then 128 through 131, with `shownRanges` covering the header pair.
- A range starting at a table's header or delimiter row, outside any table, or
  inside a table nested in a blockquote or list item is unchanged.
- Recognition agrees with micromark's GFM table extension on a fixture set of
  root-level tables wherever GFM and CommonMark agree on headings, and keeps
  the CommonMark heading result where they do not.

## Decisions for approval

- **T1 Root-level tables only.** This matches the root-heading ancestor rule
  and keeps the scanner's container handling unchanged. Tables inside
  blockquotes and list items get no header.
- **T2 The header pair outranks the outer headings.** Column names explain the
  requested cells more directly than an outer heading does, so under a tight
  budget the outer headings are dropped first.
- **T3 No header for a range that starts on the header or delimiter row.** The
  header is then already in the window or its context line.
- **T4 CommonMark headings win over GFM tables.** Table lines followed by
  `===` or `---` are a setext heading under CommonMark and a table under GFM.
  Letting the table win would change shipped heading sections, `:outline`, and
  ancestor chains; keeping CommonMark means such lines get no header pair.

## Non-goals

- `:outline` naming the table a range falls in.
- Header rows for a passage that starts outside a table and runs into one; its
  header is already inside the window.
- Tables inside containers (T1), and GFM's table-over-setext precedence (T4).
