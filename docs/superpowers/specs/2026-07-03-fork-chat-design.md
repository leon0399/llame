# Fork a conversation from an earlier point

## Objective

There is no way to explore an ALTERNATE conversation direction without destroying
the original — regenerate REPLACES the last reply, edit REWRITES a message. "Fork
from here" COPIES a chat up to a chosen message into a NEW independent chat, so you
can continue differently while the original stays intact (the canonical use: fork
at an assistant reply, then ask a different follow-up). Reference-supported —
session lineage is a first-class pattern in the checkouts (Hermes
`parent_session_id`, opencode sessions, our own `compactions.parentId` + #57).
Validatable via the RLS harness (reliable here), no E2E dependency.

## Design

### Backend
- `POST /api/v1/chats/:id/forks` body `{ fromMessageId }` → creates a NEW chat
  (owner = caller, title = `forkTitle(original.title)`) and COPIES every message
  with `seq <= fromMessage.seq` into it, in seq order, then returns the new
  `ChatResponse` (201). A fork IS a new chat resource → POST to the `forks`
  SUB-COLLECTION, NOT an RPC `/fork` verb (matches regenerate→`/runs`; AGENTS.md
  "don't bolt on verbs"). `ChatsService.forkChat` + `ForkChatDto` (`fromMessageId`
  uuid, `@IsUUID`).
- Owner-scoped & atomic: all inside `runAs(userId)` (one tx). `findById(chatId,
  userId)` → 404 if not owned (no existence leak). The fork-point message is found
  by `(chatId, fromMessageId)` — a message id from ANOTHER of the caller's chats
  also 404s (it isn't in this chat's list; `findByChatId(chatId, userId)` is called
  WITHOUT `limit`, so it returns full rows ascending by seq). The new chat + every
  copied message INSERT under `runAs(caller)`, so RLS makes them the caller's — a
  cross-tenant fork can't create anything.
- The copy carries `role`, `senderUserId`, `parts`, `attachments` — but NOT
  `usage`: a fork makes ZERO API calls, so carrying the original cost/token
  telemetry (with a fresh `created_at`) would DOUBLE-COUNT the source spend in the
  BYOK usage dashboard (which sums `messages.usage` by `created_at`). `in_reply_to`
  is REMAPPED via an old→new id map built as we go (copies are seq-ordered, so an
  assistant's replied-to user message is always copied first) — satisfies the `#73`
  integrity trigger and the one-reply-per-message unique index (the copy is 1:1).
  `seq` is `generatedAlwaysAsIdentity` — regenerated, but insert order preserves
  ordering.
- **DoS bound (review P1):** the DB pool is `max:1` (one shared connection app-
  wide), so an unbounded copy would hold the process's only connection through
  ~N sequential inserts, blocking EVERY tenant's request. Guarded by a hard cap:
  `> MAX_FORK_MESSAGES (1000)` messages to copy → 400. A fork past that is
  rejected rather than serialized.

### Web
- A "Fork" (git-branch icon) button on ASSISTANT messages (any position, when
  `status` is ready/error — the natural fork points) → `useForkChat` mutation →
  `POST …/fork` → navigate to `/chat/:newId` + invalidate the chats list.

## Testability

- API (integration, RLS): forking the owner's chat creates a NEW owned chat with
  the copied prefix — right count, seq order preserved, `in_reply_to` remapped to
  the NEW ids (the assistant copy points at the copied user turn, not the
  original); a cross-tenant fork (forking a chat you don't own) → 404 and creates
  NOTHING; forking from an assistant message includes its preceding user turn.
- Pure `forkTitle(title)` (unit): appends " (fork)", idempotent-ish shape.

## Non-goals (named)

- Lineage tracking (a `parent_chat_id` column) — the MVP forks into an
  INDEPENDENT chat; recording provenance needs a migration, a follow-up.
- Forking a chat you DON'T own (e.g. someone's public/shared chat into your
  account) — owner-scoped only; a cross-owner copy is a separate data-flow.
- Batch-copying huge chats — sequential inserts (needed for the id remap); fine
  for typical sizes, a perf follow-up otherwise.
- Auto-running the fork — it copies; the user continues by sending.
- Carrying the source's compaction (#57): the fork has no `compactions` row, so
  a long forked prefix re-compacts on its next turn (extra summarization call).
  Self-healing (the context-builder's own `maxMessages` cap prevents any break),
  named here as an accepted cost surprise.

## Revision history

- **v2 (2026-07-03):** Round-1 review. Both reviewers verified the copy/remap is
  correct (seq-prefix → new ids, `#73` trigger + unique index satisfied) and the
  cross-tenant fork creates nothing. Fixes to their findings: (adversarial P1)
  `usage` is NOT copied — else a fork double-counts BYOK spend; (adversarial P1)
  a `MAX_FORK_MESSAGES` cap bounds the copy given the `max:1` connection's cross-
  tenant DoS blast radius; (primary P1) the endpoint is `POST /chats/:id/forks`
  (sub-collection), not an RPC `/fork` verb, per the codebase's REST convention.
  Folded in the P2s: explicit `(chatId, fromMessageId)` lookup scoping, the
  no-`limit` `findByChatId` ordering note, and the compaction non-goal.
- **v1 (2026-07-03):** Initial.
