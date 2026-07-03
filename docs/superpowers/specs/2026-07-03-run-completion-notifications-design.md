# Background run-completion notifications

## Objective

llame's runs are durable: a message becomes a worker-processed run that survives
a page refresh and keeps generating while you navigate away (#50 — the biggest
recent backend investment). But that's structurally INVISIBLE today: you still
have to sit and watch the tab. Make it FELT — when a run you started finishes
while you're looking at a different chat (or the tab is backgrounded), notify:
an in-app toast, a sidebar badge on that chat, and (opt-in) a desktop
notification. This is architecture-to-UX translation, not more chat polish.

Client-only: reuses the existing `GET /api/v1/runs/:id` (status) — NO backend
change, NO new RLS surface.

## Design

### Active-run registry (global)

- `ActiveRunsProvider` (React context, mounted in `providers.tsx` inside the
  QueryClient, above the routes so it SURVIVES chat→chat navigation):
  - `active: Map<runId, { chatId, title }>` — runs started this session, still
    in flight.
  - `completedChats: Set<chatId>` — chats with an unseen background completion
    (drives the sidebar badge).
  - `trackRun(runId, chatId, title)` / `markChatSeen(chatId)`.
- **Watcher**: a single interval (~4s) polls `GET /runs/:id` for each `active`
  run (bounded — session-tracked only; usually 1). On a TERMINAL status, resolve
  via the pure `resolveTerminalRun`:
  - `cancelled` → ALWAYS silent: the user hit stop, or the run was superseded
    (regenerate). Never a surprise toast for something they caused. (This is the
    load-bearing carve-out — without it, "stop then navigate away before the
    poll tick" would toast "reply ready" for a killed reply.)
  - else if viewing that chat AND the tab is visible → silent (they saw it).
  - else NOTIFY: `completed` → "Reply ready — <title>" (clickable → navigates);
    `failed` AND `expired` → a "Run failed" toast (`expired` is a reaped/hung
    run — the reply never came, so it's surfaced, not swallowed). Add `chatId`
    to `completedChats`; fire a desktop `Notification` if granted + tab hidden.
- **Untrack on stream-finish (avoids a false-positive window):** the poll ticks
  on a fixed 4s cadence, decoupled from actual completion. So when the user
  WATCHES a reply finish (`useChat` `onFinish`/`onError`), the chat-page calls
  `untrackChat(chatId)` to drop it immediately — otherwise a user who finishes
  watching then clicks to another chat within 4s gets a stale "reply ready" for
  what they just saw. Navigating away MID-stream (before onFinish) leaves it
  tracked → the poll correctly notifies on completion.

### Wiring

- `chat-page`: when a run starts (an assistant turn with a run id appears —
  `runIdToCancel(messages)` during `submitted`/`streaming`), call
  `trackRun(runId, chatId, title)`. Call `markChatSeen(chatId)` while the chat is
  the active route (clears its badge).
- Sidebar `ChatItem`: a small unread dot when `chatId ∈ completedChats`.
- `lib/services/chat/runs.ts`: add `fetchRun(runId)` (`GET /runs/:id`) +
  `isTerminalRunStatus(status)`.

### Desktop notifications (opt-in, non-intrusive)

- NEVER auto-prompt on load. Fire a desktop `Notification` only when permission
  is already `granted`. When a background completion occurs and permission is
  `default`, the toast carries an "Enable desktop alerts" action that calls
  `Notification.requestPermission()` (user-initiated). Denied/unsupported →
  toast + badge still work (the always-on path).

## Reference

No comp does this — ai-chatbot/most chat UIs are synchronous (no durable
background run to notify about). It's original, but the shape (background job →
completion signal) is standard; the durable-run worker (#50) is what makes it
apt. The resumable SSE + `GET /runs/:id` (the hard parts) already exist.

## Testability

- `isTerminalRunStatus` unit (terminal set vs active).
- The registry reducer/logic unit: `trackRun` adds; a terminal poll result
  removes + (when not-viewing) adds to `completedChats`; viewing+visible
  suppresses; `markChatSeen` clears. (Pure logic extracted from the effect so
  it's testable without timers/DOM.)
- `fetchRun` service (URL/verb).
- Existing suites green (chat-page wiring is additive).

## Placement / mechanism (review-confirmed)

- `ActiveRunsProvider` mounts in the `(chat)` LAYOUT (not root `providers.tsx`) —
  it persists across chat→chat/settings navigation (a layout doesn't remount on
  child route changes) while staying scoped to the chat area.
- "Am I viewing this chat" uses `usePathname()` (`=== /chat/:chatId`), NOT the
  nested `ChatContext.activeChatId` (a provider can't read a context supplied
  below it). All `document.hidden`/`Notification`/`window` reads are effect-
  scoped (SSR-safe), never at render.

## Non-goals (named)

- Reload/closed-tab robustness AND the submit-then-immediately-leave hole: the
  runId only becomes known at the FIRST stream chunk (it's the assistant
  message's id — no synchronous runId in the POST). So a run isn't tracked if the
  user navigates away DURING the brief `submitted` window (before the first
  chunk), or reloads on a different chat, or closes the tab. All three close with
  the same follow-up — a `GET /me/runs?active` endpoint fetched on load — kept
  out to stay client-only. The primary "navigate away after the reply starts /
  background the tab" case IS covered.
- Multi-tab: two tabs of the same user each poll + each notify (double desktop
  notification) — no cross-tab coordination (`BroadcastChannel`) in v1.
- Per-run desktop notification settings; notification history/center; sound;
  aggregating multiple completions. SSE-based watching (polling `GET /runs/:id`
  is simpler and enough for completion detection). Trimming the poll for the
  currently-viewed run (double-watched with its SSE) — low cost at ~1 run.

## Revision history

- **v2 (2026-07-03):** Round-1 review (verifier + adversarial). Adversarial P0s:
  the `cancelled`-always-silent carve-out is now normative (a literal reading of
  v1 would toast "reply ready" for a stopped run); and `untrackChat` on
  onFinish/onError closes the up-to-4s false-positive window (poll ticks are
  decoupled from completion). Adversarial P1: `expired` now surfaces (reaped/hung
  run) rather than being swallowed like a cancel. Verifier P1s: the
  runId-capture hole (submit-then-leave before the first chunk) is a named
  non-goal (same follow-up as reload); placement pinned to the `(chat)` layout +
  `usePathname` (nesting-safe). Multi-tab dup + permission-grant feedback added.
- **v1 (2026-07-03):** Initial.
