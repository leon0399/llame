# Regenerate the last assistant response

## Objective

The single biggest table-stakes gap in the core chat loop: when the model's
answer is wrong/unhelpful, there's no way to re-run it. Add **regenerate the
last assistant turn** — supersede in place. Reuses the durable run pipeline,
`in_reply_to`, cancellation (stop-cancels-run), and the run budget.

## Load-bearing scope line (do NOT cross)

Regenerate applies to the **last assistant turn only**, **supersedes in place**
(deletes the old reply, streams a new one), with **no alternate-swipe/branching
UI** and **no editing of past user messages**. Edit-and-resend and
message-branching are a SEPARATE future feature that needs message-tree
semantics the append-only run/message log does not have. If this line blurs,
the iteration has silently become a message-tree subsystem — stop.

## Research-backed decision (ai-chatbot, opencode) — SEPARATE endpoint

AI SDK v6's `useChat.regenerate({messageId})` re-requests through the transport
with `trigger: 'regenerate-message'` (+ `messageId`); the SDK strips the
assistant message from client state FIRST, so `messages.at(-1)` is the last USER
message. `prepareSendMessagesRequest` receives `{ messages, trigger, messageId }`
and MAY override the target `api` url (confirmed against installed `ai@6.0.217`
`index.js:13413-13419`, `index.d.ts:3988-3998`).

**Decision: a NEW endpoint, NOT `POST /messages` + a trigger.** `POST /messages`
already has an idempotent-retry contract that 409s once a turn is completed
(`'Message turn already completed'`, `chat-loop.service.ts:~199`) — that guard
keeps _retry-an-unfinished-turn_ and _regenerate-a-finished-turn_ from colliding.
Overloading it would force weakening/branching that guard, muddying idempotent
retry with a destructive delete-and-rerun under one response contract. So
regenerate is its own endpoint with the OPPOSITE guard. ai-chatbot avoids all
this only because it has NO `in_reply_to` uniqueness (it reconstructs the whole
list) — that pattern doesn't transfer to llame. opencode has no regenerate
(its `session.revert` is a filesystem-snapshot rewind, unrelated).

- **`POST /api/v1/chats/:id/runs`** — RESTful (a run is a resource; POST to the
  chat's runs collection creates one). Server-authoritative on the target: it
  regenerates the chat's LAST user turn — no `messageId` needed in the contract
  (the SDK's stripped-client-state means the client can't reliably name the
  right id anyway; and "last turn only" is the scope line). NOT the RPC verb
  `/messages/:id/regenerate` (house rule). The transport routes
  `trigger==='regenerate-message'` to this url (client-side); `POST /messages`
  stays trigger-free.

## Design

### Model facts

- `messages.in_reply_to` (assistant → its user message) is UNIQUE — one reply
  per user message. So a new reply requires the old one gone.
- `runs.messageId` = the USER message; a user message may have MANY runs
  (attempts — `cancelActiveRunsForMessage` already assumes this). The assistant
  message is persisted at run completion (`recordAssistantTurn`, `in_reply_to`).
- The assistant message is a leaf (nothing FKs to it) → a clean delete.

### API — `POST /api/v1/chats/:id/runs` (regenerate)

- Body: optional `{ model? }` (the currently-selected model, like submit).
  Streams the new run's response (same SSE bridge as `POST /messages`).
- `chatLoopService.regenerateLastTurn({ chatId, userId, model?, abortSignal? })`.
  Credential/model resolution first (402/422 fail-fast). Then, in one own-scope
  tx:
  1. `findLastUserMessage(chatId)` — the chat's last `role='user'` turn. None →
     404 (nothing to regenerate).
  2. `findTurnState(chatId, userMsg.id)` — require a COMPLETED assistant reply
     (`isCompletedAssistantTurn`) — the OPPOSITE of the submit retry guard. No
     completed reply (turn in flight, or none) → 409 (use the normal send/stop).
  3. `cancelActiveRunsForMessage(userMsg.id)` — belt-and-suspenders (there
     shouldn't be an active run given step 2, but a race could exist).
  4. `deleteById(assistantMessage.id)` — drop the stale reply, freeing the
     UNIQUE `in_reply_to` slot so the new run's reply persists (recall
     `recordAssistantTurn` is `onConflictDoNothing` on `in_reply_to` — without
     the delete the new reply would silently NOT persist).
  5. `startRunForUserMessage(tx, …)` — the run-creation tail EXTRACTED from
     `persistUserMessageAndRun` (config snapshot + supersede + single-flight
     savepoint create + `run.created`), shared by both paths (one source of
     truth for the delicate concurrency logic).
  6. `enqueueAndStream(...)` — the enqueue + deadman + bridge-stream tail also
     EXTRACTED from `createMessageStream`, shared.
- No change to `POST /messages` (its retry contract stays intact).

### Web

- The transport's `prepareSendMessagesRequest` branches on `request.trigger ===
'regenerate-message'` and returns `{ api: /chats/:id/runs, body: { model } }`
  (overriding the target url); the submit path is unchanged. Do NOT inspect
  `messages.at(-1)` to detect regenerate — the SDK already stripped the
  assistant message, so the last message is the user turn and looks identical.
- A "Regenerate" icon button on the LAST assistant message, shown only when
  idle (`status === 'ready'`) and only on the last assistant turn, calls
  `regenerate({ messageId: lastAssistant.id })` (explicit id, though the server
  targets the last turn regardless). Sends the currently-selected model.

### Resume / streaming reconciliation

- After delete + new run, the new streaming assistant message's id is the new
  run id (bridge surrogate) — the client renders it like any fresh turn. The
  old assistant message was already removed client-side by `regenerate()`.
  Refresh-mid-regenerate resumes the new run via the existing stream endpoint.

## Testability

- API integration: `POST /chats/:id/runs` on a chat with a COMPLETED turn → the
  old assistant message is deleted, a new run is created for the same user
  message, a new assistant reply persists (in_reply_to UNIQUE satisfied, proving
  the delete unblocked the `onConflictDoNothing`). No completed reply (in-flight
  or none) → 409. Empty chat / no user turn → 404. Cross-tenant chat → 404
  (RLS/no existence leak). The old (terminal) run row remains as history.
- Web: transport routes `trigger='regenerate-message'` to `/chats/:id/runs`
  (not `/messages`); the submit path is unchanged. The regenerate button renders
  only on the last assistant turn when idle.
- Existing submit path unchanged (POST /messages untouched) — full suite green.

## Accepted edges / invariants (from review)

- **Hard-delete vs the "messages are never deleted" invariant (adversarial).**
  Compaction lineage rests on that invariant (`chats.ts`, `compaction.ts`).
  Regenerate deletes ONLY the newest assistant reply, which is by definition
  still in the live window and never yet absorbed by a compaction — so lineage
  is intact. The superseded response text also survives in the OLD run's
  `run_events` (deltas), so it isn't lost from the durable record. The invariant
  comments are reworded to scope "never deleted" to compacted history + name
  regenerate as the exception (not silently broken).
- **Seq TOCTOU (adversarial), accepted as near-unreachable.** Between
  `findLastUserMessage` (reads turn N) and the run create, a concurrent send
  could create turn N+1; if N+1 fully COMPLETED in that window, the regenerated
  reply for N could get a higher seq → out-of-order. But: (1) the per-chat
  single-flight index means once regenerate's run is created, N+1's run can't
  start (409) — and if N+1's run is already active, `findLastUserMessage`
  returns N+1 and the completed-reply guard 409s; (2) regenerate's read→create
  tx is milliseconds while N+1 completing takes a model call (seconds), so N+1
  cannot complete inside the window. Accepted for the MVP; a chat row-lock on
  both paths would fully close it (follow-up).
- **Abort-id threading (verifier P1, fixed).** `prepareRegenerateRun` does NOT
  make its own `cancelActiveRunsForMessage` call (which would strand the
  aborted ids and leave a zombie generating); `startRunForUserMessage`'s
  internal supersede is the single source of truth, and its ids flow to
  `launchRun`'s abort loop that actually stops the live stream.

## Non-goals (named)

- Edit-and-resend a user message; branching / alternate responses (swipe);
  regenerating a mid-history turn — all need message-tree semantics (separate).
- Preserving the old response as a visible "version" (it's deleted).

## Revision history

- **v3 (2026-07-03):** Round-1 review (verifier + adversarial). Fixed the
  abort-id-drop (verifier P1 — the pre-delete cancel stranded ids so a racing
  run's in-process controller was never aborted); added the `chatId` seatbelt
  to `deleteById` (defense-in-depth convention); reconciled the "messages never
  deleted" invariant comments (adversarial); documented the seq TOCTOU as a
  near-unreachable accepted edge (adversarial). Cleared by review: no
  two-response leak (history reads messages, not run-events), no compaction
  corruption, double-regenerate serializes via single-flight.
- **v2 (2026-07-03):** Research (ai-chatbot/opencode/AI SDK v6 internals) changed
  the transport decision: a SEPARATE `POST /chats/:id/runs` endpoint instead of
  overloading `POST /messages` with a `trigger` (which would muddy the
  idempotent-retry contract's completed-turn 409 guard). Extract
  `startRunForUserMessage` + `enqueueAndStream` as shared helpers (one source of
  truth for the single-flight/enqueue logic). Server targets the last turn
  (no client messageId in the contract). Reverted the `CreateMessageDto.trigger`
  field.
- **v1 (2026-07-03):** Initial (reuse POST /messages + trigger — superseded).
