Track [#810](https://github.com/leon0399/llame/issues/810), [#594](https://github.com/leon0399/llame/issues/594), and their PRs through the delivery Project under [CONTRIBUTING.md](../../../CONTRIBUTING.md). Local drafting or commits do not change Project status. [#170](https://github.com/leon0399/llame/issues/170), [#91](https://github.com/leon0399/llame/issues/91), [#806](https://github.com/leon0399/llame/issues/806), and [#866](https://github.com/leon0399/llame/issues/866) are separate work, not native blockers.

Use `$gh-stack` for every layer and `$openspec-apply-change` for implementation. Create the next layer only after the approved proposal revision is carried forward and the previous layer passed its gates. Publication and merge each require separate permission.

```text
(master) <- run-usage-accounting/proposal
         <- run-usage-accounting/api
         <- run-usage-accounting/web
         <- run-usage-accounting/finalize
```

- `proposal` owns only proposal, design, the delta spec, and this task list.
- `api` (parent `proposal`, estimated 1,100 authored lines): per-request receipts, aggregation, completeness, every terminal path, reclaim detection, the compaction signal, and the historical marker migration. Its PR uses `Closes #594` and references #810.
- `web` (parent `api`, estimated 300 authored lines): the usage badge. Its merge completes #810's acceptance, so its PR uses `Closes #810`.
- `finalize` owns only spec sync, checked task records, and archive movement.

Re-estimate authored size at each layer boundary and before publication; split a growing concern or request a named exception before publishing an oversized layer. Do not put live delivery status in this file.

## 1. `run-usage-accounting/api`: per-request usage accounting

- [ ] 1.1 Add `onRequestUsage` to `ModelStreamInput` and the step count to its `onFinish` event, and add the shared `wrapLanguageModel` receipt helper beside `applyToolCallingOptions`; call it from the Responses, Chat Completions, and Anthropic clients and from the scripted and fake streaming test clients (design M1). Verify with a scripted two-request tool stream that the helper's receipts equal the SDK's per-step usage, and that the tool-requesting request's receipt arrives before its tool resolves.
- [ ] 1.2 Add `aggregateTurnTelemetry` to `turn-telemetry.ts` (design M2). Verify with unit tests covering the spec scenarios of the aggregation, cost, completeness, and reasoning requirements, including the two-request fixture (2,400 / 1,000 / 300 / 210 / 2,700 tokens, `costUsd` 0.0063), single-request equivalence, per-request cache bounding, absent fields when nothing reported, and `null` cost when unpriced.
- [ ] 1.3 Feed the attempt's receipts into `onFinish`, `onError`, parent-abort settlement, and the progress-write-failure settlements, and pass `modelCompleted` on each (design M3, M5). Verify with `run-execution.service.test.ts` cases for the terminal-usage requirement's scenarios, the missing-`finish` step-count case, and the event order `model.completed` before `run.failed` and `run.cancelled`.
- [ ] 1.4 Mark usage incomplete in `finishRunInTransaction` when the Run has a prompt receipt from another attempt (design M4). Verify with an integration test covering the reclaim scenarios and the negative isolation scenario: receipts from another Run and from another owner's Run leave `complete: true`.
- [ ] 1.5 Rename `lastTurnTotalTokens` to `lastRequestTokens` through LSP and pass the final receipt's input plus output (design M6). Verify that a completed loop whose summed tokens exceed the threshold while its final request stays below does not compact, and that a final request above the threshold does.
- [ ] 1.6 Add the hand-authored marker migration (design M7). Verify with an integration test that seeds a pre-existing migration ledger: a historical tool-loop row becomes `complete: false`, a single-request completed row becomes `complete: true`, a non-completed row becomes `complete: false`, null usage stays null, every other usage value is byte-identical, and a second application changes nothing. Confirm `pnpm db:generate` reports no schema change.
- [ ] 1.7 Verify live and reload agreement with an integration test: a failed Run's streamed usage metadata equals the usage in the reloaded history, and a reconnect replay shows the same value.
- [ ] 1.8 Add the Run usage accounting paragraph to `SPEC.md` §9 linking `run-usage-accounting`, and a dated `CHANGELOG.md` entry covering summed usage, failed and cancelled usage, and the historical marker. Verify `pnpm lint:markdown`.
- [ ] 1.9 Run `pnpm --filter api lint`, `typecheck`, `test:coverage`, `test:integration`, and `build`, plus `pnpm format:check`, `git diff --check`, and `pnpm exec openspec validate run-usage-accounting --strict`; record the commands in the PR body.
- [ ] 1.10 Self-review (SR) the parent-relative draft diff against REVIEW_GUIDE.md, fix accepted findings, and rerun affected checks before marking ready.
- [ ] 1.11 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before adding the `web` layer.

## 2. `run-usage-accounting/web`: usage badge

- [ ] 2.1 Read `complete` in `parseTurnUsage`; render `≥` on totals and cost for incomplete usage with the explanation row, reasoning as `of which reasoning` under Output, and `—` for unknown values (design M8). Verify with `message-usage.test.tsx` cases for the display requirement's scenarios, including the live-metadata and reloaded-history equality case.
- [ ] 2.2 Update the affected stories and add an incomplete-usage story; run the Storybook story tests and return preview URLs.
- [ ] 2.3 Add a dated `CHANGELOG.md` entry for the display change. Run `pnpm --filter web lint`, `typecheck`, and `test:coverage`, plus `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; record the commands in the PR body, which uses `Closes #810`.
- [ ] 2.4 Self-review (SR) the parent-relative draft diff, fix accepted findings, and rerun affected checks before marking ready.
- [ ] 2.5 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before creating `finalize`.

## 3. `run-usage-accounting/finalize`: spec sync and archive

- [ ] 3.1 After both implementation layers are published, verified, and checked, create only the finalize layer with `$gh-stack`, then run `$openspec-sync-specs`. Verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; this layer contains no application fix and no shipping record.
- [ ] 3.2 Inspect `pnpm exec openspec status --change run-usage-accounting --json` and this task list; stop if an artifact or earlier task is incomplete. Complete this task as part of `$openspec-archive-change`, preserving checked history, and verify strict specs/all validation, Markdown lint, formatting, and `git diff --check` on the archived result.

After archive movement, the finalize PR's self-review and GitHub review loop run as post-archive gates; they are not checklist prerequisites of the archive.
