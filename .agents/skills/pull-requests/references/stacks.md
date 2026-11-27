# Stacked pull requests

`$gh-stack` owns the commands. This file is how to run a stack's pull requests
without paying for the same CI many times over.

## Why a stack is expensive

Each CI run of a product change is about 36 jobs, and the repository runs on
GitHub's shared runner pool. Measured on the seven-layer
`rust-machine-daemon` stack on 2026-11-26:

|Push|Jobs queued|Longest queue wait|Run wall time|
|---|---:|---:|---:|
|One PR alone|~36|0.1 min|7–25 min|
|Whole stack at once (14:20)|~250|13–16 min|23–57 min|

A fix on layer N rewrites every layer above it, `gh stack push` pushes them
all, and each pushed PR starts a full run and restarts its review floor. That
day the stack was pushed whole about ten times. A push cancels the earlier run
of the same PR (`cancel-in-progress`), so a quick second push wastes the first
run's queue time without making anything faster.

## Rules

- **One watcher for the stack.** Watch every open layer in one process
  (`watch-pr.mjs <bottom> … <top>`) and collect the findings of all layers
  before changing anything.
- **Batch, then push once.** Fix each finding on its owning layer (a worktree
  per branch, or `gh stack checkout`), commit every fix, run one
  `gh stack rebase`, verify locally, and push once. One push per round, never
  one per finding.
- **Push only what changed.** A fix on the top layer touches only the top
  branch: `git push` that branch alone. A fix on a lower layer needs the
  layers above rebased eventually, not immediately: push the fixed layer by
  itself (`git push --force-with-lease=refs/heads/<b>:<remote-sha> origin <b>`),
  let its CI and reviews settle, then rebase and push the layers above in one
  push. Until then the upper PRs show the old lower commits in their diff and
  their CI is stale; say so in a PR comment so reviewers wait.
- **Settle bottom-up.** Mark a layer ready, monitor it, and get it merged
  before you invest review rounds in the layers above it. Each merged layer
  drops out of every later replay. Upper layers stay draft while lower ones
  still change; a draft still runs CI, so keep the number of pushes, not the
  draft flag, as the lever.
- **Verify every pushed head started CI.** `gh stack push` sends all branches
  within seconds, and an upper layer can end up with no run. For each pushed
  branch, `gh api "repos/leon0399/llame/actions/runs?branch=<branch>"` must list
  a run whose `head_sha` is the new head; otherwise push that branch again.

## Conflicts with master

GitHub judges a stack layer's mergeability against `master` as well as its
base. When `master` changes files a layer touches, the layer is CONFLICTING
and GitHub skips its `pull_request` workflows entirely: no CI or Lint run
appears, while app bots still review. Check with
`gh pr view <N> --json mergeable`.

- Rebase onto `master` only when a layer conflicts, or right before merging.
  A rebase onto a moved `master` is a whole-stack push; batch it with the
  current round of fixes rather than doing it as its own round.
- The usual conflict sources are Drizzle's migration journal and OpenSpec
  `tasks.md` checkboxes. `CHANGELOG.md` no longer conflicts: entries live in
  `.changeset/`.
- A clean local `git merge-tree` is evidence only in a clone without local
  merge drivers or `.git/info/attributes` overrides.

## Fixing a lower layer

Fix the defect on the layer that introduced it, then replay upward; the top PR
never carries a lower layer's fix. Re-run each affected layer's narrow checks
after the rebase, since a rebase can merge cleanly and still break a layer
above.
