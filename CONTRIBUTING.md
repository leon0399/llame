# Contributing to llame

This file owns delivery from issue through merge. The closest `AGENTS.md` owns
implementation details.

## Gates

1. Features start with an issue and OpenSpec proposal.
2. Implementation waits for explicit proposal-PR approval.
3. Feature work is a linear stack: proposal, implementation layer(s), finalize.
4. Every PR is reviewable, verified, self-reviewed, and monitored.
5. Merge requires Leo's explicit permission.

Bug fixes and chores may skip OpenSpec only when they do not change a product
contract. Use an issue whenever scope, acceptance, or follow-up ownership would
otherwise be implicit.

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

Publication approval and proposal approval are distinct. Proposal approval is a
GitHub Approval from Leo or his named delegate. If Leo authored the proposal, a
top-level comment identifying the approved revision suffices.

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

1. List and trigger every configured/requested automated reviewer. Unknown
   reviewer membership is blocking; ask Leo.
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
expected automated reviewer, and zero actionable unresolved feedback. Pending
or unknown state extends the loop.

## Merge

Immediately recheck CI, approvals, threads, base, and stack. Then obtain Leo's
explicit permission. Merge a stack only with:

```bash
gh stack merge <target> --yes
```

Never use `gh pr merge` on a stack or delete an intermediate branch manually.
