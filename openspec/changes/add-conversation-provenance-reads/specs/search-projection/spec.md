## MODIFIED Requirements

### Requirement: Chunking is deterministic, versioned, and content-hashed

Chunks SHALL be produced by a deterministic, versioned chunker over version-1 visible-message text: multi-message windows with a bounded character budget and adjacent-message overlap, carrying presentation role markers, covered first/last message IDs and timestamps, and the minimal boundary coordinates required to reconstruct the exact canonical source interval. Those boundary coordinates SHALL be a zero-based UTF-16 start offset in the first message's visible-text view and a zero-based exclusive UTF-16 end offset in the last message's visible-text view. Intermediate covered messages are complete. The projection SHALL NOT persist a second whole-message visible-text copy, JSON part identity, model-facing line ranges, or a generic provenance map.

Windows SHALL split on message boundaries **except** where one message alone exceeds the budget, in which case that message SHALL be split into budget-sized blocks at a text boundary so that no message contributes more than the budget to one new block. A packed document MAY still exceed the budget because one overlap block from the preceding chunk accompanies a full new block; the document bound SHALL be asserted by test. Each oversized assistant continuation after the first MAY retain the existing bounded preceding-user anchor in presentation content, but that synthetic anchor SHALL be outside the canonical source interval. A split user message carries no anchor, and a message with no preceding user message carries none.

Each chunk SHALL store role-labelled original-cased presentation `content` for web snippets and embedding input, plus a role-free normalized lexical representation for matching. The internal content hash SHALL cover both representations, chunker version, visible-text version, covered message identities, and source boundary offsets. Re-running the chunker over unchanged input MUST produce byte-identical chunks and a no-op upsert. Changing visible-text serialization, either representation algorithm, locator semantics, budget, splitting, or anchoring SHALL require a chunker-version bump; documents of different versions SHALL NOT mix within one chat's live projection.

#### Scenario: Unchanged chat is a no-op

- **WHEN** a reindex runs for a chat whose eligible messages and chunking contract have not changed
- **THEN** no projection rows are written because internal hashes and source locators match

#### Scenario: Edited assistant reply rebuilds affected chunks

- **WHEN** an assistant row indexed by the legacy contract changes before immutable-evidence enforcement has removed or finalized it
- **THEN** the next reindex replaces every covering chunk and removes obsolete chunks
- **AND** the new immutable-evidence filter determines whether its current bytes remain eligible

#### Scenario: Representation version change rebuilds existing chunks

- **WHEN** visible-message serialization or locator semantics change
- **THEN** the chunker version changes and every affected projection row is rebuilt
- **AND** prior offsets are not interpreted under the new visible-text version

#### Scenario: A single oversized message is split rather than emitted whole

- **WHEN** one eligible visible message is several times larger than the chunk budget
- **THEN** it is divided into multiple source-addressable documents whose source intervals together cover the message without discarding visible text

#### Scenario: A continuation part carries the question it answers

- **WHEN** an oversized assistant visible message is divided into continuation documents
- **THEN** every continuation after the first retains the bounded preceding-user anchor in presentation content when available
- **AND** that anchor remains outside lexical and canonical source bytes

#### Scenario: Messages within budget chunk exactly as before

- **WHEN** every eligible message fits the current V1 budget and the same chunker version runs again
- **THEN** it produces byte-identical chunks, hashes, and source locators for the same input

#### Scenario: Oversized message has precise source boundaries

- **WHEN** one visible message is divided among several search documents
- **THEN** every document carries that message ID plus its own start and exclusive end visible-text offsets
- **AND** synthetic continuation anchors lie outside those offsets

#### Scenario: Multi-message document uses boundary offsets

- **WHEN** one document covers a partial first message, complete intermediate messages, and a partial last message
- **THEN** the stored locator identifies only the first-message start and last-message exclusive end offsets plus the existing ordered boundary message IDs
- **AND** no per-part or per-line provenance array is stored

#### Scenario: Internal hash remains noncitable

- **WHEN** the projection stores a content hash for rebuild and embedding validity
- **THEN** search/read model results omit that hash
- **AND** canonical evidence is hydrated from current eligible messages

### Requirement: Only user-visible conversation text is indexed

The chunker SHALL serialize only version-1 visible-message text from human-authored `user` turns and immutable eligible `assistant` turns. A retryable assistant row whose persisted content may still be replaced in place SHALL be excluded until it becomes immutable under the application's completed/legacy-immutable classification. System prompts, effective-context receipts, model-context parts, generated model-switch reminders, compaction rows, generated compaction summaries, deterministic checkpoint envelopes, tool-role messages, tool invocation payloads/results, model reasoning parts, and attachments MUST NOT enter `search_chat_documents` in any form.

Original immutable user/assistant messages superseded in model context by a compaction SHALL remain canonical and searchable. Role labels and oversized-message anchors added solely for presentation context MUST appear only in original-cased projection content and MUST NOT enter normalized lexical content, canonical source locators, or generated FTS vectors. Normalization SHALL preserve accents, code, identifiers, and URLs while applying the existing Unicode NFKC, whitespace-collapse, and lowercase rules to the lexical column only.

#### Scenario: Retryable assistant content is absent

- **WHEN** an assistant row remains eligible for in-place retry mutation
- **THEN** no live projection document contains its visible text
- **AND** it cannot be returned as stable episodic evidence

#### Scenario: Completed retry becomes searchable

- **WHEN** a retry finalizes the assistant row into the application's immutable completed state and reindexing runs
- **THEN** its current visible text enters the projection with source-addressable boundaries
- **AND** no earlier retryable bytes remain indexed

#### Scenario: Tool and reasoning content is absent from the projection

- **WHEN** a chat containing tool calls and reasoning parts is indexed
- **THEN** no projection row contains that content and no search query can match or excerpt it

#### Scenario: Model context is absent from the projection

- **WHEN** a chat contains a model-switch part and associated effective-context receipt
- **THEN** no projection row contains model IDs, reminder prose, system prompt contents, prompt metadata, or advertised tool schemas from those parts

#### Scenario: Compaction checkpoint is absent from the projection

- **WHEN** compaction supersedes immutable original user/assistant messages in model context
- **THEN** generated summary/checkpoint material stays outside the projection
- **AND** the immutable original visible text remains searchable and source-addressable

#### Scenario: Synthetic role labels are absent from lexical data

- **WHEN** projection content adds role labels or a continuation anchor
- **THEN** neither contributes lexical terms or bytes to the canonical source interval
- **AND** a hydrated model-facing passage contains only visible-message source text
