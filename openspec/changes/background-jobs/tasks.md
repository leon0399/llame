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
  <- background-jobs/output-capture
  <- background-jobs/job-persistence
  <- background-jobs/job-runtime
  <- background-jobs/job-recovery
  <- background-jobs/bash-async
  <- background-jobs/bash-move
  <- background-jobs/job-stop
  <- background-jobs/yield
  <- background-jobs/notices
  <- background-jobs/run-enqueue
  <- background-jobs/host-runs
  <- background-jobs/wait-suspend
  <- background-jobs/wait-resume
  <- background-jobs/web
  <- background-jobs/finalize
```

Each layer leaves `master` in a state that works. A layer that only prepares code for a later
one changes no behavior that the model or the owner can see.

| Layer             | Parent            | Owns                                                                                       | Visible change                                   | Estimate   | Issue             |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ | ---------- | ----------------- |
| `proposal`        | `master`          | The planning artifacts of this change.                                                     | none                                             | 3,250      | refs #1657        |
| `job-store`       | `proposal`        | The job tables, their isolation, the `job://` reader, the jobs API, and worker heartbeats. | `read job://`, the jobs API                      | 2,000      | refs #1657        |
| `bash-executor`   | `job-store`       | An executor handle that outlives its call, and the host process limiter.                   | 64 commands for each worker, `limit_reached`     | 1,500      | refs #1657, #1050 |
| `output-capture`  | `bash-executor`   | Redacted incremental handle snapshots, output subscriptions, and per-stream truncation.    | none                                             | 650        | refs #1657        |
| `job-persistence` | `output-capture`  | Atomic job settlement, output increments, artifacts, and database failure proof.           | none                                             | 850        | refs #1657        |
| `job-runtime`     | `job-persistence` | The registry, output capture, lifetime, and orderly worker shutdown.                       | none                                             | 1,950      | refs #1657        |
| `job-recovery`    | `job-runtime`     | Owner-scoped heartbeat stop checks and failed-settlement recovery.                         | none                                             | 350        | refs #1657        |
| `bash-async`      | `job-recovery`    | `async`, `unlimited`, background results, job settings, stop signals and Chat deletion.    | `bash` with `async: true`, effective owner stops | 1,900      | refs #1657, #1051 |
| `bash-move`       | `bash-async`      | The move of a foreground command at its bound.                                             | no kill at 120 s                                 | 1,500      | refs #1657, #1050 |
| `job-stop`        | `bash-move`       | The model-facing `stop` tool and its result/notice coordination.                           | `stop`                                           | 1,300      | refs #1657        |
| `yield`           | `job-stop`        | Calls that yield to a steer, and the interrupt fate for each call.                         | a steer or an interrupt moves a command          | 2,000      | refs #1657        |
| `notices`         | `yield`           | Job notices in the delivery queue, their context item, and host messages.                  | notices in a live Run                            | 2,000      | refs #1657        |
| `run-enqueue`     | `notices`         | Queue insertion through the caller's tenant transaction, with rollback and delay proof.    | none                                             | 750        | refs #1657        |
| `host-runs`       | `run-enqueue`     | Runs that the host starts, and held notices.                                               | a notice starts a Run                            | 1,800      | refs #1657        |
| `wait-suspend`    | `host-runs`       | `awaiting_jobs`, the wakers, the deadline job, and admission.                              | none                                             | 2,000      | refs #1657        |
| `wait-resume`     | `wait-suspend`    | The `wait` tool and the attempt after a wake.                                              | `wait`                                           | 2,000      | refs #1657        |
| `web`             | `wait-resume`     | The sidebar state, the Jobs section, and the transcript rows.                              | the owner controls                               | 1,800      | Closes #1657      |
| `finalize`        | `web`             | Spec synchronization, task records, and archive movement.                                  | none                                             | 0 authored | refs #1657        |

**Budget exception (named):** the `proposal` layer exceeds the 2,000-line review budget. The
deltas hold MODIFIED requirements in nine capabilities, and each must restate its canonical block
in full. Their size is recomputed at each revision: it was 21 requirements and about 1,200 lines
at the latest count, and `context-injection`, `durable-runs`, and `bash-execution` are the
largest. Leo approves or declines the exception with the proposal. The PR body holds the measured
size, and this text keeps no per-file figures that a later revision would make wrong.

**Delivery gate.** No layer is released or merged on its own. The layers `bash-async` through
`yield` promise a notice in the text of a `backgrounded` result, and the notices arrive in
`notices` (tasks 9.2 to 9.4) and `host-runs` (task 10). Those layers stay draft and not mergeable
until tasks 9.2 to 9.4 and task 10 are complete. The whole feature merges only with the explicit
merge permission of Leo. Native feature acceptance does not change, and no false promise reaches
released code.

**Estimates are first values.** The two closest shipped layers measured 4,390 authored lines
(segment delivery, #1641) and 5,503 (interrupt, #1646). The split above is finer than those
layers. Re-estimate each layer at its boundary. A layer that still exceeds the budget is split
again, or it gets a named exception before it is published.

Generated files count zero and are reported apart: the Drizzle snapshots,
`apps/api/openapi.json`, the Orval client, both live-protocol copies, and the queue protocol.

## 1. Proposal layer (`background-jobs/proposal`)

- [x] 1.1 Initialize the branch with `$gh-stack` before any artifact exists; `gh stack view --json` names `background-jobs/proposal` on `master`.
- [x] 1.2 Write `proposal.md`, `design.md`, the delta specs, and this file; `pnpm exec openspec validate background-jobs --strict` passes.
- [x] 1.3 Run two rounds of `$iterative-review-refinement` with two independent reviewers each, verify each finding, and commit each round apart; the revision history in `design.md` names each round.
- [x] 1.4 Run `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; all pass.
- [ ] 1.5 Self-review the draft PR diff against `REVIEW_GUIDE.md` and fix findings with new commits before the PR is marked ready. Round 2 did not converge, so run one more review round first.
- [ ] 1.6 Run the GitHub review and CI loop on the published head until every expected reviewer completes and CI passes.
- [ ] 1.7 Obtain Leo's approval of the published revision, of the three deviations, of the usage trade-off, and of the budget exception.

## 2. Job store (`background-jobs/job-store`)

- [ ] 2.1 Add `chat_jobs`, `chat_job_chunks`, and `worker_instances` with `pnpm db:generate` and hand-appended `FORCE ROW LEVEL SECURITY`; `pnpm --filter api db:check` passes and `pnpm db:provision-rls` succeeds.
- [ ] 2.2 Add the job repository with first-writer-wins settlement; integration tests cover "A late stop does not change a settled job" and the single settled state of "A settlement is recorded twice".
- [ ] 2.3 Add the worker heartbeat with an identity that is new at each start, and the dead-worker join; integration tests cover "A crash is found at the next message" (with a stale heartbeat row), "A lost job keeps its stored output", and "A job on a dead worker is not counted".
- [ ] 2.4 Reserve an artifact number for a job and add the transaction-scoped artifact commit that takes a reserved number; a test covers "The job and its artifact share a number" with rows that a fixture inserts.
- [ ] 2.5 Add the `job://` reader to `LOCATOR_READERS`, exclude the scheme from prompt imports, and lower the scheme in the permission projection; tests cover every scenario of `The read tool returns a job record`, `The read tool returns one output of a job`, `A bare job locator lists the jobs of the Chat`, `A job read renders as text`, "A locator of another Chat does not resolve", "A read group rejects job locators", and "An upper-case scheme does not pass a reject". Update `prompt-imports.test.ts`.
      The `prompt-imports` delta and its "A job marker stays prose" scenario preserve this exclusion.
- [ ] 2.6 Add `GET /api/v1/chats/:chatId/jobs`, the `PATCH` that records a stop request, and `runningJobs` on the chat list item and in `live-record-loader.ts`; tests cover "A stop of a settled job", "A repeated stop of a stopped job", and the 404 answers. Regenerate `openapi.json`, the web client, and both live-protocol copies; a second generation leaves a clean diff.
- [ ] 2.7 Add the negative isolation tests: "Another owner reads a job", "A query without an identity finds no job", "A query without an identity finds no stored output", "Another owner cannot stop a job", and a foreign `job://` read through the tool.
- [ ] 2.8 Add `docs/product/reference/locators/job.md`, the row in `locators/index.md`, the `read.md` locator row, and a dated `CHANGELOG.md` entry; `pnpm lint:markdown` passes.
- [ ] 2.9 Run the API lint, typecheck, and the focused suites; self-review the draft PR diff and fix findings before ready.
- [ ] 2.10 Run the GitHub review and CI loop on the published head.

## 3. Executor handle (`background-jobs/bash-executor`)

- [ ] 3.1 Add `startManagedBash` with `settled`, `snapshot()`, and `stop(cause)` that returns a `ManagedStopResult`, with no deadline and no call signal; keep `executeManagedBash` with its deadline. The existing `watch`, `recovery`, `acceptance`, and `contract` suites pass, and `apps/machine` type-checks with no change.
- [ ] 3.2 Prove the handle: tests cover a child that outlives `durationMs`, a call signal that aborts while `snapshot()` still returns later output, and `stop` with each cause that returns the captured streams.
- [ ] 3.3 Replace the module counter with `BashProcessLimiter` for the host and the `ssh://` path, and keep a limiter of `context.maxProcesses` inside `executeManagedBash`. Remove `resetManagedExecutorForTests` and move `execute.test.ts`, `recovery.test.ts`, `contract.test.ts`, `watch.test.ts`, `file-context.test.ts`, `acceptance.test.ts`, `apps/api/src/tools/bash.test.ts`, `ssh-bash.test.ts`, and `ssh-bash-execution.test.ts` to their own limiters.
- [ ] 3.4 Add `tools.bash.maxProcesses` to the type, the loader, the JSON Schema, and the example, and return `limit_reached` at the acquire site of the API; tests cover "Two commands in one step both run", "A call past the bound is refused", and the `maxProcesses` half of `Operator configuration bounds host commands`. Replace the pinned "Managed process limit reached." assertion. A Machine test proves that the daemon still answers `unavailable`.
- [ ] 3.5 Update `docs/product/reference/tools/bash.md` (bounds and errors) and `CHANGELOG.md`; run the package and API lint, typecheck, and `test:coverage` for `packages/bash-executor`; self-review before ready.
- [ ] 3.6 Run the GitHub review and CI loop on the published head.

## 3a. Output capture (`background-jobs/output-capture`)

This layer separates the executor's output capture from the registry that consumes it.
The split preserves the approved behavior and keeps runtime plus its unit proof within budget.

- [ ] 3a.1 Add output subscriptions, cached redacted snapshots, and per-stream truncation to the managed handle; test credential overlaps, split credentials, Unicode boundaries, and full-sanitizer equivalence.
- [ ] 3a.2 Run the executor lint, typecheck, build, and focused suites, including a real child whose snapshot grows while it runs; self-review before ready.
- [ ] 3a.3 Run the GitHub review and CI loop on the published head.

## 3b. Job persistence (`background-jobs/job-persistence`)

This layer owns the atomic database invariant, independently of the handle registry.
No tool starts a job here.

- [ ] 3b.1 Add `appendJobOutput`, `settleBashJob`, and bounded transaction retry; direct unit tests prove suffix offsets, first-writer-wins, Chat deletion, both retry classes, and exhaustion.
- [ ] 3b.2 Write the reserved job artifact in a savepoint and host files only after commit; direct real-database tests cover "A job artifact after the Run ended", "A short output creates no artifact", "A failed write keeps the stored increments", and "A record of a failed job".
- [ ] 3b.3 Run focused persistence unit and integration tests, API lint and typecheck; update `CHANGELOG.md`, then self-review the draft diff before ready.
- [ ] 3b.4 Run the GitHub review and CI loop on the published head.

## 4. Job runtime (`background-jobs/job-runtime`)

No tool starts a job in this layer. Its tests drive the registry directly.

- [ ] 4.1 Add `BashJobRegistry` with promotion of a handle to a job; a test covers the facts that it keeps and a promotion that fails and stops the command.
- [ ] 4.2 Store output increments with the safe cut of design D5; tests cover "A quiet job writes nothing", "A stored line is readable two seconds later", and "A credential across two increments" with the cut inside the value.
- [ ] 4.3 Map command exits and stop proof to settlement facts and call the persistence API; tests cover "A failing build settles as failed", "A survivor makes the outcome unknown", a command that a signal ends, and "A resumed Run on another worker reads a job". Keep failed settlement facts for later retry and preserve a row already settled lost.
- [ ] 4.4 Integrate the persistence layer's artifact policy with registry settlement; verify that captured output and the starting host-file decision reach the atomic settlement.
- [ ] 4.5 Add `tools.jobs.maxSeconds` and end a job at its lifetime; tests with a fake clock cover "A hung build ends at the lifetime", "A host command ends at the job lifetime", and the `maxSeconds` half of `Operator configuration bounds background jobs`.
- [ ] 4.6 Add `WorkerShutdownService` in a non-global module; tests cover "A deploy ends a job", "A shutdown with a pending settlement", "Shutdown cannot commit the known settlement", a command that arrives after shutdown began, and destroy order before the queue.
- [ ] 4.7 Update `SPEC.md`, `docs/product/reference/mutation-recovery.md`, and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 4.8 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 4.9 Run the GitHub review and CI loop on the published head.

## 4a. Worker recovery (`background-jobs/job-recovery`)

This layer wires the existing registry to heartbeat recovery without exposing a start tool.

- [ ] 4a.1 Install and detach the registry's heartbeat hook; retry pending immutable settlements before owner-scoped job checks, and keep checking other jobs after one read fails.
- [ ] 4a.2 Stop hosted work when its row is missing, has a recorded request, or is already settled; preserve an authoritative lost result. Unit tests cover healthy jobs, absent local handles, each stop cause, pending retries, and shutdown.
- [ ] 4a.3 Run focused recovery tests, API lint and typecheck; document the heartbeat behavior and self-review the draft diff before ready.
- [ ] 4a.4 Run the GitHub review and CI loop on the published head.

## 5. Async start (`background-jobs/bash-async`)

- [ ] 5.1 Add `bashTarget(context, input)` and the `async` and `unlimited` input fields, with `tools.jobs.allowUnlimited`; tests cover "The background fields are accepted", "Model cannot widen execution", "A build starts in the background", "A remote directory refuses async" (also a Machine Workspace call with no `cwd`), "An unlimited job is refused by default", and the rest of `Operator configuration bounds background jobs`.
- [ ] 5.2 Add the `backgrounded` member to the result union, `renderBashText`, and the stored part; tests cover "A backgrounded result has no exit line" and the fixed text.
- [ ] 5.3 Keep a job across the end of its Run; tests cover "A job continues after its Run completes", "A job continues after its Run fails", and "Stop after the move" for an `async` job.
- [ ] 5.4 Update `apps/api/src/prompts/tools/bash.md` and its exact-output tests for "Description has the background instructions" and "An absent tool is not recommended".
- [ ] 5.5 Update `docs/product/reference/tools/bash.md`, a new `docs/product/operator/background-jobs.md` with its link in `operator/index.md`, and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 5.6 Add the `job-stop` signal on top of heartbeat recovery; integration tests cover "A stop from the API reaches a dedicated worker", "The owner stops one of two jobs", "A stopped job names its stopper", "A stop that is not proved", a lost signal that the heartbeat finds, and "A worker resumes after its row was settled lost".
- [ ] 5.7 End each live job when a Chat is deleted: take the Chat row lock explicitly before the select of the live job ids, send the stop pointers in the deletion transaction, and stamp no request field, because the cascade removes the record; a test covers "A deleted Chat leaves no process".
- [ ] 5.8 Run the API lint, typecheck, and the focused suites; self-review before ready. Keep the PR draft and not mergeable until the delivery gate holds (tasks 9.2 to 9.4 and task 10 complete).
- [ ] 5.9 Run the GitHub review and CI loop on the published head.

## 6. Foreground move (`background-jobs/bash-move`)

- [ ] 6.1 Add `tools.bash.backgroundAfterSeconds` and give a `host` call separate Run-abort and timeout signals in the runner; tests cover the rest of `Operator configuration bounds host commands`, every scenario of `The call timeout caps the foreground bound of host bash`, and a per-call timeout that never rejects a host call as `outcome_unknown`.
- [ ] 6.2 Move a foreground command at the bound; tests with a fake clock cover "A long test suite passes the bound", "Output from before the move is kept", "A host command is not stopped at the foreground bound", and "The job record cannot be written".
      Also cover "A failed move with an unproved stop" and "A move that is recorded late".
      Assert exactly one `native.result` for a late move and that the command keeps running.
- [ ] 6.3 Keep the remote paths: tests cover "A remote command still ends at its deadline", "Proven-stopped timeout is known", and "Unproven stop after timeout is unknown and the Run continues" on a `machine://` directory.
- [ ] 6.4 Stop a foreground command on a Run cancellation; a test covers "Stop during a foreground command". Also cover "A cancellation during a pending move", "A cancellation before the move starts", and "A command exits during the move".
- [ ] 6.5 Update `docs/product/reference/tools/bash.md`, `docs/product/operator/native-files.md`, `docs/product/operator/background-jobs.md`, `docs/product/operator/scaling.md`, and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 6.6 Run the API lint, typecheck, and the focused suites; self-review before ready. Keep the PR draft and not mergeable until the delivery gate holds (tasks 9.2 to 9.4 and task 10 complete).
- [ ] 6.7 Run the GitHub review and CI loop on the published head.

## 7. Stop (`background-jobs/job-stop`)

- [ ] 7.1 Add the `stop` tool, its prompt file, its reference page, and its permission group in the example and the fixtures, and admit it as a host-capability tool; update the tests that count the code-owned tools. Tests cover "The model stops a monitor" (the `cancelled` entry), "A settled job keeps its state", "A stop that settles late", "Stop is advertised with bash", "Stop without host authority is not advertised", "A stop needs its own group", and a `stop` call in a Run whose mode is `read-only`.
- [ ] 7.4 Add the isolation test "A tool call cannot name a job of another owner" for `stop`.
- [ ] 7.5 Update `docs/product/reference/tools/index.md`, `stop.md`, `permission-modes.md`, `tool-call-permissions.md`, `tool-prompts.md`, and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 7.6 Run the API lint, typecheck, and the focused suites; self-review before ready, subject to the delivery gate.
- [ ] 7.7 Run the GitHub review and CI loop on the published head.

## 8. Yield (`background-jobs/yield`)

- [ ] 8.1 Add the `steer` kind on the control channel and the level-triggered yield signal of a segment; integration tests cover "A steer during a host command returns the call", "A steer during a tool call waits for the result" (`grep`), "A read does not yield", "Two commands yield at one signal", "A steer reaches a dedicated worker", "A lost signal delays the steer", "A steer names its cause", and a command that starts while a steer is pending.
      Cover a message-triggered promotion that exceeds its own 750 ms window without blocking delivery.
- [ ] 8.2 Decide the interrupt fate for each call from `bashTarget` and await `background` calls in `settleOnInterrupt`; update `registry.test.ts` and `tool-settlement.test.ts`. Integration tests cover "A host command continues after an interrupt", "An interrupt kills a long command" (`ssh://`), "A call that yields carries no interrupt marker", and an interrupt during a Machine Workspace call with no `cwd`.
- [ ] 8.3 Update `docs/product/reference` for steering during a command and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 8.4 Run the API lint, typecheck, and the focused suites; self-review before ready, subject to the delivery gate.
- [ ] 8.5 Run the GitHub review and CI loop on the published head.

## 9. Notices (`background-jobs/notices`)

- [ ] 9.1 Admit the producer `job` and the mode `notice`, with the unique index (`pnpm db:generate`, `db:check`), the delivery read, and the exclusions in `pauseBehind`, `firstPendingQueueItem`, and `changePendingMode`. Add the producer kind and the job fields to `ChatDeliveryResponse`, and regenerate `openapi.json`, the web client, and both live-protocol copies. Tests cover "A job item names its job", "The owner cannot make a notice an interrupt", "A send cannot forge a notice", "The owner drops a result", and a failed Run that leaves a notice a `notice`.
- [ ] 9.2 Insert the notice in the settlement transaction and signal a Run that executes; integration tests cover "A job that nobody waits on", the single notice of "A settlement is recorded twice", the withdrawn notice of "The model stops a monitor", "A steer and a notice at one boundary", "A notice alone at one boundary", "A job item between two steps gets a host message", "A delivery of one notice names its cause", "A notice from a job of another model", "A job settles during the final answer", "A job settles during a model response", "A read keeps the notice", and "A live Run learns of a crash at its next step".
      Cover "A late stop gets a notice", "A cancelled stop keeps the notice", and "A discarded stop result restores its notice".
      Persist exactly the consumed delivery ids as server-only tool-event metadata.
      Verify consumed ids stay outside `output` and are omitted by owner event and stream projections.
- [ ] 9.3 Add the `job` context producer, its packaged template, and the trigger row with no stored content; tests cover "A notice for a failed build", "A notice for a job that the owner stopped", "Output that copies an envelope", "A long output is cut", and "A job notice follows the interrupted item", a notice that names the host directory, and a provider request in which the earlier reply is still present.
- [ ] 9.4 Store host messages and skip them in the title, the list preview, the recency digest, the public projection, and the shared fork; tests cover "A host message in the history", "A host message is not search evidence", "A shared Chat shows no job output", "A host message is not copied into a shared fork", and "A fork during a live job".
- [ ] 9.5 Restate `llame_notify_change()` for `chat_jobs` in a manual migration with its header comment; an integration test receives `chat.upserted` with the new `runningJobs` and proves that another owner receives nothing. Also cover, with no job-row write, "An open socket sees a lease expire" (an explicit regression: the owner subscribes BEFORE the job starts), "A late heartbeat restores the count", "Only the remaining workers count", and "Another owner gets no projection", and a regression where a `NOTIFY` sends count 2, the lease then expires to 1, and the previous refresh value was also 1 (this fails with a wrong baseline), for the periodic projection refresh of `ChangeHub`. Add the operator note on its cost to `docs/product/operator/scaling.md`.
- [ ] 9.6 Update `docs/product/reference`, `SPEC.md`, and `CHANGELOG.md` for notices and host messages; `pnpm lint:markdown` passes.
- [ ] 9.7 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 9.8 Run the GitHub review and CI loop on the published head.

## 9a. Transactional Run enqueue (`background-jobs/run-enqueue`)

This layer supplies the atomic queue boundary before a host can create its first Run.
It changes no existing owner-started dispatch path.

- [ ] 9a.1 Add `EnqueueOptions.tx` and `RunDispatchService.enqueueInTransaction`; reuse the installed public pg-boss adapter with a compatible postgres.js row projection. Preserve parameter binding and throw when `send` returns `null`.
- [ ] 9a.2 Prove with real Postgres that rollback leaves no queue job, commit preserves the delayed start, and a duplicate id rejects instead of silently committing a missing enqueue.
- [ ] 9a.3 Run focused queue tests, API lint and typecheck; update `CHANGELOG.md` and self-review the parent-relative draft diff before ready.
- [ ] 9a.4 Run the GitHub review and CI loop on the published head.

## 10. Host-started Runs (`background-jobs/host-runs`)

- [ ] 10.1 Start a Run on an idle Chat with its first queue job in the settlement transaction; integration tests cover "A monitor wakes the Chat at night", "Two jobs settle together", "A lost job starts no Run", "The recorded mode is no longer enabled", "A host enqueue failure rolls back settlement", "A host worker crashes after commit", and an archived Chat that starts no Run. A wrong-owner settlement must create no host Run and consume no notice of another owner.
- [ ] 10.2 Take held notices into a send, a promoted item, and a mode change, deliver them to a follow-up Run, and return them to `pending` when a Run ends before its first dispatch; tests cover "A result after a Stop waits for the owner", "A result after a failed Run waits for Continue", the list of "A held notice alone does not label a paused queue", and a Run that fails before its dispatch.
- [ ] 10.3 Accept a follow-up Run on a host message; a test covers "A Continue after a host-started Run failed" and a Continue on a host message that a boundary delivered.
- [ ] 10.4 Update `docs/product/operator/background-jobs.md` and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 10.5 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 10.6 Run the GitHub review and CI loop on the published head.

## 11. Suspension (`background-jobs/wait-suspend`)

No tool suspends a Run in this layer. Its tests suspend a Run through the service.

- [ ] 11.1 Add `awaiting_jobs` in a migration of its own, then `wake_generation`, `current_job_id`, and `awaiting` on `runs`; regenerate `openapi.json`, the web client, and both live-protocol copies; `pnpm --filter api db:check` passes.
- [ ] 11.2 Add the suspension transaction with its retry, the `suspend` stop cause, and the end of `executeJob` on `awaiting_jobs`; integration tests cover "A wait frees the worker", "A Run that waits survives a worker crash", "A job settles just before the wait", and "A reload during a wait".
      Insert the deadline job in the suspension transaction and cover "A worker crashes right after a wait starts".
- [ ] 11.3 Add the wake update and the `wake` field of `RunJob`, using the existing transactional `enqueueInTransaction` from task 9a; regenerate the queue protocol. Tests cover the single winner of "A settlement and a steer arrive together", "A late deadline job does nothing", a `queue` item that does not wake, a dead-lettered job that is not current, and a settlement against Chat deletion with deadlock retry. Also cover "The deadline job is redelivered after its wake" and "A waker crashes after its commit".
      Cover "A failed wake insert leaves the Run waiting" and "A queue insert fails during a settlement"; retry worker terminal writes, Chat deletion, and admission as well as settlement.
      A `null` enqueue result throws and retries with a fresh id; the deadline waker reuses its existing job.
- [ ] 11.4 Read the current job in admission and wake on a cancellation; tests cover "A Run that waits blocks a plain send", "A woken Run is judged by its recorded job", and "The owner cancels a Run that waits". Also cover "A recorded job that is absent is stuck at once".
      An absent recorded job is stuck at once; the first-job enqueue retains its existing grace.
- [ ] 11.5 Anchor the budget at the first claim; a test covers "A Run passes its budget while it waits".
- [ ] 11.6 Update `docs/product/operator/scaling.md` and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 11.7 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 11.8 Run the GitHub review and CI loop on the published head.

## 12. Wait (`background-jobs/wait-resume`)

- [ ] 12.1 Add the `wait` tool with its sentinel, its prompt file, its reference page, and its permission group; tests cover both scenarios of `The wait tool names its jobs and a timeout`, "A settled job returns at once", "A wait result is one JSON object", "Two wait calls in one step", "A wait beside a read in one step", "A Run in read-only mode waits", and "A tool call cannot name a job of another owner" for `wait`.
- [ ] 12.2 Seed the first attempt after a wake with the `wait` tool part, in the collector, the request builder, the finalizer, and the step offset; integration tests cover "A wake does not restart the segment", "A build fails while the Run waits", the resumed step of "A settlement and a steer arrive together", a provider request that holds the `wait` call and its result, and a reload that shows the earlier steps once.
- [ ] 12.3 Compute the `wait` result and withdraw consumed notices in the transaction that records its tool result; integration tests cover "One of three jobs fails", "A steer ends a wait", "Another job ends a wait", "A waited job gives no notice", "The worker of a waited job crashes", "A Run that waits ends its wait at the deadline", and "A cancellation after a waited job settled keeps the notice".
- [ ] 12.4 Apply the retry rules after a wake; integration tests cover "A retry after a wake restarts a read-only segment", "A worker stops after the wake", "A worker stops after the wake of a segment with a command", and "A worker stops after a wait returned".
      Restore exactly the recorded consumed delivery ids; an owner-deleted notice stays withdrawn.
      Cover "A kept result does not restore its notice", plus budget, model-unavailable and dead-letter endings before wake pickup.
- [ ] 12.5 Pin the usage of a woken reply; a test proves that it sums the requests of the seeded attempt and is `complete: false`, and that the segment budget counts the earlier steps.
- [ ] 12.6 Update `docs/product/reference/tools/wait.md`, `tools/index.md`, `SPEC.md`, and `CHANGELOG.md`; `pnpm lint:markdown` passes.
- [ ] 12.7 Run the API lint, typecheck, and the focused suites; self-review before ready.
- [ ] 12.8 Run the GitHub review and CI loop on the published head.

## 13. Web (`background-jobs/web`)

- [ ] 13.1 Add the `background` sidebar state; component tests and stories cover "A monitor with no live Run" and "A Run that waits".
- [ ] 13.2 Add the Jobs section of the Session details panel; stories and tests cover "Stop all with no live Run" and "The composer Stop leaves jobs alone".
- [ ] 13.3 Render a pending notice and a host message; stories and tests cover "A host message in the transcript", the delete-only row, and the web half of "A held notice alone does not label a paused queue".
- [ ] 13.4 Add transcript rows for `wait`, `stop`, and the `backgrounded` result, with the `BashTool` output schema; run the Storybook MCP tests and return the preview URLs.
- [ ] 13.5 Add one focused product E2E: an `async` command, a notice that starts a Run, and a stop from the panel.
- [ ] 13.6 Remove the shipped items from `ROADMAP.md` and add the `CHANGELOG.md` entry; `pnpm lint:markdown` passes.
- [ ] 13.7 Run the web lint and typecheck; self-review before ready.
- [ ] 13.8 Run the GitHub review and CI loop on the published head.

## 14. Finalize (`background-jobs/finalize`)

- [ ] 14.1 Enter `background-jobs/finalize` with `$gh-stack` from the `web` top before `$openspec-sync-specs` writes.
- [ ] 14.2 Run `$openspec-sync-specs`; `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass.
- [ ] 14.3 Confirm archive readiness: `openspec status --change background-jobs --json` reports every artifact done, and every task above is checked.

## Workflow follow-up

- Run `$openspec-archive-change` after 14.3.
- Self-review and the GitHub review loop of the finalize PR follow the archive movement.
- Merge only through `$gh-stack`, with Leo's explicit permission.
