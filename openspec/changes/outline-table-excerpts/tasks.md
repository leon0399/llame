Track [#1322](https://github.com/leon0399/llame/issues/1322) and its PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry
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

- [ ] 0.1 Read the issue, the shipped ranged-read change, the outline reader, and the canonical outline requirements; record the sourced intent, the six approval decisions, and the non-goals in `proposal.md`, with the alternatives in `design.md`.
- [ ] 0.2 Prove the revision: `pnpm exec openspec validate outline-table-excerpts --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a script diff of both MODIFIED blocks against the canonical outline requirements keeping every canonical scenario in order; record the approval of that revision.
- [ ] 0.3 Self-review the proposal diff before marking the PR ready; record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. outline

- [ ] 1.1 Expose the open root table's excerpt lines from `markdown-tables.ts`: its header row, its first content row, and its latest content row, updated as decided lines arrive and preserved after the table closes; verify the existing tracker and conformance tests still pass unchanged.
- [ ] 1.2 Emit the table excerpt from `markdown-outline.ts` at the table's close or when the scan stops, in source order and once per table; verify the outline tests for a table after prose, a section that opens with a table, a one-content-row table, a header-only table, a table inside a container, and a cut content row.
- [ ] 1.3 Add the excerpt to the scope's ancestor chain as its innermost unit and make the section that opens with a table record the excerpt as its own; verify `.agents/skills/iterative-review-refinement/SKILL.md:outline:129-130` emits lines 6, 124, 126, 128, and 129 with `shownRange` covering 6 through 129, and that a scope whose table ends inside it still emits only decided rows.
- [ ] 1.4 Verify the bound semantics: an outline cut inside the excerpt reports `truncated` with an `nextOffset` naming the first omitted line and continues from it, a chain that cannot fit is still dropped whole, and the 2,000-line ceiling and serialized cap are unchanged for a source with no tables.
- [ ] 1.5 Update `docs/product/reference/selectors.md` ("Markdown outlines" and "Outline scope") with the table excerpt, its three lines, the chain unit, and the scan-bound limit, and add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 1.6 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter @workspace/native-file-tools typecheck`, `pnpm --filter @workspace/native-file-tools lint`, the focused `apps/api` read-tool tests that exercise an outline, `pnpm format:check`, and `git diff --check`.
- [ ] 1.7 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 1.8 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1322` in the PR body.

## 2. finalize

- [ ] 2.1 Enter `outline-table-excerpts/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`; verify the three added requirements appear word for word and both MODIFIED requirements match the delta, with every canonical scenario kept.
- [ ] 2.2 Confirm archive readiness: `openspec status --change outline-table-excerpts --json` reports every artifact done and every task above is checked; run `pnpm exec openspec validate --specs`, `pnpm exec openspec validate --all`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 2.2; then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
