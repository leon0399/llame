Track [#139](https://github.com/leon0399/llame/issues/139), [#262](https://github.com/leon0399/llame/issues/262), and their PRs through the delivery Project under [CONTRIBUTING.md](../../../CONTRIBUTING.md). Local drafting or commits do not change Project status. [#207](https://github.com/leon0399/llame/issues/207) is separate work, not a native blocker.

Use `$gh-stack` for every layer and `$openspec-apply-change` for implementation. Create the next layer only after the approved proposal revision is carried forward and the previous layer passed its gates. Publication and merge each require separate permission.

```text
(master) <- run-cancellation/proposal
         <- run-cancellation/toast-placement
         <- run-cancellation/stop-from-submission
         <- run-cancellation/finalize
```

- `proposal` owns only the proposal, design, delta spec, and this task list.
- `toast-placement` (parent `proposal`, estimated 110 authored lines): the shared toast host's position, its DESIGN.md record, and its browser proof. Its PR uses `Closes #262`.
- `stop-from-submission` (parent `toast-placement`, estimated 550 authored lines): the identifying frame, the web Stop path, the pending indicator, and their proof. Its merge completes #139's acceptance, so its PR uses `Closes #139`.
- `finalize` owns only spec sync, checked task records, and archive movement.

Re-estimate authored size at each layer boundary and before publication; split a growing concern or request a named exception before publishing an oversized layer. Do not put live delivery status in this file.

## 1. `run-cancellation/toast-placement`: notifications clear of the composer

- [ ] 1.1 Default `position` to `top-right` in the shared `Toaster` (`packages/ui/src/components/sonner.tsx`) and record the placement beside the Sonner entry in DESIGN.md (design M5). Verify with the Sonner story's test run and a preview URL showing a top-right toast.
- [ ] 1.2 Remove the conditional View click from `e2e/web/chat/model-context-transparency.spec.ts` (design M5). Confirm `active-runs-context.test.tsx` still covers the foreground case in which terminal polling completes before the chat's own finish; add that case if it is missing. Verify with `pnpm --filter web test:coverage`.
- [ ] 1.3 Add a toast-placement E2E at 1280×720 and 390×844 (design M6): a `SLOW` background completion yields a "Reply ready" toast; while the toast is hovered, its box does not intersect the composer's; its View action opens the originating chat. No forced clicks and no fixed waits. Verify with the focused spec in CI.
- [ ] 1.4 Add a dated `CHANGELOG.md` entry. Run `pnpm --filter web lint`, `typecheck`, and `test:coverage`, plus `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; record the commands in the PR body, which uses `Closes #262`.
- [ ] 1.5 Self-review (SR) the parent-relative draft diff against REVIEW_GUIDE.md, fix accepted findings, and rerun affected checks before marking ready.
- [ ] 1.6 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before adding the `stop-from-submission` layer.

## 2. `run-cancellation/stop-from-submission`: Stop cancels from acceptance

- [ ] 2.1 Emit the translator's identifying frame before the bridge's first poll, at most once per stream (design M1). Verify with `run-stream-bridge.test.ts` cases for the identifying-frame requirement: the first frame carries the Run id while the event log holds only creation; a later delta, tool event, or terminal event adds no second frame; the two terminal-row fallback cases now expect the frame alone instead of an empty body.
- [ ] 2.2 Add API integration coverage in `chats.controller` or `chat-loop` integration tests: the message stream's first frame arrives before any worker consumes the Run; cancelling that Run id settles it `cancelled` at pickup with no model request and no assistant message; the resume stream of an active Run starts with the frame; resuming another owner's chat returns 204 with no body; another owner's cancel request for the Run returns 404 and records nothing. Reuse existing cases where they already assert a scenario.
- [ ] 2.3 Verify the settlement requirement's cancellation-during-preparation and before-first-chunk scenarios with `run-execution.service` integration tests: no further model request after the abort, `run.cancelled` appended, no assistant message persisted. If either contradicts the proposal's assumption, stop and revise the proposal before continuing.
- [ ] 2.4 Implement the held Stop in `use-chat-conversation.ts` (design M2) and the S1–S4 composer states in `chat-composer.tsx` (design M3). Verify with unit tests: Stop with a known id cancels and stops immediately; Stop without an id holds, then cancels and stops when the placeholder row appears; a failed send clears the hold without a cancel request; the control is an enabled Stop icon in S1–S3 and a disabled spinner in S4; a failing `cancelRun` still stops and shows the existing toast.
- [ ] 2.5 Render the "Thinking…" indicator in an in-flight assistant row with no visible content, and skip settled assistant rows with no visible content and no persisted sequence (design M4). Verify with unit tests for the visible-content rule, including a blank-reasoning-only row showing the indicator, and for the settled-row rule; add a chat message row story for the pending state, run the Storybook story tests, and return preview URLs.
- [ ] 2.6 Add the hold-until-abort model fixture to `e2e/support/model-server.ts` and a Stop-from-submission E2E (design M6): wait for the indicator and the enabled Stop control, click Stop, poll the Run until `cancelled`, reload, and expect the user message as the last row. No fixed waits. Verify with the focused spec in CI.
- [ ] 2.7 Add the `run-cancellation` link to `SPEC.md` §9.4 and point `docs/scaling.md`'s cancellation paragraph at the capability; add a dated `CHANGELOG.md` entry. Run `pnpm --filter api lint`, `typecheck`, `test:coverage`, and `test:integration`, `pnpm --filter web lint`, `typecheck`, and `test:coverage`, plus `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`, and `pnpm exec openspec validate run-cancellation --strict`; record the commands in the PR body, which uses `Closes #139`.
- [ ] 2.8 Self-review (SR) the parent-relative draft diff against REVIEW_GUIDE.md, fix accepted findings, and rerun affected checks before marking ready.
- [ ] 2.9 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before creating `finalize`.

## 3. `run-cancellation/finalize`: spec sync and archive

- [ ] 3.1 After both implementation layers are published, verified, and checked, create only the finalize layer with `$gh-stack`, then run `$openspec-sync-specs`. Verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; this layer contains no application fix and no shipping record.
- [ ] 3.2 Inspect `pnpm exec openspec status --change run-cancellation --json` and this task list; stop if an artifact or earlier task is incomplete. Complete this task as part of `$openspec-archive-change`, preserving checked history, and verify strict specs/all validation, Markdown lint, formatting, and `git diff --check` on the archived result.

After archive movement, the finalize PR's self-review and GitHub review loop run as post-archive gates; they are not checklist prerequisites of the archive.
