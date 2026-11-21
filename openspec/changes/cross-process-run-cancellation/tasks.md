Track [#207](https://github.com/leon0399/llame/issues/207) and its PRs through the delivery Project under [CONTRIBUTING.md](../../../CONTRIBUTING.md). Local drafting or commits do not change Project status. [#118](https://github.com/leon0399/llame/issues/118) is related work, not a native blocker.

Use `$gh-stack` for every stack operation and `$openspec-apply-change` for implementation. Create the next layer only after Leo approves the published proposal revision, including design D1, and the previous layer passed its gates. Publication and merge each require separate permission. Every layer has a self-review (SR) checkpoint before draft -> ready and a GitHub review (GR) checkpoint after ready; for finalize both follow archive movement as post-archive gates.

```text
(master) <- cross-process-cancel/proposal
         <- cross-process-cancel/worker-check
         <- cross-process-cancel/finalize
```

- `cross-process-cancel/proposal` (parent `master`, about 330 authored lines) owns only the proposal, design, delta spec, and this task list. Exit: the OpenSpec proposal, Product Markdown, and Any change verification rows, review rounds committed separately, and Leo's approval of the published revision with D1 decided. References #207 and closes no issue.
- `cross-process-cancel/worker-check` (parent `proposal`, estimated 400 authored lines) owns the worker's cancellation check (design D2, D3), its unit and integration proof (design D4), the corrected code comments, `docs/product/operator/scaling.md`, and the `CHANGELOG.md` entry. It completes #207's acceptance, so its PR uses `Closes #207`. If Leo picks option B, this layer becomes `cross-process-cancel/cancel-notify` (estimated 900 authored lines) as design D1 lists, and tasks 2.1 to 2.3 are rewritten in the proposal layer before approval.
- `cross-process-cancel/finalize` (parent `worker-check`, about 120 authored lines plus rename-detected archive moves) owns only spec synchronization, checked task records, and archive movement. References #207 and closes no issue.

Re-estimate authored size at each layer boundary and before publication; split a growing concern or request a named exception before publishing an oversized layer. Do not put live delivery status in this file.

## 1. `cross-process-cancel/proposal`: proposal layer

- [ ] 1.1 [proposal] Run two adversarial review rounds on the proposal, design, and delta spec, each with at least two independent reviewers; verify each finding against code, specs, or installed dependencies; commit each round separately and surface rejected findings to Leo.
- [x] 1.2 [proposal] Verify the MODIFIED block reproduces `openspec/specs/run-cancellation/spec.md`'s requirement text and all six scenario headings, with only the edits the proposal names, by a recorded sentence-level diff. Recorded after review round 2 on the PR: paragraphs 1 and 4 and all six canonical scenario headings are byte-identical; only paragraph 2 (two sentences replaced by three), the last sentence of paragraph 3 (deleted Runs), and the `WHEN` lines of the three mid-flight scenarios differ; four scenarios are appended.
- [ ] 1.3 [proposal] Prove the layer with `pnpm exec openspec validate cross-process-run-cancellation --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; obtain Leo's approval of the published revision and his D1 choice.
- [ ] 1.4 [proposal] SR: self-review the published draft PR's parent-relative diff against `REVIEW_GUIDE.md`, fix accepted findings with new commits, and mark the PR ready.
- [ ] 1.5 [proposal] GR: complete the Ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before creating `worker-check`.

## 2. `cross-process-cancel/worker-check`: the executing worker honors a cancellation recorded elsewhere

- [ ] 2.1 [worker-check] Add the cancellation check to `RunsWorkerService.executeJob` (design D2, D3): a narrow owner-scoped repository read of `cancel_requested_at` and `status`, a chain of ticks 3 seconds apart, each starting a read unless the previous read's query is still pending (then a failed read that starts nothing), each read raced against its own 1-second deadline constant (not `JOB_STATE_READ_TIMEOUT_MS`) whose late result is discarded, started after the post-registration re-read and stopped in the existing `finally` before unregistering and once the signal is aborted, a reasonless abort on a non-terminal stamped Run and on a `cancelled` or missing Run (never on `completed`, `failed`, or `expired`), and a logged retry on a read error, a missed deadline, or a still-pending query. Verify with `runs-worker.service.test.ts` fake-timer cases for each D4 unit item, including the 4-second worst case with reads just under the deadline and no read after `executeJob` settles; check a stopped flag after each await so a read resolving after settlement neither aborts nor reschedules, with a unit case for it.
- [ ] 2.2 [worker-check] Add the D4 integration cases to `worker-liveness.integration.test.ts`, never calling `RunAbortRegistry`: after `requestCancel`, a hanging Run settles `cancelled` with `run.cancelled` last and no `run.expired`; of two hanging Runs of different owners, the uncancelled one stays `running_model` across two intervals with no recorded cancellation; deleting the Chat through `ChatsRepository.deleteById` of a hanging Run aborts its model request with no further model request. Verify with the focused integration file.
- [ ] 2.3 [worker-check] Correct the comments that call mid-flight cancellation process-local or future work: `run-abort-registry.ts:3-12`, `runs-worker.service.ts:204-206` and the liveness header at `:68-74` (naming the check as cancellation, not liveness), `runs.controller.ts:125-131`, and `chats.service.ts:415-418`, whose "deadman timeout" no longer exists. Verify by reading the diff; no behavior is tested by comments.
- [ ] 2.4 [worker-check] Rewrite `docs/product/operator/scaling.md:94-101` to state that a claimed Run stops within 5 seconds of a cancellation recorded in any process, how (the per-Run check), and its pool cost; drop "and add cross-process cancellation signaling" from the #118 bullet at `:139`; add the check's pool load to the Run execution capacity row if that row's wording needs it. Add a dated `CHANGELOG.md` entry. Verify with `pnpm lint:markdown`.
- [ ] 2.5 [worker-check] Prove the layer with `pnpm --filter api lint`, `typecheck`, and `test:coverage`, the focused integration file from 2.2, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; measure the authored diff against the 400-line estimate; record the commands in the PR body, which uses `Closes #207`; publish the draft with `$gh-stack`.
- [ ] 2.6 [worker-check] SR: self-review the draft PR's parent-relative diff against `REVIEW_GUIDE.md`, using independent subagents where they add coverage; fix accepted findings with new commits, rerun affected checks, and mark ready.
- [ ] 2.7 [worker-check] GR: complete the Ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before creating `finalize`.

## 3. `cross-process-cancel/finalize`: spec sync and archive

- [ ] 3.1 [finalize] After `worker-check` is published, verified, and checked, create only the finalize layer with `$gh-stack` from the implementation top **before** `$openspec-sync-specs` writes any canonical spec. Then apply the delta and verify `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, and that every shipped scenario heading of `run-cancellation` survives. This layer contains no application fix and no shipping record.
- [ ] 3.2 [finalize] Inspect `pnpm exec openspec status --change cross-process-run-cancellation --json` and this task list; stop if an artifact or earlier task is incomplete. Complete this task as part of `$openspec-archive-change`, preserving checked history, and verify strict `--specs` and `--all` validation, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` on the archived result.

## Workflow follow-up

- After archive movement, publish the finalize draft with `$gh-stack`, self-review its diff (SR) and mark ready, run the Ready-PR monitoring loop (GR), and request merge permission; merge only through `$gh-stack`.
