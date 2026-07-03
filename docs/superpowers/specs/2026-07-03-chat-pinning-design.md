# Pin a chat to the top of the sidebar

## Objective

Chats accumulate into a flat, time-grouped sidebar list; there's no way to keep an
important conversation reachable as it ages out of "Today". Add PINNING — pin a
chat to a "Pinned" section at the top, independent of recency. Completes the
chat-management suite (rename / delete / share / export / fork). Validatable via
the RLS harness (pin is owner-scoped) + the pure grouping logic.

## Design

### Backend
- Migration (drizzle-kit generated, next number): `chats.pinned_at timestamptz
  NULL`.
- PATCH `/chats/:id` — extend the existing owner-scoped `updateChat`: `UpdateChatDto`
  gains `pinned?: boolean` (`@IsBoolean @IsOptional`); the repo maps `pinned` →
  `pinnedAt = pinned ? now() : null`. No new endpoint (pin is a chat attribute).
- `ChatsRepository.findByOwner`: order `pinnedAt DESC NULLS LAST, updatedAt DESC`
  — pinned first (most-recently-pinned first), then recency. (The per-user chat
  list is small + fully returned, so the extra sort key needs no new index.)
- `ChatResponse` + `toChatResponse`: add `pinnedAt: Date | null`.

### Web
- `ChatResponse` type: add `pinnedAt: string | null`.
- `groupChatsByTimePeriod`: pull chats with `pinnedAt` into a new `Pinned` group
  rendered FIRST (in the API's pinned-first order), then time-group the REST — a
  pinned chat appears ONLY in Pinned, never also under Today/etc. Pure → unit-test.
- Sidebar chat menu (`app-sidebar-chat-history`): a "Pin"/"Unpin" item (pin icon)
  → the update mutation `{ pinned }` → invalidate the chat list. A small pin
  indicator on pinned rows.

## Testability

- `groupChatsByTimePeriod` (unit): a pinned chat lands in `Pinned` and NOT in its
  time group; unpinned chats still time-group; Pinned preserves input order.
- API (integration, RLS): pinning sets `pinnedAt` (owner-scoped read-back);
  unpin clears it; a CROSS-TENANT pin (PATCH another user's chat) changes nothing
  and 404s; `findByOwner` returns pinned rows first.

## Non-goals (named)

- Manual pin reordering (drag) — pinned sort by pin time. A pin count LIMIT —
  unbounded (self-inflicted; the list still renders). Per-project pins — projects
  aren't built. Pinning someone else's shared chat — owner-scoped only.

## Revision history

- **v2 (2026-07-03):** Round-1 review verified all correctness against primary
  sources — no logic bugs: the cross-tenant pin 404s (owner-scoped `.where` + RLS);
  the `contentChanged` split means a pin toggle writes `pinnedAt` WITHOUT bumping
  `updatedAt` (else unpin floats the chat to "Today"); `desc(pinnedAt)` alone would
  emit PG-default `NULLS FIRST` (unpinned before pinned) so the explicit
  `DESC NULLS LAST` raw fragment is required; migration 0030 is additive/nullable,
  no RLS change. Folded in the two P1 test-coverage gaps it named: repo unit tests
  locking the pin/no-`updatedAt` coupling, and a grouping unit test for the Pinned
  bucket. Fixed the stale `findByOwner`/`update` docstrings (P2).
- **v1 (2026-07-03):** Initial.
