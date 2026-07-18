## MODIFIED Requirements

### Requirement: Only user-visible conversation text is indexed

The chunker SHALL serialize only the canonical text parts of human-authored `user` turns and ordinary `assistant` turns. System prompts, effective-context receipts, model-context parts, generated model-switch reminders, compaction rows, generated compaction summaries, deterministic checkpoint envelopes, tool-role messages, tool invocation payloads/results, model reasoning parts, and attachments MUST NOT enter `search_chat_documents` in any form. The original user/assistant messages superseded in model context by a compaction SHALL remain canonical and searchable. Role labels added solely to preserve presentation context MUST appear only in original-cased snippet content and MUST NOT enter the normalized lexical match column or generated FTS vector. Normalization (Unicode NFKC, whitespace collapse, lowercasing for the match column) MUST preserve accents, code, identifiers, and URLs.

#### Scenario: Tool and reasoning content is absent from the projection

- **WHEN** a chat containing tool calls and reasoning parts is indexed
- **THEN** no projection row contains that content, and no search query can match or excerpt it

#### Scenario: Model context is absent from the projection

- **WHEN** a chat containing a model-switch part and an associated effective-context receipt is indexed
- **THEN** no projection row contains the prior/target model ids from the part, generated reminder prose, system prompt contents, prompt source metadata, or advertised tool schemas
- **AND** searching for distinctive text found only in that metadata returns no match or excerpt

#### Scenario: Compaction checkpoint is absent from the projection

- **WHEN** a chat has a generated compaction summary and deterministic checkpoint envelope covering original user/assistant messages
- **THEN** neither the generated summary nor envelope enters any projection row or affects ranking
- **AND** the original user/assistant message text remains searchable and is the only episodic evidence returned from that compacted range

#### Scenario: Synthetic role labels are absent from lexical data

- **WHEN** a user turn and assistant turn are indexed with no literal `user` or `assistant` text in their bodies
- **THEN** the projection's normalized lexical content and generated FTS vector contain neither synthetic role label, while its snippet content retains role attribution
