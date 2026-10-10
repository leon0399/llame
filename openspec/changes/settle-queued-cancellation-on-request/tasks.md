Track [#125](https://github.com/leon0399/llame/issues/125) (queued-cancel item)
and its PR layers through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry forward
the recorded proposal approval and recheck native blockers before starting.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
the implementation layer, after proposal approval only.

```text
master
  <- queued-cancel/proposal
  <- queued-cancel/settle
  <- queued-cancel/finalize
```

| Layer                    | Parent     | Ownership                                                 | Authored estimate | Closes |
| ------------------------ | ---------- | --------------------------------------------------------- | ----------------- | ------ |
| `queued-cancel/proposal` | `master`   | The approved proposal, design, delta, and this task list. | ~250              | none   |
| `queued-cancel/settle`   | `proposal` | Settling a queued Run on the cancellation request, tests. | ~250              | none   |
| `queued-cancel/finalize` | `settle`   | Spec sync, task records, and archive movement only.       | ~150              | none   |

The `settle` layer references #125; that umbrella stays open for its owner.

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers; verify findings against the shipped specs and code; commit the round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate settle-queued-cancellation-on-request --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a whitespace-normalized diff of each MODIFIED block against canonical keeping every canonical scenario in order; record Leo's approval, including decision Q1.
- [ ] 0.3 Self-review the proposal diff before marking the PR ready.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. settle

- [ ] 1.1 Move the `PATCH /api/v1/runs/:id` handler into a `RunCancellationController` in `RunWorkerModule` with a narrow `settleTerminalRun` capability, and settle a Run found `queued` after recording or on a repeated request (design D1, D2); verify controller unit tests that a queued Run returns `cancelled`, a repeated request on a still-queued recorded Run returns `cancelled`, and a claimed Run returns as recorded without settlement; keep `@ApiTags('runs')` and `operationId: 'updateRun'` on the moved handler, and verify the OpenAPI document is unchanged after regeneration.
- [ ] 1.2 Rewrite `run-cancellation-start-frame.integration.test.ts`'s settled-at-pickup assertion and the cancel docstring that says a queued Run is settled at pickup; verify an integration test: cancelling a queued Run leaves it `cancelled` with `run.cancelled` last in its event log and no assistant message, the owner's next message to the chat is accepted, and delivering the Run's queued job afterwards makes no model request.
- [ ] 1.3 Add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 1.4 Verify the layer: in `apps/api`, `pnpm exec vitest run --project unit src/runs`, the run-cancellation integration suites, `pnpm typecheck`, `pnpm lint`, and the changed-lines mutation gate; at the root, `pnpm format:check` and `git diff --check`.
- [ ] 1.5 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 1.6 Pass the GitHub review and CI gate under Ready-PR monitoring, referencing #125.

## 2. finalize

- [ ] 2.1 Enter `queued-cancel/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`; verify both MODIFIED requirements match the delta with every canonical scenario kept.
- [ ] 2.2 Confirm archive readiness: `openspec status --change settle-queued-cancellation-on-request --json` reports every artifact done and every task above is checked; run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 2.2; then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
