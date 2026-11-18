## Context

Inspected at `f7176c2e` (origin/master, 2026-11-18). Locked dependencies: `ai` 6.0.256,
`@ai-sdk/provider` 3.0.15, `@ai-sdk/provider-utils` 4.0.46, `@ai-sdk/anthropic` 3.0.118,
`@ai-sdk/openai` 3.0.97, `@ai-sdk/openai-compatible` 2.0.75, `pg-boss` 12.25.0.

**Wire clients and retries.** `createModelClient` (`apps/api/src/models/model-client-factory.ts:43-77`)
wraps every chat client in `withRedactedFailures` (`model-client-failures.ts:197-232`). Only the
Anthropic client sets `maxRetries: 0` (`anthropic-model-client.ts:99-105`, used at `:397` and
`:473`). The Responses, Codex, Chat Completions, and OpenCode Go clients and `generateToolBoundObject`
(`openai-model-client.ts:729`) pass nothing, so the AI SDK default of 2 applies. The SDK retry wraps
only `doStream` (`ai` `stream-text.ts:1716-1770`), retries 408, 409, 429, and 5xx, and uses a
`retry-after` only below 60 s; otherwise it waits 2 s and 4 s with no jitter. Embeddings, rerank,
and MCP already set 0; the decision client owns its loop (`decision-client.ts:45-48,402-421`).

**What the error keeps.** `sanitizeCodexError` (`openai-codex-model-client.ts:89-100`) and
`sanitizeAnthropicError` (`anthropic-model-client.ts:326-350`) keep only `statusCode`. The Chat
Completions client passes an `APICallError` through (`openai-completions-model-client.ts:298-326`),
but an in-stream envelope keeps only its message. The non-Codex Responses client forwards the raw
error. No code reads `responseHeaders` or `responseBody`. `redactModelFailure` never rewrites `name`
or `code` (`model-failure-redaction.ts:15`).

**The watchdog.** `STREAM_IDLE_TIMEOUT_MS = 300_000` (`stream-idle-watchdog.ts:16`) is both the first
window and the idle window. Every stream part re-arms it, metadata included (`:166-176`). It is
installed by `applyStreamIdleWatchdog` through `wrapLanguageModel` in the three wire builders
(`openai-model-client.ts:684`, `openai-completions-model-client.ts:495`, `anthropic-model-client.ts:415`).
A stream failure keeps a code only for `ModelStreamIdleError` (`run-execution.service.ts:4380-4381`).
`ModelContextExecutionError` writes `context_incompatible` or `model_context_incompatible`
(`:2109`, `model-context-errors.ts:2,11`). Every other failure writes `{ message }` to `runs.error`
(`schema/chats.ts`, jsonb) through `finishRun`.

**Requests.** `callStream` (`run-execution.service.ts:3692-4790`) runs one `streamText` per call; its
SDK tool loop sends one provider request per step, and `prepareStep` runs `onStepStart`, which
changes Run state (`:4043-4101`). Tool calls are tracked per attempt (`openToolCalls`, `:2584`) and
per `streamText` call by `ToolCallGate` (`tool-call-gate.ts:18-71`), which has no "any reached"
accessor. `model.requested` is appended once per attempt by `dispatchAttempt` (`:8796`), not per
request. After an error part with partial output the SDK still emits `finish-step` and `finish`
(`stream-text.ts:2131-2275`), and `onFinish` maps `finishReason: 'error'` to `failed` (`:910`).
Interrupt and withdrawal restarts call `callStream` with
`projectStoredReplyParts(collector.slice(partsBefore))` and an advanced `stepBase`
(`:3878-3889`, `:3927-3942`). `CompactionService` catches each summary failure and returns `null`
(`compaction.service.ts:381-391`, `:519-522`). Titles use `generateObject`, which calls `doGenerate`
(`title.service.ts:171`), so a `wrapStream` middleware does not see them.

**The wait machinery.** `awaiting_jobs` (migration `20261112150237_wonderful_mulholland_black`)
uses `runs.awaiting` (`AwaitingJobs`, `schema/chats.ts:27-32`), `wakeGeneration`, and
`currentJobId`. `RunWaitService.suspendInTransaction` (`run-wait.service.ts:80-162`) writes the
checkpoint and a `run.suspended` event and enqueues a `RUNS_QUEUE` job with `startAfter`
(`:400-443`). `persistWake` is one conditional update fenced on the generation (`:379-402`).
`pickupJob` (`runs-worker.service.ts:190-292`) handles the deadline wake, the cancel check, and the
budget from the first `run.started` event (`:249-272`). `chat-admission.ts:177` wakes an
`awaiting_jobs` Run on a steer or interrupt; `job-notices.ts:19` and `runs.controller.ts:157` branch
on the same literal; `run-status.ts:85-92` excludes it from claims. The waker queries filter
`status = 'awaiting_jobs'` (`run-wait.service.ts:266,284,308,385`), `resolveWakeCause` compares
`awaiting.deadline` (`:346`), and the drain check accepts only that status
(`runs-worker.service.ts:505-513`). The resume needs a `wait` tool call: `claimRun` calls
`completeWaitInTransaction` whenever `awaiting` is set (`run-execution.service.ts:1661-1667`), and
`wakeStateFromEvents` requires a `toolCallId` and a `tool.completed` result
(`wake-projection.ts:29,83-85,156-195`). `enqueueRun` throws for a Run with no `messageId`, so a
compaction Run cannot wait today. `runs` has forced RLS, and `migrate.ts:28-43` runs all pending
migrations in one transaction (`apps/api/src/db/AGENTS.md` P2).

**pg-boss retention.** `keep_until` is `start_after + retention` (14 days by default,
`pg-boss` `plans.js:1464`), maintenance deletes a `created` job only after `keep_until`
(`:2007-2014`), and `startAfter` has no maximum (`attorney.js:81-88`). An 8-day delayed job
therefore survives until it starts. llame sets no retention option (`queue.module.ts:24-40`).

**Owner surfaces.** `ChatLatestRunResponse.error` is the message only (`latest-run.dto.ts:74-81`),
and the SSE `errorText` drops the code (`run-stream-bridge.ts:444-470`). The web shows "Thinking…"
(`chat-message-row.tsx:491`) and the failed turn (`chat-transcript.tsx:232-268`). The sidebar treats
`awaiting_jobs` as `background` (`chat-item.tsx:247-257`, `app-sidebar-pinned.tsx:229-242`), and
`active-run-queries.ts:62` prefers any other status over it. No owner field names a provider
(`available-models/spec.md:45`); the web names a model with `modelDisplayName`
(`apps/web/lib/services/models/queries.ts:32`).

## Prior art

| Mechanism          | oh-my-pi (`de397d59`)                                                                             | Codex CLI (`e58bf8f5`)                        | AI SDK 6.0.256          | This change                                          |
| ------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------- | ---------------------------------------------------- |
| Backoff            | 500 ms base, 8 s cap, 25% downward jitter (`retry-fallback-chains.ts:89-97`)                      | 200 ms base, ±10% (`backoff.rs:7-15`)         | 2 s, 4 s, no jitter     | 500 ms, 8 s, full jitter                             |
| Count              | 10 (`settings.ts:790-793`)                                                                        | 4 request, 5 stream                           | 2                       | 10 for every transient class                         |
| Stated wait        | used up to `retry.maxDelayMs` 5 min, then fail fast (`turn-recovery.ts:3015-3025`)                | server delay wins                             | used below 60 s         | in process up to 60 s                                |
| Long reset         | in-process sleep, opt-in `waitForUsageReset`                                                      | terminal                                      | ignored                 | durable `awaiting_quota`                             |
| Grace, jitter, cap | 60 s, ±30%, 8 days (`anthropic-slow-mode.ts:97-101`)                                              | 0–30 s added jitter (`server_api.rs:337-348`) | none                    | 60 s, +0–18 s, 8 days                                |
| First event        | 300 s; any real event, reasoning included (`idle-iterator.ts:5-6,205-211`)                        | 300 s idle                                    | none                    | 300 s; content only                                  |
| Broken stream      | committed text is not replayed; a resume reminder, up to 3 (`turn-recovery.ts:736-800,1750-1757`) | stream retries                                | none                    | re-sent unless a tool call started; parts superseded |
| Classes            | regex over status and text (`flags.ts:230-233,506`)                                               | typed `CodexErr` (`error.rs:445-505`)         | `isRetryable` by status | per-wire status, body code, headers                  |

No source uses a 10 s in-process threshold; the nearest are 30 s (oh-my-pi maintenance) and 60 s
(AI SDK, oh-my-pi `fetchWithRetry`). No peer parks a Run durably.

## Goals / Non-Goals

Goals: the spec deltas of this change, for one exact model with no roles. Non-goals: those of the
proposal.

## Decisions

### D1: A `ProviderFailure` error carries the class

Each wire client builds a `ProviderFailure` (an `Error` with `code` = failure class, `resetsAt?`,
`hintMs?`) in its classifier, from the raw `APICallError` or the in-stream error event, before its
sanitizer runs. The sanitizer keeps these fields and replaces only the message. `code` survives
redaction (`CLASSIFICATION_KEYS`), and numeric fields are never rewritten. A failure that reaches
`RunExecutionService` without a `ProviderFailure` is `unknown`. A caller with its own code
(`ModelContextExecutionError`) keeps it. The compaction Run settlement
(`compaction-run.service.ts:207-216`) writes `code` and `resetsAt` like `RunExecutionService`.

Rejected: classifying in `RunExecutionService` from the message (Codex and Anthropic drop the body
first) and a second error channel beside the thrown error (two sources of truth).

### D2: One classifier module per wire family

`apps/api/src/models/provider-failure/` holds `classify-responses.ts` (OpenAI, Codex, Zen, and
OpenRouter on Responses), `classify-completions.ts` (OpenAI-compatible, OpenRouter, and Go),
`classify-anthropic.ts`, and a shared `reset-signals.ts`. Each is a pure function from status,
parsed body, headers, and in-stream error to a `ProviderFailure`.

Precedence: body code, then in-stream error type, then HTTP status, then transport. The body code is
`code`, `type`, and `details.error_code`, parsed from the raw `responseBody` or the error part. It
wins because both adapters invent a status: the Responses adapter's `getStatusCode` is a substring
heuristic that defaults to 500 (`@ai-sdk/openai` 3.0.97 `dist/index.js:176-205`), and the Anthropic
adapter throws a first-chunk SSE error as status 500 for every type but `overloaded_error`
(`@ai-sdk/anthropic` 3.0.118 `dist/index.js:5376-5392`). For an in-stream error, headers come from
the send's `doStream` `response.headers`, which the middleware keeps per send. On a Responses
pre-output frame the schema strips `resets_at` and `metadata` (`openai` `:3731-3799`), so an in-stream
Codex reset comes only from the `x-codex-*-reset-at` headers. A numeric OpenRouter in-stream
`error.code` reaches the classifier only on Chat Completions, which maps the number itself.

Provider-keyed rules (Codex, OpenCode Go, OpenRouter) live in `reset-signals.ts` and a shared
`provider-rules.ts`. Every wire classifier applies them for the client's `provider`, because a Go
model also runs on the Responses and Messages wires (`opencode-go-model-client.ts:86-103`). Each
rule gets a fixture per wire it can run on.

| Signal (first match in precedence order)                                                                                                                                                                                     | Class              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Codex `usage_limit_reached`; `GoUsageLimitError`; OpenRouter budget `limit_source` with non-null `resets_at`; Anthropic `enforced_spend_limit_reached`; OpenAI `*_spend_limit_exceeded`, `organization_usage_limit_exceeded` | `quota_exhausted`  |
| `insufficient_quota`, `credit_balance_exhausted`, `usage_not_included`; OpenRouter `openrouter_credits`, `openrouter_key_limit`, a budget with `resets_at: null`; a bare 402                                                 | `billing`          |
| OpenRouter `openrouter_in_flight_budget` (wins over 402); Anthropic `rate_limit_error`; `rate_limit_exceeded`, `slow_down`; other 429                                                                                        | `rate_limited`     |
| `overloaded_error`; 503, 529                                                                                                                                                                                                 | `overloaded`       |
| Anthropic `api_error`; 408, 500, 502, 504                                                                                                                                                                                    | `server_error`     |
| `model_not_found`; 404                                                                                                                                                                                                       | `model_not_found`  |
| a context-length code; Anthropic 400 `invalid_request_error` whose message starts with "prompt is too long"; 413 `request_too_large`                                                                                         | `context_overflow` |
| a content-policy code                                                                                                                                                                                                        | `content_policy`   |
| other 400, 422                                                                                                                                                                                                               | `invalid_request`  |
| 401, 403 without a budget or plan code; Go `MonthlyLimitError` (401, unverified)                                                                                                                                             | `auth`             |
| the fixed unreadable-event and redirect errors of `provider-api-selection`                                                                                                                                                   | `unknown`          |
| transport failure with no response, or a socket error after the headers and before content                                                                                                                                   | `unreachable`      |

Matching of the Go codes ignores case, as OpenCode does (`gousagelimiterror`). OpenAI
`*_spend_limit_exceeded` and `organization_usage_limit_exceeded` state no reset field, so as
`quota_exhausted` without `resetsAt` they fail at once; no inferred reset is added. The Anthropic
overflow row reads the message, because neither the status nor the type decides
between `invalid_request` and `context_overflow`. The research note on `research/provider-reset-signals`
holds the field sources; implementation re-reads them and copies no file from that branch.

### D3: Request recovery replaces the idle watchdog

`stream-idle-watchdog.ts` becomes `request-recovery.ts`, installed at the same three `wrapStream`
sites. A `wrapGenerate` variant with the same classification and retry loop, and no windows, wraps
the model in the structured builders (`generateToolBoundObject` at `openai-model-client.ts:829`,
`openai-completions-model-client.ts:551`, and `runAnthropicObject` at
`anthropic-model-client.ts:466`), so titles and structured generation get the same rules.

Per send, the stream middleware arms the first window (`firstTokenTimeoutSeconds` or 300 s). It
holds back every part until the first non-empty `text-delta` or `reasoning-delta`, or a
`tool-input-start`, `tool-call`, `file`, `source`, or `finish` part. It then releases them in order
and arms the 300 s stall window on every later part. An empty `reasoning-delta` that carries only a
signature is metadata.
Before that release, a retry is invisible: the middleware drops its held parts, reports
`model.retrying` through a callback on `ModelStreamInput` (only the Run's own requests pass one),
then sleeps the jittered or stated delay and calls `doStream` again. The SDK never sees the failure,
and `onStepStart` does not run twice. The middleware tracks the complete `tool-call` parts of its own
send, because `ToolCallGate` spans several sends.

Request recovery is installed before `applyRequestUsageCallback`, so it is the inner wrapper and
the usage wrapper sees one combined stream per request. The Responses and openai-compatible
adapters emit `finish` in `flush` even after an error (`openai` `dist/index.js:6878-6893`,
`openai-compatible` `:894-957`); recovery drops the `finish` of each failed send and forwards only
the final send's. A failed send therefore reports no usage on every wire. The
`run-usage-accounting` delta marks an attempt incomplete after any failed send whose usage it
discards, including a failure before content. Known request receipts remain a lower bound.

### D4: A failure after released parts restarts the step

The middleware cannot take back released parts: the SDK adds them to the step content and to the
messages of the next step. A transient failure after released parts, with no complete `tool-call`
part, therefore ends the stream with the `ProviderFailure`, a `superseded` flag, and the retry number
`n` so far.

Callers without live text or reasoning deliveries, including compaction, Codex titles, and hosted
search, do not need partial output delivered to the SDK. Their middleware holds the entire send
until it finishes successfully. It tracks content for the first window and complete tool calls
while it holds those parts. A transient failure with no complete tool call drops the buffer and
retries the same request inside the middleware, under the same retry budget. A complete tool call
still forbids a retry or a quota wait. Thus these callers have a recovery owner without the
Chat loop's `callStream` restart, and no incomplete signed reasoning enters a later request.

- **Anchor.** The middleware has no event access, and sequences are assigned at insert through the
  serialized `enqueueEvent` chain (`run-execution.service.ts:2331-2375`). A send that writes events
  is always the last send of its step, because held parts write none and a failure after release
  ends the step. So `onStepStart`, after its flushes, enqueues a chain step that stores
  `sendStartSequence = max(sequence) + 1`. `model.superseded { fromSequence, step }` carries that
  value and is appended through the same chain after the `onError` flushes. The window holds only
  the part events (`model.delta`, `reasoning.delta`) of that step.
- **Live view.** `run-stream-bridge.ts` maps each part event to the UI part id it opened. On
  `model.superseded` it closes the open text and reasoning parts and emits one
  `data-superseded { partIds }` chunk for the UI parts opened at or after `fromSequence`. The web
  `useChat` `onData` handler removes those parts. Reload replay emits the same chunk in order.
- **Settlement gate.** `onError` sets `stopCause = 'superseded'` and `nextCall`. `onFinish` returns
  right after `closeSegment()` (`run-execution.service.ts:4446`), before the text append at `:4463`,
  which would otherwise add the broken text back.
- **Restart.** `nextCall` is
  `callStream([...callMessages, ...projectStoredReplyParts(collector.slice(partsBefore)).messages],
  stepBase + brokenStepNumber)` with the retry number carried in, the pattern of the interrupt and
  withdrawal restarts. `partsBefore` keeps its meaning, the collector length at the `callStream`
  start (`:3697`), so steps 0 to k-1 of the call stay in the request. The broken output is removed
  from the collector from `stepResultStart` (`:4050`) first.
- **What is dropped.** Only the model output parts of the broken send: reasoning, text, and tool
  input. The in-Run context items that its `onStepStart` committed stay in the collector, and the
  restart does not stage them again. `streamedText`, `firstOutputDeltaMs`, `outputDeltaCount`, and
  the delta buffers roll back to the step start after a flush.

Rejected: buffering parts in the middleware until the send ends (it removes live streaming) and
keeping the partial parts (grilling Q1 B).

The first task of the `broken-streams` layer is a spike that proves the restart against the scripted
model client, with a break at step 0 and at a step k of 1 or more, before the event and web work.

### D5: The quota wait reuses `awaiting` as a tagged union

`runs.awaiting` becomes `{ kind: 'jobs', … } | { kind: 'quota', failureClass, resetsAt, wakeAt,
resumeAt, waitCount }`. `resumeAt` is `request`, `preDispatch`, `boundary`, `finalAnswer`, or
`compactionRun`: the point where the woken attempt picks up. Event payloads without `kind` are job
suspensions; only `runs.awaiting` is backfilled.

- **Migrations.** One generated migration adds the value with
  `ALTER TYPE "public"."run_status" ADD VALUE 'awaiting_quota' BEFORE 'completed'`. A second,
  custom migration tags each non-null `awaiting` with `kind: 'jobs'` between `NO FORCE ROW LEVEL
  SECURITY` and `FORCE ROW LEVEL SECURITY`, with the SQL-comment header that
  `apps/api/src/db/AGENTS.md` requires. Both run in one transaction (`migrate.ts:28-43`); neither
  uses the new value, and no later migration in the same batch may.
- **Entry.** `RunWaitService.suspendForQuota` writes the status, `awaiting`, the generation, the
  deadline job, and a `run.suspended { kind: 'quota', attemptId, generation, failureClass, resetsAt,
  wakeAt, resumeAt, waitCount, parts, steps }` in one attempt-fenced transaction. `attemptId` serves
  `suspendedByThisAttempt` (`:3615-3622`), and `generation` pairs the event with its
  `run.resumed { kind: 'quota', attemptId, generation, cause }`. The checkpoint holds the parts and
  steps without the failed send.
  After the commit, `onError` sets `stopCause = 'suspend'`, and `onFinish` returns at the D4 gate. A
  quota failure after released parts first appends `model.superseded`, as in D4.
- **Compaction.** `summarizeCheckpoint` rethrows a `ProviderFailure` that needs a quota wait
  instead of returning `null`, and so does the catch in `prepareBoundaryCompaction`
  (`run-execution.service.ts:7248-7264`). The callers map to `resumeAt`: `deliverAtBoundary`
  (`:3770`) to `boundary`, the final-answer compaction in `settleRun` (`:4573-4592`) to
  `finalAnswer`, and `deliverWakeCompaction` (`:7417`) and the pre-dispatch trigger (`:7552`) to
  `preDispatch`. `enqueueRun` gets a path for a Run with no `messageId`, which a compaction Run
  needs.
- **Consumers that branch on `kind`.** `run-wait-completion.ts:17-48,104-121`,
  `wake-projection.ts:29,143,156-195`, `run-execution.service.ts:1661-1682,3615`,
  `run-reply-finalizer.ts:452-475` (`wakeReplyRecovery`, which must use the quota projection so a
  settler without the collector keeps the pre-wait parts), and the D7 budget sum.

Rejected: a new column (#1776 Q5 settled reuse) and a generic waiting status with a cause (#1776
Q5).

### D6: The wake

`wakeAt = resetsAt + 60 s + random(0, 18 s)`; the deadline job is a `RUNS_QUEUE` job with
`startAfter = wakeAt`. Wakers are the deadline job (cause `timeout`) and cancellation (cause
`cancelled`).

Sites that change:

- `readWakeCandidate`, `lockWakeRun`, and `persistWake` take `status IN ('awaiting_jobs',
  'awaiting_quota')`; `resolveWakeCause` compares `wakeAt` for a quota wait.
- `pickupJob` (`runs-worker.service.ts:226`) wakes both statuses on the deadline job; the drain
  check (`:505-513`) accepts both; `claimableRunPredicate` (`run-status.ts:89`) excludes both.
- `runs.controller.ts:157` wakes both on cancellation.
- `notifyLiveRunSteering` (`chat-admission.ts:177-187`) returns early for `awaiting_quota`, and
  the inverted check in `job-notices.ts:19` sends no steer signal to it. `wakeForChatInTransaction`
  skips it because `lockChatAwaitingRun` (`run-wait.service.ts:497-513`) stays `awaiting_jobs`-only;
  do not widen that query. A steer, an interrupt, or a notice therefore stays pending.
- `claimRun` gets a quota branch: it clears `awaiting` under the attempt fence, appends no tool
  result, and rebuilds with a `quotaWakeStateFromEvents` that restores the checkpoint parts and
  steps. It then resumes at `resumeAt`: `request` calls `callStream`, `preDispatch` runs preparation
  again, `boundary` runs the boundary compaction and delivery, and `finalAnswer` runs the boundary
  summary and settles `completed` with the checkpoint. For a compaction Run, no reply prefix is
  needed, but the claim returns its quota request's `resumeAt`, `waitCount`, and generation;
  `CompactionRunService` replans with that same counter.

The wait count belongs to one logical request, not to an interval between Run part events. A new
request starts with zero waits. Entry stores `waitCount + 1` in `awaiting` and `run.suspended`.
The counter projection reads the latest quota suspension not closed by `run.quota_recovered`,
independently of the first-wake-only reply-prefix projection. It returns `resumeAt`, `waitCount`,
and generation both on the first wake claim and on a redelivery after `awaiting` was cleared.
Thus a worker death or a compaction replan cannot turn that request into a new allowance.
A failure ends the request when its counter is already 4.

After that request succeeds, append `run.quota_recovered { generation, resumeAt }` before a later
request starts. For a summary, write it with checkpoint publication; for a step, write it through
the ordered event chain when the successful step settles. That marker ends the counter even when
the summary emitted no part events. A crash before that durable success boundary retains the
same counter. No new column or request identifier is needed.

### D7: The budget excludes quota waits by events

`pickupJob` computes the budget deadline from the first `run.started` plus the budget plus the sum
of each quota `run.suspended` (filtered on `kind: 'quota'`) to its next `run.resumed`. The wake has
already appended `run.resumed` when the sum is read. No column is added. `runGuarded` uses that
deadline for its abort timer.

### D8: Owner surfaces

The `quota-wait` layer adds `awaiting_quota` to the DTO enums and regenerates OpenAPI, the orval
models, and both `live-protocol.ts` copies, because the web parses `run.updated` with a strict
`z.enum`. The same layer adds `awaiting_quota` to the status reducer (`active-run-queries.ts:62`)
and both sidebar checks. `stopOrInterrupt` (`use-chat-delivery.ts:403-419`) calls
`cancelRun(latestRun.id)` when `latestRun.status === 'awaiting_quota'`, before its steer branch.

The `quota-wait-web` layer adds `quotaWait: { failureClass, resetsAt, wakeAt } | null` to
`RunResponse`, `ChatLatestRunResponse`, and `ActiveRunResponse`. It adds `errorCode` and
`errorResetsAt` to `ChatLatestRunResponse`; they mirror `error.code` and `error.resetsAt` and are
null unless the Run failed. The `run.failed` SSE chunk keeps `errorText`.

The web adds a `QuotaWaitNotice` in the `pending` slot of `ChatComposer`, above `PendingDeliveries`
(`chat-page.tsx:415`, `chat-composer.tsx:451-459`). It reads "_Model name_ usage limit reached" for
`quota_exhausted` or "_Model name_ rate limit reached" for `rate_limited`, then "Sends again at _local time_ · in _countdown_", and has a Stop button bound to
`cancelRun`. The countdown ticks each second under one hour and each minute above it. After `wakeAt`
it reads "Sending again…". The retry line replaces the "Thinking…" shimmer with "Retrying after
_label_ (n/10)", where the label maps each class to plain words, such as `overloaded` to "provider
overload". The failed turn, or the error row of a compaction Run, appends "Resets at _local time_"
when `errorResetsAt` is set.

### D9: Side calls

Title generation and structured generation run through the `wrapGenerate` variant, except on
Codex, whose client has no structured builder (`generateObject: false`), so its titles use
`streamText` (`title.service.ts:191`) and the stream middleware. Hosted web search also uses the
stream middleware. None passes a `model.retrying` callback. A reset time above
60 s fails them. `model-hosted.ts` maps the class to an engine class in place of its status switch.
A model-switch compaction on the earlier model is a side call, and its failure keeps the canonical
code `context_incompatible`.

### D10: Configuration

`runs.quotaWaitMaxSeconds` and `models[].firstTokenTimeoutSeconds` join the raw types, the defaults
(`llame-config.ts:648,825`), the schema (`llame.config.schema.json:716-750,1016-1033`), the loader,
and `worker-harness.ts`. `firstTokenTimeoutSeconds` reaches the client config through
`model-client-factory.ts` like `maxOutputTokens`.

## Risks / Trade-offs

- [A hung provider holds a Run for about 55 minutes before it fails, grilling Q3] → Leo chose this;
  the retry line shows each retry, and Stop works throughout.
- [The D4 restart misses a piece of attempt state] → the spike task compares the step counters, the
  stored snapshot, and the in-Run item positions with a run that never broke.
- [A classifier misreads a body and parks a Run on a reset that is not one] → reset times come only
  from the named fields; a fixture per row of the D2 table; the 8-day cap; Stop.
- [pg-boss retention changes in a later upgrade] → a test inserts an 8-day delayed job and reads
  `keep_until`.
- [Many Runs wake at one Codex reset] → the 18 s jitter spreads them; each wake is one claim.
- [The removal of `model_stream_idle` breaks a consumer that matches it] → no web or live code reads
  it; the changelog names the removal.
- [A superseded send was billed] → its usage is unknown, and the attempt usage is marked incomplete.
- [An attached tab polls the Run row for up to 8 days, two queries per `POLL_MS`] → the bridge backs
  its poll off to a keepalive while the Run is `awaiting_quota`.
- [A content-filter or empty finish ends the first window] → it is not a failure, so no retry runs;
  #1756 Q3 names only content parts, and the finish part is added so such a send cannot hang.

## Threats

The change reads response headers and bodies that it ignored before. A classifier keeps only the
class, a reset instant, and a hint in milliseconds; no header or body text reaches a Run, an event,
a log, or an owner. The quota wait reads and writes the owner's Run under the RLS-scoped
transactions, and `quotaWait` is part of a Run read that is already owner-scoped. The backfill
migration lifts forced RLS only for its own statement. Each owner-facing layer adds a negative test
where a second owner reads the waiting Run and gets 404.

## Migration Plan

The two migrations of D5 run in one transaction. The generated enum migration has no
`IF NOT EXISTS`, so it is not idempotent; the migration ledger prevents a second run. Rollback after
deploy: cancel every Run in `awaiting_quota` before the code that knows the status is removed; the
enum value stays, as Postgres cannot drop one.

## Open Questions

None. Each grilling decision is recorded in the proposal.

## Revision history

- **v1 (2026-11-18, `516fe4f8`):** Initial draft.
- **v2 (2026-11-18):** Review round 1. Spec review: 2 P0, 15 P1, 17 P2. Feasibility review: 3 P0,
  10 P1, 9 P2. Fixes: a per-send `model.superseded` anchor (`fromSequence`), since
  `model.requested` is per attempt; a quota branch of `claimRun` with `resumeAt`, since the wait
  resume needs a tool call; the backfill under `NO FORCE` RLS and the one-transaction migration
  fact; held parts before the first content part; the `onFinish` settlement gate; the restart
  through projected parts with an advanced `stepBase` and a carried retry number; in-Run items kept
  across a restart; `wrapGenerate` for titles and structured output; compaction failures rethrown
  for the wait; the D2 precedence, in-stream rows, and OpenRouter rows; the wait count per request
  from events; the full list of `awaiting_jobs` sites. Spec deltas added for `tool-calling` (a quota
  wake is not a retry), `durable-runs` "Received reasoning is durable before browser delivery", and
  `run-usage-accounting` (a superseded send makes usage incomplete). The Stop rule, the class of an
  error after content, any started tool call blocking a retry, the short quota retry, the per-request
  wait count, the cap ending the request under its caller rule, the compaction scope, the
  `model.retrying` scope, and a long hint failing only `rate_limited` were tightened. The `quota-wait`
  layer now regenerates the enums and ships the sidebar and Stop; compaction waits move to their own
  layer. Rejected: none.
- **v3 (2026-11-18):** Review round 2. Spec review: 0 P0, 7 P1, 14 P2. Feasibility review: 1 P0,
  9 P1, 10 P2. Fixes: the D4 restart keeps `partsBefore` at the `callStream` start and removes the
  broken output from `stepResultStart`; the `onFinish` gate moves before the text append; the anchor
  moves into the `onStepStart` event chain; a `data-superseded` bridge chunk drops live parts;
  recovery sits inside the usage wrapper and drops the `finish` of failed sends; the quota
  `run.suspended` payload carries `attemptId` and `generation`; `finalAnswer` joins `resumeAt`, and
  the `prepareBoundaryCompaction` catch rethrows; web Stop cancels a quota wait before its steer
  branch; provider-keyed rules apply on every wire; D2 names where the body code and headers come
  from and adds rows; `wakeReplyRecovery` uses the quota projection; the wait count reads part
  events. Spec: the projection says "send"; a started tool call blocks the quota wait; a finish,
  file, or source part ends the first window; the tool-call rule and the watchdog defer to the
  caller rule; llame's bounded errors are `unknown`; the compaction Run writes its class; the wire
  deltas say "can make the Run wait"; new scenarios for the live drop, a title retry, a switch
  compaction, a compaction Run on `auth`, and a usage limit after a tool call. Not converged: this
  was the last round Leo asked for before the draft PR, and it still changed substance.
- **v4 (2026-11-18):** Verified published-review corrections, without another iterative review
  round: record the retry event before its delay; mark hidden failed sends incomplete; scope the
  wait counter to the logical request and restore it through the quota checkpoint; hold complete
  sends for non-live consumers so their middleware owns post-content recovery; state the wake
  exception to the later-attempt reset and supersede quota-failed output before suspension.
  These corrections preserve the approved retry, wait, and signed-reasoning outcomes.
- **v5 (2026-11-18):** Verified three contract gaps from published feedback. Added the non-live
  buffering rule to the normative delta and kept signed live-send supersession explicit. Specified
  quota suspension/wake payloads, including `resumeAt`. Separated durable counter recovery from
  first-wake reply-prefix recovery and added a generation-matched `run.quota_recovered` success
  marker, so worker redelivery and compaction replanning preserve the four-wait bound. No new column
  or request identifier; no change to approved wait or retry limits.
- **v6 (2026-11-18):** Scoped reasoning durability to deltas released for live delivery,
  preserving the approved whole-send buffer for non-live callers. Scoped legacy kind-less
  payload interpretation to suspension and resumption events, not the quota recovery marker.
  Both are consistency corrections; retry, waiting, and signed-reasoning decisions are unchanged.
