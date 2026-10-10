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
| `ranged-table-headers/proposal` | `master`   | The approved proposal, design, delta, and this task list.                       | ~350              | none   |
| `ranged-table-headers/headers`  | `proposal` | Root GFM table recognition, header-pair admission, the oracle, tests, and docs. | ~900              | #1024  |
| `ranged-table-headers/finalize` | `headers`  | Spec sync, task records, and archive movement only.                             | ~250              | none   |

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers per round; verify findings against the shipped spec, the scanner, and the oracle; commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate ranged-markdown-table-headers --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a whitespace-normalized script diff of the MODIFIED block against canonical keeping every canonical scenario in order; record Leo's approval of that revision, including proposal decisions T1-T3.
- [ ] 0.3 Self-review the proposal diff before marking the PR ready; record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. headers

- [ ] 1.1 Add `micromark-extension-gfm-table` and `mdast-util-gfm-table` as dev dependencies of `packages/native-file-tools` and a table mode to `markdown-structure.conformance.test.ts` comparing root table spans and header lines with the oracle; verify fixtures for a table after a paragraph line, a mismatched cell count, a header without outer pipes, a following line without a pipe, a table ended by a heading, a fence, and a blank line, an escaped pipe, a pipe in a code span, a table in a blockquote, a four-space-indented table, and `a` over `-`.
- [ ] 1.2 Implement design D1 in `markdown-structure.ts`; verify the conformance fixtures pass and the existing heading conformance and `markdown-structure.test.ts` cases still pass.
- [ ] 1.3 Implement design D2 in `markdown-ancestors.ts` and `markdown-range.ts`; verify `native-file-tools` tests for every new scenario of the MODIFIED requirement, a comma read whose two passages start in the same table (pair emitted once), a comma read whose passages start in two tables, a continuation at `nextOffset + 1` inside a table, and a window that ends on a header row.
- [ ] 1.4 Verify one host-path and one web-render read through `apps/api/src/tools` tests show the header pair, and a `:raw`, `:outline`, and `.txt` read of the same content do not.
- [ ] 1.5 Update the `read` reference page under `docs/product/reference` and add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 1.6 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter @workspace/native-file-tools typecheck`, `pnpm --filter @workspace/native-file-tools lint`, the focused `apps/api` tests from 1.4, `pnpm format:check`, and `git diff --check`.
- [ ] 1.7 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 1.8 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1024` in the PR body.

## 2. finalize

- [ ] 2.1 Enter `ranged-table-headers/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`; verify the synced requirement matches the delta word for word, with every canonical scenario kept.
- [ ] 2.2 Confirm archive readiness: `openspec status --change ranged-markdown-table-headers --json` reports every artifact done and every task above is checked; run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 2.2; then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
