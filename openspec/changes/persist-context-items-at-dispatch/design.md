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
request, one fenced tenant transaction prepends the staged parts to the user
message and writes the digest initialization and told set, the skill-catalog
freeze and told set, the Workspace told set and detach clear, and the Run's
`turn_tool_availability`. It is fenced by the attempt id like
`updateForAttempt`, so a superseded attempt writes nothing. The settlement
transaction no longer writes any of these.

The availability comparison reads the most recent prior Run that recorded
`turn_tool_availability`, rather than the most recent completed Run, so a
failed Run's announcement is not repeated.

### D2. A retried attempt reuses its Run's items

Each persisted accepted-turn part carries the Run id, as prompt-import and
activation parts already do. Preparation looks for parts of the current Run on
the user message first; when present they are the attempt's accepted-turn
items and every producer skips authoring. Their text is reused verbatim, which
keeps the cached prefix stable.

### D3. In-Run items are Run events

`onStepStart` appends a `context.item` Run event carrying the part, through the
same ordered event writer as `tool.requested`, before the step request. The
durable reconstructor replays it into the collector at its position, and
settlement keeps rail parts for every outcome, so `withoutContextItems` is
deleted. The stream bridge does not forward the event; the owner sees the part
when the assistant message settles, as today.

### D4. The switch baseline is the latest prior reply's model

The baseline is the model id recorded on the most recent prior Run whose
assistant message exists, whatever its status, which equals today's
any-status lookup restricted to Runs that produced a reply. A Run that never
dispatched has no reply and does not move the baseline.

### D5. The per-Run record is removed

A migration drops `runs.context_items`. `recordContextItems`, the
`updateForAttempt` field, the controller route, the DTOs, and the OpenAPI
operation are deleted, and the web client is regenerated. `BuiltContext`
keeps its in-memory item list only where request assembly needs it.

## Risks / Trade-offs

- [The pre-dispatch transaction lengthens time to first token] → It replaces
  the existing pre-dispatch `updateForAttempt` write with one transaction of
  the same order, measured in the implementation layer.
- [A crash between the transaction and the request] → The items are then in
  history though no request carried them. A retry reuses them (D2) and sends
  them; an `outcome_unknown` Run keeps them as context the model may have
  seen, which is the conservative reading.
- [Breaking API change] → The endpoint has no UI consumer; the changelog marks
  it breaking.
- [Larger replays after failures] → A failed Run's context now replays like a
  completed Run's, which is the point of the change.
