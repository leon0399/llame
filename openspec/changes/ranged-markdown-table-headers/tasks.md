Track [#1024](https://github.com/leon0399/llame/issues/1024) and its PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry
forward the recorded proposal approval and recheck native blockers before
starting; keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
the implementation layer, after proposal approval only.

```text
master
  <- ranged-table-headers/proposal
  <- ranged-table-headers/headers
  <- ranged-table-headers/finalize
```

| Layer                           | Parent     | Ownership                                                                       | Authored estimate | Closes |
| ------------------------------- | ---------- | ------------------------------------------------------------------------------- | ----------------- | ------ |
| `ranged-table-headers/proposal` | `master`   | The approved proposal, design, delta, and this task list.                       | ~600              | none   |
| `ranged-table-headers/headers`  | `proposal` | Root GFM table recognition, header-pair admission, the oracle, tests, and docs. | ~900              | #1024  |
| `ranged-table-headers/finalize` | `headers`  | Spec sync, task records, and archive movement only.                             | ~250              | none   |

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers per round; verify findings against the shipped spec, the scanner, and the oracle; commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate ranged-markdown-table-headers --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a whitespace-normalized script diff of the MODIFIED block against canonical keeping every canonical scenario in order; record Leo's approval of that revision, including proposal decisions T1-T4.
- [ ] 0.3 Self-review the proposal diff before marking the PR ready; record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. headers

- [ ] 1.1 Add `micromark-extension-gfm-table` and `mdast-util-gfm-table` as dev dependencies of `packages/native-file-tools` and a table mode to `markdown-structure.conformance.test.ts` (design D3); verify oracle-compared fixtures for a table after a one- and a multi-line paragraph, mismatched cell counts, a header without outer pipes, delimiter rows `:-`, `-|`, `|-`, `|:-:|-:|`, and a 3-space-indented delimiter, header rows `| a | b`, `||`, and `a||`, a following line without a pipe, a link reference definition and `#x` continuing a body, tables ended by an ATX heading, each fence, a thematic break `***`, `>`, `2. x`, an empty `*` item, an HTML block, a lone `<span>` line, indented code, and a blank line, a `<span>x</span>` body row, escaped and double-backslashed pipes, pipes in code spans, autolinks, and link destinations, a table in a blockquote, after a lazy list or blockquote continuation, inside frontmatter, a four-space-indented table and a four-space-indented header after a paragraph, a `- | -` delimiter, a link reference definition as header row, a lone `|` header, a U+FEFF before line 1's header, header rows after a `2. x` or `<span>` line that ended a table, and after a `# H`, `***`, closed fence, closed `<script>`, indented code, or empty `2.` line that ended one, a table after a `2. x` line that ended a table and was followed by `# H`, `***`, a closed fence, or `>` plus a blank line, a table indented to the content column of a `2. x` or empty `*` item that ended a table, directly, after a blank line, or after a sibling `3. y`, and a lone-pipe header and delimiter pair; and CommonMark-asserted fixtures for table lines followed by `===`, `=`, `---`, `-`, and `text` plus `===`, and for a table after a three-column-indented `# H` following a `2. x` line, or after `# H` following a `<span>` line, that ended a table.
- [ ] 1.2 Expose root-paragraph status on decided lines from `markdown-structure.ts` and implement the table tracker of design D1; verify the conformance fixtures pass and the existing heading conformance, outline, and `markdown-structure.test.ts` cases still pass unchanged.
- [ ] 1.3 Implement design D2 in `markdown-ancestors.ts` and `markdown-range.ts`; verify `native-file-tools` tests for every new scenario of the five ADDED requirements and the MODIFIED ancestor requirement, a comma read whose passages start in two tables, a comma read whose earlier passage shows the header row but not the delimiter row, a continuation at `nextOffset + 1` inside a table, a window that ends on a header row, and a window ending before a setext underline that a longer window reaches.
- [ ] 1.4 Verify one host-path and one web-render read through `apps/api/src/tools` tests show the header pair, and a `:raw`, `:outline`, and `.txt` read of the same content do not.
- [ ] 1.5 Update `docs/product/reference/selectors.md` ("Ranged Markdown ancestors") with the header pair, its budget priority, and the T1 and T4 limits, and add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 1.6 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter @workspace/native-file-tools typecheck`, `pnpm --filter @workspace/native-file-tools lint`, the focused `apps/api` tests from 1.4, `pnpm format:check`, and `git diff --check`.
- [ ] 1.7 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 1.8 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1024` in the PR body.

## 2. finalize

- [ ] 2.1 Enter `ranged-table-headers/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`; verify the five added requirements appear word for word and both MODIFIED requirements match the delta, with every canonical scenario kept.
- [ ] 2.2 Confirm archive readiness: `openspec status --change ranged-markdown-table-headers --json` reports every artifact done and every task above is checked; run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 2.2; then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
