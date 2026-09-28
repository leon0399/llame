# Tasks

Delivery stack:

```text
master <- ranged-read-ancestors/proposal <- ranged-read-ancestors/reader <- ranged-read-ancestors/finalize
```

`ranged-read-ancestors/proposal` owns the four planning artifacts and no
application code. It is estimated at about 1,000 authored lines against
`master`, including the canonical MODIFIED requirement reproductions, and
closes no issue.

`ranged-read-ancestors/reader` is the functionality-completing layer. It owns
the shared Markdown ancestor tracker, native file and in-memory single- and
multi-range behavior, web media-type plumbing, focused tests, the model-facing
read prompt, operator documentation, the dated `CHANGELOG.md` entry, and any
completed `ROADMAP.md` removal. It is estimated at 1,200-1,600 authored lines
against `ranged-read-ancestors/proposal`; generated lockfile churn, if any, is
reported separately. Its PR owns `Closes #1018`.

`ranged-read-ancestors/finalize` owns only canonical spec synchronization,
checked task history, and archive movement. It is estimated below 200 authored
lines against `ranged-read-ancestors/reader`, using rename detection for archive
movement, and closes no issue. It MUST NOT repair application code.

Use `$gh-stack` for every branch, parent, publication, replay, and merge
operation. Use `$openspec-apply-change` only after proposal approval and only for
the current owning layer. Checked tasks record completed work but never grant
approval or publication permission. Keep each layer within the approximately
2,000-authored-line review budget against its immediate parent and report
reproducible generated churn separately.

## 1. Proposal layer

Branch `ranged-read-ancestors/proposal`, parent `master`, owns `proposal.md`,
`design.md`, `specs/native-file-tools/spec.md`, and this task ledger. Exit
evidence is the canonical delta proof, strict OpenSpec validation, Product
Markdown lint, and a clean parent-relative proposal diff. The branch was
initialized before the scaffold was written.

- [x] 1.1 Confirm with `$gh-stack` that `ranged-read-ancestors/proposal` is based on `master`, then verify the proposal branch contains only proposal-owned artifacts and no application code with `git status --short` and an artifact listing
- [ ] 1.2 Verify every implementation claim and file:line citation in the four artifacts against the current tree, including the native single- and multi-range result shapes, streaming and in-memory paths, Markdown scanner and outline ancestry, file media-type table, web selector callers, source bounds, and issue #1018; record any conflict in the proposal's assumptions or open questions before review
- [ ] 1.3 Run the bounded canonical delta-preservation script for both MODIFIED requirements; prove that every canonical sentence and scenario remains, every difference is an intentional insertion, and all 13 brief scenarios appear in the ADDED requirement
- [ ] 1.4 Run `pnpm exec prettier --write openspec/changes/ranged-read-ancestors/`, `pnpm exec openspec validate ranged-read-ancestors --strict`, `pnpm lint:markdown`, and `git diff --check`; retain the outputs as proposal-layer evidence and fix any artifact-only failure
- [ ] 1.5 Commit the complete initial proposal layer as one conventional commit named `docs(openspec): propose ranged-read-ancestors`, with a body naming #1018, #701, and #572 plus `Co-authored-by: Claude <noreply@anthropic.com>`; verify the commit contains only proposal-owned artifacts
- [ ] 1.6 Complete the first adversarial review round with at least two independent reviewers over proposal, design, both MODIFIED blocks, the ADDED requirement, and tasks; verify findings against the issue, current code, canonical spec, and CONTRIBUTING.md, fix accepted findings in a separate commit, and rerun affected checks
- [ ] 1.7 Complete a second independent adversarial review round with at least two reviewers covering result-shape promotion, per-passage deduplication, setext and heading-boundary behavior, bounds and continuation progress, source and permission isolation, web media labels, and canonical-block preservation; fix accepted findings in a separate commit and rerun affected checks
- [ ] 1.8 Complete Leo's explicit review and approval of the published proposal revision; record the approved revision and any rejected findings without treating local readiness as approval
- [ ] 1.9 After publication authorization, publish the proposal draft with `$gh-stack`, self-review the actual parent-relative PR diff, and mark it ready only after the proposal evidence and accepted review fixes are current
- [ ] 1.10 After the proposal is ready, complete the GitHub-bot review and current-head CI loop on the published PR, resolve every actionable finding, and verify the expected approval before creating `ranged-read-ancestors/reader`

## 2. Reader layer implementation

Branch `ranged-read-ancestors/reader`, parent `ranged-read-ancestors/proposal`,
owns the implementation and focused behavior tests. Use
`$openspec-apply-change` for this layer only after the proposal is approved and
`$gh-stack` confirms the immediate parent. Each task below names focused proof;
full published-head CI remains a separate gate in section 3.

- [ ] 2.1 Extract the shared root-heading ancestor tracker from the outline path into the Markdown structure layer, preserving the scanner's native line, ATX, setext, duplicate-heading, deferred-run, and source-order behavior; verify with focused native scanner and outline regression tests
- [ ] 2.2 Extend the native single-range stream and in-memory selection paths to apply the tracker only to explicit ordinary `text/markdown` ranges, emit verbatim heading lines without excerpts or 120-unit cuts, promote to plural range metadata only when a chain is emitted, and keep no-ancestor and non-Markdown results byte-compatible; verify with focused native tests for ATX, setext, heading-start, no-heading, and non-Markdown cases
- [ ] 2.3 Extend the native file-backed and in-memory multi-range walk to add a chain per merged passage, deduplicate by source line, preserve source order, keep `requestedRanges` unexpanded, include ancestors in `shownRanges`, and preserve existing context merging and gap behavior; verify with focused multi-range tests for shared ancestors, different sections, duplicate headings, and adjacent intervals
- [ ] 2.4 Apply the shared range reader to web rendered content by passing the render media type into `selectSourceLines` and `selectMultiRangeLines`; verify Markdown ladder and adapter renders receive ancestors while `text/plain`, raw, unsupported media, and directory results retain their current behavior and web envelopes
- [ ] 2.5 Implement the shared 2,000-line and serialized-result budget rules for ancestor admission, omit a chain atomically when it cannot fit, preserve requested-line `nextOffset`, and recompute chains for continuations; verify focused native and web tests for budget omission, oversized lines, truncation, continuation progress, reserved envelope room, and scanner consumption past a deferred window

## 3. Reader delivery and issue closure

Branch `ranged-read-ancestors/reader`, parent `ranged-read-ancestors/proposal`,
continues to own the complete issue-closing layer. Its exit evidence is focused
native/API verification, updated operator surfaces, a measured parent-relative
diff, separate SR, and the published GR loop.

- [ ] 3.1 Add focused native and API tests covering host, `file://`, `kb://`, `skill://`, and web Markdown ranges, Space attribution and the untrusted-content notice, raw and outline regressions, directory and empty reads, non-Markdown isolation, source-order deduplication, setext lines, adjacent context merging, budget omission, and execution-time coordinate semantics; verify the narrowest affected test commands
- [ ] 3.2 Update `apps/api/src/prompts/tools/read.md` with the existing shown-range explanation plus one ancestor clause, update `docs/native-files.md` with the ancestor and plural-range contract, source/media/security boundaries, bounds, continuation, and stale-coordinate warning, add the dated `CHANGELOG.md` entry, and complete any corresponding `ROADMAP.md` removal; verify `pnpm lint:markdown` and the documented examples
- [ ] 3.3 Prove the reader layer with the affected native-file-tools and API focused tests, defined workspace lint and typecheck commands, strict OpenSpec validation for the unchanged proposal delta, `pnpm lint:markdown`, and `git diff --check`; record only commands actually run and separate environment failures from repository failures
- [ ] 3.4 Measure the parent-relative authored diff against the review budget, complete self-review (SR) of the actual reader diff against `REVIEW_GUIDE.md` and the approved scope, fix accepted findings in new commits, rerun affected focused checks, and keep the PR draft until SR is complete
- [ ] 3.5 Publish the reviewed reader draft with `$gh-stack` under existing authorization, mark it ready, ensure the PR body contains `Closes #1018`, and complete the GitHub-bot review, current-head CI, and monitoring loop with no actionable unresolved feedback before creating `ranged-read-ancestors/finalize`

## 4. Finalize layer

Branch `ranged-read-ancestors/finalize`, parent `ranged-read-ancestors/reader`,
owns canonical synchronization, task-history preservation, and archive movement
only. Entry requires the reader layer to be published, reviewed, CI-green, and
all implementation and delivery tasks above to be checked.

- [ ] 4.1 Use `$gh-stack` to enter `ranged-read-ancestors/finalize` from the published reader head; verify the immediate parent, complete task checkoffs, and archive readiness before any `$openspec-sync-specs` command writes canonical specs
- [ ] 4.2 Run `$openspec-sync-specs` for `native-file-tools`, reconcile any post-proposal canonical drift by hand before syncing, and verify that both MODIFIED requirements retain the complete current canonical sentence and scenario sets plus only the approved ancestor insertions
- [ ] 4.3 Run `pnpm exec openspec status --change ranged-read-ancestors --json`, `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; stop on any incomplete artifact, unchecked pre-archive task, unsynced requirement, or application fix in the finalize diff
- [ ] 4.4 Run `$openspec-archive-change` only after readiness is proved, then verify the moved archive preserves checked task history, synchronized native-file-tools requirements, and a finalize diff containing no application changes

Post-archive gates, not pre-archive checkbox prerequisites: publish the
finalize draft with `$gh-stack` under existing authorization, self-review (SR)
its actual parent-relative archive diff, mark it ready, complete the GitHub-bot
review and current-head CI monitoring loop (GR), recheck terminal CI, approvals,
threads, and stack bases, and request Leo's explicit merge permission. Merge
only through `$gh-stack`.
