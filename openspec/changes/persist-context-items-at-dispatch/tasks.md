Track [#1177](https://github.com/leon0399/llame/issues/1177) and its PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry
forward the recorded proposal approval and recheck native blockers before
starting; keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
each implementation layer, after proposal approval only.

```text
master
  <- dispatch-context-items/proposal
  <- dispatch-context-items/turn-items
  <- dispatch-context-items/in-run-items
  <- dispatch-context-items/drop-record
  <- dispatch-context-items/finalize
```

| Layer                                 | Parent         | Ownership                                                                                                                      | Authored estimate   | Closes |
| ------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ------ |
| `dispatch-context-items/proposal`     | `master`       | The approved proposal, design, deltas, and this task list.                                                                     | ~900                | none   |
| `dispatch-context-items/turn-items`   | `proposal`     | Accepted-turn items, told sets, baselines, and availability in one pre-dispatch transaction; retry reuse; the switch baseline. | ~1,200              | none   |
| `dispatch-context-items/in-run-items` | `turn-items`   | In-Run items as `context.item` Run events kept on every settlement.                                                            | ~600                | #1177  |
| `dispatch-context-items/drop-record`  | `in-run-items` | Removal of `runs.context_items`, its endpoint, DTOs, and generated client.                                                     | ~500 plus generated | none   |
| `dispatch-context-items/finalize`     | `drop-record`  | Spec sync, task records, and archive movement only.                                                                            | ~400                | none   |

`in-run-items` closes #1177 because with it every rail item survives every
outcome; `drop-record` is the cleanup the issue also asks for and references
it.

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers per round, one of them checking every canonical requirement the change touches; verify findings against the shipped specs and code; commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate persist-context-items-at-dispatch --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a whitespace-normalized script diff of each MODIFIED block against its canonical requirement keeping every canonical scenario in order or rewritten in place; record Leo's approval of that revision, including decisions P1-P4.
- [ ] 0.3 Self-review the proposal diff before marking the PR ready; record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. turn-items

- [ ] 1.1 Move the user-message prepend, digest initialization and told set, skill-catalog freeze and told set, Workspace told set and detach clear, and `turn_tool_availability` write from `finishRunInTransaction` into one attempt-fenced pre-dispatch transaction (design D1); verify an integration test where a Run fails after its first request and the user message holds its staged items and every told set and baseline advanced, and one where a superseded attempt writes nothing.
- [ ] 1.2 Tag persisted accepted-turn parts with the Run id and reuse them on a retried attempt (design D2); verify a test where a second attempt of the same Run emits no duplicate item and sends the first attempt's text verbatim.
- [ ] 1.3 Read the availability baseline from the most recent prior Run that recorded `turn_tool_availability`, and the switch baseline from the most recent prior Run with an assistant message (design D1, D4); verify tests that a failed Run's availability or switch announcement is not repeated next turn, and that a Run that never dispatched does not move either baseline.
- [ ] 1.4 Verify the issue's reload scenario as an integration test: a Run that loads instruction files and fails is followed by a turn that loads none of them again.
- [ ] 1.5 Update the compaction comment and estimate path that assumed staged text is unpublished; verify the compaction estimate tests still pass.
- [ ] 1.6 Update the affected reference and operator docs and add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 1.7 Verify the layer: in `apps/api`, `pnpm exec vitest run --project unit src/runs src/chats src/skills src/compaction`, `pnpm test:integration` filtered to the run-execution, chat-loop, and compaction suites, `pnpm typecheck`, and `pnpm lint`; at the root, `pnpm format:check` and `git diff --check`.
- [ ] 1.8 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 1.9 Pass the GitHub review and CI gate under Ready-PR monitoring, referencing #1177.

## 2. in-run-items

- [ ] 2.1 Append a `context.item` Run event from `onStepStart` before the step request, replay it in the durable reconstructor, and delete `withoutContextItems` so every settlement keeps rail parts (design D3); verify tests that a Run crashing after an in-Run instruction bundle keeps it on the assistant message at its step position, and that the stream bridge does not forward the event.
- [ ] 2.2 Verify a test where a cancelled and an `outcome_unknown` Run keep their in-Run items and the next turn does not reload them.
- [ ] 2.3 Add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 2.4 Verify the layer with the commands of 1.7.
- [ ] 2.5 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 2.6 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1177` in the PR body.

## 3. drop-record

- [ ] 3.1 Generate a migration dropping `runs.context_items`; delete `recordContextItems`, the `updateForAttempt` field, the controller route, the DTOs, and the OpenAPI operation (design D5); verify the migration applies on a fresh database and `GET /api/v1/runs/:id/context-items` returns 404 in a controller test.
- [ ] 3.2 Regenerate OpenAPI and the web client and verify a second generation leaves no diff; verify `apps/web` typecheck.
- [ ] 3.3 Rewrite tests that used the record as evidence to assert the persisted parts instead; delete tests that only pinned the record.
- [ ] 3.4 Add the dated, **Breaking** `CHANGELOG.md` entry for the removed endpoint; verify `pnpm lint:markdown`.
- [ ] 3.5 Verify the layer: the commands of 1.7, the OpenAPI lint, `pnpm --filter web typecheck`, and the API integration suite.
- [ ] 3.6 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 3.7 Pass the GitHub review and CI gate under Ready-PR monitoring, referencing #1177.

## 4. finalize

- [ ] 4.1 Enter `dispatch-context-items/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`; verify each MODIFIED requirement matches its delta with every canonical scenario kept or rewritten in place, and the REMOVED requirement is gone.
- [ ] 4.2 Confirm archive readiness: `openspec status --change persist-context-items-at-dispatch --json` reports every artifact done and every task above is checked; run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 4.2; then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
