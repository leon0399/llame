# Contributing to llame

This file owns delivery from issue through merge. The closest `AGENTS.md` owns
implementation details.

`$name` below names an agent skill vendored in
[`.agents/skills`](.agents/skills). Each harness directory —
`.claude/skills`, `.opencode/skills`, `.codex/skills` — symlinks the skills it
loads, so a clone carries every skill this file asks you to run.

OpenSpec injects per-phase delivery reminders from `openspec/config.yaml`
(`context`, `rules`, `operations`) into its skills. This file owns the
human-readable policy and the two ordering preconditions that hold regardless
of that injection: the proposal branch exists before any change artifact is
written, and the finalize branch exists before spec synchronization writes
canonical specs.

The checked-in workflows are generated with OpenSpec 1.13.1. Keep project
policy in `openspec/config.yaml`, not in generated skills or commands. When
upgrading the CLI, regenerate consumers and verify instruction delivery before
relying on it; missing guidance or a successful command does not grant approval.

## Gates

1. Features start with an issue and OpenSpec proposal.
2. Implementation waits for proposal approval.
3. Feature work is a linear stack: proposal, implementation layer(s), finalize.
4. Every PR is reviewable, verified, self-reviewed before ready, and monitored.
5. Merge requires Leo's explicit permission.

Bug fixes and chores may skip OpenSpec only when they do not change a product
contract; the [review budget](#review-budget) still applies to them. Use an
issue whenever scope, acceptance, or follow-up ownership would otherwise be
implicit.

## Review budget

Plan and review each layer within about 2,000 **authored** added-plus-deleted
lines against its immediate parent, not `master`. Tests, specs, docs, and
mechanical codemods count as authored. Reproducible generated output counts
zero — Drizzle metadata snapshots, generated OpenAPI documents and clients,
lockfiles, and equivalent outputs — but report its churn separately, and still
verify regeneration, migration safety, and any hand-authored SQL or security
step. Use rename detection for pure moves.

The budget covers every PR, including proposal, finalize, and chores that skip
OpenSpec. Re-estimate at each layer boundary and before publication. Split a
growing concern, or request a named exception with its reason and evidence
before publishing an oversized layer; never split an atomic safety invariant to
satisfy the number.

## Project tracking

The [llame delivery Project](https://github.com/users/leon0399/projects/2) owns
live delivery status. Derive delivery transitions from the corresponding GitHub
PR's published draft, review, approval, merge, or closure state. Local commits,
local reviews, and unpublished branch activity do not change Project status or
advance its Next action. The agent doing the work updates the issue and relevant
PR items after each GitHub transition and verifies them before handoff.

| Status            | GitHub evidence                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backlog           | No published delivery PR, or a published PR explicitly marked deferred/experimental without approved scope.                                                                                                   |
| Design            | An open draft proposal PR, or a proposal PR with requested substantive changes.                                                                                                                               |
| Awaiting approval | An open, non-draft proposal PR awaiting approval of its published revision, with no outstanding change request.                                                                                               |
| Ready             | A merged proposal PR or an approved open non-draft proposal PR, with no outstanding change request and no published implementation PR. Native blockers remain in Next action and must clear before execution. |
| In progress       | An open draft implementation PR or a published implementation PR with outstanding GitHub change requests. Temporary blockers are named in Next action.                                                        |
| In review         | The implementation or other deliverable has an open non-draft PR without outstanding change requests, ready for review/merge. Proposal review uses Awaiting approval.                                         |
| Done              | The item's own delivery PR is merged. A closed, unmerged PR is recorded as cancelled or superseded in Next action; a merged proposal PR does not complete its feature issue.                                  |

Apply the explicit deferred/experimental Backlog exception before the active
phase rules. Draft state takes precedence over an earlier approval.
When an implementation PR merges without completing the issue's published
acceptance, mark that PR Done and keep the issue In progress until a later PR
transition, even if no implementation PR remains open.

`Priority` and `Order` select work independently of readiness. Keep `Workstream`
and `Next action` current; name the missing decision, native blocker, or next
concrete step and link the evidence. Preserve intentional deferrals. A parent
issue reflects its remaining outcome, not the most advanced child or PR. Each PR
tracks its own layer. Derive the issue status from the published PRs covering
its outcome; creating or editing an unpublished layer does not change it.

Before implementation, carry forward approval of the actual revision and recheck
native blockers; do not request the same approval again. Published substantive proposal revisions return to Design when their PR becomes
draft or receives a GitHub change request; approval of the revised scope is
required before implementation. Reconcile legacy proposals by their approved
contract, rather than reopening approval because a review record is absent.
Bug fixes and chores that skip OpenSpec follow their published PR state directly.

At each GitHub transition, fetch the PR state and current Project fields/items,
update Status and Next action with the PR link and any changed native dependencies,
then read them back. Add
missing issue/PR items with Status, Priority, Workstream, and Next action. Do not
change priority or native dependencies merely to make a status fit. If Project access
fails, report the unsynchronized transition in the handoff; do not claim it was
updated. Keep live status in the Project rather than duplicating it in task
files or issue bodies. OpenSpec checkboxes continue to record completed tasks.

## Feature delivery

Run stack operations through `$gh-stack`; it owns command syntax and failure
recovery. OpenSpec injects the per-phase reminders from `openspec/config.yaml`
into `$openspec-propose`, `$openspec-apply-change`, `$openspec-sync-specs`, and
`$openspec-archive-change`. This section owns the policy and phase ordering
those reminders cannot enforce.

### 1. Issue and evidence

Before editing, read the issue, dependencies, current code, shipped specs,
`SPEC.md`, and relevant recent commits. Resolve material product/security
ambiguity. Data/auth/tenancy work states threats and includes a negative test.

Reference the issue from every stack PR. Put `Closes #N` on the implementation
layer whose merge enables the functionality and satisfies the issue's acceptance
criteria. Earlier partial implementation layers only reference the issue.
Do not defer issue closure to a later spec-sync or archive-only finalize layer;
that layer remains required delivery work after the feature issue closes.

### 2. Proposal layer

Create `<change>/proposal` from current `master` with `$gh-stack` **before**
`$openspec-propose` writes any file: injected artifact rules arrive too late to
own that ordering. Run `$openspec-propose`; the proposal branch owns only
`proposal.md`, `design.md`, delta specs, and `tasks.md`.

```text
master <- <change>/proposal <- <change>/<implementation> <- <change>/finalize
```

Split implementation by dependency and reviewable responsibility. Each layer
has one sentence of ownership and an authored size estimated within the
[review budget](#review-budget). `tasks.md` must contain:

- the exact delivery stack;
- `$gh-stack` and `$openspec-apply-change` requirements;
- every task assigned to one layer with focused verification;
- `- [ ]` tracking and the issue-closing owner;
- a self-review-before-ready checkpoint and a GitHub review/CI gate per layer;
- final-layer spec-sync and archive-readiness tasks, and the `finalize` entry
  boundary before `$openspec-sync-specs` writes.

For finalize, SR and GR are recorded as post-archive gates, not pre-archive
checkbox tasks. All tracked tasks must be complete before archive movement.

Do not create implementation branches before proposal approval.

### 3. Proposal review and approval

1. Commit the complete initial proposal.
2. Run `$iterative-review-refinement` or an equivalent adversarial review with
   at least two independent reviewers per round.
3. Verify findings against code, specs, primary docs, or executable checks.
4. Commit each review/user-feedback round separately; do not erase reasoning
   history with amend/autosquash.
5. Surface changed decisions, rejected findings, and uncertainty to Leo.
6. Obtain Leo's explicit approval of the final revision.

Then prove the proposal layer with the [Verification](#verification) rows for
OpenSpec proposal, Product Markdown, and Any change; commit only proposal-owned
files.

After publication approval, publish the draft stack with `$gh-stack`, inspect
the generated PR, complete self-review (SR) of its actual diff per
[PR contract](#pr-contract), fix with new commits, and mark it ready for the
GitHub review (GR) loop.

Publication approval and proposal approval are distinct. A proposal committed
to `master` is approved; carry that decision forward. Before it lands on
`master`, approval is a GitHub Approval from Leo or his named delegate. If Leo
authored the proposal, a top-level comment identifying the approved revision
suffices. A local commit on a proposal branch alone is not approval.

### 4. Implementation layers

After proposal approval, create only the next layer with `$gh-stack` from the
current stack top.

For each layer:

1. Run `$openspec-apply-change`; implement only this layer's assigned tasks.
2. Verify each task, then change its checkbox to `- [x]` in the same layer.
3. Commit only the owned concern and task records.
4. Publish/refresh the draft with `$gh-stack`; new PRs stay draft until SR
   completes.
5. Complete SR, update the PR body, mark ready, run the GR/monitoring loop, then
   add the next layer.

The PR that ships work adds its relevant operator documentation, dated
`CHANGELOG.md` entry, and completed `ROADMAP.md` removals. Unplanned
fixes/chores go directly to the changelog.

Fix a lower-layer defect on its owning branch with `$gh-stack` and replay the
stack upward; never repair a lower concern in the top PR.

### 5. Finalize

After every implementation layer is published, verified, and checked, enter
`<change>/finalize` from the implementation top with `$gh-stack`. Do this
**before** `$openspec-sync-specs` writes canonical specs: a separate sync
invocation can run before archive guidance is read. The finalize layer owns
only spec synchronization, task records, and archive movement — never
application fixes.

1. Run `$openspec-sync-specs`. Inspect
   `openspec status --change <change> --json` and `tasks.md`, and complete the
   layer's spec-sync and archive-readiness tasks. Stop on any incomplete
   artifact or unchecked task.
2. Run `$openspec-archive-change` only after readiness is proved. Preserve
   checked task history; check MODIFIED requirements and cross-capability
   wording for semantic consistency, not just strict validation.
3. Prove the layer with the Final OpenSpec, Product Markdown, and Any change rows in
   [Verification](#verification), then publish the finalize PR as draft with
   `$gh-stack`. Its SR and GR are post-archive gates: after archive movement,
   self-review the actual diff, mark ready, and run the
   [Ready-PR monitoring](#ready-pr-monitoring) loop. Readiness gates movement;
   movement gates publication, review, and merge — never the reverse.
4. Merge only under [Merge](#merge).

## Verification

CI is the ground for full verification. The table below names the evidence a
change carries; CI produces all of it on every push. Do not reproduce the full
sweeps locally — the whole unit or integration project, product E2E, component
tests, the aggregate build, mutation testing. Run the narrowest command that
covers the surface you changed: a focused test file, the workspace lint and
typecheck, `git diff --check`; add `pnpm lint:markdown` and the strict OpenSpec
validation for Markdown and spec edits. Prove each phase with its rows before
publishing: OpenSpec proposal for the proposal layer, Final OpenSpec for
finalize, plus Product Markdown and Any change as they apply.

Only CI's result on the published head gates a merge. A local green is not a
substitute for it, and no row may be claimed as passed until CI reports it. Run
a broader row locally only where CI cannot cover it — an environment it does not
provide, or a failure it cannot attribute.

Narrow evidence cannot support a broader claim.

| Surface                | Evidence                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| Any change             | `pnpm format:check`; `git diff --check`                                                      |
| Product Markdown       | `pnpm lint:markdown`                                                                         |
| OpenSpec proposal      | `pnpm exec openspec validate <change> --strict`                                              |
| Workspace TypeScript   | affected `lint`, `typecheck`, and `test:coverage` when defined                               |
| Root TypeScript        | `pnpm lint`; focused E2E if behavior changed                                                 |
| Buildable workspace    | `pnpm --filter <workspace> build`                                                            |
| API DB/tenancy         | API integration suite plus negative isolation coverage                                       |
| API/generated client   | OpenAPI lint, regeneration, second-generation clean diff                                     |
| Shared UI/stories      | Storybook MCP tests and previews; CLI fallback if unavailable                                |
| Cross-surface behavior | focused product E2E                                                                          |
| GitHub Actions         | `actionlint`; `zizmor .github/workflows/`; `pinact run --check`                              |
| Final OpenSpec         | `pnpm exec openspec validate --specs --strict`; `pnpm exec openspec validate --all --strict` |

Use `pnpm exec turbo run build --concurrency=1` only when aggregate build
evidence is necessary. Never run unbounded `pnpm build`. Report environment
failures separately from repository defects.

## PR contract

Confirm every PR's immediate base and ownership with `$gh-stack`. Its body
contains the one concern, issues served, stack position, and commands actually
run. Use `Closes #N` only for completed issues. Do not add a `Test plan`
section or mention agent tooling unless asked.

Every layer has two separate review checkpoints:

- **Self-review (SR), before draft -> ready.** The author reviews the actual
  parent-relative diff against [REVIEW_GUIDE.md](REVIEW_GUIDE.md) and the
  approved scope while the PR is draft. Independent subagents may cover
  nontrivial or high-risk concerns; they never replace GitHub review. Verify
  every finding independently, fix accepted ones, rerun affected checks, and
  re-review before marking ready.
- **GitHub review (GR), after ready.** The configured/requested GitHub review
  bots and current-head CI power the external loop; a local reviewer or
  subagent never substitutes for an expected bot. For every non-draft fix push,
  self-review the changed diff and rerun affected checks locally before
  pushing, then restart [Ready-PR monitoring](#ready-pr-monitoring). Never
  toggle draft state to retrigger reviews.

## Ready-PR monitoring

After every non-draft push:

1. List every configured/requested automated reviewer. If a reviewer is
   quota-exhausted, record it as skipped and continue; quota exhaustion is
   nonblocking. Unknown reviewer membership is blocking; ask Leo. Do not
   manually retrigger reviews with comments or draft/ready toggles; automatic
   review triggers when needed.
2. Record head commit and push time; any push restarts the loop.
3. For at least 15 uninterrupted minutes, poll CI, verdicts, comments, and
   review threads at least every two minutes. Do not replace polling with one
   sleep.
4. Use `pr-review-fetcher` when available; otherwise use paginated APIs and
   GraphQL `reviewThreads`.
5. Process each finding:

   ```text
   fetch -> analyze -> accept or reject -> fix if accepted -> verify -> reply -> resolve
   ```

   Reply on the originating surface; only inline threads are resolvable.

6. Re-fetch after processing. A fix push restarts monitoring for every affected
   non-draft stack PR.

Exit only after the 15-minute floor, terminal passing CI, completion from every
expected automated reviewer except those recorded as quota-exhausted skips, and
zero actionable unresolved feedback. A quota-exhausted reviewer recorded as
skipped does not keep the loop open. Pending or unknown state extends the loop.

## Merge

Immediately recheck CI, approvals, threads, base, and stack. Then obtain Leo's
explicit permission. Merge stacks only through `$gh-stack`; `gh pr merge` cannot
merge a stack, and intermediate branches are never deleted manually.
