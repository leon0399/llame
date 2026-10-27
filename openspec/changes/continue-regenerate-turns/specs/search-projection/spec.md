## MODIFIED Requirements

### Requirement: Only user-visible conversation text is indexed

The chunker MUST serialize only stable visible message text from human-authored `user` turns and
from immutable eligible `assistant` turns. It MUST exclude a retryable assistant row, whose
persisted content can still change in place. The exclusion stays until that row becomes immutable
under the completed or legacy-immutable classification of the application. It MUST also exclude a revised
assistant row, which a Regenerate from `turn-actions` replaced after it was `completed`, for good.
These items MUST NOT enter `search_chat_documents` in any form: system prompts, effective-context
receipts, model-context parts, and generated model-switch reminders. The same applies to
`checkpoint` rows, the persisted checkpoint text and its raw summary, and tool-role messages. It
also applies to tool invocation payloads and results, model reasoning parts, cap notices, and
attachments.

Original immutable user and assistant messages that a checkpoint superseded in model context MUST
stay canonical and searchable. Role labels and anchors of oversized messages that the system adds
only for presentation context MUST appear only in the original-cased projection content. They MUST
NOT enter normalized lexical content, internal canonical source intervals, or generated FTS
vectors. Normalization MUST keep accents, code, identifiers, and URLs. It applies the current
Unicode NFKC, whitespace-collapse, and lowercase rules to the lexical column only.

#### Scenario: Retryable assistant content is absent

- **WHEN** an assistant row has a recorded usage status other than `completed`
- **THEN** no live projection document contains its visible text
- **AND** the system cannot return it as stable episodic evidence

#### Scenario: Completed retry becomes searchable

- **WHEN** a retry finalizes the assistant row into the immutable `completed` state of the application, and reindex runs
- **THEN** its current visible text enters the projection with internal source-addressable boundaries
- **AND** no earlier retryable bytes stay indexed

#### Scenario: Tool and reasoning content is absent from the projection

- **WHEN** the system indexes a Chat that contains tool calls and reasoning parts
- **THEN** no projection row contains that content, and no search query can match or excerpt it

#### Scenario: Model context is absent from the projection

- **WHEN** a Chat contains a model-switch part and its effective-context receipt
- **THEN** no projection row contains model IDs, reminder prose, system prompt contents, prompt metadata, or advertised tool schemas from those parts

#### Scenario: Compaction checkpoint is absent from the projection

- **WHEN** a `checkpoint` row and its raw summary stand in model context for immutable original user and assistant messages
- **THEN** no projection row contains the persisted checkpoint text or that raw summary
- **AND** the immutable original visible text stays searchable and sequence-addressable

#### Scenario: Synthetic role labels are absent from lexical data

- **WHEN** projection content adds role labels or a continuation anchor
- **THEN** neither adds lexical terms or bytes to the canonical source interval
- **AND** canonical model shaping derives its excerpt from the current visible message source text

#### Scenario: A revised reply leaves the projection

- **WHEN** a Regenerate replaces a `completed` reply, the Regenerate Run completes, and reindex runs
- **THEN** no projection row contains the old text or the new text of that reply

### Requirement: Lexical indexing is synchronous on turn completion, with async fallback and coalescing

Turn completion is assistant finalization, also after any regenerate. It MUST rebuild the lexical
projection of the whole Chat **synchronously, after the user-facing write commits, inside the
tenant scope of the Chat owner**. Thus the content of the turn that the chunker keeps is
searchable as soon as finalization completes. This content is the user message and the assistant
reply together, except a revised reply that the chunker excludes. The rebuild needs no BYPASSRLS
and no background worker. This is the only inline indexing site. The system does not rebuild
inline for a user message persisted before its turn finalizes, because finalization covers it
soon after. A fork enqueues its own content asynchronously and does not rebuild inline. The
synchronous rebuild MUST NOT run inside the user-facing write transaction and MUST NOT fail the
user-facing write. On any failure it MUST fall back to an asynchronous per-Chat reindex job, so the
update is not lost. Each rebuild MUST be an idempotent reconstruction from canonical `messages`. It
MUST run under **REPEATABLE READ**, so the message read and the `indexed_at` watermark share one
snapshot. Thus a plain message write during a rebuild is fully indexed or fully excluded. It is
never chunked out but stamped into the watermark. An excluded write leaves `chats.updated_at` ahead
of `indexed_at`, so discovery flags the Chat again. A rebuild can lose a write race with a
concurrent rebuild of the same Chat, as a serialization failure under REPEATABLE READ. The system
MUST then retry it; the rebuild is idempotent, so the fresh snapshot of the retry converges.
`search_chat_state.indexed_at` MUST only advance (`GREATEST(existing, excluded)`). The asynchronous
paths are the Tier-1 fallback, fork, the discovery sweep, and phase-2 embedding work. The system
MUST coalesce them, so at most one job is pending and one runs for each Chat (pg-boss queue policy
`'stately'` and `singletonKey = chat_id`).

#### Scenario: Fresh turn is searchable synchronously

- **WHEN** a user's message gets an answer, and the assistant's reply finalizes with a distinctive term
- **THEN** the term is searchable directly when that request completes, before any background job runs

#### Scenario: Synchronous rebuild failure falls back to the queue

- **WHEN** the synchronous rebuild fails after the user-facing write committed
- **THEN** the user-facing write still succeeds, and the system enqueues an asynchronous reindex job for the Chat
- **AND** the Chat becomes searchable when that job runs

#### Scenario: Concurrent rebuilds of one chat converge

- **WHEN** two rebuilds for the same Chat run at the same time, for example a Tier-1 inline write and a queued reindex job
- **THEN** a rebuild that fails with a serialization error is retried and converges on the same projection
- **AND** `indexed_at` only advances

#### Scenario: A message written during a rebuild is never lost by a stale watermark

- **WHEN** a new message commits to a Chat while the rebuild of that Chat is in progress
- **THEN** the rebuild, under REPEATABLE READ, includes the message or excludes it fully
- **AND** when it excludes the message, `indexed_at` does not move past that message, so `chats.updated_at` stays ahead and discovery flags the Chat for reindex again

#### Scenario: Async paths coalesce per chat

- **WHEN** the fallback, fork, or sweep enqueues reindex jobs for one Chat while a rebuild runs
- **THEN** at most one additional rebuild is queued, and the final projection reflects all messages

#### Scenario: A regenerated reply is rebuilt out of the projection

- **WHEN** a Regenerate Run from `turn-actions` replaces a `completed` reply and then finalizes
- **THEN** the synchronous rebuild runs after that finalization
- **AND** the projection holds the user message of the turn and no text of the revised reply
