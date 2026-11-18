## Why

A provider error ends a llame Run `failed` with a message and nothing else
([#1774](https://github.com/leon0399/llame/issues/1774)). No code says what kind of failure it was.
The only failure code is `model_stream_idle`. Retries are uneven: the Anthropic client turns SDK
retries off, while the OpenAI-family wires keep the AI SDK default of two retries with 2 s and 4 s
delays. That default ignores a stated wait of 60 s or more and reads no reset header. A one-second
`529` therefore moves nothing forward, and a Codex weekly usage limit fails a long Run that could
continue after the reset.

[Model roles with fallback chains](https://github.com/leon0399/llame/issues/1772) needs typed
failures to decide when to fail over. This change ships first and works for one exact model with
no roles. It gives every provider failure a class, owns the same-model retries, adds a first-token
timeout, and parks a Run that hits a usage limit until the provider's stated reset. The decisions
come from three closed wayfinding tickets and one grilling session; `design.md` records the prior
art and the code facts.

## What Changes

- **Failure classes.** Each wire client assigns one class from a closed set to every failed model
  request: `quota_exhausted`, `billing`, `rate_limited`, `overloaded`, `server_error`,
  `unreachable`, `first_token_timeout`, `stream_broken`, `model_not_found`, `auth`,
  `context_overflow`, `invalid_request`, `content_policy`, or `unknown`. The class is the `code`
  of a failed Run's error and of its `run.failed` event. The failure message does not change.
- **Reset times.** A `quota_exhausted` or `rate_limited` failure carries `resetsAt` only when the
  provider states it: Codex `error.resets_at` or an exhausted window's `x-codex-*-reset-at`,
  Anthropic `anthropic-ratelimit-*-reset` for the exhausted bucket, OpenRouter budget
  `error.metadata.resets_at`, OpenAI API `x-ratelimit-reset-*`, and OpenCode Go `Retry-After` on a
  `GoUsageLimitError`. llame never infers a reset. The Codex client classifies before
  `sanitizeCodexError` removes the body and headers.
- **llame owns retries.** Every chat-wire request sends `maxRetries: 0`. llame re-sends a request
  that failed as `overloaded`, `server_error`, `unreachable`, `rate_limited`,
  `first_token_timeout`, or `stream_broken` on the same model. It waits a random delay from 0 to
  `min(8 s, 500 ms * 2^n)` and stops after 10 request retries. A stated wait of 60 s or less is
  honored in process. A `rate_limited` hint longer than 60 s fails the request at once.
- **First-token timeout.** The first window of a request ends at its first text, reasoning,
  tool-input, or tool-call part; metadata does not count, and llame holds back earlier parts until
  then. A model entry can set `firstTokenTimeoutSeconds`, and 300 s applies otherwise. Expiry is
  `first_token_timeout`. A stall after the first content part is `stream_broken`. **BREAKING**: the
  error code `model_stream_idle` is removed.
- **Broken streams.** A transient failure after the first content part is re-sent unless a complete
  tool-call part of that send streamed; in that case the Run fails with the class. The re-sent
  request is the same request. A `model.superseded` Run event marks the parts of the broken send,
  so they leave the Reply, the live view, and model history, and the event log keeps them. The
  attempt's usage is then marked incomplete.
- **Retry visibility.** Each request retry of a Run's own request is a Run event. The web shows
  "Retrying after _class_ (n/10)" where it shows "Thinking…" today.
- **Quota wait.** A request that a Run sends to its own model can fail as `quota_exhausted` or
  `rate_limited` with a reset more than 60 s away. The Run then enters the new non-terminal status
  **`awaiting_quota`**. It holds no worker, and a delayed queue job wakes it at the reset plus 60 s
  plus up to 18 s of jitter. It then re-sends the same request on the same model. One request waits
  again at most 3 times. A reset beyond `runs.quotaWaitMaxSeconds` (default 691,200 s, 8 days) ends
  the request with its class and reset time, and the caller's failure rule applies. This covers step
  requests and compaction summaries on the model of the Run, compaction Runs included.
- **The waiting Chat.** Steers, interrupts, queue items, and job notices stay pending and do not
  wake the Run. A plain send still gets 409. Stop always cancels the wait. The time in
  `awaiting_quota` does not count toward `runs.timeoutSeconds`. A floating box above the prompt
  composer shows the model name, the reset time, a live countdown, and Stop. The sidebar shows the
  Chat as `background`.
- **Side calls.** Title generation and hosted web search get the classes and the owned retries,
  then fail as today. A failed hosted-search engine still advances the engine chain.

## Assumptions, confirmed with Leo

Settled decisions from closed tickets (cited as ticket and question):

- [#1756](https://github.com/leon0399/llame/issues/1756) Q1–Q5: the closed class set; SDK retries
  off with llame-owned full-jitter retries; a short stated wait honored, a longer authoritative
  reset parks; a content-only first-token timeout with a per-model override and a 300 s default;
  `stream_broken` retried unless a tool call started; usage limits never fail over.
- [#1775](https://github.com/leon0399/llame/issues/1775): the reset fields per wire, from the
  research note on the unmerged branch `research/provider-reset-signals`.
- [#1776](https://github.com/leon0399/llame/issues/1776) Q1–Q6: a classified usage-limit
  `Retry-After` counts as a reset; the 8-day operator cap; quota wait time excluded from
  `runs.timeoutSeconds`; pending items do not wake the Run and Stop ends the wait; the new status
  `awaiting_quota`; the wake at reset plus 60 s grace plus jitter with at most 3 re-waits.

Decisions from the grilling session of 2026-11-18 (cited as grilling Q):

- **grilling Q1 (A).** A broken stream that is re-sent discards the broken request's parts. Leo
  accepted this on the condition that no incomplete or unsigned provider data reaches a request. The
  re-sent request carries no part of the broken one, so the condition holds by construction.
- **grilling Q2 (A).** `rate_limited` gets the transient backoff, and a stated hint is the floor of
  that retry's delay. A hint that is not authoritative and above 60 s fails the Run at once.
- **grilling Q3 (A).** One budget of 10 request retries for every transient class. Leo prefers a
  longer hang that gives a provider time to recover: a provider that hangs keeps a Run for about
  11 × 300 s before it fails.
- **grilling Q4 (B).** The in-process threshold is 60 s.
- **grilling Q5 (B).** Every request of a Run to its own model can park, compaction Runs included.
- **grilling Q5b (A).** Title generation and hosted web search retry, then fail as today. A failed
  hosted-search engine maps to the existing engine classes, so a chain advances and an aggregate's
  other children still answer.
- **grilling Q6 (A).** The waiting Chat shows the model name, the reset time, and a live countdown
  in a floating box above the composer, with Stop. The sidebar reuses `background`.
- **grilling Q7 (A).** Each request retry is a Run event with a web line.

Assumptions that follow and that Leo did not object to:

- A stall before the first content part is `first_token_timeout`, and a stall after it is
  `stream_broken`, so `model_stream_idle` goes away.
- Failure messages stay as they are today. The class is added as `error.code`.
- Stop on an `awaiting_quota` Run always requests cancellation, also with pending steers, because
  an interrupt does not wake it.
- When both Codex windows are exhausted, the Run waits for the later reset, as oh-my-pi does.
- The decision, rerank, and embedding lanes keep their own retry loops.

## Deviation from the grilling record

[#1776](https://github.com/leon0399/llame/issues/1776) Q4 says the Chat "shows the provider". No
owner-facing field names a provider: `available-models` forbids provider execution ids, and a
`providers[]` entry has no display name. grilling Q6 resolved this to the model name. Confirm that
this replaces the ticket's wording.

## Capabilities

### New Capabilities

- `provider-failures`: failure classes, reset signals, owned request retries, the first-token
  timeout, broken streams, the retry event, and side calls.
- `quota-wait`: the `awaiting_quota` status, its deadline, wakers, re-waits, cap, budget rule,
  Stop, events, and the owner surface.

### Modified Capabilities

- `durable-runs`: "A run never stays stuck, enforced without a cross-tenant reaper" (the budget
  excludes quota wait time, and the idle watchdog becomes the first-token timeout and the
  `stream_broken` stall); "Final assistant-message projection preserves replay order" (the parts of
  a superseded send leave the projection); "Received reasoning is durable before browser delivery"
  (the log keeps superseded reasoning, and the transcript omits it).
- `tool-calling`: "No mid-run tool-state checkpointing (read-only slice; write-tool landmine)" (a
  wake from `awaiting_quota` is not a retry and continues from the stored steps).
- `run-usage-accounting`: "Usage records whether it is complete" (a superseded send makes the
  attempt's usage incomplete).
- `provider-api-selection`: "Chat Completions failures reach the run as bounded messages" (no SDK
  retry summary; llame's request retries apply).
- `opencode-go-provider`: "Upstream failures are mirrored under the existing contract" (classes, a
  quota wait on `GoUsageLimitError`, and llame retries).
- `anthropic-messages-provider`: "Failure boundaries are bounded and sanitized" (rate limits retry
  or wait before they fail).
- `subscription-access-openai-codex`: "Manual model metadata and unknown cost" (a usage limit
  waits for its reset).
- `run-steering`: "A delivery does not restart the time limits of the Run" (the budget excludes
  quota wait time); "Stop interrupts when steers are pending" (Stop cancels a quota wait).
- `background-jobs`: "The sidebar shows a background state" (`awaiting_quota` shows
  `background`).
- `instance-config`: adds `runs.quotaWaitMaxSeconds` and `models[].firstTokenTimeoutSeconds` as
  ADDED requirements under "First-slice setting surface", which says consumer changes add their own
  keys.

Deliberately unchanged, with the reading under which each holds:

- `durable-runs` "Run failures are classified — infra retries, model failure is terminal": a
  request whose retries or quota wait have not ended has not failed; once it fails, the Run ends
  terminal as written.
- `durable-runs` "A Run that waits holds no worker", "A Run starts to wait only when nothing is
  pending", "One waker resumes a Run that waits", "The deadline job ends a wait", and "A wait and a
  wake are Run events": each names `awaiting_jobs` and an open `wait` call, so each governs that
  status only. `quota-wait` states the rules of `awaiting_quota`.
- `durable-runs` "One in-flight run per chat (single-flight)": liveness reads the recorded queue
  job, and `quota-wait` records the wake job as that job.
- `run-cancellation` "A cancellation ends a Run that waits": it names `awaiting_jobs`;
  `quota-wait` adds the same rule for `awaiting_quota`.
- `model-system-prompts` "A failed compaction Run fails" and "A failed step-boundary compaction
  continues the Run": a summary request fails only after its retries and quota wait end, as
  `provider-failures` defines. A reset beyond the cap or a fourth wait ends the request, and these
  rules then apply.
- `model-system-prompts` "A model switch replaces the top-level prompt and preserves portable
  history": its source-model compaction is on another
  model, so it is a side call and keeps `context_incompatible` on failure.
- `run-cancellation` "A recorded cancellation settles the Run as cancelled": "the output observed
  before the cancellation" is the projection, which already omits superseded sends.
- `turn-actions`: its list of `latestRun` fields does not state that it is exhaustive, so
  `quotaWait`, `errorCode`, and `errorResetsAt` can join it.
- `provider-api-selection` "Provider failures never carry a configured credential": classes are
  assigned before redaction, and redaction keeps `code`, as its "Classification survives
  redaction" scenario requires.
- `subscription-access-openai-codex` "Contain credential and owner data": llame reads `resets_at`
  and the window headers but does not expose a body or header.
- `web-search` "The chain tries engines in order and advances on failure or emptiness": a
  model-hosted engine still fails with one engine class.
- `instance-config` "Model catalog configuration": its list of optional entry fields does not
  state that it is exhaustive, and the published schema adds the new key.

## Impact

- **API:** the provider clients (`apps/api/src/models/*-model-client.ts`), a new failure classifier
  module, the stream watchdog replaced by request recovery, `run-execution.service.ts`,
  `run-wait.service.ts`, `runs-worker.service.ts`, `chat-admission.ts`, `runs.controller.ts`, the
  config loader and schema, the Run DTOs, OpenAPI, and the live protocol.
- **Database:** a generated migration adds `awaiting_quota` to `run_status`, and a custom migration
  tags existing `awaiting` rows as job waits under a lifted forced RLS. No new table.
- **Web:** the quota wait box, the retry line, the failed-turn reset time, and the sidebar state.
- **Docs:** provider runbooks, `docs/product/operator/scaling.md`, the glossary, `SPEC.md`, and
  `CHANGELOG.md`, each in the layer that ships the behavior.
- **Prompts:** none. The model never sees a class, a retry, or a wait.

## Non-Goals

- Failover to another model or provider ([#1772](https://github.com/leon0399/llame/issues/1772)),
  and whether a role's next candidate re-runs a broken request
  ([#1777](https://github.com/leon0399/llame/issues/1777)).
- A quota ledger, usage meters, or a pre-flight check against known limits.
- A wait without an authoritative reset, or an inferred reset such as "the first of next month".
- A change to the decision, rerank, or embedding retry loops, or to MCP calls.
- An owner control to end the wait on another model.

## Acceptance

- A Codex Run that hits its weekly limit mid-Run shows `awaiting_quota` with the reset time and a
  countdown, survives a worker restart, and continues on Codex after the reset.
- A `529` from Anthropic is retried with full jitter on the same model, and the web shows the
  retry line.
- A stream that breaks mid-text is re-sent, and the Reply holds only the re-sent request's output.
- A stream that breaks after a tool call started fails the Run with `stream_broken`.
- A request with no content part in its first-token window fails as `first_token_timeout` after its
  retries.
- Stop ends a quota wait at once, and a steer sent during the wait is delivered after the reset.
- A configured `runs.timeoutSeconds` does not expire a Run because of the time it spent in
  `awaiting_quota`.
