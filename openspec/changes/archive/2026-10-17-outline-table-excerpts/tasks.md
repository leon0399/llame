Track [#1322](https://github.com/leon0399/llame/issues/1322) and its PR layers
through [Project tracking](../../../../CONTRIBUTING.md#project-tracking). Carry
forward the recorded approval of this revision and recheck native blockers
before starting; keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for the
implementation layer, after proposal approval only.

```text
master
  <- outline-table-excerpts/proposal
  <- outline-table-excerpts/outline
  <- outline-table-excerpts/finalize
```

| Layer                             | Parent     | Ownership                                                                   | Authored estimate | Closes |
| --------------------------------- | ---------- | --------------------------------------------------------------------------- | ----------------- | ------ |
| `outline-table-excerpts/proposal` | `master`   | The proposal, design, delta, and this task list.                            | ~700              | none   |
| `outline-table-excerpts/outline`  | `proposal` | Root-table outline excerpts: tracker accessor, outline wiring, tests, docs. | ~800              | #1322  |
| `outline-table-excerpts/finalize` | `outline`  | Spec sync, task records, and archive movement only.                         | ~250              | none   |

## 0. proposal

- [x] 0.1 Run one review round with two independent reviewers — one contract review against the shipped canonical text, one empirical probe of the reader, the tracker, and today's build; verify every finding against code or the oracle, fix the accepted ones in one commit, and record the rejected ones with their evidence in the PR body.
- [x] 0.2 Prove the revision: `pnpm exec openspec validate outline-table-excerpts --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a script diff of all three MODIFIED blocks against the canonical requirements keeping every canonical scenario in order; record the approval of that revision.
- [x] 0.3 Self-review the proposal diff before marking the PR ready; record the review round and the corrected worked examples in the PR body.
- [x] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. outline

- [x] 1.1 Expose the open root table's excerpt lines from `markdown-tables.ts`: its header row, its first content row, and its latest content row, updated as decided lines arrive and readable after the table closes; verify the ranged read's tracker tests and the conformance fixtures still pass unchanged.
- [x] 1.2 Write the table excerpt from `markdown-outline.ts` after the tracker closes a table — the line that ends it, or the end of the scan — in the step before `handleLine`, so its coordinates precede the closing line's own entry; verify the outline tests for a table after prose, a section that opens with a table, a one-content-row table, a header-only table, and a table that ends at end of file.
- [x] 1.3 Filter every excerpt line by the scope and carry it into a chain: verify `.agents/skills/iterative-review-refinement/SKILL.md:outline:129-130` emits lines 6, 124, 126, and 128 with `shownRange` covering 6 through 128, `:outline:125-135` emits 6, 124, 126, 128, and 135, `:outline:127-130` emits 6, 124, 126, and 128 because the scope holds the table's first content row, and a scope that stops inside a table emits no row past its end.
- [x] 1.4 Verify the dedup and bound semantics: a line the chain and the table's own position would both carry is emitted once, a chain that cannot fit is still omitted whole, an outline cut between excerpt lines reports `truncated` with an `nextOffset` naming the first omitted line and continues from it, and a source with no tables is unchanged.
- [x] 1.5 Update `docs/product/reference/selectors.md` — `### Outline output`, which enumerates the emitted lines, and `### Outline scope` — with the table excerpt, its three lines, the chain's header-and-first-row unit, and the scope filter, and add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [x] 1.6 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter @workspace/native-file-tools test:coverage`, `pnpm --filter @workspace/native-file-tools typecheck`, `pnpm --filter @workspace/native-file-tools lint`, the focused `apps/api` read-tool tests that exercise an outline, `pnpm format:check`, and `git diff --check`.
- [x] 1.7 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [x] 1.8 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1322` in the PR body.

## 2. finalize

- [x] 2.1 Enter `outline-table-excerpts/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`; verify the three added requirements appear word for word and all three MODIFIED requirements match the delta, with every canonical scenario kept.
- [x] 2.2 Confirm archive readiness: `openspec status --change outline-table-excerpts --json` reports every artifact done and every task above is checked; run `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`, recording any failure that already exists on `master` (the CLI escalates its requirement-length warning, so the strict spec runs fail repo-wide).
- [x] 2.3 After the archive move, repair the archived `tasks.md`'s Project tracking link depth (one more `../`) and any other relative link the move breaks; re-run `pnpm lint:markdown` and `node scripts/check-markdown-links.mjs`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 2.2; then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
