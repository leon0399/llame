# Contributing to llame

This is the internal contribution contract for llame. It governs the path from
issue to proposal, implementation, review, and merge. Repository and
directory-specific `AGENTS.md` instructions still apply; the closest
instruction owns implementation details.

## Non-negotiable gates

1. New features are issue-first and OpenSpec-driven.
2. Implementation does not begin until the proposal PR has explicit approval.
3. Feature work is delivered as a linear stack with a proposal layer at the
   bottom and an OpenSpec finalization layer at the top.
4. Every PR is independently reviewable, locally verified, self-reviewed, and
   monitored after publication.
5. No contributor or agent merges a PR without Leo's explicit permission.

Bug fixes and chores may skip OpenSpec only when they do not add or change a
product contract. They still require an issue when scope, acceptance criteria,
or follow-up ownership would otherwise be implicit.

## New feature flow

### 1. Start from an issue

Before editing:

- Read the issue, its acceptance criteria, dependencies, and linked decisions.
- Inspect the current code, shipped OpenSpec capabilities, `SPEC.md`, and the
  latest relevant commits. Historical proposals and PR stacks are context, not
  current authority.
- Resolve material ambiguity in the issue. Do not use the proposal to conceal
  an unresolved product or security decision.
- State tenant-isolation and threat considerations up front when the change
  touches data, authentication, tenancy, identity, secrets, or an externally
  reachable surface. Include a negative security test in the planned work.

Reference the issue from every PR in its stack. Referencing is not closing; the
PR that actually completes an issue must include `Closes #<number>` in its
body. If one layer completes multiple issues, include one closing keyword for
each. Do not put a closing keyword on a proposal or partial implementation PR.

### 2. Create the proposal layer before implementation

Use `$gh-stack` before writing files. From an up-to-date `master`, initialize
the bottom branch:

```bash
git config rerere.enabled true
git config remote.pushDefault origin
gh stack init <change>/proposal
gh stack view --json
```

Then run `$openspec-propose` to create the complete change: `proposal.md`,
`design.md`, delta specs, and `tasks.md`. The proposal layer owns those
artifacts only and introduces no application behavior.

Every feature stack has at least three layers:

```text
(master) <- <change>/proposal <- <change>/<implementation> <- <change>/finalize
```

Large changes split the middle into multiple implementation layers. Split by
reviewable responsibility and dependency order, not by arbitrary file count.
Each layer must have one concern that can be described in one sentence.

The proposal's `tasks.md` must:

- Include a `Delivery Stack` section with the exact branch sequence.
- State that implementers must use `$gh-stack` and
  `$openspec-apply-change`.
- Assign every task to one stack layer and name that layer in the heading or
  task text.
- Give each layer its own focused verification commands.
- Use `- [ ]` checkboxes for incomplete work.
- Reserve the final layer for `$openspec-sync-specs` and
  `$openspec-archive-change`.
- Identify which implementation layer owns each issue-closing outcome.

Do not create implementation branches yet. First make the proposal coherent,
reviewed, and approved.

### 3. Grill the proposal and preserve its reasoning history

Before publishing the proposal PR or marking an existing draft ready:

1. Commit the initial complete proposal.
2. Run `$iterative-review-refinement` or an equivalent adversarial document
   review with at least two independent reviewers per round.
3. Verify load-bearing findings against current code, canonical specs, primary
   documentation, or executable checks. Reviewer confidence is not evidence.
4. Apply verified findings and commit each feedback or review iteration
   separately. Do not amend, autosquash, or rewrite these commits merely to
   make the branch look clean.
5. Surface material decisions, changed trade-offs, rejected findings, and
   remaining uncertainty to Leo.
6. Obtain Leo's explicit approval of the final proposal revision.

The PR may eventually squash-merge, but its source commit history must show the
thought process: initial proposal, user-feedback revisions, self-review
revisions, and final approved state. A large undifferentiated proposal commit
followed by silent rewrites defeats this requirement.

Verify the proposal after its final edit:

```bash
pnpm exec openspec validate <change> --strict
pnpm lint:markdown
pnpm format:check
git diff --check
```

After Leo approves publication, push and open the proposal PR as a draft:

```bash
gh stack submit --auto
gh stack view --json
```

Inspect and self-review the actual proposal PR diff, generated title, and body.
Correct them with new commits and `gh pr edit`, rerun the proposal checks, then
mark the PR ready:

```bash
gh pr ready <proposal-pr>
```

Publication approval and proposal-PR approval are separate gates. Proposal-PR
approval normally means an explicit GitHub Approval review from Leo, unless Leo
names a delegate in the issue or PR. GitHub does not allow a PR author to
approve their own PR. When Leo authored the proposal, a top-level PR comment
from Leo that identifies the approved proposal revision satisfies this gate.
Wait for that approval record before creating implementation layers or writing
implementation code.

### 4. Implement and publish the stack incrementally

After the proposal PR is approved, create only its immediate successor:

```bash
gh stack add <change>/<layer>
```

For each layer:

1. Invoke `$openspec-apply-change` to load the change context and apply
   instructions, then implement only the tasks assigned to the current layer.
   In llame, the current stack layer bounds the skill's generic
   continue-until-done loop: stop when this layer's tasks are done, even when
   later-layer tasks remain pending.
2. Verify each completed task, then change its checkbox in `tasks.md` from
   `- [ ]` to `- [x]` in the same layer. Do not defer all checkbox updates to
   the finalization PR; the implementation PR and file blame must record when
   the work became complete.
3. Commit only the layer's owned concern and its completed task records.
4. Publish or refresh the stack while implementation is in progress:

   ```bash
   gh stack submit --auto
   gh stack view --json
   ```

   New implementation PRs stay draft until their self-review and verification
   gates pass. Do not wait until the entire stack is finished before publishing
   and associating its layers.

5. When the layer is ready, update its PR body, mark it ready, and run the
   monitoring loop below.
6. Only then add the next layer.

If a higher layer exposes a lower-layer defect, check out the owning branch,
fix and verify it there, and replay the change upward:

```bash
gh stack checkout <owning-branch>
gh stack rebase --upstack
gh stack top
gh stack push
```

Never hide a lower-layer correction in a higher PR.

### 5. Finalize OpenSpec in the top layer

Create `<change>/finalize` only after all implementation layers are published,
verified, and their owned tasks are checked:

```bash
gh stack add <change>/finalize
```

The final layer must:

1. Run `$openspec-sync-specs` and intelligently merge the delta requirements
   into the canonical specs without replacing unrelated behavior.
2. Check `openspec status --change <change> --json` and `tasks.md`. If any
   artifact is incomplete or any `- [ ]` remains, stop. llame forbids the
   generic archive skill's permissive confirmation path for incomplete work.
3. Run `$openspec-archive-change` only after that hard gate passes.
4. Preserve the completed `tasks.md` through the archive move.
5. Contain only canonical spec synchronization, completed task records, and
   the archive operation. It must not repair application behavior.
6. Verify the resulting specification state:

   ```bash
   pnpm exec openspec validate --specs --strict
   pnpm exec openspec validate --all --strict
   pnpm lint:markdown
   pnpm format:check
   git diff --check
   ```

Publish this layer as part of the same stack. It is not a later cleanup PR.

## Verification gates

Run every applicable row after the final edit to a layer. Use the smallest set
that proves the changed behavior, but do not substitute a narrow check for a
broader claim.

| Changed surface                      | Required local evidence                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Any change                           | `pnpm format:check`; `git diff --check`                                                                   |
| Product-owned Markdown               | `pnpm lint:markdown`                                                                                      |
| OpenSpec proposal                    | `pnpm exec openspec validate <change> --strict`                                                           |
| Workspace TypeScript                 | Affected workspace `lint`, `typecheck`, and `test` scripts                                                |
| Root TypeScript (`e2e/`, Playwright) | `pnpm lint:root`; focused `pnpm test:e2e -- <path-or-filter>` when behavior changes                       |
| Buildable workspace                  | `pnpm --filter <workspace> build`                                                                         |
| API database or tenancy              | `pnpm --filter api test:integration` plus negative isolation coverage                                     |
| API contract or generated web client | `pnpm openapi:lint:ci`; `pnpm generate:api-client`; prove a second generation produces no new diff        |
| Shared UI or stories                 | With Storybook MCP connected, `run-story-tests` plus preview URLs; otherwise the Storybook CLI gate below |
| Cross-surface behavior               | Focused `pnpm test:e2e -- <path-or-filter>`                                                               |
| GitHub Actions                       | `actionlint`; `zizmor .github/workflows/`; `pinact run --check`                                           |
| Finalized OpenSpec                   | `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`           |

Common workspace commands:

```bash
pnpm --filter api lint
pnpm --filter api typecheck
pnpm --filter api test
pnpm --filter api build

pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web build

pnpm --filter @workspace/ui lint
pnpm --filter @workspace/ui typecheck
pnpm --filter @workspace/ui test
```

When aggregate evidence is necessary, keep builds resource-bounded:

```bash
pnpm openapi:lint:ci
pnpm exec turbo run lint
pnpm lint:ast-grep
pnpm lint:markdown
pnpm format:check
pnpm exec turbo run typecheck
pnpm exec turbo run test
pnpm exec turbo run build --concurrency=1
pnpm --filter api test:integration
pnpm exec turbo run test:component build --filter=storybook
pnpm test:e2e
```

Do not run the unbounded root `pnpm build`. Do not claim a build, test suite, or
full CI surface passed when only a narrower command ran. Record environment
failures separately from repository defects.

## PR construction

Every PR must be reviewable against its immediate parent branch. Confirm bases
and ownership with `gh stack view --json`; do not create a stacked PR against
`master` manually.

Each PR body must include:

- A concise summary of the layer's single concern.
- The issue or issues it serves.
- Its position and dependency in the stack.
- Concrete verification evidence from commands actually run.
- `Closes #<number>` for every issue that this PR actually completes.

Do not add a `Test plan` section. Do not claim checks that have not run. Agents
must not mention themselves or their tooling in PR descriptions or comments
unless explicitly asked.

## Self-review before ready review

Every PR, including proposal and finalization PRs, must be self-reviewed before
it becomes non-draft or receives a new ready-state push.

Use the strongest appropriate review flow available to the contributor:

- A correctness review through `$superpowers:requesting-code-review`, an
  independent review agent, or an equivalent review tool.
- `$ponytail-review` for non-trivial code to identify deletable complexity,
  speculative abstractions, and unnecessary dependencies.
- A security-focused review for authentication, authorization, data, tenancy,
  secrets, or externally reachable surfaces.
- The relevant UI, API, database, or workflow-specific review tools when the
  diff touches those domains.

Review the PR's actual layer diff, not only the top-of-stack aggregate. Verify
every substantive finding before changing code. Fix valid findings; reject
invalid ones with concrete code, test, or primary-source evidence. Re-run the
affected verification after each fix.

## Ready-PR monitoring loop

After every push to a non-draft PR:

1. Build an expected-reviewer checklist containing every repository-configured
   AI reviewer, explicitly requested bot or app, and agent review run triggered
   for this PR. Trigger each entry. If the configured set cannot be inspected,
   ask Leo; unknown membership is blocking.
2. Record the latest pushed commit and push time. A later push resets both.
3. Until at least 15 uninterrupted minutes have elapsed, poll CI, review
   verdicts, standalone comments, and review threads at least every two minutes.
   Use the harness's recurring monitor when available; do not replace the loop
   with a single sleep. Poll CI with:

   ```bash
   gh pr checks <pr> --json name,state,bucket,link
   ```

4. On every poll, fetch fresh review verdicts, standalone comments, and
   unresolved threads. Agents use the `pr-review-fetcher` agent when available;
   otherwise query GitHub's paginated review APIs and GraphQL `reviewThreads`
   connection. Update the expected-reviewer checklist with each tool's observed
   completion state.
5. Process every finding through this exact flow:

   ```text
   fetch -> analyze -> accept or reject -> fix if accepted -> verify -> reply on the originating surface
   ```

   If the finding came from an inline review thread, reply inline and resolve
   the thread after disposition. If it came from a standalone PR comment or
   review summary, reply there; no resolvable thread exists.

6. Re-fetch after processing to prove no actionable unresolved thread was
   missed and to detect feedback posted during the fixes.
7. Exit only when the 15-minute floor has elapsed, required CI is terminal and
   passing, every expected automated reviewer is complete, and no actionable
   thread or comment remains. If any fix was pushed, restart this monitoring
   loop from step 1 for every affected non-draft PR in the stack.

Fifteen minutes is a lower bound, not a timeout. Continue monitoring when CI,
an automated reviewer, or a human review remains pending. If a review tool's
state cannot be determined, report it as unknown; do not silently treat it as
complete. A PR is not ready to merge while required CI is failing or pending,
an expected automated review has not completed, or an actionable thread is
unresolved.

## Merge gate

Re-check every PR's CI, approvals, unresolved threads, base, and stack state
immediately before merge. Then stop and obtain Leo's explicit permission.

For a stack, use:

```bash
gh stack merge <target> --yes
```

Do not use `gh pr merge` on a stacked PR and do not delete an intermediate
branch manually.
