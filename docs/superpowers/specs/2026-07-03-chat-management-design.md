# Chat management — wire the dead Rename & Delete buttons

## Objective

The sidebar chat dropdown shows **Rename** and **Delete** menu items that do
NOTHING — no `onClick`, no mutation (`app-sidebar-chat-history.tsx:71-80`). Two
visibly-broken core-nav affordances. Worse: there is no `DELETE /chats/:id`
endpoint at all, so a user can create chats but never remove them — they
accumulate forever. Fix both: implement chat deletion (backend + UI) and wire
rename to the existing `PATCH /chats/:id`. Table-stakes; completes chat
management before any new feature (integration over expansion).

## Design

### Backend (delete — rename's `PATCH`/`updateChat` already exists)

- `ChatsRepository.deleteById(chatId, ownerUserId)` — `DELETE FROM chats WHERE
  id = :id AND owner_user_id = :owner` RETURNING id → boolean. RLS
  (`chats_owner`, FOR ALL, FORCE) is the tenant guard; `owner_user_id` is the
  seatbelt. A cross-tenant/absent id matches 0 rows → false → 404 (no leak, no
  cross-tenant delete). The FK cascade is COMPLETE and verified: `chats` →
  messages, compactions, runs, todos (all `onDelete: cascade`), and runs →
  run_events (cascade) — so one statement removes the whole tree, no orphans.
- `ChatsService.deleteChat(userId, chatId)` — `runAs` → `deleteById`.
- `DELETE /api/v1/chats/:id` → 204 / 404 (`ParseUUIDPipe`, `CurrentUser`), an
  additive method on the existing `ChatsController` (`:id` route already exists
  for GET/PATCH — no new shadowing).
- In-flight run (revised in review — adversarial P0): `ChatsService.deleteChat`
  CANCELS an active run FIRST — `RunsRepository.findActiveByChatId` →
  `requestCancel` (stamps `cancel_requested_at`) + `RunAbortRegistry.abort`
  (in-process signal), reusing the stop path — THEN deletes. Without this the
  worker doesn't crash (every `run_events` append + the assistant-turn persist
  is try/catch-swallowed — verified across all three timing windows: pickup
  gate, `markStarted` 0-row refusal, mid-stream FK-swallow), but the provider
  stream keeps BILLING and logs an FK-violation per delta until the deadman
  timeout (~60s). Cancelling first stops the spend and the log burst.

### Web

- `lib/services/chat`: `deleteChat(id)` (DELETE) and `renameChat(id, title)`
  (PATCH) + mutation hooks that invalidate `chatQueryKeys.lists()` on success.
- **Rename**: the Rename item opens a `Dialog` with a text input prefilled with
  the current title → PATCH → invalidate. Empty/whitespace title rejected
  client-side (the DTO also caps length).
- **Delete**: the Delete item opens an `AlertDialog` (destructive confirm —
  deletion is irreversible) → DELETE → invalidate the list. For the ACTIVE chat,
  `router.push('/')` fires FIRST, then the DELETE (adversarial P1) — so the
  message-history query unmounts before the row 404s (no error flash). The web
  `deleteChat` swallows a 404 as success (idempotent — a double-click's second
  request is the desired end state).
- **Radix footgun (adversarial P1):** a `Dialog`/`AlertDialog` opened from a
  `DropdownMenuItem` needs `onSelect={(e) => e.preventDefault()}` (else the
  closing menu's focus-return races the dialog mount → flash/stuck). The dialogs
  are row-local controlled components (`open`/`onOpenChange`), siblings of the
  dropdown, not nested inside it.

## Testability

- Repo/RLS integration: owner deletes own chat → true AND its messages / todos /
  runs are gone (cascade proven); a cross-tenant delete → false and the chat
  SURVIVES (RLS); rename is owner-scoped (foreign chat → not found).
- API: `DELETE` returns 204 then 404 on a second delete; 404 for a foreign/absent
  chat; unauth rejected.
- Web: the delete/rename service (URL + verb); the mutation invalidates the list.

## Non-goals (named)

- Soft-delete / trash / undo (hard delete only — the cascade is intentional).
  Bulk delete, archive, pin. Optimistic UI (invalidate-on-success is enough).
- Renaming a chat to the literal default title (`"New chat"`) re-arms
  auto-titling on the next turn (a distinct manual title is protected by
  `setGeneratedTitle`'s title-still-default guard; the exact-default edge is a
  known, low-blast-radius non-goal).

## Revision history

- **v2 (2026-07-03):** Round-1 review (verifier + adversarial). Verifier
  CONVERGED (RLS FOR ALL + FORCE, the full cascade chain, route/verb, active-chat
  nav target, and rename reuse all verified against source; only P2 wording
  nits, folded in). Adversarial P0: delete now CANCELS an in-flight run before
  deleting (was billing until the deadman timeout). Adversarial P1s: nav-first
  ordering for the active chat, 404-swallow (idempotent delete), and the Radix
  dropdown→dialog `preventDefault` fix. Auto-title-to-default edge noted.
- **v1 (2026-07-03):** Initial.
