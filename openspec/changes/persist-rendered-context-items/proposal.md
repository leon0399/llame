## Why

Persisted context items currently store semantic inputs and regenerate their model-facing `<system-reminder>` text on every replay. A renderer, sanitizer, framing, timezone-formatting, or ordering change can therefore rewrite what a prior turn appears to have contained, invalidating provider prefix caches and making earlier assistant quotations disagree with the conversation later supplied to the model.

## What Changes

- **BREAKING:** New persisted context items store the complete rendered text block as the sole replay authority, alongside their existing structured metadata. Replay no longer regenerates, sanitizes, wraps, or reorders those blocks.
- Render and neutralize producer content once before the user-message/Run/snapshot transaction commits; retries and later workers use the persisted block verbatim.
- Keep producer, form, Run linkage, and producer payload as non-rendering metadata for UI, transition-compaction, provenance, and later inspection. A metadata/text disagreement never causes historical text to be regenerated.
- Treat pre-cutover data-only context parts as legacy and omit them from future model requests without reshaping or backfilling existing `messages.parts` values.
- Persist the complete model-facing checkpoint block for every new compaction while retaining the raw summary for lineage, UI, and later compaction. Legacy compactions continue through the legacy renderer until a later compaction supersedes them; they are not backfilled or discarded.
- Record Run context receipts from the same persisted text that entered the final request, while retaining the existing separate owner-scoped audit record.
- Narrow the stability claim to persisted context-item text and content-block order. This change does not claim immutable provider wire bytes for user-text projection, tool observations, SDK serialization, or other request components.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-injection`: Replace semantic re-rendering with render-once persisted blocks, define literal-text and stored-order authority, and specify the legacy-part boundary.
- `temporal-anchor`: Persist each new message-received row in its final truthful wording and replay it verbatim rather than formatting its stored instant again.
- `model-system-prompts`: Persist model-switch reminder text and new compaction checkpoint blocks at authoring time while retaining structured model-switch metadata and a legacy checkpoint fallback.
- `tool-calling`: Persist the final rendered availability disclosure rather than reconstructing it from reason codes on later turns.
- `chat-recency-digest`: Persist rendered append and supersession blocks after author-time neutralization so later renderer or sanitizer changes cannot rewrite them.

## Impact

- `apps/api/src/chats`: context-item authoring, validation, ordering, context assembly, model-switch detection, chat binding, and tests.
- `apps/api/src/compaction` and `apps/api/src/db`: a new immutable model-facing checkpoint value, repository writes/reads, migration, legacy fallback, and compaction tests.
- `apps/api/src/runs`: transition-compaction gating and owner-scoped `runs.context_items` recording from final persisted blocks.
- `apps/web`: versioned `data-context` parsing and model-switch boundary metadata; context items remain hidden from ordinary transcript rendering and public shares.
- Search, export, fork, and public-share projections must continue to exclude context-item text except that an owner-only fork preserves the private part verbatim.
- Deployment remains a coordinated server-authored message-part boundary: compatible readers/workers deploy before the API authors the new version; old writers are quiesced and accepted Runs drained before cutover.
