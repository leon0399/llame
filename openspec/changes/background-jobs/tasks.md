Tracks [#1657](https://github.com/leon0399/llame/issues/1657), and resolves
[#1051](https://github.com/leon0399/llame/issues/1051) and
[#1050](https://github.com/leon0399/llame/issues/1050) for host `bash`.

## Delivery stack

Follow [CONTRIBUTING.md](../../../CONTRIBUTING.md). Create each branch with `$gh-stack` from the
current stack top, only after the proposal is approved. Implement each layer with
`$openspec-apply-change`.

```text
master
  <- background-jobs/proposal
  <- background-jobs/job-store
  <- background-jobs/bash-executor
  <- background-jobs/bash-jobs
  <- background-jobs/job-control
  <- background-jobs/notices
  <- background-jobs/wait
  <- background-jobs/web
  <- background-jobs/finalize
```

| Layer           | Parent          | Owns                                                                                       | Estimate   | Issue                    |
| --------------- | --------------- | ------------------------------------------------------------------------------------------ | ---------- | ------------------------ |
| `proposal`      | `master`        | The planning artifacts of this change.                                                     | 2,500      | refs #1657               |
| `job-store`     | `proposal`      | The job tables, their isolation, the `job://` reader, the jobs API, and worker heartbeats. | 1,700      | refs #1657               |
| `bash-executor` | `job-store`     | A `bash-executor` handle that outlives its call, and the process limiter.                  | 1,000      | refs #1657, #1050        |
| `bash-jobs`     | `bash-executor` | Host `bash` in the background: triggers, lifetime, stored output, settlement, settings.    | 1,900      | refs #1657, #1051, #1050 |
| `job-control`   | `bash-jobs`     | `stop`, the stop signal, and the tools that yield to a steer or an interrupt.              | 1,400      | refs #1657               |
| `notices`       | `job-control`   | Job notices, host messages, and Runs that the host starts.                                 | 1,900      | refs #1657               |
| `wait`          | `notices`       | `wait`, `awaiting_jobs`, the wakers, and the resumed attempt.                              | 1,900      | refs #1657               |
| `web`           | `wait`          | The sidebar state, the Jobs section, and the transcript rows.                              | 1,700      | Closes #1657             |
| `finalize`      | `web`           | Spec synchronization, task records, and archive movement.                                  | 0 authored | refs #1657               |

**Budget exception (named):** the `proposal` layer exceeds the 2,000-line review budget. The
reason is five MODIFIED requirements that must restate long canonical blocks: two in
`bash-execution` (203 lines), two in `durable-runs` (161 lines), and one in `context-injection`
(124 lines). Leo approves or declines the exception with the proposal. The measured size is in
the PR body.

Re-estimate each layer at its boundary. Generated files count zero and are reported apart: the
Drizzle snapshots, `apps/api/openapi.json`, the Orval client, both live-protocol copies, and the
queue protocol.

## 1. Proposal layer (`background-jobs/proposal`)

- [x] 1.1 Initialize the branch with `$gh-stack` before any artifact exists; `gh stack view --json` names `background-jobs/proposal` on `master`.
- [x] 1.2 Write `proposal.md`, `design.md`, the delta specs, and this file; `pnpm exec openspec validate background-jobs --strict` passes.
- [ ] 1.3 Run two rounds of `$iterative-review-refinement` with two independent reviewers each, verify each finding, and commit each round apart; the revision history in `design.md` names each round.
- [ ] 1.4 Run `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; all pass.
- [ ] 1.5 Self-review the draft PR diff against `REVIEW_GUIDE.md` and fix findings with new commits before the PR is marked ready.
- [ ] 1.6 Run the GitHub review and CI loop on the published head until every expected reviewer completes and CI passes.
- [ ] 1.7 Obtain Leo's approval of the published revision, of the three deviations, and of the budget exception.

## 2. Job store (`background-jobs/job-store`)

- [ ] 2.1 Add `chat_jobs`, `chat_job_chunks`, and `worker_instances` with a generated migration and hand-appended `FORCE ROW LEVEL SECURITY`; `pnpm --filter api db:check` passes and `pnpm db:provision-rls` succeeds.
- [ ] 2.2 Add the job repository with first-writer-wins settlement; integration tests cover "A late stop does not change a settled job" and "A settlement is recorded twice" (one settled state).
- [ ] 2.3 Add the worker heartbeat and the dead-worker join; integration tests cover "A crash is found at the next message" (with a stale heartbeat row), "A lost job keeps its stored output", and "A job on a dead worker is not counted".
- [ ] 2.4 Reserve the artifact number for a job and let `writeToolArtifact` take a reserved number; tests cover "The job and its artifact share a number", "A job artifact after the Run ended", and "A failed write keeps the stored increments".
- [ ] 2.5 Add the `job://` reader to `LOCATOR_READERS`; tests cover every scenario of `The read tool returns a job record`, `The read tool returns one output of a job`, `A bare job locator lists the jobs of the Chat`, "A locator of another Chat does not resolve", and "A read group rejects job locators", with rows that a test fixture inserts.
- [ ] 2.6 Add `GET /api/v1/chats/:chatId/jobs`, the `PATCH` that records a stop request, and `runningJobs` on the chat list item; tests cover "A stop of a settled job", the repeated request, and the 404 answers. Regenerate `openapi.json` and the web client; a second generation leaves a clean diff.
- [ ] 2.7 Add the negative isolation tests: "Another owner reads a job", "A query without an identity finds no job", and a foreign `job://` read through the tool.
- [ ] 2.8 Add `docs/product/reference/locators/job.md` and the row in `locators/index.md`, and a dated `CHANGELOG.md` entry; `pnpm lint:markdown` passes.
- [ ] 2.9 Run the API lint, typecheck, and the focused suites; self-review the draft PR diff and fix findings before ready.
- [ ] 2.10 Run the GitHub review and CI loop on the published head.

## 3. Executor handle (`background-jobs/bash-executor`)

- [ ] 3.1 Add `startManagedBash` with `settled`, `snapshot()`, and `stop()`, and keep `executeManagedBash` as a wrapper; the existing `watch`, `recovery`, `acceptance`, and `contract` suites pass unchanged in behavior.
- [ ] 3.2 Replace the module counter with `BashProcessLimiter` and remove `resetManagedExecutorForTests`; move `execute.test.ts`, `recovery.test.ts`, `contract.test.ts`, `watch.test.ts`, `file-context.test.ts`, `acceptance.test.ts`, and `apps/api/src/tools/bash.test.ts` to their own limiter instances.
- [ ] 3.3 Add the `limit_reached` result member and wire the limiter into the host path and the `ssh://` path with a fixed capacity of 64; tests cover "Two commands in one step both run" and "A call past the bound is refused", and replace the pinned "Managed process limit reached." assertion.
- [ ] 3.4 Prove that a handle outlives the signals of its call: a test aborts the call signal and reads later output through `snapshot()`.
- [ ] 3.5 Add the `CHANGELOG.md` entry; run the package and API lint, typecheck, and `test:coverage` for `packages/bash-executor`; self-review before ready.
- [ ] 3.6 Run the GitHub review and CI loop on the published head.

## 4. Host bash jobs (`background-jobs/bash-jobs`)

- [ ] 4.1 Add `tools.bash.backgroundAfterSeconds`, `tools.bash.maxProcesses`, `tools.jobs.maxSeconds`, and `tools.jobs.allowUnlimited` to the type, the loader, the JSON Schema, and the example; tests cover every scenario of the three `instance-config` requirements.
- [ ] 4.2 Add `BashJobRegistry` and the `async` and `unlimited` input fields; tests cover "The background fields are accepted", "Model cannot widen execution", "A build starts in the background", "A remote directory refuses async", and "An unlimited job is refused by default".
- [ ] 4.3 Move a foreground command at the bound; tests with a fake clock cover "A long test suite passes the bound", "Output from before the move is kept", "A host command is not stopped at the foreground bound", and "A lower call timeout moves the command earlier".
- [ ] 4.4 Store output increments with redaction; tests cover "A quiet job writes nothing", "A stored line is readable within a second", and "A credential across two increments".
- [ ] 4.5 Settle a job in one transaction with its artifact; tests cover "A job continues after its Run completes", "A job continues after its Run fails", "A hung build ends at the lifetime", "A host command ends at the job lifetime", and "A resumed Run on another worker reads a job".
- [ ] 4.6 Stop a foreground command on a Run cancellation and keep a job; tests cover "Stop during a foreground command" and "Stop after the move".
- [ ] 4.7 End the jobs of a worker at shutdown; a test covers "A deploy ends a job".
- [ ] 4.8 Update `apps/api/src/prompts/tools/bash.md` and its exact-output test for "Description has the background instructions" and "A steer names its cause" (the fixed texts).
- [ ] 4.9 Update `docs/product/reference/tools/bash.md`, `docs/product/operator/native-files.md`, a new `docs/product/operator/background-jobs.md` with its link in `operator/index.md`, `SPEC.md`, and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 4.10 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 4.11 Run the GitHub review and CI loop on the published head.

## 5. Job control (`background-jobs/job-control`)

- [ ] 5.1 Add the `stop` tool, its prompt file, its reference page, and its permission group in the example and the fixtures; update the tests that count the code-owned tools. Tests cover "The model stops a monitor", "A settled job keeps its state", and the `stop` half of "A Run in read-only mode waits".
- [ ] 5.2 Add the `job-stop` signal and the heartbeat re-check; integration tests cover "A stop from the API reaches a dedicated worker", "The owner stops one of two jobs", "A stopped job names its stopper", "A stop that is not proved", and a lost signal that the heartbeat finds.
- [ ] 5.3 Request a stop for each live job when a Chat is deleted; a test covers "A deleted Chat leaves no process".
- [ ] 5.4 Add the yield signal: the `steer` kind on the control channel and the `background` fate for host `bash`; update `registry.test.ts`. Integration tests cover "A steer during a host command returns the call", "A steer during a tool call waits for the result" (`grep`), "A host command continues after an interrupt", "An interrupt kills a long command" (`ssh://`), "A read does not yield", "Two commands yield at one signal", "A steer reaches a dedicated worker", and "A lost signal delays the steer".
- [ ] 5.5 Update `docs/product/reference/tools/index.md`, `stop.md`, `permission-modes.md`, `tool-call-permissions.md`, `tool-prompts.md`, and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 5.6 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 5.7 Run the GitHub review and CI loop on the published head.

## 6. Notices (`background-jobs/notices`)

- [ ] 6.1 Admit the producer `job` and the mode `notice`, with the unique index; tests cover "A job item names its job", "A job that nobody waits on", "The owner cannot make a notice an interrupt", "A send cannot forge a notice", and "The owner drops a result".
- [ ] 6.2 Deliver notices at a step boundary and at the final answer; integration tests cover "A steer and a notice at one boundary", "A notice alone at one boundary", "A job settles during the final answer", "A job settles during a model response", and "A read keeps the notice".
- [ ] 6.3 Add the `job` context producer and its packaged template; tests cover "A notice for a failed build", "A notice for a job that the owner stopped", "Output that copies an envelope", "A long output is cut", and "A job notice follows the interrupted item".
- [ ] 6.4 Store host messages and exclude them from the title, the list preview, the search evidence, `conversation_read`, and the shared-fork sender rewrite; tests cover "A host message in the history", "A host message is not search evidence", and "A fork during a live job".
- [ ] 6.5 Start a Run on an idle Chat; integration tests cover "A monitor wakes the Chat at night", "Two jobs settle together", "A lost job starts no Run", and "The recorded mode is no longer enabled".
- [ ] 6.6 Take held notices into a send and a promoted item, and deliver them to a follow-up Run; tests cover "A result after a Stop waits for the owner", "A result after a failed Run waits for Continue", and "A Continue after a host-started Run failed".
- [ ] 6.7 Restate `llame_notify_change()` for `chat_jobs` in a manual migration with its header comment; an integration test receives `chat.upserted` with the new `runningJobs`.
- [ ] 6.8 Update `docs/product/reference`, `SPEC.md`, and `CHANGELOG.md` for notices and host messages; regenerate the API client; `pnpm lint:markdown` passes.
- [ ] 6.9 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 6.10 Run the GitHub review and CI loop on the published head.

## 7. Wait (`background-jobs/wait`)

- [ ] 7.1 Add `awaiting_jobs` in a migration of its own, then `wake_generation`, `current_job_id`, and `awaiting` on `runs`; regenerate `openapi.json`, the web client, and both live-protocol copies; `pnpm --filter api db:check` passes.
- [ ] 7.2 Add the `wait` tool, its prompt file, its reference page, and its permission group; tests cover both scenarios of `The wait tool names its jobs and a timeout`, "A settled job returns at once", and the `wait` half of "A Run in read-only mode waits".
- [ ] 7.3 Suspend a Run; integration tests cover "A wait frees the worker", "A Run that waits survives a worker restart", "A job settles just before the wait", "A wait beside a read in one step", and "A reload during a wait".
- [ ] 7.4 Add the wake update and the `wake` field of `RunJob`; regenerate the queue protocol. Integration tests cover "A settlement and a steer arrive together", "A late deadline job does nothing", "The wake enqueue is lost", and "A Run that waits ends its wait at the deadline".
- [ ] 7.5 Resume from the stored steps; integration tests cover "One of three jobs fails", "A steer ends a wait", "Another job ends a wait", "A waited job gives no notice", "A build fails while the Run waits", "A worker stops after the wake", and "A worker stops after the wake of a segment with a command".
- [ ] 7.6 Read the current job in admission and wake on a cancellation; tests cover "A Run that waits blocks a plain send", "A woken Run is judged by its recorded job", and "The owner cancels a Run that waits".
- [ ] 7.7 Update `docs/product/operator/scaling.md`, `docs/product/reference/tools/wait.md`, `SPEC.md`, and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 7.8 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 7.9 Run the GitHub review and CI loop on the published head.

## 8. Web (`background-jobs/web`)

- [ ] 8.1 Add the `background` sidebar state; component tests and stories cover "A monitor with no live Run" and "A Run that waits".
- [ ] 8.2 Add the Jobs section of the Session details panel; stories and tests cover "Stop all with no live Run" and "The composer Stop leaves jobs alone".
- [ ] 8.3 Render a pending notice and a host message; stories and tests cover "A host message in the transcript" and the delete-only row.
- [ ] 8.4 Add transcript rows for `wait`, `stop`, and the `backgrounded` result; run the Storybook MCP tests and return the preview URLs.
- [ ] 8.5 Add one focused product E2E: an `async` command, a notice that starts a Run, and a stop from the panel.
- [ ] 8.6 Remove the shipped items from `ROADMAP.md` and add the `CHANGELOG.md` entry; `pnpm lint:markdown` passes.
- [ ] 8.7 Run the web lint and typecheck; self-review before ready.
- [ ] 8.8 Run the GitHub review and CI loop on the published head.

## 9. Finalize (`background-jobs/finalize`)

- [ ] 9.1 Enter `background-jobs/finalize` with `$gh-stack` from the `web` top before `$openspec-sync-specs` writes.
- [ ] 9.2 Run `$openspec-sync-specs`; `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass.
- [ ] 9.3 Confirm archive readiness: `openspec status --change background-jobs --json` reports every artifact done, and every task above is checked.

## Workflow follow-up

- Run `$openspec-archive-change` after 9.3.
- Self-review and the GitHub review loop of the finalize PR follow the archive movement.
- Merge only through `$gh-stack`, with Leo's explicit permission.
