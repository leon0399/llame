# Design: in-Run steering

## Context

See [proposal.md](proposal.md) for the motivation. Facts below are from `master` at `4cfa917`.

- **Admission.** `POST /api/v1/chats/:id/messages` runs `ChatLoopService.createMessageStream`
  (`apps/api/src/chats/chat-loop.service.ts:170`). One transaction locks the chat row, clears the
  single-flight slot (`chats/chat-admission.ts:70`), stores the user message, and creates the Run
  (`chats/run-creation.ts:55`). A live Run gives 409. The pg-boss job id is the Run id
  (`runs/run-dispatch.service.ts:43`).
- **Loop.** One AI SDK `streamText` call per attempt (`runs/run-execution.service.ts:2164`).
  `prepareStep` calls `onStepStart` only when tools exist (`models/step-composer.ts:556`). The
  executor's `onStepStart` (`run-execution.service.ts:2183-2220`) already stages in-Run context
  items and commits them before the request that carries them.
- **Dispatch.** `dispatchAttempt` (`run-execution.service.ts:5594-5680`) fences the attempt,
  stores accepted-turn items on the trigger row, creates or resets the running reply, and appends
  `model.requested`, once per attempt.
- **Replies.** `messages.in_reply_to` is unique (`db/schema/chats.ts:228-310`): one reply per
  user row. `messages.seq` is dense per Chat and allocated in the writing transaction
  (`chats/message-sequence.ts:47`).
- **Cancel.** `PATCH /api/v1/runs/:id` stamps `cancel_requested_at`
  (`runs/runs-repository.ts:491`) and aborts an in-process `AbortController`
  (`runs/run-abort-registry.ts`). A worker in another process does not see it until pickup
  (#207). Native `bind` refuses work once `cancel_requested_at` is set
  (`native-files-repository.ts:96-110`), so interrupt cannot reuse that flag.
- **Tool settlement.** `settleToolsOnParentAbort` (`run-execution.service.ts:2124-2157`) and
  `toolTerminationResult` (`runs/tool-settlement.ts`) settle `bash` and native mutations as
  `outcome_unknown`, other tools as `cancelled`. An unknown native `edit`/`write` aborts the loop
  (`run-execution.service.ts:2023-2036`).
- **Recovery.** A redelivered Run with any `native.attempt` fails `outcome_unknown`
  (`run-execution.service.ts:1134-1157`, `hasMutation`). Otherwise the retry runs the whole
  attempt again from the trigger row.
- **Live.** One Postgres `LISTEN llame_changes` connection per API process
  (`apps/api/src/live/change-listener.ts`) fans pointer notifications out to the WebSocket
  gateway; messages validate against `apps/api/asyncapi.websocket.yaml`.
- **Stream.** `RunStreamBridge` (`runs/run-stream-bridge.ts`) replays all events of the active Run
  into one AI SDK UI message, starting with `start {messageId: runId}`.
- **Web.** The composer swaps Send for Stop while a Run streams and drops Enter
  (`apps/web/app/(chat)/components/use-chat-conversation.ts:103-107`). Stop calls
  `use-pending-stop.ts`. Context items render only for a fixed producer list
  (`message-visibility.ts`).

### Prior art

Source notes from the #1622 research live in the PR description; the main facts are below.

| Harness     | Steer boundary                                                 | Interrupt                                      | Pending input durable | Partial output after interrupt                |
| ----------- | -------------------------------------------------------------- | ---------------------------------------------- | --------------------- | --------------------------------------------- |
| oh-my-pi    | after the tool batch and at would-stop                         | aborts the run; a new run starts               | no                    | completed blocks kept, open block dropped     |
| Codex CLI   | top of each loop pass; a pending steer forces one more request | ends the turn                                  | no                    | completed items kept; `<turn_aborted>` notice |
| Claude Code | between tool calls                                             | `priority:"now"` backgrounds work, else aborts | undocumented          | text kept; dangling thinking causes 400s      |
| OpenCode    | after the tool batch                                           | `interrupt({resume})` starts a successor       | yes (SQLite inbox)    | text and calls kept, reasoning dropped        |
| OpenClaw    | after the batch; skips the unstarted sequential tail           | aborts                                         | custody state machine | completed calls kept                          |

No inspected harness continues the same Run after an interrupt or delivers steering durably and
exactly once. OpenCode's inbox (delivery event, message insert, and pending-row delete in one
transaction) is the closest model for D4.

## Goals / Non-Goals

**Goals:** one queue table that later producers reuse unchanged; exactly-once delivery that
survives worker restarts; interrupt and cancel in every deployment topology.

**Non-Goals:** see the proposal. This design also keeps compaction at Run start only.

## Decisions

### D1: A `chat_deliveries` table holds pending items

Columns: `id` (the client message id), `chat_id`, `owner_user_id`, `producer` (`owner`),
`sender_ref` (null for `owner`), `mode` (`steer | interrupt | queue`), `parts` (neutralized),
`attachments`, `settings` (`modelId`, `effort`, `permissionMode`), `state`
(`pending | delivered | withdrawn`), `position` (bigint), `delivered_message_id`, `run_id`,
`created_at`, `updated_at`. Enabled and forced RLS by `owner_user_id`, like `messages`. A partial
index on `(chat_id, position) WHERE state = 'pending'`. Rows cascade with the Chat.

`messages` gains a nullable `delivered_by_run_id` FK. It marks a delivered message and names its
Run for `turn-actions`.

Rejected: storing pending items as `messages` rows. Dense immutable `seq` and the unique
`in_reply_to` would give a pending row a position before it is delivered, and every reader of
`messages` would need a filter.

Rejected: `run_events` as the queue. It is append-only per Run, and a queue item outlives its Run.

### D2: Admission reuses the chat send path

`CreateMessageDto` gains optional `delivery`. In the admission transaction, after the chat row
lock, a live blocker and a `delivery` value insert a `chat_deliveries` row instead of the 409.
The answer is 202 with the item. The single-flight index stays untouched because no Run is
created. An `interrupt` item, or a `PATCH` to `interrupt`, sends `NOTIFY llame_run_control` in
the same transaction. Postgres delivers a NOTIFY only on commit.

`GET`, `PATCH`, and `DELETE` under `/api/v1/chats/:chatId/deliveries` are conditional updates
`WHERE state = 'pending'`; zero rows gives 409.

### D3: A segment is one `streamText` call inside the attempt

The attempt prepares its system prompt, tools, receipt, and accepted-turn items once, as today.
The executor then runs a segment loop: build the request through the `turn-replay` projection of
the history through the current segment's user row, then call `streamText` with a per-segment
`AbortController` composed with the Run signal.

At each step end the executor reads the pending `steer` and `interrupt` items of the Chat (one
indexed owner-scoped query). A `stopWhen` condition ends the call when one exists. The step cap
(`stepCountIs`) is per call, so it is per segment with no extra code.

Rejected: injecting steers as in-Run context items on the running reply. It keeps one reply per
Run, but the owner's words would be assistant-message parts, a crash reset would delete them, and
search and forks would not see an owner message.

### D4: Delivery is one fenced transaction

The delivery transaction locks the chat row, fences `activeAttemptId`, finalizes the current
reply (status `completed` for a steer boundary, `aborted` for an interrupt) with that segment's
usage, inserts the user row (next `seq`, `senderUserId` = owner, `delivered_by_run_id`), marks
the items `delivered` with that message id, attaches the `interrupted` item when the cause is an
interrupt, and appends `run.delivered`. The next segment's dispatch transaction then creates its
reply `in_reply_to` the delivered row and appends `model.requested` for the segment.

A crash before commit leaves items `pending`; the retried attempt reads history through the
latest delivered row (the current segment) and delivers them at its first boundary. A crash after
commit finds the delivered row in history, so the items never repeat. `hasMutation` narrows to the
events after the latest `run.delivered`. Terminal settlers rebuild only the current segment's
reply from that window.

### D5: Completion and promotion share the terminal transaction

The completing transaction locks the chat row before it checks for pending `steer` items. If any
exist it runs D4 instead and the loop continues. Admission takes the same lock, so a steer is
either seen by the completion or admitted after it into an idle Chat (a new Run). Otherwise the
transaction marks the Run `completed`, takes the lowest-`position` `queue` item, validates its
settings like a send, inserts its user row, creates its Run, and enqueues it after commit with the
fail-fast rule of `durable-runs`. An item that no longer validates stays pending.

The `failed`, `cancelled`, and `expired` terminal transactions move pending `steer` items to
`queue` with positions below the current minimum, in their order. No promotion happens, which is
the paused state; it is derived, not stored.

### D6: A run-control channel reaches the executing worker

Each worker process holds one postgres.js `LISTEN llame_run_control` connection, built like
`PostgresChangeListener`. The payload is `{runId, kind: "interrupt" | "cancel"}`. The listener
aborts the matching controller in the in-process registry: the Run controller for `cancel`, the
segment controller for `interrupt`. On every (re)connect the listener re-reads cancellation and
pending interrupts for the Runs it executes. The step-end query of D3 also finds interrupts, which
bounds a lost signal to one step. Cancel switches from the in-process-only `aborts.abort` to the
channel, which closes #207.

Rejected: polling a flag during a model request (seconds of latency and one query per Run per
tick); in-process only (Interrupt degrades to Steer in a dedicated-worker deployment).

### D7: Interrupt settles calls by declared fate

The tool registry gains `interruptFate`. Native `edit`/`write` (including `kb://`) declare
`finish`; every other tool declares `cancel`. On interrupt the executor:

1. aborts the segment controller, which stops the model stream;
2. gives each open `cancel` call a per-call interrupt signal (separate from the Run signal and
   from `cancel_requested_at`, so native fencing stays intact);
3. waits for `finish` calls and for `bash` within its existing settlement grace;
4. settles read-only calls `cancelled` with "The owner interrupted this call before it finished.
   It made no change. Run it again if you still need it.", `bash` and sent MCP calls through
   `toolTerminationResult` (`outcome_unknown`), and unstarted calls with the not-executed text;
5. runs D4 with cause `interrupt`.

`background` is a reserved enum value with no implementation; #1051 adds it.

### D8: The collector keeps completed blocks

The assistant part collector already stores text, reasoning, and tool parts as they arrive. On an
interrupt, the reasoning part that is open (no closing event observed) gets
`providerMetadata.llame.interrupted: true`. The `turn-replay` projection omits a part with that
marker and keeps everything else, which gives D8 of the grilling. A tool call is a stored part
only after the AI SDK emits the complete call, so incomplete arguments never reach storage.

The rule that a kept reasoning part needs a following kept part (OpenAI Responses requires an
output item after a reasoning item) is checked in the projection. A completed reasoning part with
nothing after it is omitted.

The Anthropic rule against partial edits applies to the latest assistant message; after delivery
the latest message is the delivered user row. A live probe against the Anthropic Messages API
must accept a request that keeps a signed block and drops the open one before L3 relies on it.

### D9: The UI stream covers one segment

`RunStreamBridge` ends the current UI message at `run.delivered` with a `data-run-delivered`
part (`{messageId}`) and `finish`. The resume path replays events after the latest
`run.delivered`. The web adopts history on that part, then attaches the resume stream for the
next segment. The `start` frame keeps the Run id, so cancel keeps working.

### D10: Live pending items use the change hub

An `AFTER` trigger on `chat_deliveries` sends a pointer on `llame_changes`. The hub loads the
Chat's pending items in the owner's tenant scope and sends a new `chat.deliveries` message. The
AsyncAPI document and `live-protocol.ts` are regenerated.

### D11: The web composer

The Send control becomes a `ButtonGroup` with a `DropdownMenu` while a Run is active: Steer
(Enter), Interrupt, Queue (Mod+Enter, `aria-keyshortcuts`). The pending stack renders rows from
`GET /deliveries` plus live updates, with achromatic `rounded-md` rows per `DESIGN.md`. Edit is
`DELETE`, then the response fills the composer. Stop and Esc call `PATCH` to `interrupt` on the
first pending steer when one exists, otherwise the cancel request. A visible renderer is added
for the `interrupted` producer in `message-visibility.ts`.

## Risks / Trade-offs

- [One Run, several replies, touches every reader that assumed one reply per Run] → Each
  segment reply keeps `in_reply_to` its own user row, so `messages` invariants hold; the proposal
  lists each reading of an unchanged requirement, and L2 tests Continue and Regenerate on a
  delivered message.
- [A long steered Run can outgrow the context window, because compaction runs only at Run start]
  → Same failure class as a long tool loop today (`context_incompatible`); segment compaction is a
  follow-up.
- [A lost NOTIFY delays an interrupt until the next step end] → Reconnect re-reads state; the item
  is never lost. A long `bash` call without a step end still waits for its call timeout in that
  case.
- [The Anthropic probe fails for kept signed blocks] → Fall back to the OpenCode rule (drop all
  reasoning of the interrupted segment); the spec scenario changes in the proposal before L3.
- [Interrupt during a native `write` waits for it] → Writes are bounded by the call timeout and
  usually take milliseconds.
- [Steering makes Runs longer and uses more tokens] → Each segment reports its own usage; the
  owner sees the cost per reply.
- [L2 is the largest layer] → Re-estimate at its start; split promotion into its own layer if it
  passes the budget.

## Migration Plan

One additive migration: `chat_deliveries` with RLS policies and the live trigger, and
`messages.delivered_by_run_id`. Old clients never send `delivery` and keep the 409. Rollback drops
the column and the table after the web stops sending `delivery`; delivered messages stay ordinary
user rows.

## Open Questions

None that change the specs or the stack. The exact visual of the pending stack follows
`DESIGN.md` and is reviewed in L4 Storybook stories.

## Revision history

- **v1 (2026-11-08):** Initial draft from the #1622 grilling.
