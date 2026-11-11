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
  <- background-jobs/bash-background
  <- background-jobs/job-settlement
  <- background-jobs/job-stop
  <- background-jobs/yield
  <- background-jobs/notices
  <- background-jobs/host-runs
  <- background-jobs/wait-suspend
  <- background-jobs/wait-resume
  <- background-jobs/web
  <- background-jobs/finalize
```

| Layer             | Parent            | Owns                                                                                       | Estimate   | Issue             |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------ | ---------- | ----------------- |
| `proposal`        | `master`          | The planning artifacts of this change.                                                     | 3,400      | refs #1657        |
| `job-store`       | `proposal`        | The job tables, their isolation, the `job://` reader, the jobs API, and worker heartbeats. | 2,000      | refs #1657        |
| `bash-executor`   | `job-store`       | An executor handle that outlives its call, and the host process limiter.                   | 1,500      | refs #1657, #1050 |
| `bash-background` | `bash-executor`   | The move of a host command to the background, its result, and its settings.                | 2,000      | refs #1657, #1051 |
| `job-settlement`  | `bash-background` | Stored output, the settlement of a job, its lifetime, and the end of a worker.             | 2,000      | refs #1657, #1050 |
| `job-stop`        | `job-settlement`  | The `stop` tool, the stop signal, and the stop at Chat deletion.                           | 1,300      | refs #1657        |
| `yield`           | `job-stop`        | Calls that yield to a steer, and the per-call interrupt fate.                              | 2,000      | refs #1657        |
| `notices`         | `yield`           | Job notices in the delivery queue, their context item, and host messages.                  | 2,000      | refs #1657        |
| `host-runs`       | `notices`         | Runs that the host starts, and held notices.                                               | 1,800      | refs #1657        |
| `wait-suspend`    | `host-runs`       | `wait`, `awaiting_jobs`, the wakers, and the deadline job.                                 | 2,000      | refs #1657        |
| `wait-resume`     | `wait-suspend`    | The attempt after a wake: its reply, its stream, its usage, and its retries.               | 2,000      | refs #1657        |
| `web`             | `wait-resume`     | The sidebar state, the Jobs section, and the transcript rows.                              | 1,800      | Closes #1657      |
| `finalize`        | `web`             | Spec synchronization, task records, and archive movement.                                  | 0 authored | refs #1657        |

**Budget exception (named):** the `proposal` layer exceeds the 2,000-line review budget. The
reason is eleven MODIFIED requirements that must restate their canonical blocks: 203 lines in
`bash-execution`, 161 in `durable-runs`, 124 in `context-injection`, 85 in `tool-calling`, 55 in
`tool-result-rendering`, 41 in `owner-chat-forks`, and about 110 in `run-steering` and
`ssh-locator`. Leo approves or declines the exception with the proposal. The measured size is in
the PR body.

**Estimates are first values.** The two closest shipped layers measured 4,390 authored lines
(segment delivery, #1641) and 5,503 (interrupt, #1646). The split above is finer than those
layers. Re-estimate each layer at its boundary. A layer that still exceeds the budget is split
again, or it gets a named exception before it is published.

Generated files count zero and are reported apart: the Drizzle snapshots,
`apps/api/openapi.json`, the Orval client, both live-protocol copies, and the queue protocol.

## 1. Proposal layer (`background-jobs/proposal`)

- [x] 1.1 Initialize the branch with `$gh-stack` before any artifact exists; `gh stack view --json` names `background-jobs/proposal` on `master`.
- [x] 1.2 Write `proposal.md`, `design.md`, the delta specs, and this file; `pnpm exec openspec validate background-jobs --strict` passes.
- [ ] 1.3 Run two rounds of `$iterative-review-refinement` with two independent reviewers each, verify each finding, and commit each round apart; the revision history in `design.md` names each round.
- [ ] 1.4 Run `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; all pass.
- [ ] 1.5 Self-review the draft PR diff against `REVIEW_GUIDE.md` and fix findings with new commits before the PR is marked ready.
- [ ] 1.6 Run the GitHub review and CI loop on the published head until every expected reviewer completes and CI passes.
- [ ] 1.7 Obtain Leo's approval of the published revision, of the three deviations, and of the budget exception.

## 2. Job store (`background-jobs/job-store`)

- [ ] 2.1 Add `chat_jobs`, `chat_job_chunks`, and `worker_instances` with `pnpm db:generate` and hand-appended `FORCE ROW LEVEL SECURITY`; `pnpm --filter api db:check` passes and `pnpm db:provision-rls` succeeds.
- [ ] 2.2 Add the job repository with first-writer-wins settlement; integration tests cover "A late stop does not change a settled job" and "A settlement is recorded twice" (one settled state).
- [ ] 2.3 Add the worker heartbeat with an identity that is new at each start, and the dead-worker join; integration tests cover "A crash is found at the next message" (with a stale heartbeat row), "A lost job keeps its stored output", and "A job on a dead worker is not counted".
- [ ] 2.4 Reserve an artifact number for a job and add the transaction-scoped artifact commit that takes a reserved number; a test covers "The job and its artifact share a number" with rows that a fixture inserts.
- [ ] 2.5 Add the `job://` reader to `LOCATOR_READERS`, exclude the scheme from prompt imports, and lower the scheme in the permission projection; tests cover every scenario of `The read tool returns a job record`, `The read tool returns one output of a job`, `A bare job locator lists the jobs of the Chat`, `A job read renders as text`, "A locator of another Chat does not resolve", "A read group rejects job locators", and "An upper-case scheme does not pass a reject". Update `prompt-imports.test.ts`.
- [ ] 2.6 Add `GET /api/v1/chats/:chatId/jobs`, the `PATCH` that records a stop request, and `runningJobs` on the chat list item and in `live-record-loader.ts`; tests cover "A stop of a settled job", the repeated request, and the 404 answers. Regenerate `openapi.json`, the web client, and both live-protocol copies; a second generation leaves a clean diff.
- [ ] 2.7 Add the negative isolation tests: "Another owner reads a job", "A query without an identity finds no job", "A query without an identity finds no stored output", "Another owner cannot stop a job", and a foreign `job://` read through the tool.
- [ ] 2.8 Add `docs/product/reference/locators/job.md`, the row in `locators/index.md`, the `read.md` locator row, and a dated `CHANGELOG.md` entry; `pnpm lint:markdown` passes.
- [ ] 2.9 Run the API lint, typecheck, and the focused suites; self-review the draft PR diff and fix findings before ready.
- [ ] 2.10 Run the GitHub review and CI loop on the published head.

## 3. Executor handle (`background-jobs/bash-executor`)

- [ ] 3.1 Add `startManagedBash` with `settled`, `snapshot()`, and `stop(cause)`, with no deadline and no call signal; keep `executeManagedBash` with its deadline. The existing `watch`, `recovery`, `acceptance`, and `contract` suites pass, and `apps/machine` type-checks with no change.
- [ ] 3.2 Prove the handle: tests cover a child that outlives `durationMs`, a call signal that aborts while `snapshot()` still returns later output, and `stop` with each cause that returns the captured streams.
- [ ] 3.3 Replace the module counter with `BashProcessLimiter` for the host and the `ssh://` path, with a fixed capacity of 64, and keep a limiter of `context.maxProcesses` inside `executeManagedBash`. Remove `resetManagedExecutorForTests` and move `execute.test.ts`, `recovery.test.ts`, `contract.test.ts`, `watch.test.ts`, `file-context.test.ts`, `acceptance.test.ts`, `apps/api/src/tools/bash.test.ts`, `ssh-bash.test.ts`, and `ssh-bash-execution.test.ts` to their own limiters.
- [ ] 3.4 Map the host and `ssh://` refusal to `limit_reached` in the API; tests cover "Two commands in one step both run" and "A call past the bound is refused", and replace the pinned "Managed process limit reached." assertion. A Machine test proves that the daemon still answers `unavailable`.
- [ ] 3.5 Add the `CHANGELOG.md` entry; run the package and API lint, typecheck, and `test:coverage` for `packages/bash-executor`; self-review before ready.
- [ ] 3.6 Run the GitHub review and CI loop on the published head.

## 4. Background move (`background-jobs/bash-background`)

- [ ] 4.1 Add `tools.bash.backgroundAfterSeconds`, `tools.bash.maxProcesses`, `tools.jobs.maxSeconds`, and `tools.jobs.allowUnlimited` to the type, the loader, the JSON Schema, and the example, and wire the limiter capacity; tests cover every scenario of the three `instance-config` requirements.
- [ ] 4.2 Give a host `bash` call separate Run-abort and timeout signals in the runner; a test proves that the per-call timeout never rejects a host call as `outcome_unknown`, and that an `ssh://` call keeps one composed signal ("A remote command still ends at its deadline", "Proven-stopped timeout is known", "Unproven stop after timeout is unknown and the Run continues").
- [ ] 4.3 Add `BashJobRegistry` and the `async` and `unlimited` input fields; tests cover "The background fields are accepted", "Model cannot widen execution", "A build starts in the background", "A remote directory refuses async", and "An unlimited job is refused by default".
- [ ] 4.4 Move a foreground command at the bound; tests with a fake clock cover "A long test suite passes the bound", "Output from before the move is kept", "A host command is not stopped at the foreground bound", and "A lower call timeout moves the command earlier", and a promotion that fails and stays in the foreground.
- [ ] 4.5 Add the `backgrounded` member to the result union, `renderBashText`, and the stored part; tests cover "A backgrounded result has no exit line" and the fixed text for the cause `time`.
- [ ] 4.6 Update `apps/api/src/prompts/tools/bash.md` and its exact-output test for "Description has the background instructions".
- [ ] 4.7 Update `docs/product/reference/tools/bash.md`, `docs/product/operator/native-files.md`, a new `docs/product/operator/background-jobs.md` with its link in `operator/index.md`, and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 4.8 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 4.9 Run the GitHub review and CI loop on the published head.

## 5. Settlement (`background-jobs/job-settlement`)

- [ ] 5.1 Store output increments with the safe cut of design D5; tests cover "A quiet job writes nothing", "A stored line is readable two seconds later", and "A credential across two increments" with the cut inside the value.
- [ ] 5.2 Settle a job in one retried transaction, in the Run-then-Chat lock order; tests cover "A failing build settles as failed", "A survivor makes the outcome unknown", "A job continues after its Run completes", "A job continues after its Run fails", and "A resumed Run on another worker reads a job".
- [ ] 5.3 Write the job artifact in a savepoint; tests cover "A job artifact after the Run ended", "A short output creates no artifact", and "A failed write keeps the stored increments".
- [ ] 5.4 End a job at its lifetime; tests with a fake clock cover "A hung build ends at the lifetime" and "A host command ends at the job lifetime".
- [ ] 5.5 Stop a foreground command on a Run cancellation and keep a job; tests cover "Stop during a foreground command" and "Stop after the move".
- [ ] 5.6 Add `WorkerShutdownService` and its order before the queue stop; a test covers "A deploy ends a job" and a command that arrives after the shutdown began.
- [ ] 5.7 Update `SPEC.md`, `docs/product/reference/mutation-recovery.md`, `docs/product/operator/scaling.md`, and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 5.8 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 5.9 Run the GitHub review and CI loop on the published head.

## 6. Stop (`background-jobs/job-stop`)

- [ ] 6.1 Add the `stop` tool, its prompt file, its reference page, and its permission group in the example and the fixtures, and admit it as a host-capability tool; update the tests that count the code-owned tools. Tests cover "The model stops a monitor", "A settled job keeps its state", "Stop is advertised with bash", "Stop without host authority is not advertised", "A stop needs its own group", and a `stop` call in a Run whose mode is `read-only`.
- [ ] 6.2 Add the `job-stop` signal and the heartbeat re-check; integration tests cover "A stop from the API reaches a dedicated worker", "The owner stops one of two jobs", "A stopped job names its stopper", "A stop that is not proved", and a lost signal that the heartbeat finds.
- [ ] 6.3 Request a stop for each live job when a Chat is deleted; a test covers "A deleted Chat leaves no process".
- [ ] 6.4 Add the isolation test "A tool call cannot name a job of another owner" for `stop`.
- [ ] 6.5 Update `docs/product/reference/tools/index.md`, `stop.md`, `permission-modes.md`, `tool-call-permissions.md`, `tool-prompts.md`, and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 6.6 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 6.7 Run the GitHub review and CI loop on the published head.

## 7. Yield (`background-jobs/yield`)

- [ ] 7.1 Add the `steer` kind on the control channel and the yield signal of a segment; integration tests cover "A steer during a host command returns the call", "A steer during a tool call waits for the result" (`grep`), "A read does not yield", "Two commands yield at one signal", "A steer reaches a dedicated worker", "A lost signal delays the steer", and "A steer names its cause".
- [ ] 7.2 Decide the interrupt fate per call and await `background` calls in `settleOnInterrupt`; update `registry.test.ts` and `tool-settlement.test.ts`. Integration tests cover "A host command continues after an interrupt", "An interrupt kills a long command" (`ssh://`), and "A call that yields carries no interrupt marker".
- [ ] 7.3 Update `docs/product/reference` for steering during a command and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 7.4 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 7.5 Run the GitHub review and CI loop on the published head.

## 8. Notices (`background-jobs/notices`)

- [ ] 8.1 Admit the producer `job` and the mode `notice`, with the unique index (`pnpm db:generate`, `db:check`), the delivery read, and the exclusions in `pauseBehind`, `firstPendingQueueItem`, and `changePendingMode`; tests cover "A job item names its job", "A job that nobody waits on", "The owner cannot make a notice an interrupt", "A send cannot forge a notice", "The owner drops a result", and a failed Run that leaves a notice a `notice`.
- [ ] 8.2 Insert the notice in the settlement transaction and signal a Run that executes; integration tests cover "A steer and a notice at one boundary", "A notice alone at one boundary", "A delivery of one notice names its cause", "A job settles during the final answer", "A job settles during a model response", "A read keeps the notice", and "A live Run learns of a crash at its next step".
- [ ] 8.3 Add the `job` context producer, its packaged template, and the trigger row with no stored content; tests cover "A notice for a failed build", "A notice for a job that the owner stopped", "Output that copies an envelope", "A long output is cut", and "A job notice follows the interrupted item", and a provider request in which the earlier reply is still present.
- [ ] 8.4 Store host messages and skip them in the title, the list preview, the recency digest, the public projection, and the shared fork; tests cover "A host message in the history", "A host message is not search evidence", "A shared Chat shows no job output", "A host message is not copied into a shared fork", and "A fork during a live job".
- [ ] 8.5 Restate `llame_notify_change()` for `chat_jobs` in a manual migration with its header comment; an integration test receives `chat.upserted` with the new `runningJobs` and proves that another owner receives nothing.
- [ ] 8.6 Update `docs/product/reference`, `SPEC.md`, and `CHANGELOG.md` for notices and host messages; regenerate the API client; `pnpm lint:markdown` passes.
- [ ] 8.7 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 8.8 Run the GitHub review and CI loop on the published head.

## 9. Host-started Runs (`background-jobs/host-runs`)

- [ ] 9.1 Start a Run on an idle Chat; integration tests cover "A monitor wakes the Chat at night", "Two jobs settle together", "A lost job starts no Run", and "The recorded mode is no longer enabled".
- [ ] 9.2 Take held notices into a send, a promoted item, and a mode change, and deliver them to a follow-up Run; tests cover "A result after a Stop waits for the owner", "A result after a failed Run waits for Continue", and "A held notice alone does not label a paused queue" (API side: the list).
- [ ] 9.3 Accept a follow-up Run on a host message; a test covers "A Continue after a host-started Run failed" and a Continue on a host message that a boundary delivered.
- [ ] 9.4 Update `docs/product/operator/background-jobs.md` and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 9.5 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 9.6 Run the GitHub review and CI loop on the published head.

## 10. Wait and suspension (`background-jobs/wait-suspend`)

- [ ] 10.1 Add `awaiting_jobs` in a migration of its own, then `wake_generation`, `current_job_id`, and `awaiting` on `runs`; regenerate `openapi.json`, the web client, and both live-protocol copies; `pnpm --filter api db:check` passes.
- [ ] 10.2 Add the `wait` tool, its prompt file, its reference page, and its permission group; tests cover both scenarios of `The wait tool names its jobs and a timeout`, "A settled job returns at once", "A wait result is one JSON object", "A Run in read-only mode waits", and "A tool call cannot name a job of another owner" for `wait`.
- [ ] 10.3 Suspend a Run with the sentinel and the `suspend` stop cause; integration tests cover "A wait frees the worker", "A Run that waits survives a worker crash", "A job settles just before the wait", "A wait beside a read in one step", and "A reload during a wait".
- [ ] 10.4 Add the wake update, the dispatch variant with a job id, and the `wake` field of `RunJob`; regenerate the queue protocol. Integration tests cover "A settlement and a steer arrive together", "A late deadline job does nothing", "The wake enqueue is lost", "A Run that waits ends its wait at the deadline", "A Run passes its budget while it waits", a `queue` item that does not wake, and a dead-lettered stale job that does not expire the Run.
- [ ] 10.5 Read the current job in admission and wake on a cancellation; tests cover "A Run that waits blocks a plain send", "A woken Run is judged by its recorded job", and "The owner cancels a Run that waits".
- [ ] 10.6 Update `docs/product/operator/scaling.md`, `docs/product/reference/tools/wait.md`, and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 10.7 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 10.8 Run the GitHub review and CI loop on the published head.

## 11. Resumed attempt (`background-jobs/wait-resume`)

- [ ] 11.1 Seed the first attempt after a wake from `run.suspended` in `continueStateFromEvents`, the finalizer, the stream bridge, and the step offset; integration tests cover "A wake does not restart the segment", "A build fails while the Run waits", and a reload that shows the earlier steps and the `wait` result.
- [ ] 11.2 Compute the `wait` result and withdraw consumed notices; integration tests cover "One of three jobs fails", "A steer ends a wait", "Another job ends a wait", "A waited job gives no notice", and "The worker of a waited job crashes".
- [ ] 11.3 Carry the usage and the step count across the wait; a test proves that the reply usage holds the tokens of both attempts and that the segment budget counts the earlier steps.
- [ ] 11.4 Apply the retry rules after a wake; integration tests cover "A retry after a wake restarts a read-only segment", "A worker stops after the wake", and "A worker stops after the wake of a segment with a command".
- [ ] 11.5 Update `SPEC.md` and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 11.6 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 11.7 Run the GitHub review and CI loop on the published head.

## 12. Web (`background-jobs/web`)

- [ ] 12.1 Add the `background` sidebar state; component tests and stories cover "A monitor with no live Run" and "A Run that waits".
- [ ] 12.2 Add the Jobs section of the Session details panel; stories and tests cover "Stop all with no live Run" and "The composer Stop leaves jobs alone".
- [ ] 12.3 Render a pending notice and a host message; stories and tests cover "A host message in the transcript", the delete-only row, and "A held notice alone does not label a paused queue".
- [ ] 12.4 Add transcript rows for `wait`, `stop`, and the `backgrounded` result, with the `BashTool` output schema; run the Storybook MCP tests and return the preview URLs.
- [ ] 12.5 Add one focused product E2E: an `async` command, a notice that starts a Run, and a stop from the panel.
- [ ] 12.6 Remove the shipped items from `ROADMAP.md` and add the `CHANGELOG.md` entry; `pnpm lint:markdown` passes.
- [ ] 12.7 Run the web lint and typecheck; self-review before ready.
- [ ] 12.8 Run the GitHub review and CI loop on the published head.

## 13. Finalize (`background-jobs/finalize`)

- [ ] 13.1 Enter `background-jobs/finalize` with `$gh-stack` from the `web` top before `$openspec-sync-specs` writes.
- [ ] 13.2 Run `$openspec-sync-specs`; `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass.
- [ ] 13.3 Confirm archive readiness: `openspec status --change background-jobs --json` reports every artifact done, and every task above is checked.

## Workflow follow-up

- Run `$openspec-archive-change` after 13.3.
- Self-review and the GitHub review loop of the finalize PR follow the archive movement.
- Merge only through `$gh-stack`, with Leo's explicit permission.
