# Run notifications survive a reload — re-hydrate active runs on load

## Objective

Durable runs exist so you can "send a message, walk away, get told when it's
done." The notification layer (toast + sidebar badge + optional desktop alert on
completion — `ActiveRunsProvider`) tracks runs ONLY in an in-memory Map, populated
by the chat page as a run starts this session. A page RELOAD wipes that Map, so an
in-flight run's completion goes un-notified — the exact "walked away and came
back" case the feature is for. Re-hydrate on load: fetch the caller's active runs
and re-track them, so the existing poll loop still notifies on completion. This
completes a known gap in a flagship feature (well-integration), no new
notification machinery.

## Design

### Backend

- `RunsRepository.findActiveByUser(userId)` → the caller's NON-terminal runs across
  all their chats, INNER JOINed to `chats` for the title (and owner defense-in-
  depth, mirroring `findActiveByChatId`), ordered `createdAt` asc. Non-terminal =
  `status NOT IN (completed, failed, cancelled, expired)` (the same list the
  existing active queries use).
- `GET /api/v1/me/runs?status=active` (new `MeRunsController`, mirroring
  `MeUsageController`/`MePromptsController`) → `ActiveRunResponse[]`
  (`runId`, `chatId`, `chatTitle`, `status`, `createdAt`). Owner-scoped via
  `runAs(userId)` — RLS + the owner JOIN. `ActiveRunsQueryDto` with a required
  `status` enum whose only member is `active` (forward room; a non-`active` value
  is a 400, not a silent full-list). Code-first DTO + explicit response type.

### Web

- `fetchActiveRuns()` — a PLAIN fetch, NOT a React Query hook (adversarial P0).
  `ActiveRunsProvider` lives in the `(chat)` layout, not the app root, so it
  remounts whenever the user leaves and re-enters the route group (session-expiry
  → `/login` → back; opening a chat's `/shared/:id` link and returning). A React
  Query cache frozen by `staleTime: Infinity` would REPLAY that stale snapshot to
  the "on data" effect on remount — re-tracking runs that already completed +
  notified + dropped during the first mount → a second, spurious toast. A plain
  fetch in a mount effect has NO cache to replay: it re-reads CURRENT active runs
  each mount, so a since-completed run is terminal server-side and simply absent.
- In `ActiveRunsProvider`, a mount effect (`[]`-stable `trackRun` dep, with a
  `cancelled` guard for StrictMode/unmount) fetches and `trackRun(runId, chatId,
  chatTitle)` for each via the pure `activeRunsToTrackArgs`. `trackRun` is
  idempotent on `runId` (existing), so a run already tracked this session (chat
  page) is not duplicated. The existing poll loop (`fetchRun(runId)` per tracked
  run → notify on terminal) does the rest unchanged.

## Testability

- API (integration, RLS): `findActiveByUser` returns the owner's non-terminal runs
  with the chat title, EXCLUDES terminal runs, and returns nothing for a
  cross-tenant caller (owner-scoped, no leak).
- Web (unit): a pure `activeRunsToTrack(response)` mapping the response rows to
  `{runId, chatId, title}` track args (the effect calls `trackRun` over it);
  covers empty + multiple.

## Non-goals (named)

- Notifying about a run that COMPLETED while the tab was FULLY closed: on reopen
  it is terminal, so it is not in the active set and is not re-hydrated. Closing
  that needs unseen-completion tracking (a per-run seen marker or a
  recently-completed endpoint + client last-seen watermark) — a named follow-up.
  This change covers reload-WHILE-in-flight only, and says so.
- The narrow re-track/untrack ordering window (adversarial P1): after a reload
  onto the run's own chat, `useChat` resume may `untrackChat` on finish just
  before the slower `fetchActiveRuns` re-tracks it; the run is then polled once
  more, and `resolveTerminalRun`'s `viewingThisChat` guard suppresses the toast
  UNLESS the user navigated away within that ~1 poll tick. One stray toast in a
  triple-coincidence window; not worth extra coupling to eliminate.
- The active set is broad: only 4 of 14 `RunStatus` values are terminal, so a
  `queued` run stuck because the worker is down is re-tracked and polled until the
  deadman/expiry job flips it to `expired`. Pre-existing (same list the in-session
  tracker uses), accepted.
- A runs dashboard / history list; cancelling a run from the list; live push
  (the poll loop is unchanged). Paginating the active set (a user has O(few)
  concurrent runs).

## Revision history

- **v2 (2026-07-03):** Round-1 review. The adversarial reviewer found a real P0:
  a React Query hook with `staleTime: Infinity` would REPLAY its stale snapshot on
  provider re-mount (the provider is in the `(chat)` layout, not the app root) →
  double-notify already-completed runs. Fixed: a PLAIN fetch-in-effect (no cache
  to replay), fresh each mount. Both reviewers confirmed cross-tenant isolation is
  correct (`runs_owner` scopes by `user_id`, independent of chat visibility — no
  shared-chat leak) and the poll-loop re-notify mechanism. Added: the pure
  `activeRunsToTrackArgs` (unit-tested) and named the ordering-race + broad
  non-terminal-set limitations in Non-goals.
- **v1 (2026-07-03):** Initial.
