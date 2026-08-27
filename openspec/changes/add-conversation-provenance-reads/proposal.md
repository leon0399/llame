## Why

Conversation search currently returns snippets rendered from a rebuildable projection, so the model cannot safely treat them as current canonical conversation evidence or expand a hit through the same simple line-range workflow used for Knowledge files. llame needs an owner-authorized message reader whose public locator is compact, stable, understandable to models and humans, and free of JSON part indexes, source hashes, and generalized range machinery.

This proposal is intentionally narrower than the combined `#197`, `#198`, and older `#609` issue text. It defines canonical lexical/trigram excerpts and one-message line reads. `#197` and `#198` retain vector-result and final content/timeline discovery semantics. `#611` retains retry/edit/branching semantics.

## What Changes

- Define one stable visible-message text view from eligible stored text parts in stored order, joined with exactly `\n\n` and never persisted as another source copy.
- Use owner-scoped `{ chatId, messageSeq }` as the public message locator, add datastore uniqueness for `(chat_id, seq)`, and keep UUID message identity internal.
- Preserve the current `search_conversations` `{ query, limit }` input and web preview DTO while model-facing lexical/trigram results hydrate one current canonical passage from the winning document.
- Return one bounded discovery excerpt per Chat: at most 500 Unicode code points, visibly elided when cropped, with directly reusable zero-based `{ offset, limit }` logical-line coordinates for `conversation_read`.
- Add the read-only `conversation_read` tool with the same mental model as `knowledge_read`: one message, optional zero-based `offset`/`limit`, one-based line prefixes in returned content, `nextOffset`, and a closed cut reason.
- Return the closest currently readable `previousMessageSeq` and `nextMessageSeq` instead of embedding surrounding-message content or asking the model to calculate sparse sequence values.
- Add only internal first/last visible-text offsets to the derived search projection so winning chunks can be hydrated without rechunking a whole Chat; keep projection hashes and versions internal.
- Treat immutable message identity as the source premise. Until #611 replaces in-place retry mutation, retryable assistant rows remain ineligible for search evidence and conversation reads.
- Fail closed for malformed, missing, deleted, mutable, public/shared-without-owner, and other-owner sources. A source locator never grants authority.
- Preserve the existing durable read-only tool lifecycle and generic tool-call UI; add owner-facing `/chat/<chatId>#msg-<messageSeq>` targeting without a specialized conversation-read renderer.

## Capabilities

### New Capabilities

- `conversation-reads`: Canonical visible-message serialization, stable sequence locators, bounded one-message line reads, owner-facing message links, authorization, and failure semantics.

### Modified Capabilities

- `chat-search`: Keep one ranked candidate path while separating the web projection preview from one bounded canonical model excerpt.
- `search-projection`: Retain minimal internal canonical source offsets and exclude mutable/non-evidence message content while remaining fully rebuildable and owner-isolated.
- `tool-calling`: Register, execute, persist, replay, compact, truncate, and generically render `conversation_read` under the existing read-only lifecycle.

## Impact

- `apps/api/src/chats` and `apps/api/src/db/schema/chats.ts`: stable sequence lookup/uniqueness, visible-message rendering, immutable evidence eligibility, owner-scoped line reads, and message-target navigation.
- `apps/api/src/search` and `apps/api/src/db/schema/search.ts`: internal source-locator generation, projection columns/migration, canonical hydration of winning lexical/trigram candidates, and chunker-version rebuild.
- `apps/api/src/tools`: model-facing `search_conversations` result shaping and the new `conversation_read` declaration/executor.
- `apps/web`: owner-only message-sequence anchors, targeted history loading, and copyable links; ordinary tool rendering remains unchanged.
- Run/tool persistence and replay: bounded results remain durable and safely degradable under existing budgets.
- Coordinated API/worker deployment remains required because code-owned declarations and derived projection rows change together; no canonical message-content migration is introduced.

## Deferred Follow-ups

- Historical execution activity around prior messages: #615, related to #599/#611.
- Multi-region-per-Chat retrieval evaluation: #618, related to #197/#198.
- Shared Knowledge/conversation Markdown outline navigation: #616, related to #541/#544/#572.
- Canonical hydration latency measurement and optimization: #617, related to #197/#198.
