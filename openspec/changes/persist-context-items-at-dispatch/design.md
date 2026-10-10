# Design

## Context

- `run-execution.service.ts` stages accepted-turn items in
  `deriveAttemptStagedContext` and in-Run items in `createInRunContextItems`,
  then publishes them only in `finishRunInTransaction` when the outcome is
  `completed` (`persistFinishedContext`, `recordContextItems`). The same
  transaction writes the digest baseline and told set, the skill-catalog
  baseline and told set, the Workspace told set, and `turn_tool_availability`.
- Non-completed settlement strips rail parts (`withoutContextItems`), and
  durable reconstruction from `run_events` never yields them.
- `runs.context_items` is written before dispatch (`updateForAttempt`) and
  again on completion; only `GET /api/v1/runs/:id/context-items` reads it.
- Prompt imports and skill activations already persist on the user message
  before dispatch and are reused per Run id (`findForRun`/`appendForRun`).
- The model-switch item compares with `findMostRecentByMessageSequence`, which
  ignores status.

## Goals / Non-Goals

**Goals:**

- History equals what the model was shown, for every outcome.
- One pre-dispatch write per attempt for accepted-turn context and its state.

**Non-Goals:**

- Moving `chats` epoch columns into message history (#1070).

## Decisions

### D1. One pre-dispatch transaction for accepted-turn context

After preparation and any compaction checkpoint, and before the first model
request, one tenant transaction fenced by the attempt id, like
`updateForAttempt`, prepends the staged parts to the user message and writes
the digest initialization and told set, the skill-catalog freeze and told set,
the Workspace told set and detach clear, the Run's `turn_tool_availability`,
and a new `runs.dispatched_at`. A superseded attempt writes nothing. The
settlement transaction no longer writes any of these.

`dispatched_at` is the one marker of "this Run's context reached the model":
the availability, epoch, and model-switch baselines all read the most recent
prior Run with `dispatched_at` set, whatever its outcome, and retry reuse
(D2) keys on it.

### D2. A retry of a dispatched Run reuses its items

When the current Run has `dispatched_at`, preparation takes the Run's
accepted-turn parts from the user message as the attempt's items and no
producer authors another item, told-state update, or comparison record. The
text is reused verbatim, which keeps the cached prefix stable. Prompt-import
and skill-activation parts, persisted earlier in their own transactions, never
trigger reuse, so a crash before the dispatch transaction leaves a retry that
re-derives everything, as today.

Two producers act on a retry anyway. A retry whose Workspace binding changed
since the dispatched attempt (a detach) appends the detach notice and a
no-Workspace snapshot and clears the detach reason in its own attempt-fenced
write, so the model is told. A retry of a dispatched Run does not publish a
pre-step checkpoint; if its request no longer fits, it fails
`context_incompatible`, because a checkpoint would reset told state the reused
items already carry.

### D3. In-Run items are Run events carrying their attempt

`onStepStart` appends a `context.item` Run event carrying the part and the
attempt id, through the ordered event writer used for `tool.requested`, before
the step request. Settlement projects the `context.item` events of exactly the
attempts whose model output it projects; when two projected attempts carry an
item from the same producer for the same key, such as one instruction
canonical path, only the first is kept. `withoutContextItems` is deleted. The
chat stream bridge and the owner raw event stream do not forward the event;
the owner sees the part when the assistant message settles. The wedged-Run
expiry on admission (`ChatLoopService.clearActiveRunSlot`) settles through
the same projection instead of marking the Run expired without one.

### D4. The switch baseline is the latest dispatched Run's model

The baseline is the model id of the most recent prior Run with
`dispatched_at`, whatever its outcome. A Run that dispatched and failed before
any output has no assistant message but did put its switch item in history,
so it moves the baseline; a Run that never dispatched does not.

### D5. The per-Run record is removed

A migration drops `runs.context_items` and adds `runs.dispatched_at`.
`recordContextItems`, the `updateForAttempt` field, the controller route, the
DTOs, and the OpenAPI operation are deleted, and the web client is
regenerated. `BuiltContext` keeps its in-memory item list only where request
assembly needs it.

## Risks / Trade-offs

- [The pre-dispatch transaction lengthens time to first token] → It replaces
  the existing pre-dispatch `updateForAttempt` write with one transaction of
  the same order, measured in the implementation layer.
- [A crash between the transaction and the request] → The items are then in
  history though no request carried them. A retry reuses them (D2) and sends
  them; an `outcome_unknown` Run keeps them as context the model may have
  seen, which is the conservative reading.
- [A retry of a dispatched Run cannot compact] → Its window was fit before
  the first dispatch; it can only stop fitting if tool declarations grew
  between attempts, and then it fails `context_incompatible` rather than
  resetting state the reused items depend on.
- [Breaking API change] → The endpoint has no UI consumer; the changelog marks
  it breaking.
- [Larger replays after failures] → A failed Run's context now replays like a
  completed Run's, which is the point of the change.
