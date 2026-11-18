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
(`ModelContextExecutionError`) keeps it.

Rejected: classifying in `RunExecutionService` from the message (Codex and Anthropic drop the body
first) and a second error channel beside the thrown error (two sources of truth).

### D2: One classifier module per wire family

`apps/api/src/models/provider-failure/` holds `classify-responses.ts` (OpenAI, Codex, Zen, and
OpenRouter on Responses), `classify-completions.ts` (OpenAI-compatible, OpenRouter, and Go),
`classify-anthropic.ts`, and a shared `reset-signals.ts`. Each is a pure function from status,
parsed body, headers, and in-stream error to a `ProviderFailure`.

Precedence: body code, then in-stream error type, then HTTP status, then transport. The body code
wins because the Responses adapter reports an unrecognized pre-output error frame as status 500
(`@ai-sdk/openai` 3.0.97, near `createOpenAIStreamError`), so a Codex `usage_limit_reached` frame
would otherwise be retried as `server_error`. A numeric OpenRouter in-stream `error.code` is read as
the status.

| Signal (first match in precedence order)                                                                                                                                                                                     | Class              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Codex `usage_limit_reached`; `GoUsageLimitError`; OpenRouter budget `limit_source` with non-null `resets_at`; Anthropic `enforced_spend_limit_reached`; OpenAI `*_spend_limit_exceeded`, `organization_usage_limit_exceeded` | `quota_exhausted`  |
| `insufficient_quota`, `credit_balance_exhausted`, `usage_not_included`; OpenRouter `openrouter_credits`, `openrouter_key_limit`, a budget with `resets_at: null`                                                             | `billing`          |
| OpenRouter `openrouter_in_flight_budget` (wins over 402); Anthropic `rate_limit_error`; `rate_limit_exceeded`, `slow_down`; other 429                                                                                        | `rate_limited`     |
| `overloaded_error`; 503, 529                                                                                                                                                                                                 | `overloaded`       |
| Anthropic `api_error`; 408, 500, 502, 504                                                                                                                                                                                    | `server_error`     |
| `model_not_found`; 404                                                                                                                                                                                                       | `model_not_found`  |
| a context-length code; Anthropic 400 `invalid_request_error` whose message starts with "prompt is too long"; 413 `request_too_large`                                                                                         | `context_overflow` |
| a content-policy code                                                                                                                                                                                                        | `content_policy`   |
| other 400, 422                                                                                                                                                                                                               | `invalid_request`  |
| 401, 403 without a budget or plan code                                                                                                                                                                                       | `auth`             |
| transport failure with no response, or a socket error after the headers and before content                                                                                                                                   | `unreachable`      |

The Anthropic overflow row reads the message, because neither the status nor the type decides
between `invalid_request` and `context_overflow`. The research note on `research/provider-reset-signals`
holds the field sources; implementation re-reads them and copies no file from that branch.

### D3: Request recovery replaces the idle watchdog

`stream-idle-watchdog.ts` becomes `request-recovery.ts`, installed at the same three `wrapStream`
sites. A `wrapGenerate` variant with the same classification and retry loop, and no windows, wraps
the model in the structured builders (`generateToolBoundObject` at `openai-model-client.ts:829`,
`openai-completions-model-client.ts:551`, and `runAnthropicObject` at
`anthropic-model-client.ts:466`), so titles and structured generation get the same rules.

Per send, the stream middleware arms the first window (`firstTokenTimeoutSeconds` or 300 s). It
holds back every part until the first `text-delta`, `reasoning-delta`, `tool-input-start`, or
`tool-call` part, then releases them in order and arms the 300 s stall window on every later part.
Before that release, a retry is invisible: the middleware drops its held parts, sleeps the jittered
or stated delay, reports `model.retrying` through a callback on `ModelStreamInput` (only the Run's
own requests pass one), and calls `doStream` again. The SDK never sees the failure, and
`onStepStart` does not run twice. The middleware tracks the complete `tool-call` parts of its own
send, because `ToolCallGate` spans several sends.

A failed send reports no usage, because `onRequestUsage` fires only on a `finish` part
(`request-usage.ts:87-96`). The `run-usage-accounting` delta marks such an attempt incomplete.

### D4: A failure after released parts restarts the step

The middleware cannot take back released parts: the SDK adds them to the step content and to the
messages of the next step. A transient failure after released parts, with no complete `tool-call`
part, therefore ends the stream with the `ProviderFailure`, a `superseded` flag, and the retry number
`n` so far.

- **Anchor.** At each send start the middleware records the next event sequence of the Run.
  `model.superseded { fromSequence }` names that sequence. The finalizer, the rebuild, and the live
  client drop each part event from `fromSequence` to the `model.superseded` event.
- **Settlement gate.** `onError` sets `stopCause = 'superseded'` and `nextCall`. `onFinish` returns
  before any terminal write, as it does for `stopCause === 'suspend'`
  (`run-execution.service.ts:4489-4504`).
- **Restart.** `nextCall` is
  `callStream([...callMessages, ...projectStoredReplyParts(collector.slice(partsBefore)).messages],
  stepBase + brokenStepNumber)` with the retry number carried in, the pattern of the interrupt and
  withdrawal restarts. `partsBefore` is the collector length at the broken step start.
- **What is dropped.** Only the model output parts of the broken send: reasoning, text, and tool
  input. The in-Run context items that its `onStepStart` committed stay in the collector, and the
  restart does not stage them again. `streamedText`, `firstOutputDeltaMs`, `outputDeltaCount`, and
  the delta buffers roll back to the step start after a flush.

Rejected: buffering parts in the middleware until the send ends (it removes live streaming) and
keeping the partial parts (grilling Q1 B).

The first task of the `broken-streams` layer is a spike that proves the restart against the scripted
model client before the event and web work.

### D5: The quota wait reuses `awaiting` as a tagged union

`runs.awaiting` becomes `{ kind: 'jobs', … } | { kind: 'quota', failureClass, resetsAt, wakeAt,
resumeAt }`. `resumeAt` is `request`, `preDispatch`, `boundary`, or `compactionRun`: the point where
the woken attempt picks up.

- **Migrations.** One generated migration adds the value with
  `ALTER TYPE "public"."run_status" ADD VALUE 'awaiting_quota' BEFORE 'completed'`. A second,
  custom migration tags each non-null `awaiting` with `kind: 'jobs'` between `NO FORCE ROW LEVEL
  SECURITY` and `FORCE ROW LEVEL SECURITY`, with the SQL-comment header that
  `apps/api/src/db/AGENTS.md` requires. Both run in one transaction (`migrate.ts:28-43`); neither
  uses the new value, and no later migration in the same batch may.
- **Entry.** `RunWaitService.suspendForQuota` writes the status, `awaiting`, the generation, the
  deadline job, and a `run.suspended { kind: 'quota', failureClass, resetsAt, wakeAt, parts, steps }`
  in one attempt-fenced transaction. The checkpoint holds the parts and steps without the failed
  send. A quota failure after released parts first appends `model.superseded`, as in D4.
- **Compaction.** `summarizeCheckpoint` rethrows a `ProviderFailure` that needs a quota wait
  instead of returning `null`. Each caller suspends with its `resumeAt`. `enqueueRun` gets a path
  for a Run with no `messageId`, which a compaction Run needs.
- **Consumers that branch on `kind`.** `run-wait-completion.ts:17-48,104-121`,
  `wake-projection.ts:29,143,156-195`, `run-execution.service.ts:1661-1682,3615`, and the D7 budget
  sum.

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
- `chat-admission.ts:177`, `job-notices.ts:19`, and `wakeForChatInTransaction` skip
  `awaiting_quota`, so a steer, an interrupt, or a notice stays pending.
- `claimRun` gets a quota branch: it clears `awaiting` under the attempt fence, appends no tool
  result, and rebuilds with a `quotaWakeStateFromEvents` that restores the checkpoint parts and
  steps. It then resumes at `resumeAt`: `request` calls `callStream`, `preDispatch` runs preparation
  again, `boundary` runs the boundary compaction and delivery, and `compactionRun` sends the summary.

The wait count is the number of quota `run.suspended` events since the last request of the Run that
the model answered. The first wait is 0; a failure that would make it 4 ends the request.

### D7: The budget excludes quota waits by events

`pickupJob` computes the budget deadline from the first `run.started` plus the budget plus the sum
of each quota `run.suspended` (filtered on `kind: 'quota'`) to its next `run.resumed`. The wake has
already appended `run.resumed` when the sum is read. No column is added. `runGuarded` uses that
deadline for its abort timer.

### D8: Owner surfaces

The `quota-wait` layer adds `awaiting_quota` to the DTO enums and regenerates OpenAPI, the orval
models, and both `live-protocol.ts` copies, because the web parses `run.updated` with a strict
`z.enum`. The same layer adds `awaiting_quota` to the status reducer (`active-run-queries.ts:62`)
and both sidebar checks, and makes Stop cancel a quota wait.

The `quota-wait-web` layer adds `quotaWait: { failureClass, resetsAt, wakeAt } | null` to
`RunResponse`, `ChatLatestRunResponse`, and `ActiveRunResponse`. It adds `errorCode` and
`errorResetsAt` to `ChatLatestRunResponse`; they mirror `error.code` and `error.resetsAt` and are
null unless the Run failed. The `run.failed` SSE chunk keeps `errorText`.

The web adds a `QuotaWaitNotice` in the `pending` slot of `ChatComposer` where `PendingDeliveries`
renders (`chat-page.tsx:415`, `chat-composer.tsx:451-459`). It reads "_Model name_ usage limit
reached", then "Sends again at _local time_ · in _countdown_", and has a Stop button bound to
`cancelRun`. The countdown ticks each second under one hour and each minute above it. After `wakeAt`
it reads "Sending again…". The retry line replaces the "Thinking…" shimmer with "Retrying after
_label_ (n/10)", where the label maps each class to plain words, such as `overloaded` to "provider
overload". The failed turn, or the error row of a compaction Run, appends "Resets at _local time_"
when `errorResetsAt` is set.

### D9: Side calls

Title generation and structured generation run through the `wrapGenerate` variant, and hosted web
search through the stream middleware. None passes a `model.retrying` callback. A reset time above
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
