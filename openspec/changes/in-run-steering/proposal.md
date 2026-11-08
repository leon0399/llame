## Why

A message the owner sends while a Run is active gets 409 today, and the web drops it. The owner
can only cancel the Run and send again. Peer harnesses deliver such a message inside the active
Run at the next step boundary. Subagents need the same: a child that ends with `yield` must see a
steer from its parent or owner before it yields, not one Run later
([#1622](https://github.com/leon0399/llame/issues/1622), foundation F5 of
[#1612](https://github.com/leon0399/llame/issues/1612), prerequisite of
[#765](https://github.com/leon0399/llame/issues/765)). It also takes over the user-message half
of [#782](https://github.com/leon0399/llame/issues/782).

## What Changes

- A durable, producer-agnostic delivery queue per Chat. A chat send that names a `delivery`
  mode while a Run is active becomes a pending item, not a Run. This change ships one producer:
  the owner.
- Three delivery modes per message:
  - **Steer** (composer default): delivered at the next step boundary of the same Run, after
    the model response and every tool result of the step. A steer that is pending at the final
    answer makes the Run take another step.
  - **Interrupt**: stops the current step at once and continues the same Run with the message.
    The model request aborts. Read-only tools are cancelled, `bash` is killed, sent MCP calls
    settle as `outcome_unknown`, and native `edit`/`write` finish.
  - **Queue** (explicit): delivered after the Run completes, as the input of a new Run, one
    item per Run.
- All steers pending at one boundary are delivered together as one user message. The message
  closes the current reply and opens a new reply. Each part of a Run between two delivered
  messages is a **segment** with its own reply, step budget, and crash-retry scope.
- An interrupted reply keeps its partial text, every complete tool call with a result, and its
  complete reasoning. The reasoning part that the interrupt cut is display-only. An
  `interrupted` context item tells the model what was stopped.
- A Postgres LISTEN/NOTIFY run-control channel carries interrupts and cancellations to the
  worker that executes the Run. Cancellation in another process now works
  ([#207](https://github.com/leon0399/llame/issues/207)).
- The owner can withdraw a pending item, edit it (withdraw, then the text goes back to the
  composer), or change it to Steer or Interrupt until it is delivered.
- The queue pauses after a Run that does not complete. Steers that were still pending become
  queue items at the head of the queue.
- Live updates: pending items reach every owner device, and each delivered batch is a Run
  event.
- Web: a split Send button (Steer on Enter, Queue on Mod+Enter, Interrupt in the menu) while a
  Run is active, a pending-item stack above the composer, and Stop/Esc that interrupts when
  steers are pending.

No change is **BREAKING**. A chat send without `delivery` keeps its 409 answer during an active
Run.

## Assumptions, confirmed with Leo

The grilling record is in the [#1622 decisions](https://github.com/leon0399/llame/issues/1622)
section. The codes below refer to it.

- grilling D1: one queue per Chat, owner-only producer in this change, forks copy no item.
- grilling D2: admission creates no Run and is idempotent on the message id; pending-item
  actions answer 409 after delivery.
- grilling D3: steer waits for the step end; a pending steer at the final answer continues the
  Run.
- grilling D4: one user row per steer batch, one text part per steer; the batch starts a new
  segment with a fresh step budget and its own retry scope.
- grilling D5: queue items drain one per Run with the settings captured at queue time; only a
  `completed` Run promotes the next item.
- grilling D6: LISTEN/NOTIFY run-control channel for interrupt and cancel.
- grilling D7: interrupt tool fate (`cancel | finish | background`, `background` reserved).
- grilling D8 (revised to option B after prior-art review): keep completed blocks, drop only
  the open block, add an `interrupted` item.
- grilling D9: the interrupting message and every pending steer form one batch.
- grilling D10, D11: split Send button; pending rows with `Steer now`, `Interrupt now`, delete,
  edit; Stop/Esc interrupts when steers are pending, otherwise cancels and pauses the queue.
- grilling D12: live pending items and Run events for delivered batches.
- grilling D13: background jobs, `wait`, the `background` fate, and auto-backgrounding on steer
  belong to [#1051](https://github.com/leon0399/llame/issues/1051).
- grilling D14: #1612 Q18, Q19, and Q8d hold for later producers and are specified with them.
- grilling D15: #782 skill-catalog notices become a later producer.

Assumptions that follow from those decisions but that the grilling did not ask:

- A send to an idle Chat starts a Run for every delivery mode, as today.
- A steer or an interrupt does not change the model, effort, or permission mode of the Run.
  The settings that a steer item carries are ignored.
- When a Run ends `failed`, `expired`, or `cancelled` through the API, its pending steers become
  queue items ahead of the existing queue items, in their order. Nothing starts until the owner
  acts.
- `Steer now` or `Interrupt now` on a paused item when no Run is active starts a Run with that
  item.
- Each segment is a new attempt of the Run for the delivered message. It prepares like the first
  attempt of a Run: the compaction check, accepted-turn context items, prompt imports, and
  `$skill` activations run for the delivered message.
- When a run-control notification is lost, the worker finds the interrupt at its next step
  boundary at the latest, so the item is delivered as a steer would be.

## Deviation from the grilling record

- grilling D7 named `outcome_unknown` for an interrupted `bash` call. The spec uses the
  cancellation rules of `bash-execution` instead: `outcome_unknown` unless the host proves the
  process group empty, then the observed exit status. The `interrupted` notice still names each
  stopped `bash` call and states that its effects are unknown. Leo to confirm.
- grilling D11 listed edit for every pending row; the first draft left it off steer rows. The
  spec now offers edit on steer rows too.

## Capabilities

### New Capabilities

- `run-steering`: the per-Chat delivery queue, the three delivery modes, segments, interrupt
  tool fates and output retention, pending-item actions, live updates, and the web composer
  surface for them.

### Modified Capabilities

- `durable-runs`: `Every message executes as a durable, resumable run` (a delivered message
  executes inside the live Run); `One in-flight run per chat (single-flight)` (a send with a
  delivery mode is admitted as a pending item); `Final assistant-message projection preserves
  replay order` (each segment has its own reply, and finalizers act only on the current one).
- `run-cancellation`: `A recorded cancellation settles the Run as cancelled` (cancellation
  reaches a worker in another process); `The Run stream identifies its Run at acceptance` (a
  stream covers one segment, and a resume replays the current segment).
- `tool-calling`: `Multi-step tool-calling run loop` (the step cap counts per segment);
  `No mid-run tool-state checkpointing (read-only slice; write-tool landmine)` (a retry restarts
  the current segment, and only a native attempt of that segment stops the Run).
- `context-injection`: `Co-occurring items have a total author-time order` (adds the
  `interrupted` producer, first in the order).
- `run-usage-accounting`: `Usage records whether it is complete` (a reply that a steer closed is
  complete, and only attempts for the same message count); `Compaction uses the final request's
  size, not the aggregate` (the trigger runs before each segment).
- `reasoning-output`: `Earlier reasoning replays only for the model that produced it` (the
  segments of one Run replay their reasoning like one turn; an interrupted reply drops the cut
  part and a part with no later part).

Deliberately unchanged, with the reading this change relies on. Each segment is an attempt of
the Run for the message of that segment, so rules that are scoped to one attempt hold per segment.

- `durable-runs` `Run claiming and completion are crash-safe`: a delivery assigns a fresh
  `activeAttemptId` in the fenced delivery transaction. Every rule for attempt-owned events,
  superseded workers, and native effect admission applies to that attempt.
- `run-usage-accounting` `Message usage aggregates every model request of its attempt`,
  `Reasoning tokens are known only when every request reported them`, `Stream performance
  metrics are recorded additively`, `Every terminal assistant turn keeps its known usage`, and
  `Live and reloaded usage agree`: "the attempt" is the attempt of one segment.
- `context-injection` `Server-authored context is injected as discrete items on one rail`: "the
  triggering user message" of a segment attempt is the message of the Run, which a delivery moves
  to the delivered message.
- `tool-calling` `Cooperative cancellation reaches tool execution` and `Termination settles
  in-flight tool activity`: they cover Run termination. An interrupt is not a termination, and
  `run-steering` gives it its own settlement rules.
- `turn-actions` (all requirements): a delivery makes the delivered message the message of the
  Run, so `latestRun.messageId` names it, and "the latest Run of the message" is that Run.
- `anthropic-messages-provider` `Thinking blocks are persisted and replayed complete and
  unmodified`: its pruning rule defers to the model rule of `reasoning-output`, which this change
  extends for interrupted replies. A cut part never closed as a block.
- `owner-chat-forks`: a fork copies messages and no Run state. Pending items are not messages.

## Impact

- API: `POST /api/v1/chats/:chatId/messages` gains an optional `delivery` field; new
  `GET`/`PATCH`/`DELETE` routes under `/api/v1/chats/:chatId/deliveries`; generated OpenAPI
  client.
- Database: new owner-RLS `chat_deliveries` table with a composite Chat-owner key and a
  live-change trigger. A delivery moves `runs.message_id` to the delivered message. One generated
  migration and one hand-written trigger migration.
- Worker: segment loop in `RunExecutionService`, step-boundary delivery, completion check,
  queue promotion, the steer-to-queue move in every terminal writer, a run-control listener in
  every process that executes Runs, per-step interrupt abort, and interrupt tool settlement.
- Live protocol: one new message type in `asyncapi.websocket.yaml`; new `run.delivered` run
  event and stream-bridge translation.
- Web: composer split button, pending stack, Stop/Esc logic, transcript rows; `DESIGN.md`
  gains the split-button and pending-row patterns.
- Docs: `SPEC.md` §9 (intro, §9.3–9.6, §9.8), `CHANGELOG.md`.

## Non-Goals

- Producers other than the owner: parent and child messages, job completions, and system
  updates ([#1612](https://github.com/leon0399/llame/issues/1612) F3/F4,
  [#782](https://github.com/leon0399/llame/issues/782)).
- Background jobs, `wait`, and moving tools to the background on interrupt or steer
  ([#1051](https://github.com/leon0399/llame/issues/1051)).
- Reordering pending items, and changing an item from Steer back to Queue.
- A requester column on Runs (#1612 Q8d lands with its producer).

## Acceptance

- During an active Run, the owner sends a steer; the model receives it at the next step
  boundary of the same Run, and the transcript shows it as an owner message between two
  replies.
- A steer sent while the model writes its final answer makes the Run take another step instead
  of completing.
- An interrupt during a 60-second `bash` call stops the call, and the model receives the
  owner's message and an `interrupted` notice in the same Run, in every deployment topology.
- Three queued items start three Runs in order after each Run completes, and stop after a Run
  fails.
- A pending item can be withdrawn, edited, or changed to Steer or Interrupt until delivery;
  after delivery the action answers 409.
- A worker restart never delivers an item twice and never loses an item.
- User B cannot read, change, or deliver an item of user A.
