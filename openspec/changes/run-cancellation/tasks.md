Track [#139](https://github.com/leon0399/llame/issues/139), [#262](https://github.com/leon0399/llame/issues/262), and their PRs through the delivery Project under [CONTRIBUTING.md](../../../CONTRIBUTING.md). Local drafting or commits do not change Project status. [#207](https://github.com/leon0399/llame/issues/207) is separate work, not a native blocker.

Use `$gh-stack` for every layer and `$openspec-apply-change` for implementation. Create the next layer only after the approved proposal revision is carried forward and the previous layer passed its gates. Publication and merge each require separate permission.

```text
(master) <- run-cancellation/proposal
         <- run-cancellation/toast-placement
         <- run-cancellation/stop-from-submission
         <- run-cancellation/finalize
```

- `proposal` (parent `master`, about 330 authored lines) owns only the proposal, design, delta spec, and this task list. Exit evidence: strict change validation, Markdown lint, formatting, and Leo's approval of the published revision.
- `toast-placement` (parent `proposal`, estimated 250 authored lines) owns the toast host's position, its DESIGN.md record, the model-server hold, and the toast browser proof. Its PR uses `Closes #262`.
- `stop-from-submission` (parent `toast-placement`, estimated 1,000 authored lines) owns the `start` frame, the web Stop path, the pending indicator, and their proof. Its merge completes #139's acceptance, so its PR uses `Closes #139`.
- `finalize` (parent `stop-from-submission`, about 150 authored lines plus rename-detected archive moves) owns only spec sync, checked task records, and archive movement.

Re-estimate authored size at each layer boundary and before publication; split a growing concern or request a named exception before publishing an oversized layer. Do not put live delivery status in this file.

## 1. `run-cancellation/toast-placement`: notifications clear of the composer

- [x] 1.1 Add the per-token hold to `e2e/support/model-server.ts` with its control endpoint for arrival, close, and release (design M6). Verify with a focused run of an existing chat spec that unheld prompts behave as before, and with the toast spec in 1.4 exercising release.
- [x] 1.2 Pass `position="top-right"` at the `Toaster` mount in `apps/web/components/providers.tsx` and record the placement beside the Sonner entry in DESIGN.md (design M5). Proof is the browser spec in 1.4.
- [x] 1.3 Remove the conditional View click from `e2e/web/chat/model-context-transparency.spec.ts` (design M5). Confirm `active-runs-context.test.tsx` covers the foreground case in which terminal polling completes before the chat's own finish, and add that case if it is missing. Verify with `pnpm --filter web test:coverage`.
- [x] 1.4 Add the toast-placement E2E at 1280×720 and 390×844 (design M6). Verify with a focused local run of the spec where the environment allows, then CI.
- [x] 1.5 Add a dated `CHANGELOG.md` entry. Run `pnpm lint`, `pnpm --filter web typecheck` and `test:coverage`, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check`; record the commands in the PR body, which uses `Closes #262`.
- [ ] 1.6 Self-review (SR) the parent-relative draft diff against REVIEW_GUIDE.md, fix accepted findings, and rerun affected checks before marking ready.
- [ ] 1.7 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before adding the `stop-from-submission` layer.

## 2. `run-cancellation/stop-from-submission`: Stop cancels from acceptance

- [ ] 2.1 Emit the translator's `start` frame before the bridge's first poll, at most once per stream (design M1). Verify with `run-stream-bridge.test.ts` cases for the start-frame requirement: the first frame is `start` with the Run id as `messageId` while the event log holds only creation; a later delta, tool event, or terminal event adds no second `start`; the two terminal-row fallback cases now expect the `start` frame alone instead of an empty body.
- [ ] 2.2 Add API integration coverage in a harness where no worker consumes the Run, reading the response incrementally: the message stream's first frame arrives while the Run is still queued; cancelling that Run id and then letting a worker pick it up settles it `cancelled` with no model request and no assistant message; the resume stream of an active Run starts with the frame; resuming another owner's chat returns 204 with no body; another owner's cancel request returns 404 and records nothing. Reuse existing cases where they already assert a scenario. Verify with the focused integration files.
- [ ] 2.3 Cover the settlement requirement's post-claim scenarios with `run-execution.service` integration tests: cancellation during preparation makes no further model request and persists no assistant message; cancellation after `model.requested` with no output persists a turn with no parts, consistent with `chats-messages.integration.test.ts:776-821`; a Run that completed first stays `completed`. Verify with the focused integration files.
- [ ] 2.4 Implement the held Stop as a hook used by `use-chat-conversation.ts` (design M2). Verify with jsdom hook tests: Stop with a known id cancels and stops immediately; Stop without an id holds, then cancels and stops when the placeholder row appears; a failed send clears the hold without a cancel request; a failing `cancelRun` still stops and shows the existing toast.
- [ ] 2.5 Implement the S1–S4 composer states in `chat-composer.tsx` (design M3) and add a `chat-composer` story whose play function asserts the enabled Stop icon in S1–S3 and the disabled spinner in S4. Run the Storybook story tests and return preview URLs.
- [ ] 2.6 Render the indicator and apply the live-only empty-row rule (design M4). Verify with unit tests for the visible-content rule (including a whitespace-only reasoning part) and for the row rule across Stop before output, history adoption with and without a persisted empty turn, and a following send; add a chat message row story for the pending state, run the story tests, and return preview URLs.
- [ ] 2.7 Add the Stop-from-submission E2E using the hold from 1.1 (design M6). Verify with a focused local run of the spec where the environment allows, then CI.
- [ ] 2.8 Add the `run-cancellation` link to `SPEC.md` §9.4 and point `docs/scaling.md`'s cancellation paragraph at the capability; add a dated `CHANGELOG.md` entry. Run `pnpm lint`, `pnpm --filter api typecheck` and `test:coverage`, `pnpm --filter web typecheck` and `test:coverage`, the focused integration files from 2.2 and 2.3, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`, and `pnpm exec openspec validate run-cancellation --strict`; record the commands in the PR body, which uses `Closes #139`.
- [ ] 2.9 Self-review (SR) the parent-relative draft diff against REVIEW_GUIDE.md, fix accepted findings, and rerun affected checks before marking ready.
- [ ] 2.10 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before creating `finalize`.

## 3. `run-cancellation/finalize`: spec sync and archive

- [ ] 3.1 After both implementation layers are published, verified, and checked, create only the finalize layer with `$gh-stack`, then run `$openspec-sync-specs`. Verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`; this layer contains no application fix and no shipping record.
- [ ] 3.2 Inspect `pnpm exec openspec status --change run-cancellation --json` and this task list; stop if an artifact or earlier task is incomplete. Complete this task as part of `$openspec-archive-change`, preserving checked history, and verify strict specs/all validation, Markdown lint, formatting, and `git diff --check` on the archived result.

After archive movement, the finalize PR's self-review and GitHub review loop run as post-archive gates; they are not checklist prerequisites of the archive.
