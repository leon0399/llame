# Command palette (Cmd/Ctrl+K)

## Objective

The product now has many surfaces (chats, settings, model selection, prompts,
sharing…). Add a keyboard-first command palette (`Cmd/Ctrl+K`) that unifies fast
access: quick actions (new chat, settings), fast MODEL switching from anywhere,
and jump-to-any-chat. It's the natural evolution of the slash-commands work and
makes a featureful product feel cohesive + discoverable. Client-only, safe — it
reuses existing queries/navigation, no backend.

## Design (client-only)

- `CommandPalette` — the shadcn `CommandDialog` (cmdk, already in
  `@workspace/ui`), controlled by an `open` state. Groups:
  - **Actions**: "New chat" (mints a fresh draft — `setActiveChatId(null)` +
  `setDraftChatId(safeRandomUUID())` then `push('/')`, matching the sidebar's
  New Chat control; a bare `push('/')` would no-op or resume a STALE draft),
  "Settings" (→ `/settings`).
  - **Switch model**: `useModelsQuery()` → each model → `setSelectedModel(id)`
    (from `useChatContext`) — sets the model for the next message (same effect as
    the composer picker), then closes. The current model is marked.
  - **Chats**: `useChatsQuery()` is an infinite query — flatten `data?.pages
    .flat()` → each → `/chat/:id`. cmdk's built-in fuzzy filter searches all
    items by their text. Empty model/chat groups are guarded (`length > 0`).
- **Toggle**: an effect-scoped global `keydown` listener — PLATFORM-aware:
  Cmd+K on macOS, Ctrl+K elsewhere (`isPaletteToggle(e, isMac)`, case-insensitive).
  This is load-bearing: Ctrl+K in a text field on macOS is the Emacs
  kill-to-end-of-line binding, so treating it as a toggle there would swallow a
  real edit. `preventDefault()` (never types "k"), skip `e.repeat` (a held chord
  mustn't flicker), toggle `open`. Every `onSelect` closes the dialog FIRST then
  acts (`run()`), so a no-op nav can't leave the focus-trap/scroll-lock stuck.
  Listener removed on unmount.
- **Discoverability + mobile**: the sidebar already had a DEAD "Search" button
  labelled with the platform ⌘K/Ctrl+K shortcut (no handler) — the palette wires
  THAT button's `onClick` to open, rather than adding a duplicate.
- **Placement**: mounted in the `(chat)` layout (inside `ChatProvider` so it can
  read/set the selected model; persists across chat↔settings navigation).

## Reference

Open WebUI and every modern app of this class ship a `/` or `Cmd+K` command
surface; llame already has the cmdk primitive. This is expected polish, not a
novel capability — framed honestly.

## Testability

- Pure `isPaletteToggle(e)` (the key-matcher: Cmd/Ctrl+K, not other keys) — unit.
- Pure `buildPaletteActions()` (the static action list → label + href) if
  extracted — unit.
- The dialog itself is declarative cmdk + router/navigation; exercised by
  tsc/build (consistent with how the other UI components are covered — pure
  helpers + service tests, no jsdom render harness).

## Non-goals (named)

- Context actions on the CURRENT chat (share/rename/delete from the palette) — a
  follow-up (needs the active-chat + its dialogs wired in). Content/message
  search inside the palette (the sidebar already has content search; the palette
  filters chat TITLES via cmdk). Command history / recents ordering; nested
  sub-pages beyond the flat model list; fuzzy-scoring tuning.

## Revision history

- **v2 (2026-07-03):** Round-1 review (both reviewers confirmed the cmdk API,
  no double-listener, and model-switch consistency). Fixes: the key-matcher is
  PLATFORM-aware (Cmd on macOS, Ctrl elsewhere — Ctrl+K on Mac is the Emacs
  kill-line binding, the adversarial P1) + `e.repeat`-guarded; "New chat" does
  the sidebar's state-resets (not a bare `push` that resumes a stale draft, the
  verifier P1); the palette wires the EXISTING dead Search ⌘K button rather than
  adding a duplicate; `useChatsQuery` flattened (`.pages.flat()`); every
  `onSelect` closes-then-acts; empty groups guarded.
- **v1 (2026-07-03):** Initial.
