# Contributing to llame

This file owns delivery policy from issue through merge. The closest
`AGENTS.md` owns implementation details. Procedures live in agent skills
vendored in [`.agents/skills`](.agents/skills) (`$name` below; each harness
directory symlinks the ones it loads) and in the pages linked from each
section.

## Gates

1. Features start with an issue and OpenSpec proposal.
2. Implementation waits for proposal approval.
3. Feature work is one dependency graph of layers: proposal, implementation
   layers, finalize. Layers are stacked unless `tasks.md` justifies a parallel
   branch.
4. Every PR is reviewable, verified, self-reviewed before ready, and monitored.
5. Merge requires Leo's explicit permission.

Bug fixes and chores may skip OpenSpec only when they do not change a product
contract; the [review budget](#review-budget) still applies to them. Use an
issue whenever scope, acceptance, or follow-up ownership would otherwise be
implicit.

## Review budget

Prefer about 2,000 **authored** added-plus-deleted lines per layer, measured
against its immediate parent, not `master`. This is a review target, not a
publication limit. Tests, specs, docs, and mechanical codemods count as
authored. Reproducible generated output (Drizzle snapshots, generated OpenAPI
documents and clients, lockfiles) counts zero, but report its churn separately
and still verify regeneration, migration safety, and any hand-authored SQL or
security step. Use rename detection for pure moves.

The target applies to every PR, including proposal, finalize, and chores.
Re-estimate at each layer boundary and before publication. Split a growing
concern when it improves review or creates a safe merge point. Never split an
atomic safety invariant or its required tests to satisfy the number.

## Issues

An issue is the whole input for whoever picks it up. Hierarchy, the body's
sections, handoff labels, and pickup/release markers:
[docs/development/issues.md](docs/development/issues.md); procedure:
`$issue-handoff`.

## Project tracking

The [delivery Project](https://github.com/users/leon0399/projects/2) owns live
status, derived only from published GitHub PR state. Update it, and read it
back, at every GitHub transition:
[docs/development/project-tracking.md](docs/development/project-tracking.md).

## Feature delivery

The order the OpenSpec skills cannot enforce on their own:

```text
master <- <change>/proposal <- <change>/<implementation> <- <change>/finalize
```

- Create the `<change>/proposal` branch with `$gh-stack` **before**
  `$openspec-propose` writes any file.
- Create implementation branches only after the proposal is approved: the
  proposal is on `master`, or its PR has a GitHub Approval from Leo or his
  named delegate, or, on a proposal Leo authored, a top-level comment from him
  naming the approved revision. A local commit is not approval.
- Create `<change>/finalize` **before** `$openspec-sync-specs` writes canonical
  specs; finalize owns only spec sync, task records, and archive movement.
- Put `Closes #N` on the PR whose merge satisfies the issue's acceptance, even
  when later layers remain.

The full phase sequence, `tasks.md` contents, and proposal review rounds:
[docs/development/feature-delivery.md](docs/development/feature-delivery.md).
OpenSpec injects per-phase reminders from `openspec/config.yaml` into its
skills; keep delivery policy there and here, not in the skills.

## Changesets

Only the compile PR below, or a correction to an entry already compiled, edits
`CHANGELOG.md`. The PR that ships work, a fix, or a chore writes its entry to `.changeset/<name>.md`, so parallel branches never
touch the same file:

```markdown
---
"api": minor
"web": patch
---

- The entry, written as a `CHANGELOG.md` entry.
```

The frontmatter lists each workspace package the entry covers: `major` for a
breaking change, `minor` for a feature, `patch` for a fix, or nothing for a
repository-only change. Nothing versions packages yet; the bump is recorded for
a later release tool. A feature has one changeset named after its OpenSpec
change (`<change>.md`), amended by later layers; a parallel branch uses
`<change>.<layer>.md`.

`pnpm changelog:compile` moves each changeset into `CHANGELOG.md` under the
date of its last commit and deletes it; a changeset of an active OpenSpec
change waits until the change is archived. Run it on its own branch from
`master` and open the result as a `chore: compile changelog` PR.

## Verification

CI runs the full suites on every push, and its result on the published head
gates a merge. Locally, run the narrowest command that covers what you changed,
and a broader row only where CI cannot cover it. Narrow evidence cannot support
a broader claim.

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
evidence is necessary; never run unbounded `pnpm build`. Report environment
failures separately from repository defects.

## PR contract

`$pull-requests` is the procedure: opening, the body, waiting, review bots, and
stacks. The policy it implements:

- Confirm the PR's immediate base and ownership. Feature delivery uses a stack;
  a fix or chore is one PR or a stack, whichever reviews better.
- Start the body from
  [`.github/pull_request_template.md`](.github/pull_request_template.md): one
  concern, issues served, stack position, and the commands actually run. No
  `Test plan` section, and no mention of agent tooling unless asked.
- **Self-review (SR)** while draft: review the parent-relative diff against
  [REVIEW_GUIDE.md](REVIEW_GUIDE.md), fix with new commits, and mark ready only
  once CI on the head is green, or red only on checks that are also red on
  `master` and named in a PR comment.
- **GitHub review (GR)** after ready: the expected review bots and current-head
  CI. A local reviewer never substitutes for an expected bot, and draft state
  is never toggled to retrigger reviews.

## Ready-PR monitoring

After every non-draft push, watch CI and reviews for at least 15 minutes, and
give every finding a disposition (accepted and fixed, or rejected with
evidence) and a reply on the surface that raised it. Any push restarts the
loop for that PR and every stack PR above it. Exit only after the floor,
terminal passing CI, a finished review from every expected bot (a
quota-exhausted bot is recorded as skipped; an unknown one is a question for
Leo), and no actionable unresolved feedback.

## Merge

Immediately recheck CI, approvals, threads, base, and stack. Then obtain Leo's
explicit permission. Merge stacks only through `$gh-stack`; `gh pr merge` cannot
merge a stack, and intermediate branches are never deleted manually.
