Track [#1169](https://github.com/leon0399/llame/issues/1169) and its PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry
forward the recorded proposal approval and recheck native blockers before
starting; keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
the patterns layer, after proposal approval only.

```text
master
  <- bash-reject-boundaries/proposal
  <- bash-reject-boundaries/patterns
  <- bash-reject-boundaries/finalize
```

| Layer                             | Parent     | Ownership                                                                                      | Authored estimate | Closes |
| --------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `bash-reject-boundaries/proposal` | `master`   | The approved proposal, design, delta, and this task list.                                      | ~400              | none   |
| `bash-reject-boundaries/patterns` | `proposal` | The new B1 and B8 values in the example, runbook, and test mirror, their tests, and changelog. | ~80               | #1169  |
| `bash-reject-boundaries/finalize` | `patterns` | Spec sync, task records, and archive movement only.                                            | ~200              | none   |

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers per round; verify findings against the canonical spec, the matcher, and a production-compiler probe; commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate tighten-bash-reject-command-boundaries --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a script diff of the MODIFIED block against its canonical requirement showing only the B1 and B8 values, the three example rows, and the new scenario, with every canonical scenario kept; record Leo's approval of that revision.
- [ ] 0.3 Self-review the proposal diff before marking the PR ready; record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. patterns

- [ ] 1.1 Set B1 and B8 to the canonical values in `apps/api/src/testing/portable-tool-policy.ts`, `apps/api/llame.config.jsonc.example` (JSON-escaped), and the table in `docs/product/operator/tool-call-permissions.md`; verify `tool-permissions-config.test.ts` still finds the example identical to the mirror.
- [ ] 1.2 Add the new scenario's cases to the portable decision matrix in `apps/api/src/tools/permissions/permissions.test.ts`; verify each listed evasion rejects with `explicit_reject` and each guard case allows, and that the evasion cases fail against the old patterns.
- [ ] 1.3 Add the dated `CHANGELOG.md` entry naming B1 and B8 and telling operators with a copied map to re-copy them; verify `pnpm lint:markdown`.
- [ ] 1.4 Verify the layer: in `apps/api`, `pnpm exec vitest run --project unit src/tools/permissions src/instance-config src/testing`, `pnpm typecheck`, and `pnpm lint`; at the root, `pnpm format:check` and `git diff --check`.
- [ ] 1.5 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 1.6 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1169` in the PR body.

## 2. finalize

- [ ] 2.1 Enter `bash-reject-boundaries/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`; verify the synced `tool-call-permissions` requirement matches the delta word for word, with every canonical scenario kept.
- [ ] 2.2 Confirm archive readiness: `openspec status --change tighten-bash-reject-command-boundaries --json` reports every artifact done and every task above is checked; run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 2.2; then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
