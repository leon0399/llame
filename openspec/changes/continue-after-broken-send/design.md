## Context

See [proposal.md](proposal.md) for the motivation and the grilling record. Code references are at
`993b8f5a0`; `apps/api/src` and `openspec/specs` are identical at `968686ab8`, where the code was
first read. The SDK is `ai@6.0.256` (`node_modules/.pnpm/ai@6.0.256_*/node_modules/ai/dist/index.mjs`).

- **Tools start while the send streams.** `gateToolExecution` (`models/tool-call-gate.ts:80-109`)
  holds each `execute` until the consumer reaches its `tool-call` part (`reach`, `:31-71`;
  `models/stream-parts.ts:91-109`). Run tools ignore the SDK abort signal and use the Run's own
  signals (`run-execution.service.ts:3693-3700`, `:3911-3916`), so a failed send does not abort them.
- **A failed send becomes an `error` part, and the SDK continues.** `StreamRecovery.failedSend`
  (`models/request-recovery.ts:344-375`) returns `canRetry: !completeTool`, so `parts` throws
  (`:426`). `recoveredStream` turns the throw into an `{ type: 'error' }` part and closes the stream
  (`:453-456`). The SDK records `stepFinishReason = "error"` and keeps the step open until every
  started tool execution resolves. It then starts the next step whenever every client call has an
  output and no stop condition holds, whatever the finish reason (`index.mjs:8043-8047`,
  `:8180-8197`). That next request carries the broken send's trailing text.
- **`onError` comes after the whole SDK loop.** Production clients defer `onError` and `onFinish`
  behind the single `fullStream` consumer (`openai-model-client.ts:168-244`), which reads every later
  step (`stream-parts.ts:54-84`). The Anthropic and Chat Completions clients share that path. Today a
  send that fails after a tool call therefore runs on through SDK steps with the broken text in
  context, and the Run fails only when the deferred `onError` runs. [INFERENCE] from source; the
  fake client (`fake-model-client.ts:90-93`) calls `onError` at once and hides this order.
- **The step-end hook.** `stopWhenExtra` (`run-execution.service.ts:4107-4137`) first records
  `run.quota_recovered` (`recordQuotaRecovery('completed')`), then reads cancellation, suspension,
  and pending deliveries, and returns `true` to stop the SDK loop.
- **The terminal path.** `onError` (`:5094-5291`) first ends the Workspace MCP attempt, removes the
  Stop listener, and closes the segment (`:5096-5106`), then settles open calls
  (`settleOpenToolsAndDrain`) and fails the Run.
- **A live restart inside a step.** `recoverSupersededSend` (`:4531-4630`) truncates the collector
  to `stepModelOutputStart`, appends `model.superseded {fromSequence, step}` and `model.retrying`,
  waits, checks the fence, and calls `callStream` again with `superseded.retry`. `requestRetriesUsed`
  (`model-client.ts:96-97`) counts prior sends, and `restoreRetries(n)` sets `sends = n`
  (`request-recovery.ts:221-223`); `retry()` reports `retry: sends` and stops at `MAX_SENDS = 11`.
- **Boundary work.** `deliverAtBoundary` (`:4239-4345`) delivers steers and runs a due step-boundary
  compaction. The interrupt path calls it before it builds `nextCall` (`:4373-4400`), and each
  `nextCall` path resets `inRunItems` (`:4360`, `:4391`, `:4565`).
- **Superseded windows.** A window runs from `fromSequence` to its own event's sequence
  (`superseded-output.ts:5-56`). The rebuild drops only `model.delta` and `reasoning.delta` in a
  window (`assistant-transcript.ts:650-666`). The bridge drops the text and reasoning parts opened in
  the window (`run-stream-bridge.ts:317-336`). A superseded window marks the reply
  `usage.complete: false` (`run-reply-finalizer.ts:384`). `tool.requested` is written at admission,
  which can wait for an owner approval, and `enqueueEvent` returns no sequence (`:2698-2735`).
- **In-Run storage.** Inside an attempt, reply parts reach the database through `storeInRunSnapshot`
  (`:10183-10208`), which `onStepStart` calls when staged in-Run items exist (`:4839-4843`).
  `placeStoredContextItems` (`run-reply-finalizer.ts:230-262`) puts stored items after their tool
  parts on a rebuild.
- **Quota park.** `suspendQuotaSend` (`:4638-4703`) truncates to `stepModelOutputStart`, supersedes,
  and stores `run.suspended` with `parts`, `steps`, and a `stepBudgetUsed` that excludes the failed
  step (`:4689-4693`). `quotaWaitForFailure` refuses `toolCallStarted` (`runs/quota-wait.ts:15`).
- **Context items.** `interrupted-notice.ts` with `chats/prompts/interrupted-notice.md` is the
  model for a fixed notice. The producer order is in `chats/context-item.ts:50-54`.

### Prior art

| System                                 | Started calls at a break                                                                                               | What it keeps                                                                | Model told                                                                                 | Budget                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| oh-my-pi `turn-recovery.ts`            | Cannot happen: tools start after the message ends (`agent-loop.ts:1672-1735`); speculation is discarded (`:2639-2642`) | Whole failed turn plus its tool results (`preserveFailedTurn`, `:2749-2754`) | No reminder on that path (`:3374`); synthetic result text only                             | One saga of 10; only a turn with output resets it (`:590-633`, `:939`) |
| oh-my-pi, replay-safe path             | Every call has a synthetic `executed: false` result (`:1624-1660`)                                                     | Nothing; the turn is sent again                                              | n/a                                                                                        | Same saga                                                              |
| oh-my-pi, text-only stall              | No tool call                                                                                                           | The committed text                                                           | A fixed `developer` reminder (`prompts/system/stream-stall-continue.md`)                   | Separate cap of 3                                                      |
| OpenClaw `attempt-recovery.ts:522-528` | Settled batch or unknown outcome                                                                                       | The transcript                                                               | A fixed "continue from the existing transcript" prompt (`session-prompt-state.ts:325-351`) | Per attempt                                                            |

llame differs from oh-my-pi in one fact: its tools run during the stream. The wait for started
calls has no direct prior art; the kept turn and the shared budget do.

## Goals / Non-Goals

**Goals:** stop the SDK at a failed step; decide once, after the SDK has settled every started
call; reuse `model.superseded`, `model.retrying`, request retries, quota waits, in-Run items, and
`deliverAtBoundary`; no new event type, table, or wire shape.

**Non-Goals:** see the proposal. Compaction, title, decision, rerank, and hosted web search sends
carry no Run tool calls and keep their rules.

## Decisions

### D1: A stop condition ends the SDK loop after a failed step

`stopWhenExtra` receives the SDK's `steps`. When the last step finished with `error`, it returns
`true` with a new `stopCause: 'failed-send'` and records no quota recovery. The SDK has already kept
that step open until every started execution resolved, so the stop needs no wait of its own. Stop,
expiry, and an owner interrupt reach the open calls through the shipped listeners, because
`onError` has not torn them down yet.

`failedSend` keeps `canRetry: false` for a send with a complete tool-call part, so nothing re-sends
it. It marks the `ProviderFailure` `toolCallStarted` for every class and attaches `sends`, the prior
sends of that request.

_Alternative:_ accept the SDK's own next step and repair it in `onStepStart` (trim the trailing
text from `messages`, delay, append `model.retrying`, park). Rejected: the SDK would decide the next
step before the Run knows the failure class, and a quota park from inside `prepareStep` has no
shipped path.

### D2: The Run decides in the deferred terminal path, before teardown

When `onError` sees `stopCause: 'failed-send'` and a `toolCallStarted` failure on a step request, it
skips the shipped teardown and runs D3 to D6. The teardown (Workspace MCP attempt, Stop listener,
segment) moves after the decision, and only the failure outcome performs it. Every other caller and
every other failure keeps the shipped path.

An open call of the failed step with no result at this point never reached its executor. D2 counts
only calls with `origin === undefined` and `step` equal to the failed step (`openToolCalls`,
`:3102-3107`). Such a call settles with a new provider-failure result: "This call did not run,
because the provider failed before it started. Run it again if you still need it." The interrupt
text, which blames the owner, is not reused.

A `wait` call in the failed send resolves `done` with a suspension and no result (`:3856-3870`). D2
settles it with the same "did not run" result before the decision, so the Run never parks on a
send it has cut (proposal A7).

### D3: The cut anchor is captured at the last tool-call part

When the consumer reaches a complete `tool-call` part (`onToolCall`, `:4935`), the Run flushes both
delta buffers and records `latestSequence() + 1` and the collector length, as
`persistStepStartSequence` does (`:2788-2809`). The last record of the failed step is the cut. The
collector is truncated at that length, and the `model.superseded` window starts at that sequence;
its `step` is the failed step. Text and reasoning between two kept calls precede the anchor and
stay. The trailing text and reasoning follow it and go, in the rebuild and in the bridge. The reply
usage becomes `complete: false`, which is correct: the failed send reported no usage.

### D4: The cut, the notice, and the next step

1. The Run stages the `provider-failure` notice (D5) as an in-Run item after the last kept tool part,
   after the `inRunItems` reset that every `nextCall` path performs.
2. It calls `deliverAtBoundary`, as the interrupt path does. A pending steer or interrupt starts a
   segment there; the segment starts with no carried count and no retry delay (proposal A6). The
   write that closes the earlier segment persists the collector with the cut and the notice, and
   appends the `model.superseded` event in the same transaction. A due step-boundary compaction runs.
3. Without a delivery, it calls `callStream([...callMessages, ...projectStoredReplyParts(kept).messages],
   failedStep + 1, failure.sends, false)`. `restoreRetries` takes the pending failure: the first send
   waits the delay of retry `sends`, reports `retry: sends` to `onRetry`, and the request fails with
   the class when `sends` has reached `MAX_SENDS`. A provider delay of up to 60 seconds replaces the
   jittered delay, as the shipped rule does.
4. The `onStepStart` of that first send stores the snapshot with the notice through
   `storeInRunSnapshot`, and appends the `model.superseded` event in the same fenced transaction.
   A worker that stops before that write leaves neither the cut nor the notice, and the shipped
   redelivery rules apply.

A send that ends without failure already zeroes the count for the next step
(`request-recovery.ts:527-537`).

### D5: The `provider-failure` producer

- `chats/provider-failure-notice.ts` and template `chats/prompts/provider-failure-notice.md`, after
  `interrupted-notice.ts`. Payload `{ failureClass }`; the template maps it to a label.
- `context-item.ts` gains `provider-failure` directly after `interrupted`.

| Failure class         | Label                     |
| --------------------- | ------------------------- |
| `quota_exhausted`     | a usage limit             |
| `billing`             | a billing limit           |
| `rate_limited`        | a rate limit              |
| `overloaded`          | provider overload         |
| `server_error`        | a provider error          |
| `unreachable`         | a connection failure      |
| `first_token_timeout` | a first-token timeout     |
| `stream_broken`       | a broken stream           |
| `model_not_found`     | a missing model           |
| `auth`                | an authentication failure |
| `context_overflow`    | a context overflow        |
| `invalid_request`     | an invalid request        |
| `content_policy`      | a content policy refusal  |
| `unknown`             | an unknown failure        |

Seven labels reuse the web retry labels (`message-visibility.ts:70-78`); `billing` and the classes
with no retry are new.

### D6: The other outcomes store the cut and the notice in their own write

- `quota_exhausted` or `rate_limited` with a reset more than 60 seconds away and in range:
  `suspendQuotaSend` with the D3 cut in place of `stepModelOutputStart`. Its entry transaction
  appends the `model.superseded` event and stores the kept parts and the notice in the checkpoint
  `parts`. `stepBudgetUsed` includes the failed step, whose kept part is a completed step.
  `quotaWaitForFailure` stops refusing `toolCallStarted`. The wake rebuilds the request from the
  checkpoint parts, so the woken request is the next step. Because D1 records no quota recovery at
  the failed step, the wait count carries over (proposal A3). The woken request starts its retry
  count at 0, as every woken request does today (proposal A5).
- Every other class, a spent count, a reset out of range, cancellation, and expiry: the terminal
  settlement persists the collector, which holds the cut and the staged notice, and the
  `model.superseded` event is appended in that settlement transaction. Termination then finds the
  failed send's calls settled.
- An owner interrupt during the wait closes the segment through `settleOnInterrupt`, which persists
  the collector with the cut and the notice in the same way.

### D7: Web and API surfaces stay as they are

`model.retrying` and `model.superseded` already reach the live view, and the retry line renders.
The trailing text stays visible until the write of D4 step 4 or D6, then disappears. The notice is
a context item with the shipped transcript styling. No OpenAPI or live-protocol regeneration.

## Risks / Trade-offs

- [The production order differs from the fake client] → The first task is a spike through
  `runStreamChannel` with `applyRequestRecovery` and a `MockLanguageModelV3` that streams a
  `tool-call` part and then fails. It asserts when `onError` runs, how many `doStream` calls occur,
  and that no step N+1 is sent before the Run decides.
- [A long tool call holds the worker before the next send] → The same hold as an ordinary step
  that runs that call. Each tool's own timeout, host `bash` backgrounding, the execution ceiling,
  and Stop bound it (grilling Q3).
- [A provider keeps breaking after tool calls] → The shared count ends the Run after 10 retries
  (grilling Q1). Each call still runs once.
- [A rollback after notices exist] → An older build accepts any well-formed producer name and
  replays the stored text (`context-item.ts:139-178`, `context-builder.ts:458-462`). Its UI does
  not recognize the producer. No data repair is needed.
- [The model-roles change MODIFIES the same requirements] → The proposal lists the MODIFIED set,
  and the PR body repeats it.
- [A worker restart resets the count] → The shipped behavior for every step (grilling Q5).

## Migration Plan

No data migration. Deploy with the next API release. A Run already failed by the old rule stays
failed, and owner Continue works on it as before.

## Open Questions

None.

## Revision history

- **Initial draft** (`686e64844`).
- **Round 1** (spec consistency: 0 P0, 9 P1, 10 P2; feasibility: 1 P0, 6 P1, 7 P2). Accepted all
  after verification against the code and the SDK source. Main changes: the SDK continues a failed
  step by itself and `onError` is deferred, so D1 now stops the SDK at a failed step and D2 decides
  before teardown; the cut anchor is captured at the last tool-call part; the cut and the notice
  are stored in one write per outcome; the carried count uses the shipped unit of prior sends; a
  failed step records no quota recovery; a delivery at the boundary and a quota wait end the
  retry count; the narrowed transparency ADR; the ADRs stay in this layer by Leo's request; the
  `runtime` layer splits into `continue` and `quota-wait`. Rejected: none.
