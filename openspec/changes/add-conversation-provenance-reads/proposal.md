## Why

Conversation search currently returns snippets rendered from a rebuildable projection, so the model cannot distinguish retrieval context from exact canonical conversation evidence or safely expand a hit around giant messages. llame needs a bounded owner-authorized read path whose public coordinates remain message-oriented and usable without exposing JSON part indexes, projection hashes, or line-number prefixes.

This proposal is intentionally narrower than the combined `#198` + `#609` issue text. `#609` owns canonical provenance, source references, and bounded reads. `#198` still owns the final `search_conversations` discovery union and timeline-mode input contract. The older `#609` body also suggested part identity and model-facing source hashes; this change rejects both in favor of immutable message identity plus optional line bounds, with `#611` carrying the remaining retry/edit premise work.

## What Changes

- Define a versioned visible-message text view that preserves eligible text parts in stored order, joins them with `\n\n`, never merges messages, and is recomputed from canonical `messages.parts` rather than persisted as another source copy.
- Add versioned structured conversation source references and a read-only `read_conversation_range` tool for direct message links, search-result expansion, and bounded multi-message reads.
- Return raw canonical visible-message slices with message identity, role, timestamp, and zero-based line coordinates; do not expose part identity, model-facing content hashes, or generated line-number prefixes.
- Resolve lexical/trigram search hits to the exact matching source line plus one adjacent source line on each side. Resolve vector-only candidates to explicitly labeled exact retrieval context without pretending that vector similarity selected a quote.
- Preflight oversized messages below the common tool-result cap and return bounded Markdown heading outlines, exact initial slices, and deterministic continuation coordinates rather than generic truncation or whole-message loading.
- Optionally return bounded historical activity metadata that preserves the order of visible text regions and settled tool names/outcomes with already-safe source attribution. Reasoning text and unrestricted tool arguments/results remain excluded.
- Extend the derived chat-search projection with only the message-relative source boundary offsets needed to hydrate a winning chunk efficiently. Keep its existing internal content hash for rebuild and embedding validity; do not expose it as conversation provenance.
- Treat immutable message identity as the source-version premise. Until #611 replaces in-place retry mutation, retryable assistant rows are not eligible citation sources; missing, deleted, malformed, or unauthorized references fail closed.
- Preserve the web command palette's existing derived preview contract while the current content-search tool and the future #198 content/timeline modes reuse the same canonical source-reference and bounded-read layer.

## Capabilities

### New Capabilities

- `conversation-reads`: Canonical visible-message serialization, versioned source references, bounded line/message reads, oversized-message navigation, safe activity metadata, authorization, and failure semantics.

### Modified Capabilities

- `chat-search`: Separate web preview shaping from model-facing canonical passages while preserving one ranked search path and define exact versus vector-only result semantics.
- `search-projection`: Retain minimal canonical source boundary offsets and exclude mutable/non-evidence message content while remaining fully rebuildable and owner-isolated.
- `tool-calling`: Register, execute, persist, replay, compact, truncate, and render `read_conversation_range` under the existing read-only tool lifecycle.

## Impact

- `apps/api/src/chats`: owner-scoped bounded message-range reads, visible-message rendering, immutable evidence eligibility, and activity projection.
- `apps/api/src/search` and `apps/api/src/db/schema/search.ts`: source-locator generation, projection columns/migration, canonical hydration of winning candidates, and chunker-version rebuild.
- `apps/api/src/tools`: `search_conversations` result shaping and the new `read_conversation_range` declaration/executor.
- `apps/web` and shared UI: structured conversation-source and activity rendering while preserving existing command-palette previews.
- Run/tool persistence and replay: new source-reference and read-result shapes remain durable and safely degradable under existing budgets.
- Coordinated API/worker deployment is required because tool declarations and derived projection rows change together; no canonical message-content migration is introduced.
