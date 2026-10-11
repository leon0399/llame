## 1. Proposal layer

Tracks issue #180. Delivery stack:

```text
master <- members-panel-rehome/proposal <- members-panel-rehome/panel <- members-panel-rehome/e2e <- members-panel-rehome/finalize
```

Process: [CONTRIBUTING](../../../CONTRIBUTING.md). Use `$gh-stack` for every
stack operation and `$openspec-apply-change` for implementation. Create each
implementation layer only after proposal approval; publication and merge each
require their own authorization. Every layer has a self-review (SR) checkpoint
before draft -> ready and a GitHub review (GR) checkpoint after ready; for
finalize both follow archive movement as post-archive gates.

Native blockers: `panel` is created only after #1222 and #1223 (the #860
org-tree and members-panel story moves) merge to `master`, with the proposal
rebased onto that `master` (design D7).

Layers, each with its branch, parent, ownership, authored-size estimate against
its parent (tests, specs, and docs included; generated output counted
separately), exit evidence, and issue responsibility:

- `members-panel-rehome/proposal` (parent `master`): this ledger, the
  proposal, the design, and the `org-admin-ui` delta. Estimated about 750
  authored lines. Exit: the OpenSpec proposal, Product Markdown, and Any change
  rows, review rounds committed separately, and approval of the published
  revision. References #180 and closes no issue.
- `members-panel-rehome/panel` (parent `proposal`): moves the parked panel
  into the Organizations section, makes Manage members a live disclosure, and
  makes membership writes server-confirmed, tree-refreshing, and honest about
  denials, with its stories, unit tests, and `CHANGELOG.md` entry. Estimated
  about 1,500 to 1,700 authored lines (the four moved files measured with
  rename detection; most of the rest is stories), no generated output. Exit:
  the Workspace TypeScript, Shared UI/stories, Product Markdown, and Any
  change rows, and current-head CI green after ready. References #180 and
  closes no issue.
- `members-panel-rehome/e2e` (parent `panel`): restores the members flow in
  the org-units browser e2e against the real stack. It is its own layer so
  `panel` stays under the review budget. Estimated about 250 authored lines.
  Exit: the Root TypeScript, Cross-surface behavior, Product Markdown, and
  Any change rows, and current-head CI green after ready, including the
  Product e2e job. It completes #180's acceptance, so its PR body carries
  `Closes #180` once every acceptance item in `proposal.md` is covered by a
  test, and the issue closes when this layer merges; nobody closes it by
  hand.
- `members-panel-rehome/finalize` (parent `e2e`): canonical spec
  synchronization, the `org-admin-ui` Purpose sentence, task records, and
  archive movement only. References #180 and closes no issue.

Re-estimate each layer's authored size at its boundary and before publication;
split a growing concern or request a named exception before publishing an
oversized layer. If `panel` re-estimates above about 1,900 lines, its next
split point is the `apps/web/lib/services/org-units/` work (tasks 2.4 to 2.6:
server-confirmed writes, owner-tier copy, and the `myRole` removal, with their
unit tests) as a `services` layer between `proposal` and `panel`.

- [ ] 1.1 [proposal] Run `$iterative-review-refinement` with at least two independent reviewers per round on the proposal, design, and delta; verify each finding against the repository; commit each round separately.
- [ ] 1.2 [proposal] Verify the MODIFIED "Organizations overview" block reproduces `openspec/specs/org-admin-ui/spec.md` word for word except the footer scenario's placeholder clause, with all eight canonical scenario headings once and in order, by a recorded word-level diff; re-run it if #1255 merges first and re-copy the block (design D8).
- [ ] 1.3 [proposal] Prove the layer with `pnpm exec openspec validate members-panel-rehome --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; obtain Leo's approval of the final revision.
- [ ] 1.4 [proposal] SR: self-review the published draft PR's parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, fix accepted findings with new commits, and mark the PR ready.
- [ ] 1.5 [proposal] GR: after ready, run the Ready-PR monitoring loop on the current head with zero actionable unresolved feedback before creating `panel`.

## 2. Panel layer

Branch `members-panel-rehome/panel`, parent `members-panel-rehome/proposal`.
Owns the live members panel and every story, unit test, and doc its behavior
needs. References #180 and closes no issue.

- [ ] 2.1 [panel] Confirm #1222 and #1223 are merged, rebase `proposal` onto `master` with `$gh-stack`, and create `panel` with `$gh-stack add`; verify with `gh stack view --json` that `panel` sits on `proposal` and `proposal` on current `master`.
- [ ] 2.2 [panel] `git mv` `members-panel.tsx`, `member-confirm-dialogs.tsx`, `role-picker.tsx`, and `members-panel.stories.tsx` from `apps/web/app/(admin)/admin/components/parked/` to `apps/web/app/(admin)/admin/organizations/components/`, delete `parked/`, and remove every PARKED, fast-follow, and D7 pointer (the moved headers, `organizations/page.tsx`) (design D6); verify `git diff --stat -M master...` reports the moves as renames and `git grep -n -i 'parked\|fast-follow' -- 'apps/web/app/(admin)'` returns nothing.
- [ ] 2.3 [panel] Make "Manage members" the `CollapsibleTrigger` of a `Collapsible` that renders `MembersPanel` directly after the footer, open only while `membersOpenFor` equals the selected unit's id (design D1, D2); keep `org-tree.tsx` under the `max-lines` cap, extracting `org-tree-selected-footer.tsx` if needed; verify `org-tree.stories.tsx` stories for the scenarios "Manage members opens the panel for the selected unit", "Manage members closes the panel", "Selecting units sends no membership request", "Selecting another unit closes the panel", "Returning to the unit does not reopen the panel" (open on A, select B, select A again: no further roster request), and "Keyboard order follows the footer", each asserting the exact request list, and replace the disabled-button story.
- [ ] 2.4 [panel] Remove the optimistic `onMutate` and rollback from `useChangeMembershipRole` and `useRevokeMembership` and their two helpers, write the PATCH response into the cached roster after a confirmed role change, keep revoke's invalidations un-awaited so its confirmation closes before the row leaves, and invalidate `memberships` and `lists` on success in all three membership hooks (design D3); verify `mutations.test.ts` cases that the cached roster is unchanged while a write is pending and after a rejected write, that a confirmed role change writes the PATCH response before the refetch, that each hook invalidates `lists`, and stories for "Role change applies after the server confirms" (new role shown while the refetch is held), "Revoke removes the member after confirmation" (held DELETE keeps the row until it resolves; the dialog closes before the row leaves), and "Footer and tree follow a change to the caller's own role".
- [ ] 2.5 [panel] Add `ownerTier` to the membership mutation inputs, set it from the requested role and the target row's current role, and pick the owner-only or admin-or-owner forbidden copy in `withOrgUnitsErrors` (design D4); verify `errors.test.ts` cases for both copies and stories for "Admin cannot grant ownership", "Admin cannot remove an owner", and "Member without admin rights is denied", each asserting the roster is unchanged.
- [ ] 2.6 [panel] Delete the panel's role line, `myRoleDescription`, `useMyEffectiveRoleQuery`, `fetchMyEffectiveRole`, `orgUnitsQueryKeys.myRole`, every `myRole` invalidation, the `queries.ts` imports only they used (`getMyOrgUnitEffectiveRole`, `getApiErrorStatus`, `classifyOrgUnitsError`, `EffectiveRoleResponse`), the `EffectiveRoleResponse` alias in `types.ts`, and their tests and stories, keeping `classifyOrgUnitsError` exported from `errors.ts` (design D5); verify `git grep -n 'myRole\|useMyEffectiveRoleQuery\|fetchMyEffectiveRole\|EffectiveRoleResponse' -- apps/web ':!apps/web/lib/api/generated'` returns nothing, `pnpm --filter web typecheck` and `lint` report no unused import, and the remaining `members-panel.stories.tsx` stories cover "Roster lists the unit's direct members", "Service account role is not settable", "Empty roster is explained", "Grant from the panel", "Duplicate grant is explained", "Granting ownership asks first", "Blank user id sends nothing", "Making an owner asks first", and "Last owner cannot leave".
- [ ] 2.7 [panel] Render the roster query's classified error with a Retry control that refetches it, in place of the roster (design D9); verify a story for "Failed roster load is explained" in which a roster GET answered 500 shows the error and Retry sends exactly one more roster GET.
- [ ] 2.8 [panel] Move focus to the panel's titled region after a successful revoke (`AlertDialog` `finalFocus`), and to the newly selected row when Leave removes the panel's unit from the tree, reusing #1255's focus rescue if it has landed (design D8); verify stories for "Revoke removes the member after confirmation" (focus), "Leaving a unit that disappears from view" (a non-creator leaver; the refetched list omits the unit), "Writes carry no acting identity" (exact request bodies), "A deeper low role does not hide management", and "A roster the API withholds stays empty".
- [ ] 2.9 [panel] Add a dated `CHANGELOG.md` entry recording that members management is back in the Administration area, ending the 2026-07-11 regression, with the server-confirmed writes, owner-tier denial copy, and failed-load state; reference #180 without closing it; verify `pnpm lint:markdown`.
- [ ] 2.10 [panel] Prove the layer with `pnpm --filter web lint`, `typecheck`, `test:coverage` (merged unit and stories projects), the focused Storybook story tests for `members-panel` and `org-tree`, `pnpm format:check`, and `git diff --check`; record at least two temporary user-visible mutations (the panel following the selection; optimistic revoke restored), each failing a named story, verbatim from the run; measure the authored diff with rename detection against the 1,500 to 1,700 estimate and the named split point; publish the draft with `$gh-stack`.
- [ ] 2.11 [panel] SR: self-review the draft PR's parent-relative diff against `REVIEW_GUIDE.md`, with one code-review and one ponytail-review subagent; fix accepted findings with new commits, rerun affected checks, update the PR body, and mark ready.
- [ ] 2.12 [panel] GR: after ready, run the Ready-PR monitoring loop to completion on the current head before creating `e2e`.

## 3. E2E layer

Branch `members-panel-rehome/e2e`, parent `members-panel-rehome/panel`. Owns
the restored members-flow browser e2e; its PR body carries `Closes #180`.

- [ ] 3.1 [e2e] Create `e2e` on the reviewed `panel` with `$gh-stack add`; verify with `gh stack view --json` that it sits on `panel`.
- [ ] 3.2 [e2e] Restore the members flow in `e2e/web/org-units/org-units.spec.ts` against the real stack: a second account via `registerAccount`, grant through Manage members with the tree's member count rising, duplicate grant, Member to Admin, the blocked last-owner Leave, Make owner, then Leave. Because the leaver created the root and `org_units_select` keeps a unit visible to its creator (migration `0018`), expect after Leave that the organization stays in the tree, the roster shows its empty state, and the footer shows no role ("Grant from the panel", "Duplicate grant is explained", "Last owner cannot leave", "Transfer ownership, then leave"); rewrite its D7 header and verify `git grep -n -i 'parked\|fast-follow\|D7' -- e2e/web/org-units` returns nothing.
- [ ] 3.3 [e2e] Add a dated `CHANGELOG.md` line recording the restored members-flow e2e coverage; once each acceptance item in `proposal.md` is covered by a test, put `Closes #180` in the PR body (the issue closes when this layer merges, never by hand); verify `pnpm lint:markdown`.
- [ ] 3.4 [e2e] Prove the layer with `pnpm lint`, `pnpm format:check`, and `git diff --check`, and the spec in CI's Product e2e job (local Playwright e2e on this host cannot boot the web server); measure the authored diff; publish the draft with `$gh-stack`.
- [ ] 3.5 [e2e] SR: self-review the draft PR's parent-relative diff against `REVIEW_GUIDE.md`; fix accepted findings with new commits, rerun affected checks, update the PR body, and mark ready.
- [ ] 3.6 [e2e] GR: after ready, run the Ready-PR monitoring loop to completion on the current head, with the Product e2e job green, before creating `finalize`.

## 4. Finalize layer

Branch `members-panel-rehome/finalize`, parent `members-panel-rehome/e2e`.
Spec synchronization, task records, and archive movement only; never an
application fix. Enter the branch with `$gh-stack` from the implementation top
**before** `$openspec-sync-specs` writes any canonical spec.

- [ ] 4.1 [finalize] Confirm with `$gh-stack` that `finalize` sits on the published, reviewed `e2e` layer and that every task above is checked.
- [ ] 4.2 [finalize] Use `$openspec-sync-specs` to apply the `org-admin-ui` delta; if `org-tree-keyboard-navigation` (#1255) synced first, re-copy the canonical "Organizations overview" block with its edit and apply only this change's footer clause (design D8); rewrite the `org-admin-ui` Purpose sentence that calls the members panel withdrawn; verify `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, and that every canonical scenario heading survives.
- [ ] 4.3 [finalize] Verify archive readiness with `openspec status --change members-panel-rehome --json` and every tracked task checked; then use `$openspec-archive-change` and verify strict `--specs` and `--all` validation, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Publish the finalize draft with `$gh-stack`, self-review its diff (SR) and mark ready, run the Ready-PR monitoring loop (GR), recheck stack bases and checks, and request merge permission; merge only through `$gh-stack`.
