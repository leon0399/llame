## MODIFIED Requirements

### Requirement: Chunking is deterministic, versioned, and content-hashed

Chunks SHALL be produced by a deterministic, versioned chunker over the stable visible-message text contract: contextual multi-message windows with a bounded character budget and adjacent-message overlap, carrying presentation role markers, covered first/last message UUIDs and timestamps, and the minimum internal boundary coordinates required to reconstruct the exact canonical source interval. Those coordinates SHALL be a zero-based UTF-16 start offset in the first message's visible-text view and a zero-based exclusive UTF-16 end offset in the last message's view. Intermediate covered messages are complete. The projection SHALL NOT persist a second whole-message visible-text copy, public message sequence locator, JSON part identity, model-facing line ranges, or a generic provenance map.

Windows SHALL split on message boundaries except where one message alone exceeds the budget, in which case that message SHALL be divided into budget-sized blocks at text boundaries so no message contributes more than the budget to one new block. A packed document MAY still exceed the budget because one overlap block from the preceding chunk accompanies a full new block; the document bound SHALL be asserted by test. Each oversized assistant continuation after the first SHALL retain the existing bounded preceding-user anchor in presentation content when available, but that synthetic anchor SHALL remain outside the lexical and canonical source intervals. A split user message and a message without a preceding user message carry no anchor. A fitting message SHALL retain the established representation for equivalent visible input.

Each chunk SHALL store role-labelled original-cased presentation `content` for web snippets and embedding input, plus a role-free normalized lexical representation for matching. The internal content hash SHALL cover both representations, chunker version, stable visible-text semantics, covered message UUIDs, and source boundary offsets. Re-running the chunker over unchanged eligible input MUST produce byte-identical chunks and a no-op upsert. Changing visible-text serialization, either representation algorithm, locator semantics, budget, splitting, or anchoring SHALL require a chunker-version bump; documents of different versions SHALL NOT mix within one Chat's live projection.

#### Scenario: Unchanged chat is a no-op

- **WHEN** a reindex runs for a Chat whose eligible visible messages and chunking contract have not changed
- **THEN** no projection rows are written because internal hashes and source locators match

#### Scenario: Edited assistant reply rebuilds affected chunks

- **WHEN** an assistant row indexed by the legacy contract changes before immutable-evidence enforcement removes or finalizes it
- **THEN** the next reindex replaces every covering chunk and removes obsolete chunks
- **AND** the current immutable-evidence predicate determines whether its bytes remain eligible

#### Scenario: Representation version change rebuilds existing chunks

- **WHEN** visible-message serialization or locator semantics change
- **THEN** the chunker version changes and every affected projection row is rebuilt
- **AND** prior offsets are not interpreted under the new chunker contract

#### Scenario: A single oversized message is split rather than emitted whole

- **WHEN** one eligible visible message is several times larger than the chunk budget
- **THEN** it is divided into multiple source-addressable documents whose internal source intervals together cover the message without discarding visible text

#### Scenario: A continuation part carries the question it answers

- **WHEN** an oversized assistant visible message is divided into continuation documents
- **THEN** every continuation after the first retains the bounded preceding-user anchor in presentation content when available
- **AND** that anchor remains outside lexical and canonical source bytes

#### Scenario: Messages within budget chunk exactly as before

- **WHEN** every eligible message fits the budget and the same chunker version runs again
- **THEN** it produces byte-identical chunks, hashes, and source locators for the same visible input

#### Scenario: Oversized message has precise internal boundaries

- **WHEN** one visible message is divided among several search documents
- **THEN** every document carries that message UUID plus its own internal start/exclusive-end visible-text offsets
- **AND** synthetic continuation anchors lie outside those offsets

#### Scenario: Multi-message document uses endpoint offsets

- **WHEN** one document covers a partial first message, complete intermediate messages, and a partial last message
- **THEN** its internal locator identifies only the first-message start and last-message exclusive-end offsets plus existing boundary UUIDs
- **AND** no per-part or per-line provenance array is stored

#### Scenario: Internal hash and UUID remain non-public

- **WHEN** the projection stores message UUIDs and a content hash for joins, rebuilds, and embedding validity
- **THEN** newly shaped model search/read results expose public Chat/sequence/line coordinates instead
- **AND** neither internal identity is represented as source authority

### Requirement: Only user-visible conversation text is indexed

The chunker SHALL serialize only stable visible-message text from human-authored `user` turns and immutable eligible `assistant` turns. A retryable assistant row whose persisted content may still be replaced in place SHALL be excluded until it becomes immutable under the application's completed/legacy-immutable classification. System prompts, effective-context receipts, model-context parts, generated model-switch reminders, compaction rows, generated compaction summaries, deterministic checkpoint envelopes, tool-role messages, tool invocation payloads/results, model reasoning parts, cap notices, and attachments MUST NOT enter `search_chat_documents` in any form.

Original immutable user/assistant messages superseded in model context by a compaction SHALL remain canonical and searchable. Role labels and oversized-message anchors added solely for presentation context MUST appear only in original-cased projection content and MUST NOT enter normalized lexical content, internal canonical source intervals, or generated FTS vectors. Normalization SHALL preserve accents, code, identifiers, and URLs while applying the existing Unicode NFKC, whitespace-collapse, and lowercase rules to the lexical column only.

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

- **WHEN** compaction supersedes immutable original user/assistant messages in model context
- **THEN** generated summary/checkpoint material stays outside the projection
- **AND** the immutable original visible text remains searchable and sequence-addressable

#### Scenario: Synthetic role labels are absent from lexical data

- **WHEN** projection content adds role labels or a continuation anchor
- **THEN** neither contributes lexical terms or bytes to the canonical source interval
- **AND** canonical model shaping derives its excerpt from current visible-message source text
