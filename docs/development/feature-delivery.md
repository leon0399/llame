# Feature delivery

The phases of one feature, from issue to finalize, under the gates in
[CONTRIBUTING.md](../../CONTRIBUTING.md#gates).

Run stack operations through `$gh-stack`. It owns command syntax and failure recovery.
OpenSpec injects the per-phase reminders from `openspec/config.yaml` into `$openspec-propose`, `$openspec-apply-change`, `$openspec-sync-specs`, and `$openspec-archive-change`.
This page owns the policy and phase ordering that those reminders cannot enforce.

Use the canonical OpenSpec skills through the harness skill directories. Separate OpenSpec command files are not maintained.
These skills are repository-maintained adaptations of OpenSpec 1.13.1. Keep delivery policy in `openspec/config.yaml` and preserve the skills' readiness and authorization boundaries.
For CLI upgrades, generate upstream workflows in a temporary project and compare their contracts. Do not overwrite the local adaptations.
Verify instruction delivery before relying on an upgrade. Missing guidance or a successful command does not grant approval.

## 1. Issue and evidence

Before editing, read the issue body (its Spec brief, Spec, or Acceptance
section), dependencies, current code, shipped specs, `SPEC.md`, and relevant
recent commits. Resolve material product/security ambiguity. Data/auth/tenancy
work states threats and includes a negative test.

Reference the issue from every stack PR. Put `Closes #N` on the PR whose merge satisfies that issue's acceptance criteria, even if later implementation or finalize layers remain.
Earlier partial layers only reference the issue. Do not defer issue closure to a later spec-sync or archive-only finalize layer.
That layer remains required delivery work after the feature issue closes.

## 2. Proposal layer

Create `<change>/proposal` from current `master` with `$gh-stack` **before** `$openspec-propose` writes any file.
Injected artifact rules arrive too late to own that ordering. Run `$openspec-propose`.
The proposal branch owns only `proposal.md`, `design.md`, delta specs, and `tasks.md`.

```text
master <- <change>/proposal <- <change>/<implementation> <- <change>/finalize
```

Split implementation by dependency and reviewable responsibility. Prefer independently mergeable layers and identify intermediate merge boundaries.
Keep inseparable behavior together. Give each layer one sentence of ownership and an authored size estimate against the [review target](../../CONTRIBUTING.md#review-budget).
A layer's parent is the layer below it. Once the proposal has merged, a layer whose files and spec requirements are disjoint from its siblings may start from `master` as a parallel branch in its own `$gh-stack` stack.
`tasks.md` states why the layer is independent. Before the proposal merges, every layer stays in one linear stack.
Finalize starts from `master` after every parallel leaf has merged.
Confirm, create, or merge the feature's cutover sub-issues when the proposal is written. Approving the proposal approves that split.
`tasks.md` must contain:

- the delivery graph: each layer's branch, its parent, and the cutover it closes, if any.
- safe intermediate merge boundaries and any layers that must merge together.
- `$gh-stack` requirements and `$openspec-apply-change` requirements.
- every task assigned to one layer with focused verification.
- `- [ ]` tracking and the issue-closing owner.
- final-layer spec-sync and archive-readiness tasks, and the `finalize` entry boundary before `$openspec-sync-specs` writes.

`tasks.md` holds no SR or GR checkbox for any layer: the PR checklist tracks both.
Archive movement and the gates after it (publishing the finalize draft, SR, GR) are prose, because
all tracked tasks must be complete before archive movement.

Do not create implementation branches before proposal approval.

## 3. Proposal review and approval

1. Commit the complete initial proposal.
2. Run `$iterative-review-refinement` or an equivalent adversarial review with at least two independent reviewers per round.
3. Verify findings against code, specs, primary docs, or executable checks.
4. Commit each review/user-feedback round separately. Do not erase reasoning history with amend/autosquash.
5. Surface changed decisions, rejected findings, and uncertainty to Leo.
6. Obtain Leo's explicit approval of the final revision.

Then prove the proposal layer with the [Verification](../../CONTRIBUTING.md#verification) rows for OpenSpec proposal, Product Markdown, and Any change.
Commit only proposal-owned files.

After publication approval, publish the draft stack with `$gh-stack` and inspect the generated PR.
Complete self-review (SR) of its actual diff per [PR contract](../../CONTRIBUTING.md#pr-contract).
Fix with new commits and mark it ready for the GitHub review (GR) loop. The PR checklist records both.

Publication approval and proposal approval are distinct. A proposal committed to `master` is approved, so carry that decision forward.
Before the proposal lands on `master`, approval must be a GitHub Approval from Leo or his named delegate.
If Leo authored the proposal, a top-level comment identifying the approved revision suffices.
A local commit on a proposal branch alone is not approval.

## 4. Implementation layers

After proposal approval, create only the next layer with `$gh-stack` from the top of its stack.
The top is the current stack top, or `master` for a parallel branch after the proposal merged.

For each layer:

1. Run `$openspec-apply-change`. Implement only this layer's assigned tasks.
2. Verify each task, then change its checkbox to `- [x]` in the same layer.
3. Commit only the owned concern and task records.
4. Publish or refresh the draft with `$gh-stack`. New PRs stay draft until SR completes.
5. Complete SR, update the PR body, mark ready, and run the GR/monitoring loop. Then add the next layer.

The PR that ships work updates its affected documentation, adds or amends its [changeset](../../CONTRIBUTING.md#changesets), and removes completed `ROADMAP.md` items in that same layer.
A feature has one changeset, `.changeset/<change>.md`. The first layer that ships behavior creates it, and later layers amend it.
A parallel branch uses `<change>.<layer>.md`, so siblings do not edit one file.

Fix a lower-layer defect on its owning branch with `$gh-stack` and replay the stack upward.
Never repair a lower concern in the top PR.

## 5. Finalize

After every implementation layer is published, verified, and checked, enter `<change>/finalize` with `$gh-stack` from the implementation top, or from `master` once every parallel leaf has merged.
Do this **before** `$openspec-sync-specs` writes canonical specs. A separate sync invocation can run before archive guidance is read.
The finalize layer owns only spec synchronization, task records, and archive movement, never application fixes.

1. Run `$openspec-sync-specs`. Inspect
   `openspec status --change <change> --json` and `tasks.md`, and complete the
   layer's spec-sync and archive-readiness tasks. Stop on any incomplete
   artifact or unchecked task.
2. Run `$openspec-archive-change` only after readiness is proved. Prove it from GitHub: each layer PR's head CI, bot reviews, unresolved threads, and proposal approval.
   Record that evidence once, as prose, in the finalize commit's `tasks.md`. Preserve checked task history.
   Check MODIFIED requirements and cross-capability wording for semantic consistency, not just strict validation.
3. Prove the layer with the Final OpenSpec, Product Markdown, and Any change rows in [Verification](../../CONTRIBUTING.md#verification).
   Then publish the finalize PR as draft with `$gh-stack`.
   After archive movement, self-review the actual diff, mark ready, and run the [Ready-PR monitoring](../../CONTRIBUTING.md#ready-pr-monitoring) loop.
   Readiness gates movement. Movement gates publication, review, and merge, never the reverse.
4. Merge only under [Merge](../../CONTRIBUTING.md#merge).
