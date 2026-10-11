## 1. Proposal layer

Tracks #177 and item 1 of #190. Delivery stack:

```text
master <- org-tree-keyboard-navigation/proposal <- org-tree-keyboard-navigation/keyboard <- org-tree-keyboard-navigation/finalize
```

Process: [CONTRIBUTING](../../../CONTRIBUTING.md). Use `$gh-stack` for every
stack operation and `$openspec-apply-change` for implementation. Create each
implementation layer only after proposal approval. Publication and merge each
need their own authorization. Every layer has a self-review (SR) checkpoint
before draft -> ready and a GitHub review (GR) checkpoint after ready. For
finalize, both come after archive movement as post-archive gates.

Native blocker: the `keyboard` layer extends `org-tree.stories.tsx` and
`org-unit-dialogs.stories.tsx`, which #1222 and #1230 of the #860 stack add.
Create it only after both have merged to `master` and this stack is rebased
onto that `master` (design D9).

Layers, each with its branch, parent, ownership, authored-size estimate against
its parent (tests, specs, and docs included), exit evidence, and issue
responsibility:

- `org-tree-keyboard-navigation/proposal` (parent `master`): this ledger, the
  proposal, the design, and the `org-admin-ui` delta. About 750 authored
  lines. Exit: the OpenSpec proposal, Product Markdown, and Any change rows,
  review rounds committed separately, and approval of the published revision.
  References #177 and #190 and closes neither.
- `org-tree-keyboard-navigation/keyboard` (parent `proposal`): the tree's
  roving Tab stop, APG key handling, selection continuity, focus rescue,
  dialog focus return, keyboard-reachable row actions, and the `Command` move
  picker, with their unit tests and stories (design D1–D8). About 1,000
  authored lines. Exit: the Workspace TypeScript, Shared UI/stories, Product
  Markdown, and Any change rows, and current-head CI green after ready,
  including the product E2E leg. Its PR body carries `Closes #177` and
  `Refs #190` (items 2 and 3 of #190 stay open), so #177 closes when the
  layer merges; nobody closes it by hand.
- `org-tree-keyboard-navigation/finalize` (parent `keyboard`): canonical spec
  synchronization, task records, and archive movement only. References #177
  and closes no issue.

Re-estimate each layer's authored size at its boundary and before publication.
Split a growing concern, or request a named exception, before publishing an
oversized layer.

- [ ] 1.1 [proposal] Run the review rounds on the proposal, design, and delta spec (`$iterative-review-refinement`), verify each finding against the repository, and commit each round separately. Record each round's accepted and rejected findings here.
- [ ] 1.2 [proposal] Verify that the MODIFIED "Organizations overview" block reproduces `openspec/specs/org-admin-ui/spec.md` word for word except for the one named insertion in "Selected-unit footer is visible from first paint", with a recorded word-level diff (`openspec-delta-canonical-check`).
- [ ] 1.3 [proposal] Prove the layer with `pnpm exec openspec validate org-tree-keyboard-navigation --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`, and obtain approval of the published revision.
- [ ] 1.4 [proposal] SR: self-review the published draft PR's parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, fix accepted findings with new commits, and mark the PR ready.
- [ ] 1.5 [proposal] GR: after ready, run the Ready-PR monitoring loop on the current head until no actionable feedback is unresolved, before creating `keyboard`.

## 2. Keyboard layer

Branch `org-tree-keyboard-navigation/keyboard`, parent
`org-tree-keyboard-navigation/proposal`, created only after #1222 and #1230
are on `master`. Owns every behavior in `specs/org-admin-ui/spec.md`. Its PR
body carries `Closes #177` and `Refs #190`.

- [ ] 2.1 [keyboard] Add `org-tree-keyboard.ts` with the pure key resolver (design D2) and the id-path ancestor walk (design D3), plus `org-tree-keyboard.test.ts` covering every key and row shape in the "Arrow keys navigate the org tree per the APG tree pattern" scenarios, including a top-level row whose parent the caller cannot see, and the walk for a deleted unit, a moved unit, and no rendered ancestor. Verify with the focused unit run.
- [ ] 2.2 [keyboard] Make the selection the roving index and adjust it during render (design D1, D3). Set the row's `tabIndex` from `selected`, select on the row's own `onFocus`, apply resolver intents in the row's `onKeyDown` only when `e.target === e.currentTarget`, and register row elements for focus. Verify with stories for "The org tree is one roving Tab stop", "Arrow keys navigate the org tree per the APG tree pattern", and "The org tree keeps a rendered selection" (chevron collapse, Collapse all, Expand all).
- [ ] 2.3 [keyboard] Add the focus rescue (design D4) and verify it with a story whose render wrapper drops the focused unit on a `window` event and asserts that the new selected row has focus ("A removed focused row hands focus to the new selection").
- [ ] 2.4 [keyboard] Take chevrons out of the Tab sequence, and every row's actions except the selected row's (design D6). Verify with stories for "Row actions are keyboard reachable", including the keyboard delete explainer with an empty `sentRoutes()`. The existing `KeyboardSelect` story must still pass unchanged: it focuses the chevron programmatically, which `tabIndex={-1}` still allows.
- [ ] 2.5 [keyboard] Thread `finalFocus` through the create-child, rename, move, delete, and delete-explainer dialogs and record the invoker when an action opens them (design D5). Verify with stories for "Unit dialogs return focus to the tree": Cancel returns to Rename, deleting the selected leaf focuses its parent with exact `sentRoutes()`, a move under a collapsed parent focuses the nearest rendered ancestor, and deleting the last unit focuses New organization.
- [ ] 2.6 [keyboard] Rebuild `MoveTargetList` on `Command` (design D7) and verify with `MoveKeyboard`, `MoveFilter`, `MoveNoMatch`, and `MoveEnterDoesNotSubmit` stories in `org-unit-dialogs.stories.tsx`, covering "The move picker is a filterable keyboard list" and "Move picker filtering keeps the hierarchy legible". The existing `Move`, `MoveCancel`, and tree `MovePicker` stories still pass.
- [ ] 2.7 [keyboard] Prove the stories with at least two temporary component mutations, for example Right on an expanded parent doing nothing and `finalFocus` ignoring the invoker. Each must fail a named story; revert them, and copy the list verbatim from the run into the PR body.
- [ ] 2.8 [keyboard] Add a dated `CHANGELOG.md` entry (refs #177, #190) and verify `pnpm lint:markdown`.
- [ ] 2.9 [keyboard] Prove the layer with `pnpm --filter web lint`, `typecheck`, and `test:coverage` (report statements, lines, branches, and functions; design Risks), the stories via Storybook MCP `run-story-tests` (CLI `pnpm --filter web test:stories` as fallback) run three times including a cold cache, `pnpm format:check`, and `git diff --check`. Leave the product E2E `e2e/web/org-units/org-units.spec.ts` to CI. Measure the authored diff against the 1,000-line estimate and publish the draft with `$gh-stack`.
- [ ] 2.10 [keyboard] SR: self-review the draft PR's parent-relative diff against `REVIEW_GUIDE.md`, with one code-review and one ponytail-review subagent. Fix accepted findings with new commits, rerun affected checks, update the PR body, and mark ready.
- [ ] 2.11 [keyboard] GR: after ready, run the Ready-PR monitoring loop to completion on the current head before creating `finalize`.

## 3. Finalize layer

Branch `org-tree-keyboard-navigation/finalize`, parent
`org-tree-keyboard-navigation/keyboard`. Spec synchronization, task records,
and archive movement only, never an application fix. Enter the branch with
`$gh-stack` from the implementation top **before** `$openspec-sync-specs`
writes any canonical spec.

- [ ] 3.1 [finalize] Confirm with `$gh-stack` that `finalize` sits on the published, reviewed `keyboard` layer and that every task above is checked.
- [ ] 3.2 [finalize] Use `$openspec-sync-specs` to apply the `org-admin-ui` delta. Verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`, and that every shipped `org-admin-ui` scenario heading survives.
- [ ] 3.3 [finalize] Verify archive readiness with `openspec status --change org-tree-keyboard-navigation --json` and every tracked task checked. Then use `$openspec-archive-change` and verify strict `--specs` and `--all` validation, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Publish the finalize draft with `$gh-stack`, self-review its diff (SR) and mark it ready, run the Ready-PR monitoring loop (GR), recheck stack bases and checks, and request merge permission. Merge only through `$gh-stack`.
- #190 stays open for items 2 and 3 (dialog vertical rhythm, the rename dialog's visible label). Its Project fields name them as the remaining scope after `keyboard` merges.
