# Chat todos — a user-manageable task panel

## Objective

The `todos` table + `write_todos`/`list_todos` agent tools are BUILT but have
NO UI, and `write_todos` is operator-gated OFF by default — so today it's dead
weight in the schema. Surface it: a chat-scoped todo panel the USER can manage
(add / toggle / delete) alongside the agent. README names todos a first-class
control primitive (#2 "todos are structured data"); this makes it real. Mirrors
the user-managed-memories pattern; safe (chat-scoped RLS, no escalation).

Also fold in **copy-to-clipboard** on messages (a free-rider table-stakes polish
— absent today).

## Design

### Write-coordination — a `source` column (revised in review from LWW)

Round-1 review escalated the naive last-writer-wins to a P0: the sibling
`memories` table already solved "user + agent both write" with a `source`
column, and silently wiping a user's todos on the next agent plan-write (which
is DETERMINISTIC when enabled, not a rare race) is a footgun. So todos gets the
same treatment (migration 0027):
- `source todo_source ('user'|'agent')` default `'agent'`. The agent's
  `write_todos` replace-all deletes + reinserts ONLY `source='agent'` — the
  user's `source='user'` list is NEVER touched. No data loss.
- The `UNIQUE(chat_id, position)` becomes `UNIQUE(chat_id, source, position)` so
  the two lists occupy separate position spaces (agent 0..n; user max+1 within
  its own source) — no collision. `list` orders `agent` first (plan order) then
  `user` (theirs): deterministic.
- User add appends at `MAX(position) WHERE source='user' + 1`. Two concurrent
  adds race on the same slot → unique violation → the repo RETRIES ONCE
  (recomputes max+1) rather than surfacing a spurious 409 (the loser just needed
  a different slot). A `23505` check walks the cause chain (not the
  runs-index-gated `isInflightUnifViolation`).

### Repository (`TodosRepository`, additive)

- `countByChat(chatId)` — for the cap.
- `add(chatId, content)` — append at `MAX(position)+1`; returns the row.
- `updateStatus(id, status)` — set status by id (RLS-scoped; undefined if not
  owned → 404).
- `deleteById(id)` — remove by id (RLS-scoped; boolean → 404).
- (`list`/`replace` unchanged.)

### API (`ChatTodosController`, `/api/v1/chats/:id/todos`)

- `GET` → `TodoResponse[]` (id, content, status, position), plan order.
- `POST { content ≤ 500 }` → 201 `TodoResponse`; 409 at `TODOS_MAX_PER_CHAT`
  (50). Pre-check the chat is owned (`ChatsRepository.findById` → 404 else) so a
  cross-tenant/absent chat is a clean 404, not an RLS/FK error.
- `PATCH :todoId { status ∈ enum }` → `TodoResponse`; 404 if not found/owned.
- `DELETE :todoId` → 204; 404 if not found/owned.
- DTO + explicit response types (code-first OpenAPI). RLS (`todos_owner` = chat
  ownership) is the tenant guard.

### Web

- `ChatTodos` panel in the chat view (collapsible; shown when the chat has
  todos, plus an always-available add affordance): a list with a checkbox
  (toggle pending↔completed), the content, and a delete button; an input to add.
  Backed by a `chats/:id/todos` service (ky + TanStack Query, invalidate on
  mutate). Scoped to the active chat; empty for a new/draft chat.
  - The panel renders only for an EXISTING chat (`displayMessages.length > 0`),
    so it never POSTs to a not-yet-created draft chat (adversarial P1).
  - USER todos are editable (toggle done, delete); AGENT todos are shown
    read-through with an "assistant" badge and no toggle/delete (the agent owns
    its plan) — resolving the checkbox-for-in_progress/cancelled ambiguity.
- **Copy button** on each message (user + assistant): copies the concatenated
  TEXT parts (skips reasoning/tool parts) to the clipboard, with a brief
  "copied" state. `copyText` is secure-context-safe: it uses
  `navigator.clipboard` when present but FALLS BACK to `execCommand('copy')`
  for a self-hosted HTTP (non-secure) deployment, and returns false / never
  throws when neither works (adversarial P1). React-escaped text only.

## Testability

- Repo/RLS integration: add (position appends, cap enforced), toggle, delete,
  list — all scoped to the chat owner; cross-tenant add/toggle/delete denied
  (RLS); content CHECK rejects oversized/empty.
- API: 404 for a cross-tenant/absent chat on POST; 409 at the cap; PATCH/DELETE
  404 for a foreign todo.
- Web: the todos service (URLs/verbs); a copy-helper unit (concatenates text
  parts). Existing suites green (agent replace-all untouched).

## Non-goals (named)

- Merging user + agent edits (LWW is the accepted model; agent replace-all
  unchanged). Reordering / drag-and-drop. `in_progress`/`cancelled` from the UI
  (the checkbox toggles pending↔completed; the agent still sets the richer
  states). Cross-chat / global todo view. Markdown/highlight in the copy.

## Revision history

- **v2 (2026-07-03):** Round-1 review (verifier + adversarial). The adversarial
  P0 (silent LWW data-loss) drove the biggest change: adopt the `memories`
  `source`-column pattern (migration 0027) so the agent's replace-all only
  touches `source='agent'` and never wipes the user's list; partition the
  unique index by source; order agent-then-user. Verifier P1: the add-race is a
  spurious 409 → the repo RETRIES once instead. Adversarial P1s: gate the panel
  on an existing chat (draft-chat 404), clipboard secure-context fallback
  (self-hosted HTTP), skip non-text parts in copy, agent todos read-only in the
  panel (checkbox-semantics). Verifier confirmed RLS (`todos_owner` FOR ALL) is
  the correct write guard.
- **v1 (2026-07-03):** Initial (no-migration LWW — superseded).
