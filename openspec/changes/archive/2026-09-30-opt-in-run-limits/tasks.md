# Tasks

Track [#1038](https://github.com/leon0399/llame/issues/1038) and its PR through the delivery Project under [CONTRIBUTING.md](../../../CONTRIBUTING.md). Local drafting and commits do not change Project status. The follow-ups #1047–#1051 are out of scope.

**Named delivery exception (Leo, 2026-09-30):** this change ships as one PR on one branch. The proposal, the implementation, and finalize (spec sync and archive) are successive commits instead of a linear stack. The gates still apply in order:

- Implementation starts only after Leo approves the proposal revision.
- Spec sync and archive start only after the implementation tasks are verified.
- Publication and merge each need Leo's permission.

Use `$openspec-apply-change` for the implementation commits.

```text
(master) <- opt-in-run-limits   (one PR: proposal -> implementation -> finalize)
```

- Estimated size is about 1,100 authored lines against `master`: about 450 for the proposal and about 650 for code, tests, and docs. There is no migration or generated output. The PR uses `Closes #1038`.

## 1. Proposal

- [x] 1.1 Commit the proposal, design, delta specs, and this task list. Verify with `pnpm exec openspec validate opt-in-run-limits --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.
- [x] 1.2 Run `$iterative-review-refinement` with at least two independent reviewers. Verify each finding against the code or specs, and commit each round separately.
- [x] 1.3 Record Leo's approval of the final proposal revision before any implementation commit. Leo approved the revision after the first review round on 2026-09-30 ("after this review round - done").

## 2. Implementation

- [x] 2.1 Make the Run limits opt-in (design D1):
  - `runs.timeoutSeconds` and `tools.maxStepsPerRun` become `number | null`, default `null`, across the types, loader, published schema, example config, and `.env.example`.
  - `0`, negative, and fractional values fail startup, as does a `runs.timeoutSeconds` at or above the execution ceiling.
  - The example config uses `"timeoutSeconds": "{env:RUN_TIMEOUT_SECONDS:-}"` and omits `maxStepsPerRun`.
  - Verify with `config-loader.test.ts` and `schema.test.ts`: absent, `null`, and an empty-resolving token resolve to `null`; the committed example loads with both limits `null`; each rejected value names its path.
- [x] 2.2 Remove the default step cap from the model clients (design D1). `maxSteps: null` sets a `stopWhen` that never fires, keeps `prepareStep` forwarding `onStepStart` and its messages override, never calls `onCapReached`, and records no cap marker; clients pass `include: { requestBody: false }`. A configured cap keeps today's behaviour. Verify with unit tests that drive the production `applyToolCallingOptions` through a `MockLanguageModelV3`: an uncapped loop runs more than 100 tool steps with `onStepStart` firing on each, and a configured cap still stops. Update the test-only mock clients that copy `maxSteps ?? 8` (`run-execution-tools.integration.test.ts`, `scripted-model-client.ts`, `mcp-operator.integration.test.ts`, `run-usage-accounting.integration.test.ts`) to treat `null` as uncapped.
- [x] 2.3 Declare the runs queue's job duration and the worker's execution ceiling (design D2):
  - `QueueOptions.expireInSeconds` passes through `ensureQueue`'s create and update calls, and `runsQueueDefinition` declares 86,399 s.
  - The worker's per-attempt timer is `min(timeoutSeconds ?? ∞, 86,100 s)`, with a distinct `run-ceiling` abort reason classified `expired`. Every site that writes the expired message chooses it from the abort reason.
  - Delete the dead `timeoutMs` in `buildSystemReadContext`.
  - Verify with `pgboss-queue.service.test.ts` (the option shapes, and undeclared queues carry no `expireInSeconds`), `run-queues.test.ts`, `run-execution.service.test.ts` (the budget and ceiling messages at each writing site), and a `queue.integration.test.ts` case where a queue first created without an expiry is re-declared with one and a job enqueued afterwards reports that `expireInSeconds` through `getJobById`.
- [x] 2.4 Name each Run's job after the Run and judge admission by job state (design D3):
  - `Queue.enqueue` accepts `id`, and `Queue.jobState` returns the mapped state without the payload.
  - Dispatch enqueues with `id: runId`, `clearActiveRunSlot` applies the D3 table, and `stuckRunThresholdMs` is deleted.
  - Verify with `queue.integration.test.ts`: a named job's state, an absent id, and a reused id that creates no second job.
  - Verify with `chat-loop.integration.test.ts`:
    - an active blocker older than the old threshold gets 409;
    - a queued blocker gets 409;
    - a job-less blocker younger than one heartbeat gets 409;
    - a job-less, completed, or failed blocker older than that is expired and admitted;
    - **negative isolation:** another owner's Chat id neither expires that owner's live Run nor reaches `jobState`.
- [x] 2.5 Add the stream-idle watchdog middleware (design D4):
  - It is applied by every model client beside the usage callback.
  - It calls `model.doStream` with a linked abort signal, arms before that call, resets on each provider part, and fails with `ModelStreamIdleError` (`model_stream_idle`) both before headers and mid-stream.
  - Every client's error sanitizer passes `ModelStreamIdleError` through.
  - Run execution records the Run as terminally `failed` and keeps the observed parts, and the job succeeds without a retry.
  - Verify with unit tests using fake timers:
    - a stalled first part fires;
    - a stall between parts fires;
    - steady parts do not fire;
    - an aborted Run clears the timer;
    - a tool running longer than 300 s between two requests does not fire.
  - Verify through the real Anthropic and Codex sanitizers that the error keeps its code, and add one `run-execution` test proving the terminal `failed` state, `error.code`, and the `run.failed` payload code.
- [x] 2.6 Update the docs:
  - `docs/scaling.md`: Run limits, the execution ceiling, and the stream watchdog.
  - `CHANGELOG.md`: a dated entry marked **Breaking** for the defaults.
  - `ROADMAP.md`: remove the #1038 entry, if one exists.
  - Verify with `pnpm lint:markdown` and `pnpm format:check`.
- [x] 2.7 Run the implementation gates locally: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the affected unit and integration files, and `git diff --check`. Record the commands in the PR body.

## 3. Finalize

- [x] 3.1 After 2.1–2.7 are checked, run `$openspec-sync-specs`. Rewrite the `durable-runs` Purpose sentence so it names job-state admission and the opt-in budget instead of "age-based recovery" and the "in-process wall-clock budget". Verify each MODIFIED requirement word for word against the delta, then run `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [x] 3.2 Confirm `pnpm exec openspec status --change opt-in-run-limits --json` reports every artifact done and this list complete apart from 3.2. Then run `pnpm exec openspec archive opt-in-run-limits --skip-specs --yes` and commit the move separately.

After archive movement, and not as checkbox prerequisites:

- **SR (self-review before ready):** review the PR's full diff against `REVIEW_GUIDE.md` with one reviewer agent and one ponytail review, then fix the accepted findings.
- **GR (GitHub review):** mark the PR ready, then wait for current-head CI to go green. Per Leo, bot reviews do not gate.
