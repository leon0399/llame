## Why

A model request that fails after it streamed a complete tool-call part fails the Run today, for
every failure class ([#1828](https://github.com/leon0399/llame/issues/1828)). The shipped rule
protects against a re-send, which would emit the call again. Tools start while the send still
streams, so the call has often already run, and the owner must press Continue by hand to resume a
long agentic Run after one provider hiccup. Continuing is safe once every started call has settled:
the next request is an ordinary next step, and nothing runs twice. This was decided on
[Failing over a request whose stream broke mid-output](https://github.com/leon0399/llame/issues/1777)
(resolution, Q2 A and Q2b A), and it ships before
[model roles with fallback chains](https://github.com/leon0399/llame/issues/1772), which inherits it.

The code also differs from the shipped rule (design, Context). On the Responses and Anthropic
clients, the SDK turns the failure into an `error` part, waits for the started calls, and sends the
next step by itself, with the broken trailing text in context. The Run fails only afterwards, in the
deferred `onError`. On the Chat Completions client, `onError` fails the Run at the `error` part and
gives the running calls termination results. [INFERENCE] from source; the first `continue` task
proves the order on both client shapes.

## What Changes

- A send of a Run step that fails after a started tool call no longer fails the Run at once. The
  Run stops the SDK at that step and waits until each started call settles, as success, error, or
  `outcome_unknown`. It does not cancel them, and it sends no request meanwhile.
- The Run then decides by the failure class:
  - a class that gets a request retry continues with the next step on the same model;
  - `quota_exhausted` or `rate_limited` with a reset in range waits for the reset at that step
    boundary, under the shipped quota-wait rules;
  - every other class, and a spent budget, fails the Run, with real tool results instead of
    termination results.
- The reply keeps the failed send's parts through its last settled tool part. A `model.superseded`
  event marks the parts after it, so the live view removes them and a reload agrees.
- The next step uses the request-retry count and the quota-wait count of the failed request: one
  retry, its delay, its `model.retrying` event, and the web line "Retrying after … (n/10)". A later
  step send without failure ends both counts. A quota wait, or a steer or interrupt at that
  boundary, ends the retry count.
- A new context item, producer `provider-failure`, form `notice`, follows the last settled tool part
  in every outcome. It tells the model that the provider failed, that each call above has its
  result, and that its output after the last result is not kept. It ranks second in the producer
  precedence, after `interrupted`. The cut and the notice are stored in one write.
- Not **BREAKING** for operators or clients: no configuration, API, or wire shape changes. The
  change in behavior for owners is the point of the change.

## Assumptions, confirmed with Leo

Grilling round on this change, 2026-11-20 (codes "grilling Qn"):

- **grilling Q1 A.** The next step shares the failed request's retry count. A send that completes
  without failure resets it. `model.retrying` keeps its payload. Prior art: oh-my-pi's retry saga,
  which only a successful turn closes.
- **grilling Q2 A.** Dropped parts reuse `model.superseded`, with a window that starts after the last
  kept tool part. No new event.
- **grilling Q3 A.** The wait has no limit of its own. Each tool's own timeout and the execution
  ceiling bound it. Stop, interrupt, and steer keep their shipped rules during the wait.
- **grilling Q4 A.** A call that provably never ran does not turn the failure into a re-send. The
  Run continues in every case.
- **grilling Q5 A.** A worker restart during the wait or during the next step keeps the shipped
  redelivery rules: a recorded `native.attempt` fails the Run as `outcome_unknown`, otherwise the
  segment starts again from its first step.
- **grilling Q6 A.** Only Run steps continue. A hosted web search that breaks after its search tool
  call still fails its engine. Continuation inside hosted search is a later change, with the better
  engine or with subagents.
- **grilling Q7 B, Q9 A, Q10 A, Q11 A.** The model is told, through a new `provider-failure` notice
  with a fixed text and the label of the failure class, ranked second.
- **grilling Q8 A.** Every failure class waits for settlement before the Run decides.
- **grilling Q12 B.** The notice is stored in every outcome: the next step, a quota wait, a failure,
  and an expiry, interrupt, or cancellation during the wait. Owner Continue keeps it, because it
  keeps the context items directly after the last settled tool part.

Two of these decisions are recorded as ADRs, because each is hard to reverse, surprising to a
reader who knows oh-my-pi, and a real trade-off. Leo asked for them in this PR, so the proposal
layer carries them as a named exception to the proposal-only file rule of CONTRIBUTING.md:

- [A failed send with a started tool call continues and is never sent again](../../../docs/adr/2026-11-20-a-failed-send-with-a-started-call-continues.md)
  (grilling Q3, Q4, Q8, and #1777 Q2).
- [The model is told when output it already sent is cut from a reply that continues](../../../docs/adr/2026-11-20-the-model-is-told-when-its-sent-output-is-cut.md)
  (grilling Q7 and Q12).

Assumptions that follow from these answers but were never asked:

- **A1. Scope of the notice.** "Every outcome" covers only a send that failed with a started tool
  call. A failed send with no started call keeps the shipped behavior and gets no notice.
- **A2. The parts after the last settled tool part are superseded in every outcome**, a failure
  included. Otherwise the notice text "your output after the last result is not kept" is false
  for a failed reply, and later requests replay that text after the notice.
- **A3. The next step also keeps the quota-wait count of the failed request**, by the same rule as
  the retry count (grilling Q1). The failed step therefore records no quota recovery.
- **A4. The cut and the notice are stored in one write.** When the Run continues, that write comes
  before the retry delay. A worker that stops before it, after the calls settle and before the next
  step starts, leaves neither, and the redelivery rules of grilling Q5 apply.
- **A5. A quota wait ends the retry count.** A woken request starts its retry count at 0, as every
  woken request does today. Keeping it would need a persisted count (grilling Q5).
- **A6. A delivery at the boundary ends the retry count.** A steer, interrupt, or notice delivery
  starts a segment, as the shipped steering rules say, so its first send gets no retry delay and no
  `model.retrying` event. The Run decides by the failure class first, so a Run that fails delivers
  nothing.
- **A7. A `wait` call of the failed send does not open.** It settles with a result that states that
  the wait did not start, the Run does not enter `awaiting_jobs`, and the next step can call `wait`
  again. This MODIFIES `durable-runs` "A Run that waits holds no worker".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `provider-failures`:
  - MODIFIED "A request with a started tool call is not sent again". It owns this requirement
    and its scenarios; the model-roles change references it and does not modify it.
    - ADDED "A failed send waits for its started tool calls", "The Run keeps the parts of the failed
      send through its last settled tool part", "The cut and the notice are stored together", "The
      next step uses the budgets of the failed request", "Some events end the counts of the next
      step", "A wait call of a failed send does not open", "A provider-failure notice follows the last
      settled tool part", and "The provider-failure notice has a fixed text".
- `quota-wait`: MODIFIED "A Run that waits for a quota reset holds no worker", "The entry to a
  quota wait is one fenced transaction", "A woken Run sends the same request again", and "A quota
  wait and its wake are Run events". Each one excluded a send with a started tool call, or excluded
  all parts of the failed send.
- `context-injection`: MODIFIED "Co-occurring items have a total author-time order", to add the
  `provider-failure` producer second.
- `durable-runs`: MODIFIED "A Run that waits holds no worker", so a `wait` call of a failed send
  does not open (A7).
- `run-steering`: MODIFIED "An interrupted reply keeps its complete output", so an interrupt during
  the wait keeps the cut out of the reply.

Deliberately unchanged, with the reading this change relies on:

- `turn-actions` "Continue keeps the completed steps of the reply": the notice is a context item
  directly after the last settled tool part, so owner Continue keeps it as written.
- `durable-runs` "Final assistant-message projection preserves replay order", "Received reasoning
  is durable before browser delivery", and `run-usage-accounting`: they speak of "the parts of
  each send that a `model.superseded` event names". The ADDED keep requirement states that the
  event names the cut and no kept part. A superseded window already makes usage incomplete. A
  redelivery keeps its shipped behavior (grilling Q5).

- `tool-calling` "Termination settles in-flight tool activity": the failed send's calls settle
  before the Run fails, so termination finds them settled. It still settles every other open call.
- `context-injection` "Server-authored context is injected as discrete items on one rail": the
  notice is an in-Run item. When the Run continues, the in-Run snapshot write at the start of the
  next step stores it. When no request
  carries it, the quota entry transaction, the terminal settlement, or the write that closes the
  segment at a delivery stores it, as they already store the parts of the attempt.
- `provider-failures` "Transient failures get request retries", "A request retry sends the same
  request", "Each request retry of a Run is a Run event", and "The web shows a request retry": the
  first send of the next step is a new request, not a request retry. The ADDED budget requirement
  gives it the count, the delay, the event, and the web line of one.
- `quota-wait` "One request waits at most four times": the next step keeps the count of the failed
  request (A3), so the cap of four holds across it. "The web shows a quota wait above the composer"
  says the Run sends its request again; after a started call, that request is the next step.
- `provider-failures` "A failed hosted-search request keeps the engine classes" and
  the rest of `run-steering` (Stop, interrupt fates, steer delivery): unchanged (grilling Q3, Q6).

## Impact

- `apps/api/src/models/`: a send with a complete tool-call part is marked `toolCallStarted` for
  every class and carries its send count; a synchronous `onSendFailed` seam in
  `captureRequestFailure`; a pending failure for the first send of the next step.
- `apps/api/src/runs/run-execution.service.ts`: the stop at a failed step, the cut anchor, the
  decision in `onFinish`, the cut in the Stop, expiry, and interrupt writers, the next step with the
  carried count, and the snapshot write.
- `apps/api/src/runs/quota-wait.ts`, `run-suspension.ts`: park after a started call with the cut.
- `apps/api/src/chats/`: the `provider-failure` producer, its packaged template, and its
  precedence.
- No migration, no OpenAPI or live-protocol change, no web change: `model.retrying` and
  `model.superseded` already reach the live view.

## Non-Goals

- Any failover to another model, or any setting for it. That is
  [#1772](https://github.com/leon0399/llame/issues/1772), opt-in under
  [Automatic failover is opt-in per model role, failure group, and Run origin](../../../docs/adr/2026-11-20-automatic-failover-is-opt-in.md).
- Continuation inside hosted web search (grilling Q6).
- A re-send for calls that never ran (grilling Q4).
- A persisted retry count or a continuation checkpoint across a worker redelivery (grilling Q5).
- A text-only stall reminder for a send with no tool call, as oh-my-pi's
  `handleCommittedTextStreamStall` does.

## Acceptance

- A send that streams a complete `read` tool-call part and then breaks gives a Run that completes:
  the `read` call executes once, and the reply holds its result, the notice, and the output of the
  next step. No request goes out before the Run decides.
- A Codex `usage_limit_reached` after a `bash` call parks the Run after the call settles, and the
  woken Run sends the next step with the `bash` result.
- A provider that breaks after a tool call on 11 sends in a row fails the Run with `stream_broken`,
  and each call executes once.
- An `auth` failure after a tool call fails the Run with the real tool result and the notice, and an
  owner Continue keeps both.
