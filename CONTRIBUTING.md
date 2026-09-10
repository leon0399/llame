# Contributing to llame

This file owns delivery from issue through merge. The closest `AGENTS.md` owns
implementation details.

`$name` below names an agent skill vendored in
[`.agents/skills`](.agents/skills). Each harness directory —
`.claude/skills`, `.opencode/skills`, `.codex/skills` — symlinks the skills it
loads, so a clone carries every skill this file asks you to run.

## Gates

1. Features start with an issue and OpenSpec proposal.
2. Implementation waits for proposal approval.
3. Feature work is a linear stack: proposal, implementation layer(s), finalize.
4. Every PR is reviewable, verified, self-reviewed, and monitored.
5. Merge requires Leo's explicit permission.

Bug fixes and chores may skip OpenSpec only when they do not change a product
contract. Use an issue whenever scope, acceptance, or follow-up ownership would
otherwise be implicit.

## Project tracking

The [llame delivery Project](https://github.com/users/leon0399/projects/2) owns
live delivery status. Derive delivery transitions from the corresponding GitHub
PR's published draft, review, approval, merge, or closure state. Local commits,
local reviews, and unpublished branch activity do not change Project status or
advance its Next action. The agent doing the work updates the issue and relevant
PR items after each GitHub transition and verifies them before handoff.

| Status            | GitHub evidence                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backlog           | No published delivery PR, intentionally deferred work, or an experimental PR without approved scope.                                                                                  |
| Design            | An open draft proposal PR, or a proposal PR with requested substantive changes.                                                                                                       |
| Awaiting approval | An open, non-draft proposal PR awaiting approval of its published revision.                                                                                                           |
| Ready             | An approved or merged proposal PR, satisfied native blockers, and no published implementation PR.                                                                                     |
| In progress       | An open draft implementation PR, requested implementation changes, or remaining unpublished layers behind a published implementation PR. Temporary blockers are named in Next action. |
| In review         | The implementation or other deliverable has an open non-draft PR ready for review/merge. Proposal review uses Awaiting approval.                                                      |
| Done              | The item's own delivery PR is merged, or the item is closed. Record cancellation or supersession in Next action; a merged proposal PR does not complete its feature issue.            |

`Priority` and `Order` select work independently of readiness. Keep `Workstream`
and `Next action` current; name the missing decision, native blocker, or next
concrete step and link the evidence. Preserve intentional deferrals. A parent
issue reflects its remaining outcome, not the most advanced child or PR. Each PR
tracks its own layer; keep the issue In progress while implementation layers
remain, and move it to In review when the complete outcome is reviewable.

Before implementation, carry forward approval of the actual revision and recheck
native blockers; do not request the same approval again. Substantive changes outside an approved contract return to Design and require
approval of the revised scope. Reconcile legacy proposals by their approved
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

### 1. Issue and evidence

Before editing, read the issue, dependencies, current code, shipped specs,
`SPEC.md`, and relevant recent commits. Resolve material product/security
ambiguity. Data/auth/tenancy work states threats and includes a negative test.

Reference the issue from every stack PR. Only the layer that completes it uses
`Closes #N`.

### 2. Proposal layer

From current `master`, before writing files:

```bash
git config rerere.enabled true
git config remote.pushDefault origin
gh stack init <change>/proposal
gh stack view --json
```

Run `$openspec-propose`. The proposal branch owns only `proposal.md`,
`design.md`, delta specs, and `tasks.md`.

```text
master <- <change>/proposal <- <change>/<implementation> <- <change>/finalize
```

Split implementation by dependency and reviewable responsibility. Each layer
has one sentence of ownership. `tasks.md` must contain:

- the exact delivery stack;
- `$gh-stack` and `$openspec-apply-change` requirements;
- every task assigned to one layer with focused verification;
- `- [ ]` tracking and the issue-closing owner;
- final-layer sync and archive tasks.

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

Then run:

```bash
pnpm exec openspec validate <change> --strict
pnpm lint:markdown
pnpm format:check
git diff --check
```

After publication approval, submit the draft stack, inspect the generated PR,
self-review its actual diff, fix with new commits, and mark it ready:

```bash
gh stack submit --auto
gh stack view --json
gh pr ready <proposal-pr>
```

Publication approval and proposal approval are distinct. A proposal committed
to `master` is approved; carry that decision forward. Before it lands on
`master`, approval is a GitHub Approval from Leo or his named delegate. If Leo
authored the proposal, a top-level comment identifying the approved revision
suffices. A local commit on a proposal branch alone is not approval.

### 4. Implementation layers

After proposal approval, create only the next layer:

```bash
gh stack add <change>/<layer>
```

For each layer:

1. Run `$openspec-apply-change`; implement only this layer's assigned tasks.
2. Verify each task, then change its checkbox to `- [x]` in the same layer.
3. Commit only the owned concern and task records.
4. Publish/refresh with `gh stack submit --auto`; keep new PRs draft until the
   gates below pass.
5. Update the PR body, mark ready, run the monitoring loop, then add the next
   layer.

The PR that ships work adds its dated `CHANGELOG.md` entry and removes any
completed `ROADMAP.md` item. Unplanned fixes/chores go directly to the changelog.

Fix a lower-layer defect on its owning branch, then replay upward:

```bash
gh stack checkout <owning-branch>
gh stack rebase --upstack
gh stack top
gh stack push
```

### 5. Finalize

After every implementation layer is published, verified, and checked:

```bash
gh stack add <change>/finalize
```

Run `$openspec-sync-specs`. Then inspect
`openspec status --change <change> --json` and `tasks.md`; stop on any incomplete
artifact or unchecked task. Run `$openspec-archive-change` only after both are
complete. Preserve checked task history. This layer contains only spec sync,
task records, and archive movement, never application fixes.

```bash
pnpm exec openspec validate --specs --strict
pnpm exec openspec validate --all --strict
pnpm lint:markdown
pnpm format:check
git diff --check
```

## Verification

Run every applicable row after the final edit. Narrow evidence cannot support a
broader claim.

| Surface                | Evidence                                                        |
| ---------------------- | --------------------------------------------------------------- |
| Any change             | `pnpm format:check`; `git diff --check`                         |
| Product Markdown       | `pnpm lint:markdown`                                            |
| OpenSpec proposal      | `pnpm exec openspec validate <change> --strict`                 |
| Workspace TypeScript   | affected `lint`, `typecheck`, and `test:coverage` when defined  |
| Root TypeScript        | `pnpm lint`; focused E2E if behavior changed                    |
| Buildable workspace    | `pnpm --filter <workspace> build`                               |
| API DB/tenancy         | API integration suite plus negative isolation coverage          |
| API/generated client   | OpenAPI lint, regeneration, second-generation clean diff        |
| Shared UI/stories      | Storybook MCP tests and previews; CLI fallback if unavailable   |
| Cross-surface behavior | focused product E2E                                             |
| GitHub Actions         | `actionlint`; `zizmor .github/workflows/`; `pinact run --check` |
| Final OpenSpec         | strict `--specs` and `--all` validation                         |

Use `pnpm exec turbo run build --concurrency=1` only when aggregate build
evidence is necessary. Never run unbounded `pnpm build`. Report environment
failures separately from repository defects.

## PR contract

Confirm every PR's immediate base and ownership with `gh stack view --json`.
Its body contains the one concern, issues served, stack position, and commands
actually run. Use `Closes #N` only for completed issues. Do not add a `Test
plan` section or mention agent tooling unless asked.

Before ready review or after a ready-state push, review the layer diff for
correctness, unnecessary complexity, security where applicable, and
domain-specific traps. Verify findings independently, fix accepted ones, explain
rejections with evidence, and rerun affected checks.

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
explicit permission. Merge a stack only with:

```bash
gh stack merge <target> --yes
```

Never use `gh pr merge` on a stack or delete an intermediate branch manually.
