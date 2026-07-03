# Chat search — find past conversations

## Objective

As chat history accumulates, a user needs to FIND a past conversation. llame
already has the keyword-search primitive (`MessagesRepository.search`, the
`search_conversations` agent tool) but no USER-facing search. Add a search box
that finds chats by title OR message content and jumps to them. Surfaces a
built capability; clean and owner-scoped (no new RLS).

## Note (deferred, not this iteration)

The bigger gap — the org/membership admin HTTP surface (#44 governance is built
but unreachable) — is deferred: it needs security-critical RLS work (a
recursion-safe member-visibility policy via a SECURITY DEFINER helper, an
escalation model, an invite/email flow) that warrants a dedicated, careful
iteration rather than an autonomous rush. Flagged as the next big rock.

## Reference (Open WebUI)

`get_chats_by_user_id_and_search_text` (`models/chats.py:1389`) searches title
(`Chat.title.ilike`) AND content together, with `tag:`/`folder:`/`pinned:`
filters and word-splitting; the UI is a sidebar `SearchInput`. llame's MVP takes
the title+content core; tags/folders/pinned don't exist yet (out of scope).

## Design

### Backend

- `ChatsRepository.searchByOwner(userId, query, limit)` — a single owner-scoped
  query (RLS is the guard; the `owner_user_id` predicate is the seatbelt) that
  returns chats where the TITLE matches `ILIKE` OR the chat has a message whose
  text part matches, ordered by `updated_at DESC`, with a `snippet` = the first
  matching message's text (null for a title-only match). Reuses the existing
  `jsonb_array_elements(parts) → e->>'text' ILIKE` shape (NOT `parts::text`) and
  a `SET LOCAL statement_timeout` (unindexed scan on the shared connection, like
  `MessagesRepository.search`). The `%`/`_`/`\` in the query are wildcard-escaped.
  Empty/blank query → `[]` (no full-table dump).
- `GET /api/v1/chats/search?q=&limit=` → `{ results: [{ id, title, snippet,
  updatedAt }] }`. DTO (query) + explicit response type. `limit` bounded
  (default 20, max 50). Placed BEFORE `GET /chats/:id` route-wise so `search`
  isn't captured as an `:id` (or use a distinct path) — verify NestJS route
  ordering.

### Web

- A `SearchInput` in the sidebar (`app-sidebar`) above the chat history:
  debounced query → `GET /chats/search` via a ky/TanStack Query service. Results
  render as a list (title + muted snippet); clicking navigates to the chat and
  clears the search. Empty query shows the normal history (search is additive,
  not a replacement).

## Testability

- Repo/RLS integration: finds the owner's chats by TITLE and by CONTENT; returns
  a snippet for a content match; cross-tenant chats/messages never match (RLS);
  blank query → `[]`; wildcard chars in the query are escaped (a literal `%`
  doesn't match everything). Ordered by recency.
- API: the endpoint maps rows → response; unauthenticated rejected; `:id` route
  not shadowed by `search`.
- Web: the search service (URL/params); the input debounces and renders results.

## Review-hardened decisions

- **Role filter (adversarial P1):** the query matches ONLY `role IN
  ('user','assistant')` text parts — system prompts and tool results are never
  matched NOR surfaced as snippets, so a future persisted tool-result (raw API
  payload / token) can't leak into a browser-visible search snippet.
- **Shared-connection cost (adversarial P1):** the whole process runs on ONE
  Postgres connection (`db.ts max:1`), so a type-ahead must not flood it. Client
  mitigations: 300ms debounce, a 2-char minimum, and request cancellation on
  retype (TanStack Query passes an AbortSignal to ky). Server: the query is
  `statement_timeout`-bounded (3s). A real fix (FTS / pg_trgm index, or a
  read-pool) is the named follow-up; this MVP is bounded, not free.
- **`q` capped at 200 chars (DTO `@MaxLength`)**; trimmed BEFORE the blank check
  (a lone space → `[]`, not a whitespace-matches-everything dump); snippet
  subquery is `ORDER BY seq LIMIT 1` (deterministic earliest match).

## Non-goals (named)

- Tag / folder / pinned filters, full-text ranking / relevance (ILIKE only),
  fuzzy/semantic search (that's the v0.6 pgvector work).
- Searching across shared/project chats (no sharing yet).
- Highlighting the match within the snippet (plain excerpt for the MVP).

## Revision history

- **v2 (2026-07-03):** Round-1 review. Primary reviewer CONVERGED (route
  shadowing — `GET search` declared before `GET :id` — and RLS/wildcard-escape
  verified against source; its P2, snippet-as-a-single-SQL-statement, is
  satisfied by the correlated subquery). Adversarial P1s fixed: role filter
  (exclude system/tool from matches + snippets), the shared-connection
  type-ahead mitigations (debounce + min-length + abort; FTS follow-up), `q`
  length cap, trim-before-blank, deterministic snippet ordering.
- **v1 (2026-07-03):** Initial.
