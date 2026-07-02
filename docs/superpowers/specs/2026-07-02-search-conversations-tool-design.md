# `search_conversations` — the first context-aware data tool

## Objective

Give the agent a genuinely useful, safe capability and establish the pattern
for every future data-touching tool: a read-only tool that searches the
authenticated user's OWN past messages (across their chats) — memory beyond the
context window / what compaction (#57) summarized away. Its scope comes from
**trusted execution context, never a model argument** — the core
agents-best-practices / repo-security principle ("authorization identity comes
only from a trusted source, never client-controlled input").

## Why this, now (well-integrated)

- The tool loop is proven at every layer but has one *demo* tool. This is the
  first tool with real value AND the pattern (injected context, RLS scope,
  snippet results) all later data/memory/knowledge tools reuse.
- Zero new storage/migration: reuses `messages` + RLS + `tenantDb`.
- Read-only → `SAFE_BUILTIN_TOOL_NAMES` allowlisted, no policy-write friction.
- Just-in-time retrieval per agents-best-practices: search → concise snippets +
  references, result-limited; never load everything.

## Design

### Tool execution context (new)

`BuiltinTool.execute` gains a second param: `execute(args, context?)` where
`ToolContext = { userId, chatId, tenantDb }`. **`context` is OPTIONAL in the
type** so existing single-arg call sites (`get_current_time`'s execute and its
unit test) keep compiling; the run loop ALWAYS supplies it, and data tools
guard (`no_context` → fail closed) when absent. The wrapper in
`RunExecutionService.executeRun` builds it from the RUN's trusted fields
(`input.userId`, `input.chatId`, `this.tenantDb`) and passes it to every
tool's execute. `get_current_time` ignores it (pure). **The model never
supplies userId/chatId** — it can only pass the tool's declared input schema
(query, limit). This is the load-bearing security property.

### The tool

```
name:        search_conversations
riskClass:   read_only  (→ safe allowlist)
inputSchema: { query: string (1..200), limit?: int (1..10, default 5) }  strict
scope:       context.userId (injected) — RLS scopes every read to the user
result:      { status:"success", results: [{ chatId, role, snippet, at }] }
             | { status:"success", results: [] }  (nothing found — the model
               handles it; not an error)
             | { status:"error", type, message }
```

### Search implementation

`MessagesRepository.search(query, ownerUserId, limit)` — run inside
`tenantDb.runAs(userId)`. The `messages_owner` RLS policy is the primary scope;
following the repo's defense-in-depth convention (as `findByChatId` does), the
query ALSO filters `chats.ownerUserId = ownerUserId` explicitly:

```sql
SELECT m.* FROM messages m JOIN chats c ON m.chat_id = c.id
WHERE c.owner_user_id = $ownerUserId
  AND EXISTS (                         -- match text VALUES, not JSON keys
    SELECT 1 FROM jsonb_array_elements(m.parts) AS e
    WHERE e->>'type' = 'text' AND e->>'text' ILIKE $pattern
  )
ORDER BY m.created_at DESC LIMIT $limit
```

- **NOT `parts::text ILIKE`** — jsonb cast to text includes the JSON keys
  (`"type"`, `"text"`), so a query for "text"/"type" would match every message.
  `jsonb_array_elements → e->>'text'` matches only the actual text content.
- `$pattern = '%' || escape(query) || '%'`, a SINGLE-pass `replace(/[\\%_]/g,
  '\\$&')` (sequential replaces would double-escape) so the user's query
  matches literally — ILIKE wildcards can't be injected by the query text.
- Snippet: concat the text parts, truncate to ~200 chars; non-text parts are
  dropped (diverges from `partsToText`'s serialize-fallback — search wants
  human text, not JSON). Never return whole messages.
- **Connection-starvation bound (adversarial review):** this is the FIRST
  slow, data-dependent, UNINDEXED query in the hot path, and it runs mid-stream
  over the process's SINGLE Postgres connection (`db.ts` `max:1`). A large
  history could stall every other concurrent run/request behind that one
  connection. Mitigation: `SET LOCAL statement_timeout = 3000` in the search
  transaction so it fails fast instead of starving the process; the tool turns
  the failure into a structured `search_failed` result (retry with narrower
  keywords), never a throw. A GIN/FTS index is the real fix (deferred).

### Wiring

- `search_conversations` added to `BUILTIN_TOOLS` + `SAFE_BUILTIN_TOOL_NAMES`.
- The run-execution wrapper passes `context` to `execute`.
- System prompt already permits tools; add a one-line hint that it can search
  past conversations.

## Testability

- Unit: the tool with a FAKE ToolContext (a stub tenantDb returning canned
  rows) — asserts it queries via context (not a model arg), returns snippets +
  chatId, empty-results is success, and a bad query fails structured.
- `MessagesRepository.search` RLS integration: seed two users' messages; a
  search as user A returns only A's matches, never B's (cross-tenant denial) —
  the security property, proven under FORCE RLS.
- Tool-loop mechanism (MockLanguageModelV3): the model calls
  search_conversations, the wrapper injects context, execute runs.
- Existing suites stay green (a new safe tool; the fakes ignore tools).

## Non-goals (named)

- Embeddings / semantic search — keyword ILIKE is the defensible MVP (openclaw
  uses FTS; vectors are v0.6 knowledge). No FTS index migration now (ILIKE on
  jsonb text; add a GIN/FTS index when message volume warrants).
- Cross-USER search (never — RLS forbids), memory WRITE tools (policy-gated
  write is a separate, riskier change).
- A BESPOKE search-results UI — the results render through the EXISTING generic
  `dynamic-tool` part (same path as `get_current_time`), no new component.
  Consequence, accepted for MVP (same user, not a tenant issue): a ~200-char
  snippet from another of the user's chats now appears in THIS chat's transcript
  + durable `run_events`. Named, not hidden.
- Ranking beyond recency; pagination; excluding the current turn's own
  just-persisted user message from matches (a harmless self-match for MVP).

## Revision history

- **v2 (2026-07-02):** Round-1 review (verifier + adversarial, both
  not-converged). Both confirmed the IMPLEMENTATION correct; the spec was the
  drift. Fixes: (P0) replaced the stale `parts::text ILIKE` SQL — which matches
  JSON keys in every row — with the `jsonb_array_elements → e->>'text'` form the
  code already uses; (P1) corrected the search signature to
  `search(query, ownerUserId, limit)` with explicit defense-in-depth ownerUserId
  filter (not "no userId needed"); (P1) stated `context` must be OPTIONAL;
  (P1, substantive — fixed in CODE) named the single-connection starvation
  surface and added `SET LOCAL statement_timeout = 3000` + structured
  `search_failed`; (P1) clarified results render via the existing generic
  dynamic-tool path and named the cross-chat-snippet-in-transcript consequence;
  (P2) single-pass escape, snippet/partsToText divergence, self-match noted.
- **v1 (2026-07-02):** Initial.
