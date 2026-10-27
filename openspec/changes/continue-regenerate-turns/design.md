## Context

See `proposal.md` for the motivation and the settled decisions (Q codes). Facts below are from
master at `2faf008d`.

- A Run exists only as part of a chat send. `ChatLoopService.createMessageStream`
  (`apps/api/src/chats/chat-loop.service.ts:172-196`) validates, then one tenant transaction
  admits the turn (`admitTurn`, `:402-450`, which locks the chat row with `touch`), clears the
  single-flight slot (`clearActiveRunSlot`, `:596-641`), inserts the user message, and creates
  the Run (`createRunForMessage`, `createRunRow`, `:478-560`). `finalizeAcceptedRun`
  (`:294-330`) dispatches and returns the stream.
- The reply is one row per user message (`messages_in_reply_to_unique_idx`,
  `apps/api/src/db/schema/chats.ts:272`). Each attempt's dispatch resets it to `parts: []` with
  `running` usage (`upsertRunningReply`, `apps/api/src/chats/running-reply-repository.ts:22-50`).
  A `completed` reply is protected by `replaceableReply` in that upsert, by `finalizeRunReply`
  (`apps/api/src/runs/run-reply-finalizer.ts:382`), by `ownsLiveReply`, and by
  `ReplyAlreadyCompletedError` (`apps/api/src/runs/run-execution.service.ts:579-583`), whose
  handler settles a Run `completed` when a salvaged answer already completed its own reply
  (`:1214-1227`).
- Attempt preparation reads history only through the triggering user message
  (`rebuildContextForChat`, `run-execution.service.ts:2280-2320`). Request assembly replaces the
  last request message with the trigger (`:4228-4250`).
- Later-turn replay of assistant parts (`apps/api/src/chats/context-builder.ts:356-404`) emits one
  assistant message and one tool message per tool pair (`flushPendingToolPair`, `:268-276`) and
  applies the replay budget of 8,000 code units per pair and 32,000 per turn, with clearing,
  dropping, and an omission marker (`apps/api/src/chats/tool-observation-part.ts:31-32`).
  Reasoning of a dropped pair moves to the next surviving part.
- The part collector starts empty (`createAssistantPartCollector`,
  `apps/api/src/runs/assistant-transcript.ts:281-283`). A settler without a live collector
  rebuilds the reply from the attempt's events and places every stored context item of the
  snapshot (`rebuiltReplyWrite`, `placeStoredContextItems`, `run-reply-finalizer.ts:220-330`).
- Accepted-turn context items are authored in the worker and stored on the triggering user
  message in the dispatch transaction. `priorDispatch` is Run-scoped
  (`run-execution.service.ts:4772-4827`).
- Evidence eligibility is a predicate over `usage.status` (`eligibleMessagePredicate`,
  `apps/api/src/chats/message-eligibility.ts:17-31`; TS twin `isImmutableEvidenceMessage`). The
  search chunker, `conversation_read`, and timeline discovery use it.
- Tool classification (`apps/api/src/tools/types.ts:233`) exists only on live executors. The
  `tool.started` payload is `{ toolCallId, toolName }`, and `tool.started` is sent only for an
  allowed call (`run-execution.service.ts:1561-1562`). The reconstructor ignores `tool.started`.
- `ChatResponse` and `ChatMessageResponse` carry no Run fields
  (`apps/api/src/chats/dto/chats.dto.ts:208-243`, `:437-503`).
- The stream's `start` frame names the Run id (`apps/api/src/runs/run-stream-bridge.ts:146-151`).
  `useChat.regenerate()` in `ai` 6.0.256 slices the client messages to the last user message,
  whether or not a reply exists, and calls the transport with `trigger: 'regenerate-message'`
  (`apps/web/node_modules/ai/dist/index.mjs:13821-13838`).

### Prior art

| Harness             | Failed-turn action                                                                                           | Reasoning on resume                                                          | Regenerate after file edits                   | Old answer       |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------- | ---------------- |
| oh-my-pi `dcafcef`  | F5 strips the failed assistant message and continues with no new user message (`turn-recovery.ts:3270-3308`) | earlier steps replay with signatures; the failed step's reasoning is dropped | allowed; no file restore                      | sibling branch   |
| OpenClaw `0e90c04`  | "Try again" sends a continuation that checks completed work                                                  | n/a                                                                          | Rewind moves chat context only                | kept as Versions |
| Claude Code         | automatic retries, then resend                                                                               | n/a                                                                          | allowed; `/rewind` offers code, chat, or both | deleted          |
| Cursor              | resend                                                                                                       | n/a                                                                          | dialog: Revert or Don't revert                | replaced         |
| OpenCode `ab4d1f3`  | automatic retry, then `/undo`                                                                                | n/a                                                                          | `/undo` reverts files with the turn           | deleted          |
| LibreChat `a378657` | regenerate; "continue" is a separate turn shape                                                              | n/a                                                                          | allowed, silent                               | sibling          |

No harness resumes a provider token stream. No harness blocks regenerate because a turn edited
files. Only Cursor asks first.

## Goals / Non-Goals

**Goals:**

- One admission path for both actions, with the same lock, single-flight, stuck-run expiry,
  dispatch, and stream behavior as a chat send.
- Continue that keeps the provider's reasoning chain for completed steps and sends every kept
  result in full.
- Regenerate that never leaves a citation to changed content.

**Non-Goals:**

- A second reply row per user message, or a branch topology (#611).
- Any change to the queue's retry of an attempt within one Run.
- Any change to later-turn replay of stored tool parts (#599).

## Decisions

### D1: One route keyed on the user message

`POST /api/v1/chats/:chatId/messages/:userMessageId/runs`, tagged `streaming` like
`createChatMessage`, with operation id `createChatFollowUpRun`. The admission service ships in
`api-follow-up` without an HTTP route. The route ships in `api-continue`, with the worker that
executes a Continue Run, so no layer can create a Continue Run that runs as a plain Run. The
admission transaction:

1. resolves the Chat for the owner and locks its row with `touch`, as `admitTurn` does; a foreign
   or missing Chat or message answers 404 before any job state is read;
2. refuses an archived Chat with the chat-send error;
3. requires the message to be a user row of that Chat with no user row of higher `seq` (409);
4. runs `clearActiveRunSlot`, so a live Run answers 409 and a stuck Run expires;
5. reads the message's latest Run and the reply after that, and applies the action check (D2);
6. creates the Run through `createRunForMessage`, then `finalizeAcceptedRun` dispatches and
   streams.

Rejected: an assistant-message key. A Run that fails at pickup or at enqueue has no reply row, and
those turns need Regenerate most.

### D2: Validation and the action check

`action` is `continue` or `regenerate`; a malformed body answers 400.

- Continue rejects `modelId` and `effort` with 400. It requires a reply whose `usage.runId` names
  the message's latest Run, whose `usage.status` is not `completed`, and whose Run is `failed`,
  `cancelled`, or `expired`; any other state answers 409. Model and effort come from that Run and
  pass the chat-send model and effort checks again, so a model that the operator removed answers
  with the chat-send error before any write.
- Regenerate requires `modelId` and a terminal latest Run, with or without a reply.
- Both validate `permissionMode` against `tools.permissionModes` with the chat-send error;
  absent means `default`. Regenerate validates `modelId`, `effort`, and `permissionMode` in the
  chat-send order.

The reply check closes one gap: a Regenerate that fails before its dispatch leaves an older Run's
reply, and Continue must never keep parts that another Run's model produced.

Rejected: Continue that silently ignores a sent model.

### D3: The Run records its follow-up action and source

`runs` gains `follow_up_action text null` (check `IN ('continue', 'regenerate')`) and
`source_run_id uuid null` (composite FK with `user_id` to `runs`, like the other owner FKs). For
Continue the source is the reply's Run; for Regenerate it is the latest Run. A chat-send Run keeps
both null. The worker reads them to choose its path.

### D4: The Continue boundary

At admission, the service reads the reply's stored parts. The boundary is after the last tool part
whose state is `output-available` or `output-error`, plus the `data-context` parts directly after
it (in-Run items anchored to that step, which live Runs already send right after the tool
results). Parts after the boundary are the unfinished step. With no settled tool part, nothing is
kept. Open calls are settled at termination (`settleOpenToolCalls`), so the kept parts never hold
a call without a result.

### D5: Continue's kept parts live in its own event log

The admission transaction appends `run.continued` with `{ sourceRunId, parts }` right after
`run.created`. Each attempt of the Continue Run then:

- seeds its part collector with those parts, so live finalization writes kept parts plus new
  parts;
- builds the request as the history through the trigger, then the Continue projection of the kept
  parts (D6), with the trigger index taken from the history rows, not from the last message;
- starts the in-Run region at the end of the kept parts (`inRunItems.beginStep`).

The dispatch still resets the reply to `running` with no parts, so the unfinished step leaves the
reply only when a Continue Run dispatches; a Continue that fails before dispatch changes nothing.
A settler without a live collector rebuilds as the `run.continued` parts, then the parts of the
attempt window, and places only snapshot items whose `data.runId` is the Continue Run's id, so
kept items appear once. The stream bridge emits the kept text, reasoning, and tool parts as UI
chunks before the first `model.*` event. Kept context items have no UI chunk; they appear when the
web adopts the finalized history, as live in-Run items do today.

Kept parts count toward both the compaction threshold and the window fit, and compaction never
absorbs them. When the history through the trigger plus the kept parts does not fit even after
compaction of the history, the Run fails with the current context-incompatible error, and
Regenerate stays available.

No stored copy holds the exact model-facing tool output, so the projection rebuilds it the way the
live loop builds it: native tools through their model-output serializer, other tools as JSON. A
Continue Run is a new attempt with empty image memory (`media-attachments`), so a kept image
result from a non-`media://` read replays with the not-retained placeholder, and a `media://`
result replays from the media store.

Rejected: seeding the reset reply row. A later attempt of the same Continue Run would have to read
its own reply to recover the kept parts, and a reload during the Run would hide them, because owner
reads omit a `running` reply.

### D6: The Continue projection

The kept parts do not go through later-turn replay. A dedicated projection groups them by step: a
step is the reasoning and text parts before a run of consecutive tool parts, plus that run. Each
step becomes one assistant message (its reasoning parts with their stored provider metadata, its
text, then all its tool calls) and one tool message with all its results. A kept in-Run item
becomes a user-role text block after its step's tool message, at its stored position, as the live
loop places it. No replay budget applies; each result carries its stored model-facing output, as
the live loop sent it. The projection adds nothing else after the last kept tool result.

This shape matches what the live loop sent, which matters on two wires:

- Anthropic with thinking validates the in-progress turn: the final assistant message must start
  with its thinking block, and one step's parallel calls must be one assistant turn.
- The projection adds no user text of its own. Kept in-Run items stay where the live loop put them,
  as user-role text after their step's tool results, which the live loop already sends.

Wire tests with the real adapters prove the shape: Anthropic with thinking and two parallel calls,
Responses with `store` unset (reasoning as `item_reference`), and the Codex wire with
`store: false` (encrypted content).

Rejected: the later-turn projection. It drops kept results above 32,000 code units, splits
parallel calls into separate assistant turns, and moves reasoning of a dropped pair.

### D7: Regenerate replaces a completed reply and marks it revised

Only the `setWhere` of `upsertRunningReply` changes: it also accepts a `completed` row when the
dispatching Run is a Regenerate and the row's `usage.runId` names another Run. That same statement
sets `messages.revised_at = now()` when the row was `completed`. `ReplyAlreadyCompletedError`, the
finalizer's early return, and `ownsLiveReply` stay as they are, so a later attempt of the
Regenerate Run never resets its own salvaged answer. The evidence predicate adds
`revised_at IS NULL`, in SQL and in the TS twin, so search chunking, `conversation_read`, timeline
discovery, and the hydrator exclude the row. The finalization path already rebuilds the lexical
projection synchronously.

A non-completed reply was never eligible evidence, so its reset sets no mark.

Rejected: a flag in `usage`. Every follow-up Run rewrites `usage`, so the mark would need a copy
rule in each writer.

### D8: Accepted-turn context items of a follow-up Run

`priorDispatch` becomes "any Run of the triggering user message dispatched". A follow-up Run then
follows the retry rule: it keeps every stored item in place, derives each producer again with
stored items counted as told, authors no second `temporal` item, loads only unseen instruction
files, and appends new items after the last stored context item. The tool-availability baseline is
the most recent prior dispatched Run, which can be the earlier Run of the same message.

The `prompt-imports` and `skill-activation` items are stored before dispatch and keyed by Run id
today (`PromptImportPartsRepository.findForRun`, `ActivationPartsRepository`). For a follow-up Run
both lookups become message-scoped: the Run reuses the stored items, reads no import target again,
and activates no skill again. The omission rewrite of an activation stays limited to the Run that
stored it, because a model already read the earlier text.

The model-switch item is the exception, because the stored item names the model of an earlier Run.
The first dispatch of a Regenerate Run removes the `effective-context-change` items with cause
`model` from the trigger and stores, after the last stored context item, the item that its own
comparison against the most recent prior reply below the trigger yields. This derivation runs on
the Regenerate's first dispatch even though an earlier Run dispatched. A retry of the Regenerate
Run keeps what its first dispatch stored. A Continue keeps the Run's model, so the stored item
stays valid.

A Run that a Regenerate replaced is no longer "the previous completed Run" for compaction's model
and receipt source: that lookup reads the Run named by the reply's `usage.runId`.

### D9: The Regenerate notice is an accepted-turn item

The replaced reply holds a non-read-only call when a tool part records a classification other than
`read_only`, or when a legacy part with no `classification` field names a tool that does not
resolve to a `read_only` tool (`TOOL_REGISTRY`; an `mcp__` id is `unverified`; an unknown name
counts). A part with `classification: null` never counts. When it holds one, and the trigger holds
no `regenerate` item yet, the admission records `notice: true` in the `run.created` payload. The
worker then stages an accepted-turn item with producer `regenerate` and form `notice`, ranked
second in the producer list, and the dispatch transaction stores it on the triggering user
message like any other accepted-turn item. Its text is a packaged file:

> An earlier attempt at this turn was discarded after it ran tools that can change files or other
> state. Check the current state before you act on it.

The item stays on the trigger, so every later Run of the turn, and every later turn, carries it.
A tool-less Regenerate also carries it, because accepted-turn items go into the initial request.

Rejected: a reply-leading in-Run item (the grilling answer to Q16). The reply reset writes no parts,
the in-Run carrier runs only for Runs with tools, and the rail rules require turn-level items
inside the triggering user message. A chained Regenerate would also lose the disclosure.

### D10: Classification on stored tool parts

`tool.started` carries `classification`. The collector and the reconstructor write it on the tool
part. A completed call with no `tool.started` (gate-rejected or permission-denied) gets
`classification: null`. The history response carries the field. The web has no tool catalog, so it
treats a legacy part (no field) as non-read-only.

### D11: Usage and receipts

The follow-up Run writes `running` usage with its own `runId` and `attemptId` at dispatch, and
finalizes its own aggregate. For Continue, the kept parts' spend is not added. The canonical rule
"a usage that replaces an earlier reply's usage records `complete: false`" applies, but the reset
hides the earlier usage from the finalizer (`hasReplaceableAssistantUsage` reads the reply at
finalization). The admission therefore records `replacesUsage: true` in the `run.created` payload
when the reply has usage, and the finalizer reads it. The effective context action resolves
`usage.runId`, so it shows the follow-up Run's receipts. The old Run's receipts stay readable
through `GET /api/v1/runs/:id`.

### D12: The history read reports the latest Run

`ChatMessagesResponse` (`GET /api/v1/chats/:id/messages`) gains
`latestRun: { id, messageId, status, followUpAction, modelId, effort, permissionMode } | null`, read
in the same transaction as the messages: the Chat's newest Run by creation, with its accepted mode.
The web refetches this response after each stream, so the action check and the messages never
disagree. `ChatResponse` stays unchanged, so the Chat list and the other endpoints that return it
need no per-Chat Run query.

### D13: Web

- The action row of the latest assistant turn replaces the `Regenerate` stub. Continue shows when
  `latestRun` matches the reply's Run, its status is `failed`, `cancelled`, or `expired`, the
  reply's usage status is not `completed`, and the reply holds a settled tool part. Regenerate
  shows when `latestRun` is terminal. A latest turn with no reply gets a minimal failed-turn row
  with Regenerate when `latestRun` is terminal.
- While `latestRun` is a non-terminal follow-up Run of the latest turn, the web hides the old reply,
  so a reload before the follow-up dispatch does not show the old reply beside the resumed stream.
- Regenerate is a split button. A plain click sends `latestRun`'s `modelId`, `effort`, and
  `permissionMode`. The menu holds the composer's model, effort, and permission-mode selectors,
  so a pick sets the composer; its submit item sends the composer values. Continue sends the
  composer's permission mode.
- Before a Regenerate whose reply holds a non-read-only call or a legacy tool part, an alert dialog
  names those calls and warns that their effects stay and that the new answer will not see them.
- Both actions call `useChat.regenerate()` with a body that names the action. The transport's
  `prepareSendMessagesRequest` sends a `regenerate-message` request to the follow-up route, keyed
  on the last user message. The SDK removes the old reply on the client, and the stream renders
  the kept parts and the new parts in one assistant message.
- The notice renders with the context-item notice style on the user message.

## Risks / Trade-offs

- [The inferred step grouping merges two steps when the second has no reasoning and no text] ->
  the merged message still pairs every call with its result. Adaptive thinking can skip reasoning on
  a step, so this happens; the merged shape is one assistant turn with all calls, which both wires
  accept.
- [A provider rejects the replayed reasoning] -> Continue keeps the reply's model and wire (D2),
  and wire tests cover both reasoning wires. A rejection fails the Run under the current failure
  contract, and Regenerate stays available.
- [Regenerate repeats `bash` effects or overwrites edits] -> the confirmation and the notice
  disclose it. File rewind is out of scope.
- [Spend of a replaced attempt is lost from the reply] -> accepted (Q14-C); #170 owns the ledger.
- [A long `run.continued` payload] -> it holds parts that the tool-result limits already bound,
  once per Continue Run.
- [Old search chunks stay until the Regenerate Run ends] -> the hydrator rejects ineligible rows,
  so a stale chunk resolves to `conversation_source_not_found` during that window.
- [A concurrent chat send and follow-up request] -> both lock the chat row first and create their
  Run under the datastore single-flight index.

## Migration Plan

Two Drizzle migrations, all columns nullable with no backfill: `api-follow-up` adds
`runs.follow_up_action` and `runs.source_run_id`; `api-regenerate` adds `messages.revised_at`.
RLS policies on both tables are row-scoped and need no change. Rollback: deploy the earlier image
and drop the columns; until then the old image ignores them. The eligibility predicate change
ships with `revised_at`.

## Open Questions

None. The notice placement (D9) changes a grilling answer and is listed for Leo's confirmation in
`proposal.md`.
