# Agent todos — durable, chat-scoped task tracking

## Objective

Give the agent a durable working plan it can maintain across turns — a
chat-scoped todo list (principle #2 lists "todos" as first-class durable
structured data; v0.5 control primitive). The agent reads the current list and
rewrites it as its plan evolves, and the list survives a page refresh (llame's
durable ethos).

## Research-backed decisions (Claude Code, opencode, Open WebUI)

- **Replace-all, not incremental.** Both Claude Code's `TodoWriteTool` and
  opencode's `todowrite` take the WHOLE list every call (one tool). Claude
  Code's incremental Task system exists ONLY for multi-agent swarm coordination
  (ownership claims, blocking deps, per-task locking) — a different problem.
  For a chat-scoped list with one run at a time, replace-all is what both
  converge on. opencode implements it as `DELETE … WHERE session_id` +
  bulk-INSERT with an explicit `position` column (array order), in one
  transaction — the exact pattern for a Postgres-backed chat list.
- **Fields:** `content` + `status` (the floor both agree on) + `position`
  (opencode's ordering column, needed because replace-all is delete+reinsert).
  Status = opencode's 4-state `pending | in_progress | completed | cancelled`
  (strictly more expressive than Claude Code's 3-state, free). Skip
  `activeForm` (spinner cosmetic) and `priority` (no consumer). No model-facing
  `id` — the model sends/receives an ordered list, not id-addressed items.
- **`write_todos` is default-DENY (gated), like `remember` (v2 — both reviewers).**
  My v1 argued default-available (references default todos on). Both reviewers
  rejected it, and correctly: (1) it contradicts `registry.ts`'s unconditional
  "a WRITE tool never belongs in the safe allowlist" invariant, established when
  `remember` was locked down; (2) the risk ordering is BACKWARDS — `remember`
  is append-only (can only grow, capped) yet gated, while `write_todos` is
  replace-all (delete-then-reinsert — a mistaken empty/partial call clears the
  plan), STRICTLY more destructive, so if `remember` is gated `write_todos` must
  be too. So `write_todos` stays out of the safe allowlist: default-deny,
  enabled by an operator (`TOOLS_ENABLED=write_todos`) or an explicit policy
  allow — consistent with the "agent writes are operator-opt-in" posture.
  `list_todos` (read-only) is default-available. (The industry precedent for
  default-on todos holds for EPHEMERAL session todos; llame's are durable, so
  the destructive replace-all is exactly what the gate protects.)

## Design

### Storage (`todos` table)

```
todos: id uuid PK, chat_id uuid FK→chats(cascade), content text NOT NULL,
       status todo_status NOT NULL default 'pending', position int NOT NULL,
       created_at, updated_at
```
`todo_status` pgEnum = `pending|in_progress|completed|cancelled`. RLS
`todos_owner`: `EXISTS (SELECT 1 FROM chats c WHERE c.id = todos.chat_id AND
c.owner_user_id = current_setting('app.current_user_id', true))` (chat
ownership = tenant boundary, like messages). `.enableRLS()` + the migration
hand-appends `FORCE ROW LEVEL SECURITY`. Index `(chat_id, position)`. DB
`CHECK(char_length(content) BETWEEN 1 AND 500)` + a per-chat count cap
(`TODOS_MAX_PER_CHAT = 50`) enforced in `write_todos` — a plan isn't a dumping
ground, and it bounds the replace-all payload.

### Tools (chat-scoped via injected ToolContext.chatId)

- `list_todos()` — read the current chat's todos, ordered by position. Returns
  `{ status:'success', todos:[{content, status}] }`. `read_only`.
  **Why a read tool AND replace-all:** llame persists only the assistant's
  final text per turn — tool calls/results are NOT in the next turn's context
  (unlike Claude Code, which keeps todos in view). So a fresh turn must
  `list_todos` to see current state before it can `write_todos` the updated
  list. (Auto-injecting todos into context — so the model always sees them — is
  a natural follow-up, not the MVP.)
- `write_todos(todos: [{content, status?}])` — REPLACE the chat's list with the
  given items in one transaction (delete the chat's todos, insert with
  `position` = array index; status defaults to `pending`). Rejects if the list
  exceeds the per-chat cap. Returns the stored list. `write_internal`,
  default-available (see above).

`list_todos` is in `SAFE_BUILTIN_TOOL_NAMES` (read-only, default-available);
`write_todos` is NOT (default-deny — enabled via `TOOLS_ENABLED`/policy). Scope
from injected `chatId`, never a model arg. `write_todos.replace` runs under
`SET LOCAL statement_timeout = 3000` (mid-stream delete+bulk-insert on the
single connection). Replace-all's omitted-item-is-deleted semantics are named
in the tool description (the model must send the full list) and are the reason
it's gated. `(chat_id, position)` is a UNIQUE index (defense-in-depth: no
duplicate positions → deterministic `list_todos` order). The per-chat cap is
the zod `.max(50)` on the array (no count round-trip — replace-all sets the
whole list).

## Testability

- Unit (fake ToolContext): `write_todos` replaces (calls repo.replace with the
  chat scope + positioned items); `list_todos` maps rows; empty list is
  success; no-context fails closed; the schema caps content length and rejects
  an over-cap list.
- RLS integration (real DB, FORCE): user A's `list_todos`/replace only ever
  touches A's chat's todos, never B's (cross-tenant denial); replace-all
  delete+reinsert preserves order via `position`; `relforcerowsecurity`
  asserted; the content CHECK holds. Mirrors `memories-rls.integration`.
- End-to-end (MockLanguageModelV3, like `memory-loop.integration`): the model
  calls `write_todos([...])` then `list_todos()` through the real loop; assert
  the todos persisted under RLS and both tool calls landed in the trace.
- Existing suites green: two new default-available tools; fakes ignore tools.

## Non-goals (named)

- Incremental/id-addressed ops, dependency graph, ownership/claim (swarm-only).
- `priority`, `activeForm`, auto-inject of todos into context (follow-up),
  a todos UI panel, cross-chat/global todos, goals (a distinct v0.5 object).
- Subagent write-restriction (opencode denies todo-write to parallel subagents;
  llame has no parallel sub-runs per chat yet — revisit when it does).

## Revision history

- **v2 (2026-07-02):** Round-1 review (verifier + adversarial, both
  not-converged, both landing the SAME core defect). Load-bearing fix:
  **`write_todos` is default-DENY (gated like `remember`), not in the safe
  allowlist** — it contradicted the "no write in the allowlist" invariant AND
  the risk ordering was backwards (replace-all is more destructive than
  append-only `remember`, which is gated). `list_todos` (read) stays
  default-available. Also fixed in the implementation: the stale `remember.ts`
  docstring that wrongly said "default-available"; a UNIQUE `(chat_id, position)`
  index (adversarial P1); `statement_timeout` on the replace transaction
  (adversarial P1); the destructive omitted-item semantics named in the tool
  description. Reframed "transient vs durable" → the real axis is chat-scoped vs
  account-cross-session (verifier). RLS/atomicity/stateless-turn claims
  confirmed correct by both. Verified: tool unit tests + 5 todos RLS
  integration cases green.
- **v1 (2026-07-02):** Initial.
