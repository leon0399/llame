# Spec Delta

## MODIFIED Requirements

### Requirement: Only user-visible conversation text is indexed

The chunker SHALL serialize only stable visible-message text from human-authored `user` turns and immutable eligible `assistant` turns. A retryable assistant row whose persisted content may still be replaced in place SHALL be excluded until it becomes immutable under the application's completed/legacy-immutable classification. System prompts, effective-context receipts, model-context parts, generated model-switch reminders, `checkpoint` rows, the persisted checkpoint text and its raw summary, tool-role messages, tool invocation payloads/results, model reasoning parts, cap notices, and attachments MUST NOT enter `search_chat_documents` in any form.

Original immutable user/assistant messages superseded in model context by a checkpoint SHALL remain canonical and searchable. Role labels and oversized-message anchors added solely for presentation context MUST appear only in original-cased projection content and MUST NOT enter normalized lexical content, internal canonical source intervals, or generated FTS vectors. Normalization SHALL preserve accents, code, identifiers, and URLs while applying the existing Unicode NFKC, whitespace-collapse, and lowercase rules to the lexical column only.

#### Scenario: Retryable assistant content is absent

- **WHEN** an assistant row remains eligible for in-place retry mutation
- **THEN** no live projection document contains its visible text
- **AND** it cannot be returned as stable episodic evidence

#### Scenario: Completed retry becomes searchable

- **WHEN** a retry finalizes the assistant row into the application's immutable completed state and reindexing runs
- **THEN** its current visible text enters the projection with internal source-addressable boundaries
- **AND** no earlier retryable bytes remain indexed

#### Scenario: Tool and reasoning content is absent from the projection

- **WHEN** a Chat containing tool calls and reasoning parts is indexed
- **THEN** no projection row contains that content and no search query can match or excerpt it

#### Scenario: Model context is absent from the projection

- **WHEN** a Chat contains a model-switch part and associated effective-context receipt
- **THEN** no projection row contains model IDs, reminder prose, system prompt contents, prompt metadata, or advertised tool schemas from those parts

#### Scenario: Compaction checkpoint is absent from the projection

- **WHEN** a `checkpoint` row and its raw summary stand in model context for immutable original user/assistant messages
- **THEN** no projection row contains the persisted checkpoint text or that raw summary
- **AND** the immutable original visible text remains searchable and sequence-addressable

#### Scenario: Synthetic role labels are absent from lexical data

- **WHEN** projection content adds role labels or a continuation anchor
- **THEN** neither contributes lexical terms or bytes to the canonical source interval
- **AND** canonical model shaping derives its excerpt from current visible-message source text
