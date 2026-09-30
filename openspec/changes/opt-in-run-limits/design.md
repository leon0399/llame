# Design: opt-in Run limits

## Context

The proposal's Why section explains the motivation. Current code on `origin/master` at `953baea4`:

- **Wall clock.** `RunsWorkerService` arms `setTimeout(runs.timeoutSeconds)` with the reason `run-timeout` (`apps/api/src/runs/runs-worker.service.ts:225-228`). `classifyAbortedRun` maps that reason to `expired` (`run-execution.service.ts:414-429`). The built-in default is 900 s (`instance-config/llame-config.ts:562`).
- **Step cap.** `tools.maxStepsPerRun` defaults to 100 (`llame-config.ts:574`). `applyToolCallingOptions` enforces it through `prepareStep` and keeps `stopWhen = stepCountIs((maxSteps ?? 8) + 1)` as a backstop (`models/openai-model-client.ts:108-126`).
- **Queue.** `RUNS_QUEUE` declares no `expireInSeconds` (`runs/run-queues.ts:29-92`), so pg-boss 12.25 applies its 900 s default. That default is enforced in two places, both regardless of heartbeat freshness: a handler race (`pg-boss/dist/manager.js:421`) and a supervisor sweep (`plans.js:1814`). Queue options change only through `updateQueue`, because `createQueue` does nothing when the queue already exists (`queue/pgboss-queue.service.ts:75-121`). pg-boss asserts `expireInSeconds / 3600 < 24` (`attorney.js:401-404`).
- **Dispatch.** `RunDispatchService.dispatch` discards the job id `enqueue` returns (`runs/run-dispatch.service.ts:47-60`). Every accepted message creates a new Run row, and a same-message retry supersedes the old Run rather than re-dispatching it (`chats/chat-loop.service.ts:399-413`).
- **Admission.** `clearActiveRunSlot` runs inside the owner's `tenantDb.runAs` transaction. It judges a blocker by `now - (startedAt ?? createdAt) >= timeoutSeconds + heartbeatSeconds` (`chat-loop.service.ts:471-511`).
- **Model stream.** The model stream has no idle watchdog. `request-usage.ts:39-73` already wraps the provider model with a `wrapStream` middleware to observe each provider `finish` part.
- **System-origin reads.** Their `ToolContext.timeoutMs` is derived from `runs.timeoutSeconds` (`run-execution.service.ts:2299`).

## Goals / Non-Goals

**Goals:** a progressing Run is never ended by age or step count unless the operator configured a limit. The substrate never re-executes a live Run from its beginning. A dead or orphaned Run never wedges its Chat. A hung provider stream cannot hold a Chat forever.

**Non-goals:** a configurable watchdog duration, continuation or retry (#1047, #1049), Runs past 24 h (#1048), and tool-level limits (#1050, #1051).

## Decisions

### D1: `null` is unlimited, and it is the default

`runs.timeoutSeconds` and `tools.maxStepsPerRun` become `number | null`, with a built-in default of `null`. The loader resolves both with `nullable: true`. A literal or interpolated value must otherwise be a positive integer, and `0` fails startup rather than meaning unlimited, as in OpenClaw and Hermes. `runs.maxOutputTokens` is the existing nullable precedent in the same namespace.

A configured `runs.timeoutSeconds` at or above the execution ceiling (D2) fails startup naming the path. The operator would otherwise believe a budget applies that the ceiling silently truncates.

With no step cap, the tool loop must still let the model take as many steps as it requests. The AI SDK's default `stopWhen` is a single step, so omitting it is not an option. The model clients receive `maxSteps: null` for "no cap" and set `stopWhen` to a predicate that never fires. They skip the cap `prepareStep` and never call `onCapReached`. An answer-only turn (no tools declared) keeps its current single-step behaviour.

A system-origin read takes `tools.callTimeoutSeconds * 1000` as its deadline, the same rule as a model-issued tool call, because the Run budget can now be absent.

_Alternatives:_ a large finite default, such as OpenClaw's 48 h. Rejected: Leo decided on no default limits (Q1), and D2 already bounds the substrate. A string sentinel such as `"unlimited"`: rejected, because `null` already means unset elsewhere in this config.

### D2: The queue declares a job duration; the worker ends the Run before it

`QueueOptions` gains `expireInSeconds`, passed through `ensureQueue`'s `updateQueue` path. `runsQueueDefinition` declares 86,399 s, the largest integer pg-boss accepts. `RunsWorkerService` arms one timer for the effective limit, `min(runs.timeoutSeconds ?? ∞, EXECUTION_CEILING_SECONDS)`, where the ceiling is 86,100 s (23 h 55 m). When the ceiling wins, the abort reason is a distinct `run-ceiling`. `classifyAbortedRun` maps it to `expired` with the message "Run reached the 23 h 55 m execution ceiling." The 299 s gap gives the aborted Run time to settle its terminal state before pg-boss's own handler race fires.

The ceiling is a constant, not configuration. It exists only because of the substrate and moves when #1048 lands.

_Alternatives:_ no worker-side ceiling, letting pg-boss expire the job. Rejected: pg-boss would fail the job and retry it, re-executing the Run from scratch, which is exactly what #1038 reports.

### D3: The Run id is the job id; admission reads that job's state

`Queue.enqueue` accepts an optional caller-chosen `id`, forwarded as pg-boss's `JobOptions.id`. `Queue` gains `jobState(queue, id)`, which wraps `boss.getJobById` and maps pg-boss states to `queued | retrying | active | completed | failed | cancelled | absent`. It returns no payload. `RunDispatchService.dispatch` enqueues with `id: runId`.

`clearActiveRunSlot` keeps its RLS-scoped `findActiveByChatId`. For the blocking Run it asks `jobState(RUNS_QUEUE, blocking.id)`:

| Job state                            | Blocker age                   | Result                                                      |
| ------------------------------------ | ----------------------------- | ----------------------------------------------------------- |
| queued, retrying, active             | any                           | live: 409                                                   |
| absent                               | under `runs.heartbeatSeconds` | live: 409 (the enqueue may still be in flight after commit) |
| absent, completed, failed, cancelled | otherwise                     | stuck: expire, admit                                        |

The existing double-read of the blocker stays, so a blocker that finishes between reads is simply gone. `stuckRunThresholdMs` is deleted.

A stalled `active` job needs no heartbeat-age check. pg-boss already fails it through the heartbeat path and retries it, and the dead-letter consumer settles it once retries are exhausted. Admission only needs "can the queue still execute this Run?".

_Alternatives:_

- A `runs.job_id` column. Rejected: it needs a migration and a post-enqueue update, and it has a crash window between enqueue and update. Naming the job by the Run id removes both.
- An application heartbeat column updated during long tools, as Hermes and OpenClaw do. Rejected: `durable-runs` forbids an application-level liveness poll, and pg-boss already records the same signal.
- Reading `heartbeat_on` for `active` jobs. Rejected: it duplicates the substrate's own stall detection.

**Tenancy and threats.** `pgboss.job` is not under llame RLS. A caller can make admission read a job only by naming a Chat whose blocking Run is visible under the caller's `app.current_user_id`. The id read is that Run's own id, and the read returns only a state enum. It never scans, and it never returns another job or any payload. Threat: a forged Chat id for another owner's Chat. The Chat lookup under RLS fails first, and neither `jobState` nor `markFinished` runs. The negative integration test proves that another owner's Chat id neither expires that owner's live Run nor reaches `jobState`.

### D4: A stream-idle watchdog middleware around the provider model

`applyStreamIdleWatchdog(streamOptions, input)` is a sibling of `applyRequestUsageCallback` and wraps the model with `wrapLanguageModel`. Its `wrapStream`:

- Arms a 300 s timer before calling `doStream()`, so the wait for headers counts toward the first part.
- Resets the timer on every part the provider stream yields, and clears it when the stream ends, errors, or the Run's abort signal fires.
- On expiry, aborts the provider request through an `AbortController` linked into `params.abortSignal`, then errors the stream with a `ModelStreamIdleError` (code `model-stream-idle`).

Run execution classifies that error as a model-level failure: the Run ends terminally `failed`, its observed parts are kept, and the job succeeds without a queue retry. Every model client applies the middleware at the same point as the usage callback.

_Alternatives:_ the AI SDK's own `timeout: { chunkMs }` (ai 6.0.256). Rejected on two counts. It resets inside the step-level transform that also carries tool results (`ai/dist/index.mjs:7901`), so a tool running longer than 300 s would trip it. It is also not armed before the first chunk, so it misses a stalled request. A middleware on the provider stream measures only provider silence, which matches Codex, OpenCode and oh-my-pi, whose watchdogs run only while a model response is being read.

## Risks / Trade-offs

- **[Risk] A reasoning model that emits nothing for over 300 s before its first part fails with `model-stream-idle`.** → Mitigation: Codex and oh-my-pi run the same 300 s first-event limit against the same providers. Any stream part, metadata included, counts. If it is observed, a per-model override is a follow-up.
- **[Risk] A runaway tool loop with no configured cap spends tokens until the owner cancels.** → Mitigation: cancellation already works mid-Run, and operators can set `tools.maxStepsPerRun` or `runs.timeoutSeconds`. Loop detection is outside this change.
- **[Trade-off] During a worker outage a queued Run keeps its Chat blocked (409) until a worker returns.** It no longer expires after about 15 minutes. The queued work is not lost, and it runs as soon as a worker is back.
- **[Risk] Slow downstream consumption of stream parts counts toward the between-parts window,** because the provider stream is pulled with backpressure. → Mitigation: per-part persistence takes milliseconds, 300 s is a wide margin, and every reference harness measures the same way.
- **[Risk] Runs in flight during the deploy were enqueued under random job ids,** so their job reads as absent. → Mitigation: workers drain on shutdown (`durable-runs`, "Workers drain gracefully"). A Run that survives the drain is expired only by a later message to its own Chat, which is the stuck-run outcome it would reach anyway. Pre-launch, no compatibility shim.

## Migration Plan

- The runs queue's `expire_seconds` is updated in place by `ensureQueue` at boot.
- Operators relying on the old 900 s or 100-step defaults set them explicitly. `CHANGELOG.md` marks this **Breaking**.
- **Rollback:** reverting the release restores the old defaults. An explicitly configured `null` then fails startup under the old schema and must be removed. Named jobs remain valid pg-boss jobs.
