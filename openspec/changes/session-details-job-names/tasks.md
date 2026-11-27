# Tasks

## 0. Delivery

- Graph: `master ← feat/session-details-job-intents` (#1944, closes #1954) `← finalize`
  (spec sync and archive, from `master` after #1944 merges).
- At Leo's choice, the change artifacts and the implementation share #1944. No
  intermediate merge boundary exists inside it.
- #1944 owns the issue closure. The finalize layer closes nothing.

## 1. Data and API (#1944)

- [x] 1.1 Add nullable `chat_jobs.intent` and `chat_jobs.command`, written at job binding from `ToolContext.toolIntent` and the bash command; verify with `pnpm --filter api db:check` and the bash dispatch unit test.
- [x] 1.2 Return `intent` and `command` from `GET /api/v1/chats/:chatId/jobs`; verify "The list holds the intent" in `chat-jobs.integration.test.ts`.
- [x] 1.3 Add `GET /api/v1/chats/:chatId/jobs/:jobId/output` with the `status` union; verify "A failed job's output", "A long stream is cut", "Another owner reads the output", and the 409 for a live job in `chat-jobs.integration.test.ts`.
- [x] 1.4 Regenerate `openapi.json` and the web client; `pnpm lint:openapi` passes.

## 2. Model context (#1944)

- [x] 2.1 Add the intent to the `job://` listing and the intent and command to the record; verify "A record names the intent and the command" and the listing case in `job-reader.test.ts`.
- [x] 2.2 Name the intent in the job notice with neutralized delimiters; verify "An intent that copies an envelope" in `job-context-item.test.ts`.
- [x] 2.3 Tell the model in the `bash` description that the owner names jobs by intent; update `docs/product/reference/locators/job.md`.

## 3. Web (#1944)

- [x] 3.1 Show live jobs by intent with elapsed time, stop, and "Stop all", and settled jobs behind a Finished control; verify "Stop all with no live Run" and "Settled jobs are behind the Finished control" in `jobs-section.stories.tsx`.
- [x] 3.2 Add the Finished jobs panel on the outer edge of Session details with command, output, and outcome; verify its stories in `finished-jobs-panel.stories.tsx`.
- [x] 3.3 Keep "The composer Stop leaves jobs alone" in `chat-page.stories.tsx` and the jobs E2E passing.
- [x] 3.4 Add a dated `CHANGELOG.md` entry.

## 4. Gates (#1944)

- [x] 4.1 Run the API and web lint, typecheck, the focused tests above, `pnpm format:check`, `git diff --check`, and `pnpm exec openspec validate session-details-job-names --strict`.
- [x] 4.2 Self-review the diff against `REVIEW_GUIDE.md` before ready; then the GitHub review and CI gate.

## 5. Finalize (separate PR)

- [ ] 5.1 Create `session-details-job-names/finalize` from `master` after #1944 merges, before `$openspec-sync-specs` writes.
- [ ] 5.2 Sync the delta into `openspec/specs/background-jobs/spec.md` and check the MODIFIED requirements against the canonical text.
- [ ] 5.3 Archive the change; run `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
