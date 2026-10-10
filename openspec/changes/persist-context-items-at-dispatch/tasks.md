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

| Layer                                 | Parent         | Ownership                                                                                                                                 | Authored estimate        | Closes |
| ------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------ |
| `dispatch-context-items/proposal`     | `master`       | The approved proposal, design, deltas, and this task list.                                                                                | ~2,800 (exception below) | none   |
| `dispatch-context-items/turn-items`   | `proposal`     | `dispatched_at`, accepted-turn items, told sets, baselines, and availability in one pre-dispatch transaction; retry reuse; the baselines. | ~1,400                   | none   |
| `dispatch-context-items/in-run-items` | `turn-items`   | In-Run items as attempt-tagged `context.item` Run events kept on every settlement, including wedged-Run expiry.                           | ~700                     | none   |
| `dispatch-context-items/drop-record`  | `in-run-items` | Removal of `runs.context_items`, its endpoint, DTOs, generated client, and `SPEC.md` record claim.                                        | ~500 plus generated      | #1177  |
| `dispatch-context-items/finalize`     | `drop-record`  | Spec sync, task records, and archive movement only.                                                                                       | ~400                     | none   |

`drop-record` closes #1177 because the issue's acceptance includes removing
the record; the earlier layers reference it.

**Review-budget exception for the proposal layer.** OpenSpec requires each
MODIFIED block to restate its whole canonical requirement, so the 30-odd
blocks across nine capabilities copy about 1,800 canonical lines verbatim. A
whitespace-normalized diff against canonical measures the authored spec change
at about 570 changed lines, plus about 650 lines of proposal, design, and
tasks. Splitting the delta across layers would leave the canonical specs
contradicting each other between them, so the layer is published whole.

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers per round, one of them checking every canonical requirement the change touches; verify findings against the shipped specs and code; commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate persist-context-items-at-dispatch --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a whitespace-normalized script diff of each MODIFIED block against its canonical requirement keeping every canonical scenario in order or rewritten in place; record Leo's approval of that revision, including decisions P1-P6.
- [ ] 0.3 Self-review the proposal diff before marking the PR ready; record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. turn-items

- [ ] 1.1 Add `runs.dispatched_at` in a migration whose backfill `UPDATE` follows `apps/api/src/db/AGENTS.md`: a header comment with its rationale and a `NO FORCE`/`FORCE` row-level-security wrap, proven by a static SQL test like `model-context-storage-cutover-migration.test.ts`; then move the user-message prepend, digest initialization and told set, skill-catalog freeze and told set, Workspace told set and detach clear, and `turn_tool_availability` write from `finishRunInTransaction` into one attempt-fenced pre-dispatch transaction that sets it (design D1); verify integration tests where a Run fails after its first request and the user message holds its staged items, every told set and baseline advanced, and `dispatched_at` is set; where a superseded attempt writes nothing; where a failed dispatch transaction or a preparation failure commits nothing and sends no request; and where public share and export still exclude a failed Run's rail parts.
- [ ] 1.2 Reuse a dispatched Run's accepted-turn parts on a retry and skip every producer, never keying on prompt-import or skill-activation parts; append the Workspace and availability reconciliation items and write the told root, detach clear, and replaced availability record in one fenced write; refuse a pre-step checkpoint on it (design D2); verify tests that a second attempt emits no duplicate and sends the first attempt's text verbatim, that a crash after a skill activation but before dispatch re-derives every item, that a detaching retry narrates and clears the reason, that a retry after an earlier attempt's `enter_workspace` appends the root snapshot and root instruction chain, that a retry whose tool recovered appends a `Now available` reminder and replaces the Run's record so the next turn emits none, and that a retry whose request no longer fits fails `context_incompatible`.
- [ ] 1.3 Read the availability, epoch, and model-switch baselines from the most recent prior Run with `dispatched_at` (design D1, D4); verify tests that a failed Run's availability and switch announcements are not repeated next turn, including a Run that failed before any output, that a Run that never dispatched moves no baseline, and that the epoch boundary decides from a failed baseline Run. Verify the migration backfill: a pre-cutover completed Run gets `dispatched_at` and a failed one does not, and a chat whose last pre-cutover Run completed gets no switch item on the same model and no second digest-supersession item on its first post-cutover turn.
- [ ] 1.4 Verify the issue's reload scenario as an integration test: a Run that loads instruction files and fails is followed by a turn that loads none of them again.
- [ ] 1.5 Update the compaction comment and estimate path that assumed staged text is unpublished; verify the compaction estimate tests still pass and that a failed Run's rail items enter the next compaction's input.
- [ ] 1.6 Update the affected reference and operator docs and add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 1.7 Verify the layer: in `apps/api`, `pnpm exec vitest run --project unit src/runs src/chats src/skills src/compaction`, `pnpm test:integration` filtered to the run-execution, chat-loop, and compaction suites, `pnpm typecheck`, and `pnpm lint`; at the root, `pnpm format:check` and `git diff --check`.
- [ ] 1.8 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 1.9 Pass the GitHub review and CI gate under Ready-PR monitoring, referencing #1177.

## 2. in-run-items

- [ ] 2.1 Append an attempt-tagged `context.item` Run event from `onStepStart` before the step request, project the events of exactly the attempts whose output a settlement projects with whole-item deduplication, delete `withoutContextItems`, filter the event from the chat stream and the owner raw event stream, and extract the projection helpers and route wedged-Run expiry on admission through them (design D3); verify tests that a Run crashing after an in-Run instruction bundle keeps it at its step position, that an `outcome_unknown` settlement projecting an earlier attempt keeps its items, that a cancelled retry that reloaded the same bundle keeps one copy, that neither stream carries the event, and that an expired-on-admission Run keeps its items. Update `chat-loop.integration.test.ts`'s expiry expectation, which today asserts no assistant message.
- [ ] 2.2 Verify a test where a cancelled and an `outcome_unknown` Run keep their in-Run items and the next turn does not reload them.
- [ ] 2.3 Add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 2.4 Verify the layer with the commands of 1.7.
- [ ] 2.5 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 2.6 Pass the GitHub review and CI gate under Ready-PR monitoring, referencing #1177.

## 3. drop-record

- [ ] 3.1 Generate a migration dropping `runs.context_items`; delete `recordContextItems`, the `updateForAttempt` field, the controller route, the DTOs, and the OpenAPI operation (design D5); verify the migration applies on a fresh database and `GET /api/v1/runs/:id/context-items` returns 404 in a controller test.
- [ ] 3.2 Regenerate OpenAPI and the web client and verify a second generation leaves no diff; verify `apps/web` typecheck.
- [ ] 3.3 Rewrite tests that used the record as evidence to assert the persisted parts instead; delete tests that only pinned the record.
- [ ] 3.4 Rewrite the `SPEC.md` sentence that names `runs.context_items` as the record of what a Run injected so it names the persisted message parts, keeping its non-erasure limitation; add the dated, **Breaking** `CHANGELOG.md` entry for the removed endpoint; verify `pnpm lint:markdown` and that no non-archived doc outside `CHANGELOG.md` and `openspec/changes` names `runs.context_items`.
- [ ] 3.5 Verify the layer: the commands of 1.7, the OpenAPI lint, `pnpm --filter web typecheck`, and the API integration suite.
- [ ] 3.6 Self-review the parent-relative diff before marking the PR ready; fix accepted findings with new commits.
- [ ] 3.7 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1177` in the PR body.

## 4. finalize

- [ ] 4.1 Enter `dispatch-context-items/finalize` with `$gh-stack` before any canonical spec write. Then reconcile with every other live change under `openspec/changes` that names a requirement this change modifies or renames in the same capability (at proposal time: `tool-search` on `Tool observations survive into later turns as stored UI parts`, `knowledge-submit` on `No mid-run tool-state checkpointing (read-only slice; write-tool landmine)`): rebase each such block on canonical as it stands at finalize, so it carries any sibling change already synced, and record in the finalize PR body which sibling changes still need the same rebase. Then run `$openspec-sync-specs`; verify each MODIFIED and RENAMED requirement matches its delta with every canonical scenario kept or rewritten in place, and the REMOVED requirement is gone; reword the `model-system-prompts` Purpose sentence that says only successful turns publish attempt-owned context, since sync does not touch Purpose text.
- [ ] 4.2 Confirm archive readiness: `openspec status --change persist-context-items-at-dispatch --json` reports every artifact done and every task above is checked; run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 4.2; then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
