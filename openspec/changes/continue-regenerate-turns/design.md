## Context

See `proposal.md` for the motivation and the settled decisions (Q codes). Facts below are from
master at `2faf008d`.

- A Run exists only as part of a chat send. `ChatLoopService.createMessageStream`
  (`apps/api/src/chats/chat-loop.service.ts:172-196`) validates, then one tenant transaction
  admits the turn, clears the single-flight slot (`clearActiveRunSlot`, `:596-641`), inserts the
  user message, and creates the Run (`createRunForMessage`, `createRunRow`, `:478-560`).
  `finalizeAcceptedRun` (`:294-330`) dispatches and returns the stream. Only `admitTurn`
  (`:402-450`) and the user-message insert are specific to a new message.
- The reply is one row per user message (`messages_in_reply_to_unique_idx`,
  `apps/api/src/db/schema/chats.ts:272`). Each attempt's dispatch resets it to `parts: []` with
  `running` usage (`upsertRunningReply`, `apps/api/src/chats/running-reply-repository.ts:22-50`).
  A `completed` reply is protected at four places: `replaceableReply`
  (`apps/api/src/chats/messages-repository.ts:75`), `finalizeRunReply`
  (`apps/api/src/runs/run-reply-finalizer.ts:382`), `ownsLiveReply`, and
  `ReplyAlreadyCompletedError` (`apps/api/src/runs/run-execution.service.ts:579-583`).
- Attempt preparation reads history only through the triggering user message
  (`rebuildContextForChat`, `run-execution.service.ts:2280-2320`), and request assembly replaces
  the last request message with the trigger (`:4228-4250`). `buildContext` already projects an
  assistant row's reasoning (with `providerMetadata` as `providerOptions`), tool pairs, and
  context items (`apps/api/src/chats/context-builder.ts:356-404`).
- The part collector starts empty (`createAssistantPartCollector`,
  `apps/api/src/runs/assistant-transcript.ts:281-283`). A settler without a live collector
  rebuilds the reply from the attempt's events (`rebuiltReplyWrite`,
  `run-reply-finalizer.ts:284-330`).
- Accepted-turn context items are authored in the worker and stored on the user message in the
  dispatch transaction. `priorDispatch` is Run-scoped (`run-execution.service.ts:4772-4827`), so
  a second Run on the same message would author a second temporal item and a second
  model-switch item and would rank them among the first Run's items.
- Evidence eligibility is a predicate over `usage.status` (`eligibleMessagePredicate`,
  `apps/api/src/chats/message-eligibility.ts:20-38`; TS twin `isImmutableEvidenceMessage`).
  The search chunker and `conversation_read` both use it.
- Tool classification (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`,
  `unverified`; `apps/api/src/tools/types.ts:233`) exists only on live executors. Stored tool
  parts carry the tool name and the permission decision (`assistant-transcript.ts:51-92`).
- The stream's `start` frame names the Run id (`apps/api/src/runs/run-stream-bridge.ts:444-459`),
  so the web always renders a new client-side assistant message and adopts server history after
  the stream ends. `useChat.regenerate()` in `ai` 6.0.256 slices the client messages to the last
  user message and calls the transport with `trigger: 'regenerate-message'`
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

- One admission path for both actions, with the same single-flight, stuck-run expiry, dispatch,
  and stream behavior as a chat send.
- Continue that keeps the provider's reasoning chain for completed steps.
- Regenerate that never leaves a citation to changed content.

**Non-Goals:**

- A second reply row per user message, or a branch topology (#611).
- Any change to the queue's retry of an attempt within one Run.

## Decisions

### D1: One route keyed on the user message

`POST /api/v1/chats/:chatId/messages/:userMessageId/runs`, tagged `streaming` like
`createChatMessage`, with operation id `createChatFollowUpRun`. The service method reuses
`clearActiveRunSlot`, `createRunForMessage`, and `finalizeAcceptedRun`. It replaces `admitTurn`
and the message insert with a turn check in the same transaction: the Chat exists for the owner
and is not archived; the message is a user row of that Chat; no user row has a higher `seq`;
the message has a Run; and the latest Run of the message has the status that the action needs.
A foreign or missing Chat or message answers 404 before any job state is read, as the
single-flight scenario "Another owner's run is never judged" requires.

Rejected: an assistant-message key. A Run that fails at pickup or at enqueue has no reply row,
and those turns need Regenerate most.

### D2: Validation per action

`action` is `continue` or `regenerate`. Continue rejects `modelId` and `effort` with 400; it
reads both from the latest Run of the message. Regenerate requires `modelId` and validates
`modelId`, `effort`, and `permissionMode` with the chat-send order (`validateTurn`'s first three
steps). `permissionMode` is optional for both and defaults to `default`, as on a chat send.

Rejected: Continue that silently ignores a sent model. A request that names a model expects it
to apply; a 400 makes the mismatch visible.

### D3: The Run records its follow-up action and source

`runs` gains `follow_up_action text null` (check `IN ('continue', 'regenerate')`) and
`source_run_id uuid null` (FK to `runs.id`, composite with `user_id` like the other owner FKs).
The worker reads them to choose the Continue or Regenerate path. A chat-send Run keeps both
null. The columns also keep the follow-up chain for #611 and #170.

Rejected: an event-only marker. The worker would have to read the event log to learn what kind
of Run it executes, and the relation would not be queryable.

### D4: The Continue boundary

At admission, the service reads the reply's stored parts. The boundary is after the last tool
part whose state is `output-available` or `output-error`, plus the `data-context` parts that
follow it before the next non-context part (they are in-Run items anchored to that step). Parts
after the boundary are the unfinished step and are dropped. With no settled tool part, nothing
is kept. Stored tool parts are always settled (`assistant-transcript.ts:292-300`), so the kept
parts never hold a call without a result.

### D5: Continue's kept parts live in its own event log

The admission transaction appends a `run.continued` event as the Run's second event, after
`run.created`. Its payload is `{ sourceRunId, parts }`, with the kept parts verbatim. Each attempt
of the Continue Run then:

- seeds its part collector with those parts, so live finalization writes kept parts plus new
  parts;
- projects those parts after the trigger in the model request through the existing assistant
  history projection, with `requestKind: 'continuation'`, so reasoning metadata replays;
- treats the end of the kept parts as the start of the Run region for in-Run items
  (`inRunItems.beginStep`).

The stream bridge translates `run.continued` into the UI chunks of the kept parts before the
first `model.*` event. A refresh during the Run therefore shows the whole reply. A settler
without a live collector rebuilds from `run.continued` plus the attempt window. The dispatch
still resets the reply to `running` with no parts, and preparation still reads history only
through the triggering user message, so the canonical projection rules hold as written.

Rejected: seeding the reset reply row with the kept parts. A later attempt of the same Continue
Run would then read its own reply to recover the kept parts, and a reload during the Run would
hide them, because owner reads omit a `running` reply.

### D6: Continue adds no user message

The request ends with the last kept tool result, or with the trigger when nothing is kept. An
in-Run item that the kept parts hold is replayed at its stored position. Any user-role text after
the last tool result would end the provider's reasoning chain: OpenAI Responses drops reasoning
items before the latest user message, and Anthropic ends the tool loop on a non-`tool_result`
user message.

### D7: Regenerate replaces a completed reply and marks it revised

A Regenerate Run's dispatch transaction can reset a `completed` reply. The four guards in
Context accept a reset when the dispatching Run's `follow_up_action` is `regenerate`. When the
reset row was `completed`, the same transaction sets `messages.revised_at = now()`. The evidence
predicate adds `revised_at IS NULL`, in SQL and in the TS twin, so search chunking,
`conversation_read`, timeline discovery, and the hydrator all exclude the row. The finalization
path already rebuilds the lexical projection synchronously, so the old chunks leave the index
when the Regenerate Run ends.

A non-completed reply was never eligible evidence, so its reset sets no mark. A Regenerate that
fails before its dispatch leaves the old reply and its mark unchanged.

Rejected: a flag in `usage`. Every follow-up Run rewrites `usage`, so the mark would need a copy
rule in each writer. A column survives every rewrite.

### D8: Accepted-turn context items of a follow-up Run

`priorDispatch` becomes "any Run of the triggering user message dispatched". A follow-up Run then
appends its new items after the last stored context item, authors no second `temporal` item,
keeps each stored instructions bundle and prompt-imports item, and compares tool availability
against the most recent prior dispatched Run, which can be the earlier Run of the same message.
This is the rule that a retry of the same Run follows today.

The model-switch item is the one exception. A follow-up Run compares its model with the target
model of the last model-switch item stored on the triggering user message. When the message has
no switch item, it compares with the model of the most recent prior reply below the trigger. On
a difference, it appends a switch item from that model to its own.

### D9: The Regenerate notice

The replaced reply holds a non-read-only call when a tool part records a classification other
than `read_only`, or when a legacy tool part with no `classification` field names a tool that does
not resolve to a `read_only` tool (`TOOL_REGISTRY` for code-owned ids; an `mcp__` id is
`unverified`; an unknown name counts as non-read-only). The admission transaction then records
`notice: true` in the `run.created` payload. The worker then stages one
context item with producer `regenerate` and form `notice` before the first request. The dispatch
transaction stores it as the reply's first part, and the model receives it as a user-role text
block directly after the trigger, on every step. Its text is a packaged file:

> This is a new attempt at this turn. An earlier attempt was discarded after it ran tools that
> can change files or other state. Check the current state before you act on it.

The notice is an in-Run item with no anchor tool call. Later turns replay it at its stored
position, before the reply's content.

### D10: Classification on stored tool parts

When a tool call starts, the collector records the executor's classification on the tool part as
`classification`. A call that the gate rejected never starts and records `classification: null`,
so it never counts as non-read-only. A part without the field predates this change and falls
back to the name lookup in D9. The history response carries the field, so the web confirmation and
the notice read the same data. The web has no tool catalog, so it treats a legacy part as
non-read-only: the confirmation can then name a legacy read-only call, which only adds one
dialog for replies stored before this change.

### D11: Usage and receipts

The follow-up Run writes `running` usage with its own `runId` and `attemptId` at dispatch, and
finalizes its own aggregate. For Continue, the kept parts' spend is not added. The effective
context action resolves `usage.runId`, so it shows the follow-up Run's receipt. The old Run's
receipt stays readable through `GET /api/v1/runs/:id`.

### D12: Web

- The action row of the latest assistant turn replaces the `Regenerate` stub. Continue shows when
  the latest Run of the turn is `failed`, `cancelled`, or `expired` and the reply has at least one
  settled tool part. Regenerate shows on every terminal status. For a turn with no reply row, the
  web renders a minimal failed-turn row that carries the same actions.
- Regenerate is a split button. A plain click sends the old Run's `modelId`, `effort`, and
  `permissionMode` from the reply's usage metadata. The menu holds the existing model, effort,
  and permission-mode selectors bound to the composer state, so a pick sets the composer; its
  submit item sends the composer values.
- Before a Regenerate whose reply holds a tool part that counts under D9, an alert dialog lists
  those calls by tool name and warns that their effects stay and that the new answer will not see
  them.
- Both actions call `useChat.regenerate()` with a request body that names the action. The
  transport's `prepareSendMessagesRequest` sends a `regenerate-message` request to the follow-up
  route, keyed on the last user message. The SDK removes the old reply on the client, and the
  stream renders kept parts and new parts in one assistant message.
- The notice renders with the existing context-item notice style.

## Risks / Trade-offs

- [The heuristic boundary keeps a step whose stream died after its tool call settled] -> that
  step's assistant content is complete up to the tool call, and every kept call has its result, so
  the request is valid. Text that a provider emits after a tool call in the same step is not
  produced by the current providers.
- [A provider rejects replayed reasoning metadata] -> Continue never changes the model (Q4-A), so
  the metadata always returns to the model and the wire that produced it. A rejection fails the
  Run under the current failure contract, and Regenerate remains available.
- [Regenerate re-runs `bash` effects or overwrites edits] -> the confirmation and the notice
  disclose it. File rewind is out of scope.
- [Spend of a replaced attempt is lost from the reply] -> accepted (Q14-C); #170 owns the ledger.
- [A long `run.continued` payload] -> it holds parts that are already bounded by the tool-result
  limits, once per Continue Run.
- [Old search chunks stay until the Regenerate Run ends] -> the hydrator rejects ineligible rows,
  so a stale chunk resolves to `conversation_source_not_found` during that window.
- [A concurrent chat send and follow-up request] -> both create their Run under the datastore
  single-flight index, so at most one of them is admitted while the other Run is live. The turn
  check runs inside the admission transaction, so a follow-up request after a newer user message
  commits answers 409.

## Migration Plan

Two Drizzle migrations, one per API layer, all columns nullable with no backfill: `api-continue`
adds `runs.follow_up_action` and `runs.source_run_id`; `api-regenerate` adds
`messages.revised_at`. RLS policies on both tables are row-scoped and need no change. Rollback:
deploy the earlier image and drop the columns; until then the old image ignores them. The
eligibility predicate change ships in the same layer as `revised_at`.

## Open Questions

None. Every question that would change the specs, the approach, or the task breakdown was
settled in the grilling record.
