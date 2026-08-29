## Why

Acceptance testing of #609 exposed two avoidable sources of model and operator confusion: canonical excerpts require a hidden opt-in even when `conversation_read` is available, and public message locators leak a database-wide identity instead of naming a message within its Chat. Because the dependent stack is still unmerged, the product should cut over once to the simple contract instead of shipping a legacy model-result mode or globally large locator values.

## What Changes

- **BREAKING** Remove `search.chats.canonicalModelExcerpts`; `search_conversations` always returns the canonical content/metadata union when allowlisted and never falls back to the legacy model preview shape.
- Fail HTTP startup when it can admit allowlisted `search_conversations` Runs without complete current projection locator coverage, and fail every runs-consuming worker on incomplete coverage regardless of that worker's current allowlist; retain the web presentation response independently.
- **BREAKING** Change `messages.seq` from a database-wide generated identity to an immutable, positive, one-based insertion sequence allocated independently within each Chat.
- Deterministically backfill existing messages in their prior sequence order and translate persisted compaction boundaries under a quiesce/drain cutover.
- Use the same Chat-local sequence for owner/shared history cursors and message DTOs, search locators, `conversation_read`, neighboring-message navigation, Run boundaries, compactions, forks, and message links.
- Keep message order append-only: no product operation deletes or reorders an individual message. Whole-Chat deletion removes the complete sequence namespace; assistant retry updates retain the existing row and sequence; a fork starts a new namespace at 1.
- Allocate ordinary concurrent inserts through the existing `(chat_id, seq)` uniqueness boundary using `MAX(seq) + 1` plus bounded same-Chat collision retry, without a counter table or Chat-row lock.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-search`: Make canonical model-facing search shaping unconditional for an allowlisted tool, remove the legacy model fallback/feature flag, and fail boot on incomplete locator coverage.
- `conversation-reads`: Define `messageSeq` as the immutable one-based insertion sequence local to one Chat, require dense append-only allocation for the Chat lifetime, and prohibit individual-message deletion/reordering.
- `tool-calling`: Align persisted conversation-read lifecycle semantics with whole-Chat deletion and the coordinated declaration/data cutover rather than individual source-message deletion.

## Impact

- Issue: #630, follow-up to #609 and related to #194/#611.
- Database: `messages.seq` identity semantics, `(chat_id, seq)` allocation/backfill, compaction `upto_seq`, migration verification, RLS-backed concurrency tests, and coordinated Run drain requirements.
- API/worker: message repositories, owner/shared history and Run/compaction cursors, positive-safe Run queue parsing, search hydration, conversation reads, target loading, queue fixtures, immutable declaration snapshots, and role-aware startup coverage admission.
- Configuration: loader types/defaults/schema/tests and operator examples remove `canonicalModelExcerpts`; stale configurations fail strict validation.
- Web: message anchors and targeted-history calls retain their public shape but receive small Chat-local values; ordinary web search presentation remains unchanged.
- Documentation/specs: conversation recall rollout/rollback, API operational guidance, CHANGELOG/ROADMAP, and canonical `chat-search`, `conversation-reads`, and `tool-calling` requirements.
