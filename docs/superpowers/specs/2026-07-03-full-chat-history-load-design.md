# Load the full chat history (fix the silent 100-message cap)

## Objective

The chat UI silently shows only the LATEST 100 messages. `GET /chats/:id/messages`'s
`ChatMessagesQueryDto.limit` has a class default of 100 (`CHAT_MESSAGES_DEFAULT_LIMIT`,
max 200) that the transforming `ValidationPipe` applies even when the param is
absent — and BOTH history-load sites call the URL with no limit:
`fetchChatMessages` (client, `queries.ts`) and `fetchInitialChatMessages` (SSR,
`server.ts`). So any chat past 100 messages hides its older turns with no
indicator — a real data-visibility bug (surfaced while building export #—, which
paginated for its OWN fetch but left the main view capped). Fix: load the FULL
history by walking the `beforeSeq` cursor, via ONE shared helper used by the SSR
seed, the client query, and export (DRY).

## Design

- New `lib/services/chat/paginate-messages.ts`:
  `paginateAllMessages(fetchPage: (beforeSeq?: number) => Promise<ChatMessagesResponse>)
  → Promise<ChatMessageResponse[]>`. Walks the cursor newest→oldest: page size 100
  (always ≤ the api max, so it never trips `@Max`), each page is oldest-first,
  PREPEND older pages, and STOP when a page returns fewer than the page size (chat
  start), empty, or the cursor fails to advance (a guard against a server ignoring
  `beforeSeq`). `beforeSeq` is EXCLUSIVE server-side (`maxSeq = beforeSeq - 1`), so
  passing the oldest seq seen fetches strictly-older rows — no dup/skip at the
  boundary. `fetchPage` is injected, so the loop is pure and unit-tested.
- **Safety valve (review P1):** the walk is capped at `CHAT_HISTORY_MAX_PAGES` (20
  → latest 2000 messages). llame's durable runs can accrue very long histories
  with large tool-call traces, so an UNBOUNDED load would risk SSR latency and a
  huge serialized RSC/HTML payload. The cap bounds both; a chat past it shows the
  latest 2000 turns (vs the old 100). The true tail is a follow-up (see non-goals).
- `queries.ts` `fetchChatMessages`: build each page with `buildChatMessagesHistoryUrl(
  chatId, { limit: 100, beforeSeq })` via the ky client, FORWARDING the TanStack
  `signal` into every page's `api.get` (so unmount/invalidation cancels in-flight
  fetches) → `paginateAllMessages` → `toChatUiMessages`.
- `server.ts` `fetchInitialChatMessages`: same, with a raw-`fetch` `fetchPage` that
  carries the session cookie and applies the auth (401→redirect, 400/404→notFound)
  and timeout PER PAGE. Per-page (not a single total deadline) is a deliberate
  choice: each round-trip is bounded by `CHAT_HISTORY_FETCH_TIMEOUT_MS`, and the
  page cap bounds the count, so worst-case SSR time is `MAX_PAGES × timeout` (only
  reached if every page is slow — normal pages are sub-100ms).
- `export.ts`: refactor `fetchAllMessages` to call the shared helper (removes the
  duplicate loop).

## Testability

- `paginateAllMessages` (unit, injected `fetchPage`): a single short page → one
  fetch, all rows; exactly-page-size then a short page → two fetches, merged
  oldest-first with the cursor set to the oldest seen seq; an empty first page →
  `[]`; a full page then empty → stops. Assert the `beforeSeq` passed to each call.

## Non-goals (named)

- Virtualization / incremental "load older" UI — this loads up to the capped
  window (latest 2000) up front; rendering is unchanged. The cost: `min(⌈N/100⌉,
  MAX_PAGES)` sequential fetches (+1 empty-page round-trip when the length is an
  exact multiple of the page size), plus an unvirtualized render of the window.
  On-demand older-load (past the cap) + windowed rendering is the follow-up for
  pathologically long chats — the cap is the safety valve until then.
- Changing the endpoint's default limit — the server is unchanged; the client
  paginates. (Raising the default would just move the cap, not remove it.)

## Revision history

- **v2 (2026-07-03):** Round-1 review verified the cursor walk (exclusivity,
  ordering, termination, page-size) is correct — no P0s. Resolved its P1s: added
  a `CHAT_HISTORY_MAX_PAGES` safety valve (bounds SSR latency + the serialized
  payload for very long durable-run histories); confirmed the client path forwards
  the TanStack `signal` per page (cancellation preserved); made the per-page SSR
  timeout choice explicit (bounded by the page cap). Folded in the P2s: the
  `beforeSeq`-exclusive contract is now stated, and the ⌈N/100⌉ cost corrected for
  the cap + the exact-multiple extra fetch.
- **v1 (2026-07-03):** Initial.
