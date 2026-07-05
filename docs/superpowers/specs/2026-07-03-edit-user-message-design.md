# Edit & resubmit your last message

## Objective

The chat interaction model is asymmetric: you can STOP a run, REGENERATE an
assistant reply, and regenerate through a DIFFERENT model — but you can't fix your
OWN message. Editing your last message and resubmitting is table-stakes (every
serious chat UI has it) and completes the interaction primitives (send / stop /
regenerate / **edit**). Add "edit & resubmit" for the LAST user message.

## Approach (reference-checked)

Vercel `ai-chatbot` (our stack) edits a message via `deleteTrailingMessages`
(server) + `setMessages` (edit locally) + `regenerate()`. That pattern does NOT
transfer directly: ai-chatbot's regenerate RE-SENDS the client's edited message
content, whereas llame's regenerate is SERVER-AUTHORITATIVE — `regenerateLastTurn`
re-reads the last user message from the DB (`POST /chats/:id/runs` carries only a
model, no content). So llame EXTENDS its regenerate endpoint with an optional
`editUserMessage`: the client edits locally + `regenerate({ body: { editUserMessage
} })`, and the server updates the last user message's content before rewinding and
re-running. One atomic op inside the existing `runAs` transaction, reusing the
already-reviewed regenerate/supersede stream path (no bespoke streaming).

## Design

### Backend

- `RegenerateRunDto`: add `editUserMessage?: string` (`@IsOptional @IsString
@MinLength(1) @MaxLength(20000) @Matches(/\S/)` — the same non-blank + cap
  guards as a sent text part) and `editMessageId?: string` (`@IsUUID`, the pin —
  see the two-tab race below).
- Thread `editUserMessage` + `editMessageId` through ALL THREE sites (each drops
  fields it doesn't name): `regenerateRun` (controller) → `regenerateLastTurn` →
  `prepareRegenerateRun`.
- `MessagesRepository.updateUserMessageContent(messageId, chatId, text)` → sets
  `parts = [{ type: 'text', text }]` for a message that is `role = 'user'` in the
  chat (owner-scoped: FORCE RLS on `messages` + explicit `chatId` + `role='user'`
  guard, so it can never rewrite an assistant/system turn). Returns the updated
  row or undefined.
- `prepareRegenerateRun` (called by `regenerateLastTurn`): when `editUserMessage`
  is present → 409 if `editMessageId` is set and ≠ the current last user turn (the
  TWO-TAB PIN: another tab may have sent a message, making a DIFFERENT message
  last — never silently rewrite it); trim-reject a whitespace-only edit (400);
  `updateUserMessageContent(lastUserMessage.id, …, editUserMessage)` FIRST, RE-BIND
  the local `userMessage` to the RETURNED updated row (load-bearing:
  `startRunForUserMessage` builds the run from the passed object's `parts`, NOT a
  DB re-read — passing the stale pre-edit row would run the model on the OLD
  text), then delete the assistant reply IF one exists, then
  `startRunForUserMessage`. The pure-regenerate `409 (no completed reply)` guard
  is RELAXED for an edit (you may edit + retry a turn that errored or never
  replied); without `editUserMessage`, behavior is byte-for-byte unchanged (409
  intact). `findLastUserMessage` 404 (no user turn / cross-tenant) is unchanged.

### Web

- An edit (pencil) button on the LAST user message, shown on the same
  `status === "ready" || "error"` condition as regenerate. Click → an inline
  editor (a `Textarea` prefilled with the message's current text + Save / Cancel).
- Save (disabled when empty/unchanged) → `setMessages` replacing the edited user
  message's parts with `[{ type: 'text', text }]` (cosmetic — the server is
  authoritative), then `regenerate({ messageId: <reply id, if any>, body: {
editUserMessage: text, editMessageId, ...(modelToSend ? { model } : {}) } })`.
  CRITICAL: the transport (`prepareSendMessagesRequest`) reconstructs the regen
  body from an ALLOWLIST — it must be extended to forward `editUserMessage` +
  `editMessageId` (a blank edit is dropped), else the edit silently no-ops. The
  existing regenerate stream supersedes the old reply and streams a fresh one.
  Cancel → leave edit mode.
- Pure `userMessageText(parts)` → the concatenated text of a user message's text
  parts (for the editor prefill), unit-tested.

## Testability

- API (integration, RLS): editing the last user message updates its content AND a
  fresh run supersedes the prior reply (owner-scoped); a cross-tenant caller
  editing the same chat's message is a no-op (RLS — `updateUserMessageContent`
  returns undefined, no rows touched); `updateUserMessageContent` refuses a
  non-user message (role guard).
- Web (unit): `userMessageText` — joins text parts, ignores non-text parts,
  empty for none.

## Non-goals (named)

- Editing ANY earlier message (only the LAST user turn — editing mid-history is
  multi-turn truncation, a bigger feature). Editing assistant messages. Preserving
  downstream turns across an edit (the old reply is superseded, same as
  regenerate). Visible edit history / message versioning. Editing while a run is
  in-flight (gated on idle, like regenerate). Non-text (attachment) parts in the
  edited message (text-only, matching today's composer).

## Revision history

- **v2 (2026-07-03):** Round-1 review (both reviewers, on the code). Fixes to the
  P0/P1s: (P0, both) the transport's regen body is an ALLOWLIST — extended to
  forward `editUserMessage`/`editMessageId` + a transport test (else silent
  no-op). (P0, primary) `startRunForUserMessage` uses the passed object's `parts`,
  not a DB re-read → re-bind to the row returned by `updateUserMessageContent`
  (else the model runs on pre-edit text). (P1, adversarial) added `editMessageId`
  - a 409 pin so a two-tab race can't rewrite a different message. (P1, both)
    `@Matches(/\S/)` blank guard + a server trim-reject. Verified clear by the
    reviewers: tenancy (no cross-tenant/public write — `messages_owner` write vs
    `messages_public_read` select-only), the `in_reply_to` trigger (only fires on
    `in_reply_to`/`chat_id`, not `parts`), and the relaxed-409 branch (no reply row
    exists to conflict).
- **v1 (2026-07-03):** Initial.
