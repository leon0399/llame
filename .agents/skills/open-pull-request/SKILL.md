---
name: open-pull-request
description: This skill should be used when opening, publishing, or rewriting the body of a llame pull request — a single PR or one layer of a gh-stack — or when asked to "open a PR", "open a draft PR", "write the PR body", "update the PR description", or "mark it ready". Covers the PR contract from CONTRIBUTING.md, the repository pull request template, visual body formatting, the delivery Project item, and the self-review before ready.
metadata:
  version: "1.0.0"
  scope: "llame-pull-request"
---

# Open a pull request

[CONTRIBUTING.md](../../../CONTRIBUTING.md#pr-contract) owns the PR contract;
[`.github/pull_request_template.md`](../../../.github/pull_request_template.md)
is its fill-in form. This skill is the procedure, for a single PR or one layer
of a stack.

## 1. One PR or a stack

Decide from the change, not by default:

|Use a single PR against `master` when…|Use a `$gh-stack` stack when…|
|---|---|
|the change is one concern within the review budget|it splits into dependent, separately reviewable layers|
|it is a fix, chore, dependency bump, or tooling change|it is feature delivery (proposal → implementation → finalize)|
|nothing else is in flight on top of it|later work must build on it before it merges|

A stack layer's branch, base, rebase, and publish commands go through
`$gh-stack`; a single PR uses plain `git` and `gh` (below). Do not split one
concern into layers to look smaller, and do not pile a growing concern into one
PR past the budget: split it instead.

## 2. Before writing

- Confirm the branch, its immediate base, and that the base is current:
  `git fetch origin && git merge-base --is-ancestor origin/<base> HEAD`.
  Mergeability is judged against the PR's own base, not the stack against
  `master`; rebase a layer that conflicts with its parent.
- Commit only owned paths (`git commit -- <paths>`). Other work in the tree is
  someone else's.
- Size the layer: authored added+deleted lines against the parent, with
  generated churn counted separately (see
  [review budget](../../../CONTRIBUTING.md#review-budget)).
- Run the narrow evidence for the touched surface
  ([verification table](../../../CONTRIBUTING.md#verification)) and keep the
  exact commands and results for the body.

## 3. Write the body

Write the body to a file (`/tmp/pr-<branch>.md`) from the template: fill every
section from the diff, delete the sections and checklist items that do not
apply, verify each remaining item before ticking it, and delete the template's
comment blocks.

- **Concern** first, in 1–3 sentences: what and why.
- **One visual when the change has a shape.** Pick the smallest form that
  makes the point, put the explanation beside it, and never repeat the same
  content as both a visual and a list. Use `$show-me` when available. Forms:

  |The point is…|Use|
  |---|---|
  |files added, moved, merged, or deleted|a diff-style file tree (` ```diff ` with `├──`, `+`/`-` lines and `#` comments)|
  |runtime order of calls|a call tree (` ```text `)|
  |UI structure|a component tree with file paths|
  |who calls what, data flow, states|` ```mermaid ` flowchart or sequence diagram|
  |numbers to compare|a table with a delta column (before, after, Δ, Δ %, ratio)|
  |the exact new shape of a small block|a ` ```diff ` of that block only|

  Check Mermaid syntax before publishing
  (`npx -y -p @mermaid-js/mermaid-cli@11 mmdc -i x.mmd -o x.svg`). Keep
  visuals at the top level: a fence nested in a list item renders unreliably.
- **Measurements** report both sides and the delta, and name the machine and
  base commit. A ratio alone is hard to judge.
- **Decisions to review** lists rejected alternatives and accepted limits, so a
  reviewer can challenge them without reconstructing them.
- **Commands run** lists only what ran, with results. CI owns the full suites;
  say what was left to CI.
- Never add a "Test plan" section, and never mention the agent, model, or tool
  that wrote the change.
- Follow the repository's prose rules: answer first, each fact once, no filler.

## 4. Publish

A single PR:

```bash
git push -u origin <branch>
gh pr create --repo leon0399/llame --draft --base <base> --head <branch> \
  --title "<conventional commit title>" --body-file /tmp/pr-<branch>.md
```

A stack layer publishes with `gh stack push` instead. New PRs open as drafts. Rewrite a body later with
`gh pr edit <N> --body-file /tmp/pr-<branch>.md`.

Add the PR to the delivery Project with Status, Priority, Workstream, and Next
action, then read the fields back ([Project tracking](../../../CONTRIBUTING.md#project-tracking)
maps each PR state to a Status). A draft implementation or chore PR is
`In progress`.

## 5. Self-review and green CI, then ready

Mark a PR ready only when both hold for its current head:

- **Self-review is done.** Review the actual parent-relative diff against
  [REVIEW_GUIDE.md](../../../REVIEW_GUIDE.md) and the approved scope. Fix
  findings with new commits, rerun affected checks, and update the body.
- **CI is green.** Watch the draft's checks to a terminal state
  (`npx -y pullfrog watch leon0399/llame --pr <N>`, then
  `gh pr checks <N>`). Fix a failure the PR caused and wait again. A check
  that also fails on `master`, or a known flake, does not block; name it in a
  PR comment.

A push during either step restarts both. Then `gh pr ready <N>`, move the
Project item to `In review` (proposals: `Awaiting approval`), and run
[Ready-PR monitoring](../../../CONTRIBUTING.md#ready-pr-monitoring), reading
feedback with `$fetch-pr-reviews`.

Never toggle draft state to retrigger reviews, and never merge without Leo's
explicit permission.
