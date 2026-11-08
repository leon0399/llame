# Design: in-Run steering

## Context

See [proposal.md](proposal.md) for the motivation. Facts below are from `master` at `4cfa917`,
with `ai@6.0.256`.

- **Admission.** `POST /api/v1/chats/:id/messages` runs `ChatLoopService.createMessageStream`
  (`apps/api/src/chats/chat-loop.service.ts:170`). One transaction locks the chat row, clears the
  single-flight slot (`chats/chat-admission.ts:70`), stores the user message, and creates the Run
  (`chats/run-creation.ts:61`). A live Run gives 409. The pg-boss job id is the Run id
  (`runs/run-dispatch.service.ts:51`). `validateTurn` neutralizes text and resolves owner media
  (`chat-loop.service.ts:204-230`).
- **Loop.** `executeRun` returns one `streamText` result per attempt
  (`runs/run-execution.service.ts:1069-1071`). The worker drains it and requires a terminal Run
  afterwards (`runs/runs-worker.service.ts:271-285`). Completion is written in `onFinish`
  (`run-execution.service.ts:2485-2560`); failure and abort in `onError` (`:2383-2483`). The
  clients own `stopWhen` (`models/openai-model-client.ts:129`). `prepareStep` calls `onStepStart`
  only when tools exist (`models/step-composer.ts:556`).
- **Dispatch.** `dispatchAttempt` (`run-execution.service.ts:5594-5680`) fences the attempt,
  stores accepted-turn items on the job's user message, creates or resets its reply, and appends
  `model.requested` once per attempt. A completed reply makes the dispatch throw
  `ReplyAlreadyCompletedError`, and the salvage branch settles the Run `completed`
  (`:1361-1386`). `rebuildContextForChat` (`:2633-2700`) is the one history projection, keyed by a
  maximum `seq`.
- **Replies.** `messages.in_reply_to` is unique (`db/schema/chats.ts:228-310`): one reply per
  user row. `messages.seq` is dense per Chat (`chats/message-sequence.ts:47`). The finalizer finds
  the reply through `run.messageId` (`runs/run-reply-finalizer.ts:420-426`) and rebuilds a
  non-completed reply from the Run log.
- **Follow-ups.** `latestTurnRun` requires `latestRun.messageId === userMessage.id`
  (`chats/follow-up-admission.service.ts:540`); the web places turn actions by the same id.
- **Cancel.** `PATCH /api/v1/runs/:id` stamps `cancel_requested_at`
  (`runs/runs-repository.ts:491`) and aborts an in-process `AbortController`
  (`runs/run-abort-registry.ts`, `Map<runId, AbortController>`). Another process does not see it
  until pickup (#207). Native `bind` refuses work once `cancel_requested_at` is set
  (`native-files-repository.ts:104-123`).
- **Tool settlement.** `settleToolsOnParentAbort` (`run-execution.service.ts:2085-2147`) listens
  on the Run signal. `toolTerminationResult` (`runs/tool-settlement.ts:14-38`) gives `bash`,
  `edit`, and `write` `outcome_unknown` and every other tool `cancelled`. The MCP unknown result
  comes from `unknownMcpExecution` (`tools/runner.ts:478-486`). An unknown native mutation aborts
  the loop (`run-execution.service.ts:1985-1998`). The bash settlement grace is 750 ms
  (`tools/runner.ts:65`). MCP tools are not in the static registry (`tools/registry.ts:60-64`).
- **Reasoning stream.** `stream-parts.ts:118-130` folds reasoning start, delta, and end into one
  callback and drops an end with no metadata.
- **Recovery.** A redelivered Run with any `native.attempt` fails `outcome_unknown`
  (`run-execution.service.ts:1134-1157`, `hasMutation`).
- **Live.** One `LISTEN llame_changes` connection per API process
  (`apps/api/src/live/change-listener.ts`). Triggers are hand-written migrations
  (`20261016125611_live_change_notify.sql`). Payloads are ids only.
- **Stream.** `RunStreamBridge` replays a Run's events into one AI SDK UI message from sequence 0
  (`runs/run-stream-bridge.ts:419-423`); its poll loop has a private cursor (`:459-462`). The web re-attaches to a Run whose
  stream ended while it still executes (`use-chat-history-sync.ts:72-74`).
- **Web.** `chat-composer.tsx:112-115` swaps Send for Stop while a Run streams, and
  `use-chat-conversation.ts:103-107` drops Enter. Context items render only for a fixed producer
  list (`message-visibility.ts`).

### Prior art

The #1622 research notes are summarized in the PR description.

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
survives worker restarts; interrupt and cancel in every deployment topology; reuse of the
existing attempt machinery for each segment.

**Non-Goals:** see the proposal.

## Decisions

### D1: A `chat_deliveries` table holds pending items

Columns: `id` (the client message id), `chat_id`, `owner_user_id`, `producer` (`owner`),
`sender_ref` (null for `owner`), `mode` (`steer | interrupt | queue`), `parts` (neutralized),
`attachments`, `settings` (`modelId`, `effort`, `permissionMode`), `state`
(`pending | delivered | withdrawn`), `position` (bigint), `delivered_message_id`, `run_id`,
`created_at`, `updated_at`. A composite FK `(chat_id, owner_user_id)` to
`chats_id_owner_user_id_unique_idx`, as `runs_chat_id_user_id_fk` does, makes the owner match the
Chat. Enabled and forced RLS by `owner_user_id`. A partial index on `(chat_id, position) WHERE
state = 'pending'`. Rows cascade with the Chat. The table comes from a generated migration with
hand-added `FORCE ROW LEVEL SECURITY`; the live trigger is a separate hand-written migration that
extends `llame_notify_change()`.

Rejected: pending items as `messages` rows. Dense immutable `seq` and the unique `in_reply_to`
would give a pending row a position before delivery, and every reader of `messages` would need a
filter. Rejected: `run_events` as the queue; an item outlives its Run.

### D2: Admission reuses the chat send path

`CreateMessageDto` gains optional `delivery`. Inside the admission transaction, after the chat
row lock:

1. Look up `chat_deliveries` by the message id. A hit answers that item; nothing else runs.
2. Run single-flight admission as today. A stuck blocker is expired as today.
3. With a live blocker and `delivery`, insert the item and answer 202. Without `delivery`, 409.
4. With no blocker, start a Run as today, whatever `delivery` says.

An `interrupt` item, or a `PATCH` to `interrupt`, sends `NOTIFY llame_run_control` in the same
transaction; Postgres delivers it on commit. `GET`, `PATCH`, and `DELETE` under
`/api/v1/chats/:chatId/deliveries` are conditional updates `WHERE chat_id = :chatId AND state =
'pending'`; zero rows give 409. A `PATCH` on an idle Chat promotes the item into a Run in the same transaction (the
promotion path of D5).

### D3: A segment is a new attempt with its own `streamText` call

A delivery moves `runs.message_id` to the delivered message and writes a fresh `activeAttemptId`
in the delivery transaction. It appends no `run.started`, so native admission, which keys on the
latest `run.started` (`native-files-repository.ts:23-34`), keeps the claim's delivery sequence.
The executor then prepares the new attempt for that message: prompt and receipt, accepted-turn
items, prompt imports, `$skill` activation, and the first dispatch, which creates the reply
`in_reply_to` the delivered message. Every attempt, including a crash retry, reads the Run's
current `message_id` from the Run row, not the user message in the job payload. That removes the
salvage-branch failure: a retry in segment 3 dispatches for the segment-3 message.

The attempt machinery needs these changes to work per segment:

- **First dispatch or retry.** Accepted-turn producers decide "first dispatch" from
  `runs.turn_tool_availability` today (`run-execution.service.ts:5321-5322`). The decision moves
  to "a `model.requested` exists after the latest `run.delivered`". Baseline queries that join
  `runs.message_id` with `seq <` read the Run of an earlier reply through the reply's usage `runId`
  instead, so they still see the Run's earlier segments.
- **Follow-up state.** `loadContinueState` and the Regenerate notice apply only when no
  `run.delivered` exists, so only the first segment seeds the kept parts.
- **Compaction.** Pre-step compaction planning runs only for attempts of the first segment. A
  segment start or a retry in a later segment skips it.
- **Completeness.** `run.delivered` carries the new `attemptId`. The completeness check counts only
  receipts of attempts after the latest `run.delivered`, so a segment attempt does not mark the
  final reply incomplete.
- **Baselines.** The delivery transaction writes the first-epoch baselines (`recencyDigest`
  initialization, `skillCatalogFreeze`) that `finishRun` writes for a completed first Run, when the
  closed reply is the first segment of the Chat's first Run.
- **Title.** Title generation reads the message of `run.created`, not the Run's current message.

`executeRun` keeps its signature. It returns a result, built on `wrapStreamTextResult`, whose
`consumeStream()` drains every segment and resolves only when the Run is terminal. The worker
contract and the 319 test call sites keep their shape. `ModelStreamInput` gains a `stopWhenExtra`
predicate that each client, the scripted client included, ORs into its own `stopWhen`; the SDK
awaits async predicates after the step's tool calls settle (`ai` `dist/index.mjs:4221-4226`). The
predicate runs one owner-scoped query for pending `steer` and `interrupt` items and for
`cancel_requested_at`, so a lost cancel signal is also found at a step end. In `onFinish`, a stop
that this predicate caused is a segment end: the executor runs D4 instead of `finishRun`. When D4
finds no pending item (the owner withdrew it), the executor sends the next request in the same
segment with another `streamText` call over the same reply.

Rejected: injecting steers as in-Run context items on the running reply. The owner's words would
be assistant parts, a crash reset would delete them, and search and forks would not see an owner
message.

### D4: Delivery is one fenced transaction

The delivery transaction first updates the Run row, fenced by `activeAttemptId` and by
`cancel_requested_at IS NULL`, then locks the chat row. This is the order of the terminal
transaction and of chat deletion: Run row, then chat row (`run-execution.service.ts:4827-4831`,
`chats/chats.service.ts:466-482`). A miss on the cancel fence leaves the items pending, and the
cancellation then moves them to the queue. The transaction finalizes the current reply: status `completed` for a steer, `aborted` with `complete: false` for an interrupt. The
segment usage is published as a run event before `run.delivered`. It then inserts the user row
(next `seq`, `senderUserId` = owner, a new id) and marks the items `delivered` with that id. It
moves `runs.message_id`, writes the new attempt id, and appends `run.delivered` with
`{messageId, deliveryIds, cause, stoppedCalls, attemptId}`.

A crash before commit leaves items `pending`; the retried attempt reads history through the Run's
current message and delivers them at its first boundary. A crash after commit finds the delivered
row as the Run's message, so the items never repeat. `hasMutation` reads only the events after the
latest `run.delivered`. The finalizer looks up the reply through the moved `message_id`, so it
never touches an earlier segment, and its rebuild window starts after the latest `run.delivered`.
One `run.delivered` type with `cause` covers grilling D12's "new event types".

### D5: Completion and promotion share the terminal transaction

The completing transaction updates the Run row, then locks the chat row, then checks for pending
`steer` and `interrupt` items. If any exist it runs D4 and the loop continues. Admission takes the same lock, so a steer
is either seen by the completion or admitted after it into an idle Chat. Otherwise the transaction
marks the Run `completed`, takes the lowest-`position` `queue` item, validates its settings like a
send, inserts its user row with the item id, creates its Run, and enqueues it after commit under
the fail-fast rule of `durable-runs`. An item that no longer validates stays pending.

`RunsRepository.markFinished` moves pending `steer` and `interrupt` items to `queue`, with
positions below the current minimum, whenever it writes `failed`, `cancelled`, or `expired`. It
updates the Run row, then takes the chat-row lock before the move, so an admission that read the
Run as live commits its item first and the move sees it. Every terminal writer (admission expiry,
claim-time transitions, `finishRunInTransaction`, the reply finalizer,
`settleCancelledBeforeStart`, `expireDeadLetteredRun`, `failRunTransactionally`, and
`cancelActiveRunsForMessage`, which today bypasses it) goes through it. The paused state is
derived, not stored.

The salvage branch is a completion like any other. When its completion check finds pending items,
it runs D4 and the attempt continues the segment loop instead of throwing `RunNotRunnableError`.

Promotion validates the stored model, effort, and permission mode against the current catalog and
`tools.permissionModes`. Media were resolved and owner-checked at admission and stay owner-scoped,
so the worker does not need `MediaService`.

### D6: A run-control channel reaches the executing worker

Each process whose job-queue profile consumes `runs` (`concurrencyFor('runs') !== null`, which
includes an API process that runs Runs) holds one postgres.js `LISTEN llame_run_control`
connection, built like `PostgresChangeListener`. The payload is `{runId, kind}` with `kind`
`interrupt` or `cancel`. The abort registry stores `{controller, segmentController, userId}`. The payload is a pointer: the
listener confirms `cancel_requested_at` or a pending `interrupt` item in the owner's tenant scope
before it acts. A `cancel` aborts the Run controller. An `interrupt` aborts the segment controller
only while a model request or a tool call is in flight; otherwise the item waits for the next step
end or final answer, as a steer does. On every
(re)connect the listener re-reads, in each owner's tenant scope, the cancellation and pending
interrupts of the Runs it executes. The step-end query of D3 also finds interrupts, which bounds
a lost signal to one step. Every cancel path switches from in-process `aborts.abort` to the channel:
`PATCH /runs/:id`, chat deletion (`chats/chats.service.ts:479-481`), and superseded-Run aborts
(`chats/chat-loop.service.ts:253`, `:291`). This closes #207.

Rejected: a polled flag (seconds of latency and one query per Run per tick); in-process only
(Interrupt degrades to Steer in a dedicated-worker deployment).

### D7: Interrupt settles calls by declared fate

The static registry gains `interruptFate`: `cancel` for `read_only` tools and `bash`, `finish` for
every other tool. The attempt tool binding gives each dynamic MCP tool `cancel`. On interrupt:

1. The segment controller aborts with reason `INTERRUPT`. The executor's `onError` checks that
   reason before `classifyAbortedRun` and routes to interrupt settlement, not `finishRun`.
2. `settleToolsOnParentAbort` listens on the segment signal too. Each open `cancel` call gets a
   per-call interrupt signal, `AbortSignal.any([run, interrupt])` in its tool context. The signal is
   separate from `cancel_requested_at`, so native fencing stays intact. A rejection from that
   signal leaves the call open for interrupt settlement, as a parent-abort rejection does.
3. The executor waits for `finish` calls, and for `bash` within its 750 ms grace.
4. It settles each open call once, with `providerMetadata.llame.interrupted`:
   - a `read_only` call: `cancelled` with the spec text;
   - `bash`: the `bash-execution` cancellation result (known exit status or `outcome_unknown`);
   - an MCP call with a recorded `native.attempt` of operation `mcp`: `unknownMcpExecution`, with a
     recorded `native.result`, so a later retry does not see an unsettled attempt;
   - a call that never started: `cancelled` with the not-executed text.
5. It runs D4 with cause `interrupt` and the stopped `bash` and MCP calls in `stoppedCalls`.

The next segment's dispatch authors the `interrupted` item from the `run.delivered` payload, as an
accepted-turn producer, first in precedence. `background` is a reserved enum value with no
implementation; #1051 adds it.

### D8: The projection drops reasoning with no later part

The rule needs no open-or-closed signal from the stream, which the Chat Completions wire does not
give (`openai-completions-model-client.ts:345-366` routes reasoning through `onChunk`, which
carries no `reasoning-end`). An interrupt stops the stream, so the cut reasoning part is the last
part of the reply. In a reply whose usage status is `aborted` from an interrupt, the `turn-replay`
projection omits each reasoning part that has no later kept part. That covers the cut part and a
completed reasoning item with nothing after it, which OpenAI Responses rejects. The collector
still marks the cut part with `providerMetadata.llame.interrupted: true` for the transcript. A tool
call is a stored part only after the SDK emits the complete call, so incomplete arguments never
reach storage.

A live probe against the Anthropic Messages API must accept a request that keeps a signed block of
an interrupted reply and drops the open one, before the `interrupt` layer relies on it.

### D9: The UI stream covers one segment

`RunStreamBridge` ends the current UI message at `run.delivered` with a `data-run-delivered`
part (`{messageId}`) and `finish`. `createUiMessageStreamResponse` gains a start-sequence
parameter, and the resume path passes the sequence of the latest `run.delivered`. The web adopts history on that part, then attaches the resume
stream for the next segment. The `start` frame keeps the Run id, so cancel keeps working.

### D10: Live pending items use the change hub

The `chat_deliveries` trigger sends a pointer on `llame_changes`. The hub loads the Chat's pending
items in the owner's tenant scope and sends a new `chat.deliveries` message. The AsyncAPI document
and `live-protocol.ts` are regenerated.

### D11: The web composer

The Send control becomes a `ButtonGroup` with a `DropdownMenu` while a Run is active: Steer
(Enter), Interrupt, Queue (Mod+Enter, `aria-keyshortcuts`). The pending stack renders rows from
`GET /deliveries` plus live updates, with achromatic `rounded-md` rows per `DESIGN.md`. A delivery send is a plain
`fetch` to the messages route, outside the `useChat` transport, because its answer is 202 JSON.
Edit is `DELETE`; the response fills the composer, and the next send uses a new message id. Stop and Esc
`PATCH` the first pending steer to `interrupt` when one exists, otherwise they send the cancel
request. `message-visibility.ts` gains a renderer for the `interrupted` producer. Turn actions
follow `latestRun.messageId`, which a delivery moves.

## Risks / Trade-offs

- [Several replies per Run touch every reader that assumed one] → Each reply keeps `in_reply_to`
  its own user row, and the Run's `message_id` always names the current one; the proposal lists
  each reading of an unchanged requirement, and the `steer` layer tests Continue and Regenerate on
  a delivered message.
- [A long steered Run can outgrow the context window, because a segment start does not compact]
  → It then fails with the provider's error, as a long tool loop does today. Segment compaction is
  a follow-up that needs the compaction specs changed together.
- [A lost NOTIFY delays an interrupt until the next step end] → Reconnect re-reads state; the item
  is never lost. A long `bash` call without a step end still waits for its call timeout then.
- [The Anthropic probe fails for kept signed blocks] → Fall back to the OpenCode rule (no
  reasoning of the interrupted reply replays) through a proposal amendment before `interrupt`
  merges.
- [An interrupt during a native `write` or `enter_workspace` waits for it] → Both are bounded by
  the call timeout and usually take milliseconds to seconds.
- [Steering makes Runs longer] → Each segment reports its own usage; the owner sees the cost per
  reply.
- [The segment and interrupt work is large] → Each is split into two layers (see tasks.md);
  re-measure at each boundary.

## Migration Plan

Additive: the `chat_deliveries` table with RLS and the composite key, and the trigger migration.
Old clients never send `delivery` and keep the 409. Rollback stops the web from sending `delivery`
first, then drops the trigger and the table; delivered messages stay ordinary user rows, and Runs
keep their moved `message_id`.

## Open Questions

None that change the specs or the stack. The exact visual of the pending stack follows `DESIGN.md`
and is reviewed in the `web` layer's Storybook stories.

## Revision history

- **v3 (2026-11-08):** Round 2 (spec consistency 3 P1 / 12 P2; feasibility 5 P1 / 10 P2 / 6 P3;
  no P0). Accepted: follow-up rules only in the first segment (turn-actions delta); per-segment
  first-dispatch detection, baseline lookups, completeness by `run.delivered.attemptId`, title,
  and baselines listed as real code changes; no compaction at a segment start (compaction delta
  dropped); execution ceiling from the claim (durable-runs delta); `$skill` and prompt-import
  deltas; withdrawal race continues the segment; Run-then-chat lock order; cancel fence in D4;
  `markFinished` move under the chat lock and `cancelActiveRunsForMessage` routed through it;
  salvage continues; interrupt signal only with work in flight; listener checks state in the owner
  scope; all cancel paths on the channel; recorded `native.result` for stopped MCP calls; D8
  without `onReasoningEnd`; bridge start-sequence parameter; fetch for delivery sends; `chat_id`
  filter; settings-only promotion validation; layer splits. Rejected: none.
- **v2 (2026-11-08):** Round 1 (spec consistency 13 P1 / 15 P2; feasibility 9 P1 / 9 P2; no P0).
  Accepted: each segment is a new attempt for the delivered message and moves `runs.message_id`
  (fixes the finalizer, salvage, follow-up, and usage findings); MODIFIED deltas for the final
  projection, usage completeness, and the compaction trigger; the usage aggregate delta dropped;
  pending items only for a live blocker; idempotency lookup first; composite Chat-owner key;
  interrupt items in the completion check and the pause move; interrupt settlement marker and
  at-most-once rule; `finish` fate for Workspace tools; interrupt with no work in progress;
  `onError` interrupt routing; `onReasoningEnd`; corrected line citations and MCP settlement;
  `steer` layer split. Changed decision: bash follows `bash-execution` cancellation (proposal
  deviation). Rejected: none.
- **v1 (2026-11-08):** Initial draft from the #1622 grilling.
