## Why

Conversation replay currently reconstructs model-facing content from stored
semantics. Context reminders are re-rendered from `data-context` metadata,
visible user text is sanitized again, sender ids are injected during replay,
and compaction reconstructs a checkpoint plus tool-observation ledger. A later
renderer, sanitizer, formatter, or projection change can therefore rewrite the
apparent prior conversation. That invalidates provider prefix caches and can
make an assistant's earlier quotation disagree with the history supplied on a
later turn.

The durable application/UI representation should instead contain the final
content the application intends to replay. Conversion into AI SDK model
messages remains an SDK boundary, not a second authoring pass.

## What Changes

- Persist the complete `<system-reminder>...</system-reminder>` block in
  `data-context.data.text` when a server-authored context part is created.
  Keep the existing `data-context` discriminator and `v: 1` contract.
- Make non-empty persisted `data.text` the sole model-replay authority. Keep
  structured metadata for UI and machine behavior only. If text and metadata
  disagree, text wins for replay.
- Retain existing metadata-only context parts without rewriting them. They
  contribute no model-visible content; metadata MUST NOT regenerate missing
  text.
- Preserve stored part order and convert each surviving context part at the AI
  SDK boundary to one ordinary text part. Do not join message parts manually.
- Sanitize client-authored text before persistence and store the sanitized
  parts. Later replay uses the stored text rather than sanitizing it again.
- Remove replay-time sender-id attribution. A stored message is already its own
  turn boundary and its content must not be augmented on later requests.
- **BREAKING:** Replace compaction's semantic tool-observation ledger with a
  non-empty, message-shaped `replacementHistory`. A new compaction atomically
  stores its raw summary and the complete user-role checkpoint text, followed
  by already selected, bounded, payload-cleared AI SDK UI tool parts. Replay
  converts that stored replacement history without regenerating the checkpoint
  or tool observations.
- Keep reasoning and other declared display-only artifacts out of model replay.
- Defer the existing custom assistant/tool projection to follow-up research in
  [#599](https://github.com/leon0399/llame/issues/599). This change documents
  that projection as an explicit best-effort exception instead of redesigning
  it without proven AI SDK step boundaries.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-injection`: Persist final reminder text, preserve stored part order,
  sanitize user text before persistence, and define the minimal SDK conversion
  boundary.
- `temporal-anchor`: Persist each message-received reminder in its final
  truthful wording and replay it from text only.
- `model-system-prompts`: Persist model-switch reminder text and make
  compaction replacement history the only accepted checkpoint replay form.
- `tool-calling`: Persist availability reminder text and replace regenerated
  compacted tool observations with stored final UI tool parts.
- `chat-recency-digest`: Persist rendered append and supersession reminders
  after author-time neutralization.

## Impact

- `apps/api/src/chats`: context-part authoring/validation, user-text acceptance,
  context assembly, sender attribution, assistant-projection documentation,
  forks, and tests.
- `apps/api/src/compaction` and `apps/api/src/db`: replace
  `tool_observation_ledger` with `replacement_history`, persist the complete
  compacted-prefix replacement atomically with `summary`, and replay it without
  reconstruction.
- `apps/api/src/runs`: transition compaction and Run context receipts copy the
  same persisted reminder text that entered the request.
- `apps/web`: continue to hide context parts from ordinary transcript rendering
  while reading structured metadata for owner-only boundaries.
- Public shares, search, ordinary exports, and public forks continue to strip
  context parts. Private owner forks copy stored message parts wholesale.
- No historical `messages.parts` backfill and no legacy compaction fallback are
  introduced. This alpha cutover treats the new contract as the only supported
  runtime contract.
