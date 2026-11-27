# Tasks

## Delivery graph

Use `$gh-stack` for every layer and `$openspec-apply-change` for implementation.
Create only the next authorized branch. Planning readiness is not approval.

- `worktreeinclude/proposal`, parent `master`: owns proposal, delta specs,
  design with the ADR draft, and tasks. Estimate 750 authored lines, no generated
  churn. Exit evidence is strict validation, Markdown and formatting checks,
  independent proposal review, SR, and published-head GR/CI. Use `Refs #1910`.
- `worktreeinclude/copy`, parent `worktreeinclude/proposal`: owns the proto
  contract, Rust daemon copy, both API callers, negative tests, shipped docs,
  and ADR. Estimate 2,000 to 3,000 authored added-plus-deleted lines. Report
  generated lockfile and codegen churn separately. Exit evidence is focused
  filesystem, protocol, permission, and creation tests plus affected workspace
  lint/typecheck, Rust fmt/clippy, SR, and published-head GR/CI. This PR uses
  `Closes #1910`.
- `worktreeinclude/finalize`, parent `worktreeinclude/copy`: owns canonical spec
  synchronization, completed task records, and archive movement only. Estimate
  450 to 750 authored changed lines, with rename detection for archive moves.
  Exit evidence is strict canonical/change validation, Markdown/format checks,
  and post-archive SR and GR/CI. Use `Refs #1910`, not issue closure.

No cutover sub-issues or parallel branches are required. The implementation is
one atomic contract across the hub and daemon. Protocol-only and caller-only
changes are not separate shipping boundaries. The complete proposal and complete
implementation are safe intermediate merge boundaries after their gates pass.
Re-estimate each layer against its immediate parent before publication. Do not
split required safety tests away from their behavior to meet the review target.

## 1. Proposal layer: `worktreeinclude/proposal`

- [x] 1.1 Commit the initial planning draft and verify the parent-relative diff contains only this change's planning artifacts.
- [ ] 1.2 Run at least two independent reviewers per round, verify findings against code or executable probes, and commit each revision separately until convergence. In progress: round 1 is encoded; another round follows.
- [x] 1.3 Prove the proposal with `pnpm exec openspec validate worktreeinclude --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.
- [ ] 1.4 Obtain publication permission, publish the draft with `$gh-stack`, and complete SR of the actual parent-relative diff before ready.
- [ ] 1.5 Complete GR and current-head CI with the CONTRIBUTING.md monitoring loop, verify Project state when access permits, and obtain Leo's approval of the published revision before implementation.

## 2. Implementation layer: `worktreeinclude/copy`

- [ ] 2.1 Recheck approved scope, native blockers, and #1876/#1877; create only this layer with `$gh-stack` and start `$openspec-apply-change`. Verify no conflicting live claim or incompatible pending contract.
- [ ] 2.2 Carry the selected Checkout root as the copy source through both planners, distinct from main Checkout and base-ref logic. Record the derived `copy_source` decision only when the root differs from the canonical and `main_clone` locators, and as a bypass decision under `bypass`. Verify a linked-source fixture copies its own environment, a subdirectory of a linked Worktree decides its root before manifest access, and a root equal to an existing decision records no extra one.
- [ ] 2.3 Extend `CreateWorktreeRequest` with `copy_source` and `GitFailureReason` with `GIT_FAILURE_REASON_COPY_FAILED = 9`, add `copy_failed` to the API `FAILURE_TYPES` and result readers (carrying `message`), regenerate the TypeScript client, increase the machine protocol version, and update `crates/machine-git`. Verify a mismatched version fails the handshake before mutation, an empty or leading-`-` `copy_source` is `INVALID_INPUT`, a `copy_source` whose gitfile points at a repository outside the roots fails before any manifest read, a `copy_source` of another repository fails, and both host and remote fixtures use daemon-side copying.
- [ ] 2.4 Implement eligibility with `git ls-files -z --others --ignored --exclude-standard` (no `--directory`) through a streaming NUL-record reader with the hardening of `run_pinned`, the manifest pattern screen, and top-down matching with the workspace Rust `ignore` crate (`matched_path_or_any_parents` unused). Verify comments, escapes, root anchors, directory patterns, ordered negation, `**`, nested/global ignores (and that `XDG_CONFIG_HOME` is not honored), no manifest, empty manifest, unmatched patterns, a source with more than 1 MiB of ignored paths plus a `.env` manifest, nested repositories and a destination under the source skipped silently, and refusal of `..`, `.git`, NUL, and invalid UTF-8 patterns with real-git fixtures. Repeat the three recorded matcher probes as Rust tests.
- [ ] 2.5 Implement regular-file copying through directory handles opened component by component without following links, a destination real-path check after `git worktree add` and before any copy, destination-local temporary files renamed into place, and ordinary mode preservation. Verify selected links, link parents, special files, Git metadata, path escapes, destination hard links, and file/directory conflicts cannot redirect reads or writes, that a real-path mismatch copies nothing and leaves the hub's existing removal to run on a clean tree, and that a platform without the required primitives fails with `copy_failed`.
- [ ] 2.6 Preserve the destination index while allowing tracked regular-file overwrites. Verify source bytes replace a differing tracked destination, Git reports the difference, identical files remain clean, and source files remain unchanged.
- [ ] 2.7 Cover checkout, enumeration, and copy with one deadline and no cancellation propagation. Verify large explicit selections do not silently truncate, the deadline stops writers and removes the temporary file, every failure removes its temporary file, and an injected later-file failure retains earlier copies and reports the leftover locator with a `copy_failed` message that holds no stderr, OS error text, manifest lines, or bytes.
- [ ] 2.8 Preserve known-failure and unknown-outcome mappings through `git.worktreeAdd`, tool entry, and Chat creation. Verify no binding/catalog/lease commit on copy failure, no first message or Run on failed Chat creation, and no repeated add/copy on recovery or same-id resend.
- [ ] 2.9 Prove aggregate authorization and unchanged mode gates. Verify a source-read-rejected `.env` copies without file-tool admission, rejected entry performs no copy, model read-only creation fails, owner read-only creation succeeds, and later destination reads obey destination rules.
- [ ] 2.10 Add owner-isolation and content-disclosure negatives. Verify a foreign Checkout id starts no manifest access, a synthetic secret never appears in protocol results/logs/events/errors, and raw manifest lines never become diagnostics.
- [ ] 2.11 Verify lifecycle behavior with real git. Source edits do not propagate, an edited ignored copy does not add a removal guard, a tracked overwrite blocks removal as dirty, and plain Workspace entry does not process the manifest.
- [ ] 2.12 Publish the ADR drafted in `design.md` under `docs/adr/` with its acceptance date and status. Link it from the shipped architecture and owning spec. Verify Markdown links and ADR prose rules.
- [ ] 2.13 Update `docs/product/reference/tools/enter-workspace.md`, the existing repository and permission operator pages, tool-description behavior, and `SPEC.md`. Explain aggregate authority, tracked overwrites, leftovers, matching, and ignored-file removal. Add `.changeset/worktreeinclude.md` (the PR never edits `CHANGELOG.md`) and remove completed roadmap text if present. Verify the exact existing page names before editing and run Markdown checks.
- [ ] 2.14 Run the focused checks below, affected workspace lint/typecheck, Rust fmt and clippy through `pnpm --filter machine lint`, formatting, Markdown checks, and `git diff --check`. Record exact commands and distinguish local evidence from full CI.
- [ ] 2.15 Publish the authorized draft with `Closes #1910`, complete SR of the actual parent-relative diff before ready, and resolve verified findings with focused checks.
- [ ] 2.16 Complete GR, current-head CI, and the required monitoring loop. Verify Project readback where authorized and obtain explicit merge permission.

### Focused proof surfaces

Use the inline tests of `crates/machine-git` and `apps/machine/tests/git.rs`
for the daemon wire, root guards, typed failures, deadline, idempotency, and
the absence of file bytes in protocol results. Run them with a narrow
`cargo test --locked -p machine-git` for the `machine-git` inline tests and
`cargo test --locked -p llame-machine --test git` for the daemon integration
tests, or the workspace script behind `pnpm --filter machine test`, which runs
both. Pure matcher tests alone cannot prove
filesystem or Git eligibility behavior. Use real temporary git fixtures for
bytes, status, modes, links, failures, and removal.

Use `apps/api/src/machines/wire/git.test.ts`,
`apps/api/src/machines/wire/git.integration.test.ts`, and
`apps/api/src/machines/executor-git.service.test.ts` for the changed wire,
source identity, and failure projection. Use
`apps/api/src/tools/workspace-worktree-entry.test.ts`,
`workspace-worktree-creation.test.ts`, and focused API integration files for
durable attempts, previous binding/generation, same-id Chat resend, message
admission, and owner isolation. Follow `docs/development/testing.md` for test
placement, including its Rust daemon build requirement. Build the daemon and
generated client sequentially when an integration fixture requires it.

Run only the relevant test files locally, not the full unit/integration sweeps,
product E2E, or mutation suites. CI owns those published-head checks. No model
quality evaluation is required for this deterministic contract.

## 3. Finalize layer: `worktreeinclude/finalize`

- [ ] 3.1 Verify proposal and implementation gates, then enter this branch with `$gh-stack` before `$openspec-sync-specs` writes canonical specs. Confirm the branch parent and keep application changes out.
- [ ] 3.2 Run `$openspec-sync-specs` and inspect all four affected capabilities. Verify the new capability purpose, aggregate authorization, source distinction, failure semantics, and unchanged existing scenarios.
- [ ] 3.3 Prove archive readiness with `openspec status`, complete task records, strict spec/change validation, Markdown checks, formatting, and `git diff --check`. Stop if any tracked pre-archive task remains incomplete.

After readiness, run `$openspec-archive-change`. Archive movement precedes draft
publication. The finalize layer's SR and GR are post-archive gates, not unchecked
prerequisites of archive. Review the actual parent-relative diff before ready,
then complete current-head CI and the CONTRIBUTING.md monitoring loop. Update
Project records where authorized and merge only with explicit permission.
