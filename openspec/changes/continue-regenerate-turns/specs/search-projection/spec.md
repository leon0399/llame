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
