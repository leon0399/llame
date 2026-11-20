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

## What Changes

- A send of a Run step that fails after a started tool call no longer fails the Run at once. The
  Run waits until each started call of that send settles, as success, error, or `outcome_unknown`.
  It does not cancel them.
- The Run then decides by the failure class:
  - a class that gets a request retry continues with the next step on the same model;
  - `quota_exhausted` or `rate_limited` with a reset in range waits for the reset at that step
    boundary, under the shipped quota-wait rules;
  - every other class, and a spent budget, fails the Run as today, with real tool results instead of
    termination results.
- The reply keeps the failed send's parts through its last settled tool part. A `model.superseded`
  event marks the parts after it, so the live view removes them and a reload agrees.
- The next step uses the request-retry budget and the quota-wait count of the failed request: one
  retry, its delay, its `model.retrying` event, and the web line "Retrying after … (n/10)". A send
  that ends without failure ends both counts.
- A new context item, producer `provider-failure`, form `notice`, follows the last settled tool part
  in every outcome. It tells the model that the provider failed, that each call above has its
  result, and that its output after the last result is not kept. It ranks second in the producer
  precedence, after `interrupted`.
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
  and a cancellation during the wait. Owner Continue keeps it, because it keeps the context items
  directly after the last settled tool part.

Two of these decisions are recorded as ADRs, because each is hard to reverse, surprising to a
reader who knows oh-my-pi, and a real trade-off:

- [A failed send with a started tool call continues and is never sent again](../../../docs/adr/2026-11-20-a-failed-send-with-a-started-call-continues.md)
  (grilling Q3, Q4, Q8, and #1777 Q2).
- [The model is told when the harness changed its history](../../../docs/adr/2026-11-20-the-model-is-told-when-the-harness-changes-its-history.md)
  (grilling Q7 and Q12).

Assumptions that follow from these answers but were never asked:

- **A1. Scope of the notice.** "Every outcome" covers only a send that failed with a started tool
  call. A failed send with no started call keeps the shipped behavior and gets no notice.
- **A2. The parts after the last settled tool part are superseded in every outcome**, a failure
  included. Otherwise the notice text "your output after the last result is not kept" is false
  for a failed reply, and later requests replay that text after the notice.
- **A3. The next step also keeps the quota-wait count of the failed request**, by the same rule as
  the retry count (grilling Q1 A).
- **A4. The notice is stored when the Run decides.** A worker that dies before that point stores
  none, and the redelivery rules of grilling Q5 A apply.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `provider-failures`:
  - MODIFIED "A request with a started tool call is not sent again". It owns this requirement
    and its scenarios; the model-roles change references it and does not modify it.
  - ADDED "A failed send waits for its started tool calls", "The next step keeps the settled
    parts of the failed send", "The next step uses the budgets of the failed request", "A
    provider-failure notice follows the last settled tool part", and "The provider-failure notice
    has a fixed text".
- `quota-wait`: MODIFIED "A Run that waits for a quota reset holds no worker", "The entry to a
  quota wait is one fenced transaction", "A woken Run sends the same request again", and "A quota
  wait and its wake are Run events". Each one excluded a send with a started tool call, or excluded
  all parts of the failed send.
- `context-injection`: MODIFIED "Co-occurring items have a total author-time order", to add the
  `provider-failure` producer second.

Deliberately unchanged, with the reading this change relies on:

- `turn-actions` "Continue keeps the completed steps of the reply": the notice is a context item
  directly after the last settled tool part, so owner Continue keeps it as written.
- `durable-runs` "Final assistant-message projection preserves replay order" and the claim rules:
  the finalizer already skips each window that a `model.superseded` event names, and it places
  stored in-Run items after their tool parts. A redelivery keeps its shipped behavior (grilling Q5).
- `tool-calling` "Termination settles in-flight tool activity": the failed send's calls settle
  before the Run fails, so termination finds them settled. It still settles every other open call.
- `context-injection` "Server-authored context is injected as discrete items on one rail": the
  dispatch transaction of the next step stores the notice, as for any in-Run item. When no request
  carries it, the quota entry transaction or the terminal settlement stores it, as they already
  store the parts of the attempt.
- `provider-failures` "Transient failures get request retries", "A request retry sends the same
  request", "Each request retry of a Run is a Run event", and "The web shows a request retry": the
  first send of the next step is not a request retry, so these rules keep their meaning. The ADDED
  budget requirement gives it the count, the delay, the event, and the web line of one.
- `provider-failures` "A failed hosted-search request keeps the engine classes" and
  `run-steering` (Stop, interrupt fates, steer delivery): unchanged (grilling Q3, Q6).

## Impact

- `apps/api/src/models/request-recovery.ts`: a send with a complete tool-call part reports a
  continue outcome in place of a terminal one; `toolCallStarted` stops blocking the quota wait.
- `apps/api/src/runs/run-execution.service.ts`, `quota-wait.ts`, `run-suspension.ts`: wait for the
  open calls of the failed send, cut and supersede, carry the counts, store the notice, park or
  continue.
- `apps/api/src/chats/`: the `provider-failure` producer, its packaged template, and its precedence.
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
  next step.
- A Codex `usage_limit_reached` after a `bash` call parks the Run after the call settles, and the
  woken Run sends the next step with the `bash` result.
- A provider that breaks after a tool call on 11 sends in a row fails the Run with `stream_broken`,
  and each call executes once.
- An `auth` failure after a tool call fails the Run with the real tool result and the notice, and an
  owner Continue keeps both.
