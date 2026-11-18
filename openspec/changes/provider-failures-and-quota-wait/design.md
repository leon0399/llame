## Context

Inspected at `f7176c2e` (origin/master, 2026-11-18). Locked dependencies: `ai` 6.0.256,
`@ai-sdk/provider` 3.0.15, `@ai-sdk/provider-utils` 4.0.46, `@ai-sdk/anthropic` 3.0.118,
`@ai-sdk/openai` 3.0.97, `@ai-sdk/openai-compatible` 2.0.75, `pg-boss` 12.25.0.

**Wire clients and retries.** `createModelClient` (`apps/api/src/models/model-client-factory.ts:43-77`)
wraps every chat client in `withRedactedFailures` (`model-client-failures.ts:174-232`). Only the
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

**The watchdog.** `STREAM_IDLE_TIMEOUT_MS = 300_000` (`stream-idle-watchdog.ts:14`) is both the first
window and the idle window. Every stream part re-arms it, metadata included (`:166-176`). It is
installed by `applyStreamIdleWatchdog` through `wrapLanguageModel` in the three wire builders
(`openai-model-client.ts:684`, `openai-completions-model-client.ts:495`, `anthropic-model-client.ts:415`).
The Run keeps a code only for `ModelStreamIdleError` (`run-execution.service.ts:4380-4381`); every
other failure writes `{ message }` to `runs.error` (`schema/chats.ts`, jsonb) through `finishRun`.

**Requests.** `callStream` (`run-execution.service.ts:3692-4790`) runs one `streamText` per call; its
SDK tool loop sends one provider request per step, and `prepareStep` runs `onStepStart`, which
changes Run state (`:4040-4110`). Tool calls are tracked per Run (`openToolCalls`, `:2584`) and per
request by `ToolCallGate` (`tool-call-gate.ts:18-71`), which has no "any reached" accessor.

**The wait machinery.** `awaiting_jobs` (migration `20261112150237_wonderful_mulholland_black`)
uses `runs.awaiting` (`AwaitingJobs`, `schema/chats.ts:27-32`), `wakeGeneration`, and
`currentJobId`. `RunWaitService.suspendInTransaction` (`run-wait.service.ts:80-162`) writes the
checkpoint and a `run.suspended` event and enqueues a `RUNS_QUEUE` job with `startAfter`
(`:400-443`). `persistWake` is one conditional update fenced on the generation (`:379-402`).
`pickupJob` (`runs-worker.service.ts:190-292`) handles the deadline wake, the cancel check, and the
budget from the first `run.started` event (`:249-272`). `chat-admission.ts:177` wakes an
`awaiting_jobs` Run on a steer or interrupt; `job-notices.ts:19` and `runs.controller.ts:157` branch
on the same literal; `run-status.ts:85-92` excludes it from claims. `enqueueRun` throws for a Run
with no `messageId`, so a compaction Run cannot wait today.

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
sanitizer runs. The sanitizer keeps these fields and replaces only the message. `code` already
survives redaction; `resetsAt` and `hintMs` are numbers and join `CLASSIFICATION_KEYS`. A failure
that reaches `RunExecutionService` without a `ProviderFailure` is `unknown`.

Rejected: classifying in `RunExecutionService` from the message (Codex and Anthropic drop the body
first) and a second error channel beside the thrown error (two sources of truth).

### D2: One classifier module per wire family

`apps/api/src/models/provider-failure/` holds `classify-responses.ts` (OpenAI, Codex, Zen,
OpenRouter on Responses), `classify-completions.ts` (OpenAI-compatible, OpenRouter, Go),
`classify-anthropic.ts`, and a shared `reset-signals.ts`. Each is a pure function from status,
parsed body, and headers to a `ProviderFailure`. The default table:

| Signal                                                                                                                                                                                             | Class              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 401, 403 without a budget or plan code                                                                                                                                                             | `auth`             |
| 402; `insufficient_quota`, `credit_balance_exhausted`, `usage_not_included`, OpenRouter `openrouter_credits`                                                                                       | `billing`          |
| Codex `usage_limit_reached`; `GoUsageLimitError`; OpenRouter budget `limit_source`; Anthropic `enforced_spend_limit_reached`; OpenAI `*_spend_limit_exceeded`, `organization_usage_limit_exceeded` | `quota_exhausted`  |
| other 429; OpenRouter `openrouter_in_flight_budget`                                                                                                                                                | `rate_limited`     |
| 404, `model_not_found`                                                                                                                                                                             | `model_not_found`  |
| 400/413 with a context-length code                                                                                                                                                                 | `context_overflow` |
| a content-policy code                                                                                                                                                                              | `content_policy`   |
| other 400, 422                                                                                                                                                                                     | `invalid_request`  |
| 503, 529, `overloaded_error`                                                                                                                                                                       | `overloaded`       |
| 408, 500, 502, 504                                                                                                                                                                                 | `server_error`     |
| transport failure without a response                                                                                                                                                               | `unreachable`      |

The research note on `research/provider-reset-signals` holds the field sources; implementation
re-reads them and copies no file from that branch.

### D3: Request recovery replaces the idle watchdog

`stream-idle-watchdog.ts` becomes `request-recovery.ts`, installed at the same three sites. Per
provider request it arms the first window (`firstTokenTimeoutSeconds` or 300 s), ends it at the first
`text-delta`, `reasoning-delta`, `tool-input-start`, or `tool-call` part, then arms the 300 s stall
window on every part. Before any part is forwarded, a transient failure is retried inside the
middleware: it sleeps the jittered or stated delay, appends `model.retrying` through a callback on
`ModelStreamInput`, and calls `doStream` again. The SDK never sees the failure, and `onStepStart`
does not run twice.

### D4: A failure after forwarded parts restarts the step

The middleware cannot take back parts the SDK already holds: the SDK adds them to the step content
and to the messages of the next step. A `stream_broken` after forwarded parts with no `tool-call`
part therefore ends the stream with the `ProviderFailure` and a `superseded` flag.
`RunExecutionService` then appends `model.superseded` (naming the `model.requested` sequence of the
broken request), drops the collector parts of that request, and calls `callStream` with the messages
that the broken step sent and the same `stepBase`. The step counters of `onStepStart` are restored
from that boundary. The live client drops the parts of the named request when the event arrives;
the finalizer and the rebuild skip them (`durable-runs` delta).

Rejected: buffering parts in the middleware until the request ends (it removes live streaming) and
keeping the partial parts (grilling Q1 B).

The first task of the `broken-streams` layer is a spike that proves the step restart against the
scripted model client, before the event and web work.

### D5: The quota wait reuses `awaiting` as a tagged union

`runs.awaiting` becomes `{ kind: 'jobs', … } | { kind: 'quota', failureClass, resetsAt, wakeAt,
waitCount, startedAt }`. The migration adds `awaiting_quota` with
`ALTER TYPE "public"."run_status" ADD VALUE 'awaiting_quota' BEFORE 'completed'` and, in a second
migration, tags each non-null `awaiting` row with `kind: 'jobs'`, so the enum value is committed
before any statement uses it. The `run.suspended` checkpoint stores the steps and parts of the
attempt as for `wait`, without the failed request. A quota failure after forwarded parts first
appends `model.superseded`, as in D4. A compaction Run gets a wake path that re-enqueues with no
`userMessage`.

Rejected: a new column (#1776 Q5 settled reuse) and a generic waiting status with a cause (#1776
Q5).

### D6: The wake

`wakeAt = resetsAt + 60 s + random(0, 18 s)`; the deadline job is a `RUNS_QUEUE` job with
`startAfter = wakeAt`. Wakers are the deadline job (cause `timeout`) and cancellation (cause
`cancelled`). `chat-admission.ts`, `job-notices.ts`, and `wakeForChatInTransaction` skip
`awaiting_quota`, so a steer, an interrupt, or a notice stays pending. The claim of a woken quota
Run rebuilds the steps with `wakeStateFromEvents` and calls `callStream` with no tool result. A
failure with a reset time more than 60 s away re-enters the wait with `waitCount + 1`; at
`waitCount = 3` it fails the Run.

### D7: The budget excludes quota waits by events

`pickupJob` computes the budget deadline from the first `run.started` plus the budget plus the sum
of each quota `run.suspended` to its next `run.resumed`. No column is added. `runGuarded` uses that
deadline for its abort timer.

### D8: Owner surfaces

`RunResponse`, `ChatLatestRunResponse`, and `ActiveRunResponse` gain `quotaWait: { failureClass,
resetsAt, wakeAt } | null`. `ChatLatestRunResponse` gains `errorCode` and `errorResetsAt`, which
are null unless the Run failed. The `run.failed` SSE chunk keeps `errorText`. OpenAPI, the orval
models, and both `live-protocol.ts` copies are regenerated.

The web adds a `QuotaWaitNotice` in the slot above the composer where `PendingDeliveries` sits
(`chat-page.tsx:406-419`). It reads "_Model name_ usage limit reached", then "Resumes at _local
time_ · in _countdown_", and has a Stop button bound to `cancelRun`. The countdown ticks each second
under one hour and each minute above it. After `wakeAt` it reads "Resuming…". The retry line replaces
the "Thinking…" shimmer with "Retrying after _label_ (n/10)", where the label maps each class to
plain words, for example `overloaded` to "provider overload". The failed turn appends "Resets at
_local time_" when `errorResetsAt` is set.

### D9: Side calls

Title generation and `generateObject` run through the same middleware, so they get the classes and
retries. A reset time above 60 s fails them. `model-hosted.ts` maps the class to an engine class
(spec "A failed hosted-search request keeps the engine classes") in place of its status switch.

### D10: Configuration

`runs.quotaWaitMaxSeconds` and `models[].firstTokenTimeoutSeconds` join the raw types, the defaults
(`llame-config.ts:648,825`), the schema (`llame.config.schema.json:716-750,1016-1033`), the loader,
and `worker-harness.ts`. `firstTokenTimeoutSeconds` reaches the client config through
`model-client-factory.ts` like `maxOutputTokens`.

## Risks / Trade-offs

- [A hung provider holds a Run for about 55 minutes before it fails, grilling Q3] → Leo chose this;
  the retry line shows each attempt, and Stop works throughout.
- [The step restart in D4 misses a piece of `onStepStart` state] → the spike task, and a test that
  compares the step counters and the in-Run items after a restart with a run that never broke.
- [A classifier misreads a body and parks a Run on a reset that is not one] → reset times come only
  from the named fields; a fixture per row of D2's table; the 8-day cap; Stop.
- [pg-boss retention changes in a later upgrade] → the retention fact is in this design; a test
  inserts an 8-day delayed job and reads `keep_until`.
- [Many Runs wake at one Codex reset] → the 18 s jitter spreads them; each wake is one claim.
- [The removal of `model_stream_idle` breaks a consumer that matches it] → no web or live code reads
  it; the changelog names the removal.

## Threats

The change reads response headers and bodies that it ignored before. A classifier keeps only the
class, a reset instant, and a hint in milliseconds; no header or body text reaches a Run, an event,
a log, or an owner. The quota wait reads and writes the owner's Run under the existing RLS-scoped
transactions, and `quotaWait` is part of a Run read that is already owner-scoped. Each owner-facing
layer adds a negative test where a second owner reads the waiting Run and gets 404.

## Migration Plan

Two migrations: the enum value, then the `awaiting.kind` backfill of `awaiting_jobs` rows. Both are
idempotent and transactional. Rollback after deploy: a Run in `awaiting_quota` must be cancelled
before the code that knows the status is removed; the enum value stays, as Postgres cannot drop one.

## Open Questions

None. Each grilling decision is recorded in the proposal.

## Revision history

- **v1 (2026-11-18):** Initial draft.
