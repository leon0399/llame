# Command palette: search chat CONTENT, not just titles

## Objective

The ⌘K palette lists chats but filters them by TITLE only — cmdk's built-in
client filter over the already-loaded infinite-query pages. Typing a word that
appears in a message BODY won't surface the chat, even though llame already has a
content-search endpoint (`GET /chats/search`, used by the sidebar search via
`useChatSearchQuery`). Wire the palette's chat results to that endpoint so ⌘K
becomes a real "find any conversation by what was said in it" surface — pulling
the shipped search backend into the command hub instead of leaving it siloed in
the sidebar. Well-integration, client-only, no api/schema change.

## Design

`shouldFilter={false}` is NOT viable: the palette uses the shared `CommandDialog`
wrapper, which spreads props to `Dialog`, not to the inner cmdk `Command` — and
packages/ui says don't edit vendored primitives. So KEEP cmdk's built-in filter
(it already filters the static groups by title/label) and make the server results
survive it by embedding the query in their `value`.

- `CommandInput` becomes CONTROLLED (`value={query}`, `onValueChange`), so we can
  drive the debounced search + the server-result values. `query` resets on close.
- Hooks are called UNCONDITIONALLY every render (Rules of Hooks — the sidebar's
  exact pattern): `debounced = useDebouncedValue(query, 300)`;
  `{ data: results, isFetching } = useChatSearchQuery(debounced)` (self-gates via
  `enabled: >= MIN`). Only the RENDERED JSX branches.
- Mode flag uses the DEBOUNCED value (matching the sidebar, so the boundary
  doesn't flash an empty "server mode" for 300ms): `searching =
  debounced.trim().length >= MIN_SEARCH_LENGTH`.
- Chats group:
  - `!searching`: recent chats (loaded pages) — unchanged, cmdk filters by title.
  - `searching`: content-search results, each `CommandItem value={`${query} ${id}`}`
    so cmdk (filtering by the current `query`) always keeps them (the server
    already did the matching; embedding the current — not debounced — query avoids
    filter flicker while typing). Renders title + snippet.
  - Loading: while `isFetching` with no results yet, render a DISABLED
    `CommandItem` "Searching…" (value embeds `query`). A disabled item keeps cmdk's
    rendered count non-zero, so it never double-renders with cmdk's own
    `CommandEmpty` ("No results.") — which correctly shows only when the search
    truly returns nothing.
- Actions (New chat, Settings) + Switch model: unchanged (cmdk keeps filtering
  them by the query).

## Testability

- The palette is cmdk/hook wiring — the pure pieces it reuses (the search
  endpoint + query hook, the debounce hook, `isPaletteToggle`) are already
  unit-tested; this change adds no new pure logic (cmdk owns filtering), so it's
  type-checked + lint + build-verified, with the review round as the correctness
  gate.

## Non-goals (named)

- Searching non-chat entities (settings sections, prompts, memories) in the
  palette — chats first; settings is a single page today. Fuzzy ranking — the
  server owns relevance. Changing cmdk keyboard nav. Debounce/endpoint changes —
  reuse the sidebar's exact `useDebouncedValue(300)` + `MIN_SEARCH_LENGTH` path.

## Revision history

- **v2 (2026-07-03):** Round-1 review. P0: `shouldFilter={false}` can't attach
  through `CommandDialog` (spreads to `Dialog`, not the inner `Command`) and would
  force a discouraged packages/ui edit — pivoted to KEEP cmdk's filter + embed the
  query in server-result `value`s (zero footprint outside the palette, preserves
  the server's relevance order). P1s folded in: hooks called unconditionally
  (Rules of Hooks); loading rendered as a DISABLED `CommandItem` so it never
  double-renders with cmdk's `CommandEmpty`. P2: the mode flag uses the DEBOUNCED
  value (no 300ms empty-flash). `commandMatches` dropped (cmdk still filters the
  static groups).
- **v1 (2026-07-03):** Initial.
