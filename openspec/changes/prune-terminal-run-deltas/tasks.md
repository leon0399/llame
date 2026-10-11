Track [#119](https://github.com/leon0399/llame/issues/119) and its PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry
forward the recorded proposal approval and recheck native blockers before
starting.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
the implementation layer, after proposal approval only.

```text
master
  <- run-event-retention/proposal
  <- run-event-retention/prune
  <- run-event-retention/finalize
```

| Layer                          | Parent     | Ownership                                                                     | Authored estimate | Closes |
| ------------------------------ | ---------- | ----------------------------------------------------------------------------- | ----------------- | ------ |
| `run-event-retention/proposal` | `master`   | The approved proposal, design, deltas, and this task list.                    | ~300              | none   |
| `run-event-retention/prune`    | `proposal` | The setting, the discovery function, the DELETE policy, the job, tests, docs. | ~700              | #119   |
| `run-event-retention/finalize` | `prune`    | Spec sync, task records, and archive movement only.                           | ~200              | none   |

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers, one security-focused on the new DELETE policy; verify findings against code and specs; commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate prune-terminal-run-deltas --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a whitespace-normalized diff of the MODIFIED block against canonical keeping every canonical scenario in order; record Leo's approval, including decisions E1-E3.
- [ ] 0.3 Self-review the proposal diff before marking the PR ready.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. prune

- [ ] 1.1 Add `runs.deltaRetentionDays` to the loader, the JSON Schema, and `llame.config.jsonc.example`; verify `config-loader.test.ts` cases for the default, `null`, an interpolation token, and `0`, `-1`, `1.5` failing startup.
- [ ] 1.2 Add the discovery function and the `run_events_owner_delete_delta` policy in a migration that follows `apps/api/src/db/AGENTS.md` (P1 `FORCE`, P3 ownership and grants in `docker/postgres/rls-function-owner.sql`, a manual-SQL header); verify the migration on a fresh database and `pnpm db:check`.
- [ ] 1.3 Add `RunEventRetentionService` on a `run-event-retention` queue and worker-profile consumer (design D3); verify an integration test with Runs of two owners covering every scenario of the ADDED `durable-runs` requirement, and an RLS test that another owner's rows, non-delta events, and deletes without the cutoff setting are undeletable.
- [ ] 1.4 Update `docs/product/operator/scaling.md` (remove the #119 open constraint, document the window) and add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 1.5 Verify the layer: in `apps/api`, `pnpm exec vitest run --project unit src/runs src/instance-config`, the new integration and RLS tests, `pnpm typecheck`, `pnpm lint`, and the changed-lines mutation gate; at the root, `pnpm format:check` and `git diff --check`.
- [ ] 1.6 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 1.7 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #119` in the PR body.

## 2. finalize

- [ ] 2.1 Enter `run-event-retention/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`; verify the ADDED requirements appear word for word and the MODIFIED requirement matches the delta with every canonical scenario kept.
- [ ] 2.2 Confirm archive readiness: `openspec status --change prune-terminal-run-deltas --json` reports every artifact done and every task above is checked; run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 2.2; then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
