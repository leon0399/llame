## Context

See [proposal.md](proposal.md) for the motivation and the grilling record. Code references are at
`993b8f5a0`; `apps/api/src` and `openspec/specs` are identical at `968686ab8`, where the code was
read.

- **Tools start while the send streams.** `models/tool-call-gate.ts:143-179` releases each
  `execute` when the consumer sees its `tool-call` part (`models/stream-parts.ts:64-96`). Parallel
  calls run as independent promises. A send that breaks can therefore leave calls that ran, calls
  that still run, and calls the SDK never started.
- **The block today.** `StreamRecovery.failedSend` (`models/request-recovery.ts:344-375`) sets
  `completeTool` on a `tool-call` part (`:187`). It returns `canRetry: !completeTool`, and it marks a
  quota or rate-limit failure `toolCallStarted`, which `quotaWaitForFailure` refuses
  (`runs/quota-wait.ts:15`). `:426` then throws, and `onError`
  (`runs/run-execution.service.ts:5094-5291`) calls `settleOpenToolsAndDrain`. That writes
  termination results at once (`runs/tool-settlement.ts:13-46`) and does not await the calls; a
  late real result is dropped by `settledToolCallIds` (`:3190-3198`).
- **Awaiting calls exists for interrupts.** Each open call holds `done`, the promise of its
  execution wrapper (`run-execution.service.ts:3853`). The wrapper records the real result itself
  (`:3817`). `settleOnInterrupt` already awaits `done` of the calls whose fate is not `cancel`
  (`:3626-3640`).
- **A live restart inside a step.** `recoverSupersededSend` (`:4531-4630`) truncates the collector
  to `stepModelOutputStart`, appends `model.superseded {fromSequence, step}` and `model.retrying`,
  waits, checks the fence, and calls `callStream` again with the carried retry count
  (`requestRetriesUsed`, `models/model-client.ts:96-97`, consumed once at
  `request-recovery.ts:527-537`).
- **Superseded windows.** A window runs from `fromSequence` to the sequence of its own event
  (`runs/superseded-output.ts:5-56`). The rebuild drops only `model.delta` and `reasoning.delta`
  inside a window (`runs/assistant-transcript.ts:622-666`); tool events are never filtered. The live
  bridge drops the text and reasoning UI parts opened inside the window (`run-stream-bridge.ts:317-336`),
  and an incomplete tool call has no UI part (`:381-385` emits one only for a complete call).
- **Quota park.** `suspendQuotaSend` (`:4638-4703`) truncates to `stepModelOutputStart`, supersedes
  the send, and stores `run.suspended` with `parts`, `steps`, and a `stepBudgetUsed` that excludes
  the failed step (`:4689-4693`). A wake rebuilds the request from stored history and the
  checkpoint parts (`:9054-9065`, `:10287-10321`).
- **Context items.** The `interrupted` producer (`chats/interrupted-notice.ts`, template
  `chats/prompts/interrupted-notice.md`) is the closest model: a fixed notice body from a packaged
  template. The producer order lives in `chats/context-item.ts:50-54`.
- **Restart.** A redelivered claim with a `native.attempt` in the segment fails the Run as
  `outcome_unknown` (`native-files-repository.ts:264-285`, `run-execution.service.ts:1815-1827`).
  Otherwise the segment starts again from its first step, and the retry count starts at 0.

### Prior art

| System                                 | Started calls at a break                                                                                               | What it keeps                                                                | Model told                                                                                 | Budget                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| oh-my-pi `turn-recovery.ts`            | Cannot happen: tools start after the message ends (`agent-loop.ts:1672-1735`); speculation is discarded (`:2639-2642`) | Whole failed turn plus its tool results (`preserveFailedTurn`, `:2749-2754`) | No reminder on that path (`:3374`); synthetic result text only                             | One saga of 10; only a turn with output resets it (`:590-633`, `:939`) |
| oh-my-pi, replay-safe path             | Every call has a synthetic `executed: false` result (`:1624-1660`)                                                     | Nothing; the turn is sent again                                              | n/a                                                                                        | Same saga                                                              |
| oh-my-pi, text-only stall              | No tool call                                                                                                           | The committed text                                                           | A fixed `developer` reminder (`prompts/system/stream-stall-continue.md`)                   | Separate cap of 3                                                      |
| OpenClaw `attempt-recovery.ts:522-528` | Settled batch or unknown outcome                                                                                       | The transcript                                                               | A fixed "continue from the existing transcript" prompt (`session-prompt-state.ts:325-351`) | Per attempt                                                            |

llame differs from oh-my-pi in one fact: its tools run during the stream. The wait for started
calls therefore has no direct prior art. The kept-turn idea and the shared budget do.

## Goals / Non-Goals

**Goals:** one decision point after the failed send's calls settle; reuse of the shipped
`model.superseded`, `model.retrying`, request-retry, quota-wait, and context-item machinery; no
new event type, table, or wire shape.

**Non-Goals:** see the proposal. Also no change to compaction, title, decision, rerank, or hosted
web search sends, which never carry Run tool calls.

## Decisions

### D1: The failed send reports "continue after tools" and does not throw a terminal failure

`failedSend` keeps `canRetry: false` for a send with a complete tool-call part, so nothing re-sends
it. It marks the failure `toolCallStarted` for every class, not only quota classes, and the stream
surfaces the failure to the Run as today. `onError` reads `toolCallStarted` on a step request to
choose the new path; any other caller keeps its failure rule (the hosted-search engine, compaction,
and titles carry no Run tool calls).

_Alternative:_ resolve the continuation inside `StreamRecovery`. Rejected: the model client knows
nothing of open Run calls, the reply collector, or context items.

### D2: Wait on `done` of every open call of the failed send

`onError` on that path awaits `done` of each open call that the failed send reserved, before any
other settlement. It reuses the interrupt pattern at `run-execution.service.ts:3626-3640`. A call
with no `done` never reached its executor; it settles with the "did not run" result of
`tool-settlement.ts` (`started: false`). The wait races the Run abort signal: Stop, expiry, and an
interrupt delivery take their shipped paths (`settleOpenToolCalls`, `settleOnInterrupt`), and the
provider-failure notice is still placed (D5). A steer stays pending and reaches the next step
boundary.

The first implementation task is a spike test: a fake model that streams a `tool-call` part and
then fails, with a tool that resolves later. It proves that the SDK does not abort the execution
wrapper and that `done` resolves with the real result. If it fails, the layer stops and the design
returns to review.

### D3: Cut at the last settled tool part and supersede the rest

After the wait every started call has a result, so the last settled tool part is the last complete
tool call in stream order. The collector is truncated after that part, in place of
`stepModelOutputStart`. One `model.superseded` event is appended with `fromSequence` set to the
sequence after the run event of that call; its `step` is the current step. The rebuild keeps tool
events whatever the window, so text and reasoning between two kept calls stay, and the trailing
text and reasoning go. The bridge removes the same parts live. This holds in every outcome
(proposal A2).

_Alternative:_ a new `model.continued` event. Rejected in grilling Q2.

### D4: The next step is a new `callStream` with the carried count

The Run calls `callStream([...callMessages, ...projectStoredReplyParts(kept).messages],
currentStepNumber + 1, retriesUsed, false)`. Step-boundary preparation runs, as on the interrupt
boundary path (`:4380-4391`), so in-Run items and a due step-boundary compaction apply. `StreamRecovery`
gains one entry, `restoreRetries(n, pendingFailure)`. With a pending failure, the first send waits
the delay of retry `n + 1` and calls `onRetry`, which appends `model.retrying` with that number.
A spent budget (`n = 10`) fails the Run with the failure class instead (D6). A send that ends
without failure already zeroes the count for the next step (`request-recovery.ts:527-537`).

A provider delay of up to 60 seconds replaces the jittered delay, as the shipped in-process rule
does, and counts as that retry.

### D5: The `provider-failure` producer

- `chats/provider-failure-notice.ts` and template `chats/prompts/provider-failure-notice.md`,
  modeled on `interrupted-notice.ts`. Payload `{ failureClass }`; the template maps it to a label.
- `context-item.ts` gains `provider-failure` directly after `interrupted`.
- The notice is inserted into the collector directly after the last kept tool part, once, when the
  wait ends. It is then stored by the write that already stores those parts: the dispatch
  transaction of the next step, the quota entry transaction (D6), or the terminal settlement, which
  persists the collector. A worker that dies before the wait ends stores none (proposal A4).

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

The first eight reuse the web retry labels (`message-visibility.ts:70-78`).

### D6: Decide by the class after the cut

- Retryable class with retries left: D4.
- `quota_exhausted` or `rate_limited` with a reset more than 60 seconds away and in range:
  `suspendQuotaSend` with the D3 cut in place of `stepModelOutputStart`. The checkpoint `parts`
  hold the kept parts and the notice, and `stepBudgetUsed` now includes the failed step, because
  its kept part is a completed step. `quotaWaitForFailure` stops refusing `toolCallStarted`. The
  wake path already rebuilds the request from the checkpoint parts, so the woken request is the
  next step. The wait count stays bound to the open suspension until `run.quota_recovered`, so it
  carries over (proposal A3).
- Every other class, a spent budget, or a reset out of range: the shipped `onError` failure path,
  after D2 and D3, so termination finds the failed send's calls settled.

### D7: Web and API surfaces stay as they are

`model.retrying` and `model.superseded` already reach the live view, and the retry line already
renders. The notice is a context item with the shipped transcript styling. No OpenAPI or
live-protocol regeneration is needed.

## Risks / Trade-offs

- [The SDK aborts tool execution when its stream fails] → The D2 spike test is the first task and
  gates the layer.
- [A long tool call holds the worker before the next send] → It is the same hold as an ordinary
  step that runs that call. Each tool's own timeout, the execution ceiling, and Stop bound it
  (grilling Q3).
- [A provider keeps breaking after tool calls, and each break runs new calls] → The shared count
  ends the Run after 10 retries (grilling Q1). Each call still runs once.
- [A rollback after notices exist] → A stored part with an unknown producer can fail metadata
  validation on an older build. Roll forward, or keep `provider-failure` in the producer list of a
  rollback build. The product is pre-launch.
- [The model-roles change MODIFIES the same requirements] → The proposal lists the MODIFIED set,
  and the PR body repeats it.
- [A worker restart resets the count] → It is the shipped behavior for every step (grilling Q5).

## Migration Plan

No data migration. Deploy with the next API release. A Run already failed by the old rule stays
failed, and owner Continue works on it as before.

## Open Questions

None.

## Revision history

- Initial draft.
