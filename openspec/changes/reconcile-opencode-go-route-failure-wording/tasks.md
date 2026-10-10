Track [#919](https://github.com/leon0399/llame/issues/919) and its PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry
forward the recorded proposal approval and recheck native blockers before
starting; keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
the runbook layer, after proposal approval only.

```text
master
  <- opencode-go-failure-wording/proposal
  <- opencode-go-failure-wording/runbook
  <- opencode-go-failure-wording/finalize
```

| Layer                                  | Parent     | Ownership                                                                   | Authored estimate | Closes |
| -------------------------------------- | ---------- | --------------------------------------------------------------------------- | ----------------- | ------ |
| `opencode-go-failure-wording/proposal` | `master`   | The approved proposal, design, delta, and this task list.                   | ~250              | none   |
| `opencode-go-failure-wording/runbook`  | `proposal` | The corrected string to match in the runbook and the dated changelog entry. | ~20               | #919   |
| `opencode-go-failure-wording/finalize` | `runbook`  | Spec sync, task records, and archive movement only.                         | ~150              | none   |

The runbook layer's merge brings the runbook into line with the reworded
requirement, so it carries `Closes #919` and the `CHANGELOG.md` entry.

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers per round; verify findings against the canonical spec, the runbook, the archived live proof, and `apps/api/src/models/opencode-go-model-client.test.ts`; commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate reconcile-opencode-go-route-failure-wording --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a script diff of the MODIFIED block against its canonical requirement showing only the runbook clause and the runbook scenario changed, with every canonical scenario kept; record Leo's approval of that revision.
- [ ] 0.3 Self-review the proposal diff before marking the PR ready; record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. runbook

- [ ] 1.1 In `docs/product/operator/providers/opencode-go.md`, "Accepted upstream failures", replace the string to match with the failure message exactly as the live proof records it, `Failed after 3 attempts. Last error: Upstream request failed: Endpoint is unavailable.`, name `RetryError` as its class rather than part of the message, and describe the three attempts as the request plus two retries; verify the section names the documented format-gate message, the observed message with its 2026-09-22 date, which one to match, and the remedy, as the reworded scenario requires.
- [ ] 1.2 Add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.
- [ ] 1.3 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 1.4 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #919` in the PR body.

## 2. finalize

- [ ] 2.1 Enter `opencode-go-failure-wording/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`; verify the synced `opencode-go-provider` requirement matches the delta word for word, with every canonical scenario kept.
- [ ] 2.2 Confirm archive readiness: `openspec status --change reconcile-opencode-go-route-failure-wording --json` reports every artifact done and every task above is checked; run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 2.2; then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
