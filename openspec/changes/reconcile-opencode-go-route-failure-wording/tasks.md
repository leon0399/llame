Track [#919](https://github.com/leon0399/llame/issues/919) and its PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry
forward the recorded proposal approval and recheck native blockers before
starting; keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation. The change is a spec wording
reconciliation with no implementation layer: the runbook already satisfies the
reworded requirement, so no code or document outside `openspec/` changes.

```text
master
  <- opencode-go-failure-wording/proposal
  <- opencode-go-failure-wording/finalize
```

| Layer                                  | Parent     | Ownership                                             | Authored estimate | Closes |
| -------------------------------------- | ---------- | ----------------------------------------------------- | ----------------- | ------ |
| `opencode-go-failure-wording/proposal` | `master`   | The approved proposal, the delta, and this task list. | ~150              | none   |
| `opencode-go-failure-wording/finalize` | `proposal` | Spec sync, task records, and archive movement only.   | ~150              | #919   |

`design.md` is omitted: none of its inclusion conditions applies to a wording
change. With no implementation layer, the finalize layer completes #919's
acceptance by syncing the reworded requirement, so it carries `Closes #919`
and the dated `CHANGELOG.md` entry.

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers per round; verify findings against the canonical spec, the runbook, and the archived live proof; commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate reconcile-opencode-go-route-failure-wording --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a script diff of the MODIFIED block against its canonical requirement showing only the runbook clause and the runbook scenario changed, with every canonical scenario kept; record Leo's approval of that revision.
- [ ] 0.3 Self-review the proposal diff before marking the PR ready; record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. finalize

- [ ] 1.1 Enter `opencode-go-failure-wording/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`; verify the synced `opencode-go-provider` requirement matches the delta word for word, with every canonical scenario kept.
- [ ] 1.2 Re-read `docs/product/operator/providers/opencode-go.md#accepted-upstream-failures` against the synced requirement and verify it names the documented message, the observed message with its date, which one to match, and the remedy; add the dated `CHANGELOG.md` entry.
- [ ] 1.3 Confirm archive readiness: `openspec status --change reconcile-opencode-go-route-failure-wording --json` reports every required artifact done or legitimately omitted and every task above is checked; run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 1.3; then self-review the
  finalize diff, mark it ready with `Closes #919`, and run Ready-PR
  monitoring. These SR and GR steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
