## MODIFIED Requirements

### Requirement: Results are ranked by fused relevance with stable output shape

Search SHALL rank candidates by Reciprocal Rank Fusion over the independent retrieval legs (never by mixing raw scores), aggregate document matches into chats with weighted top-N scoring, and produce a deterministic order with stable tie-breaking. The web response contract (`id`, `title` nullable, `snippet` nullable, `updatedAt`) SHALL be preserved. The web command palette MAY continue to receive the derived best-document snippet, including its presentation-only role attribution; a title-only match SHALL yield a `null` web snippet.

Any model-facing content-discovery result, whether returned by the current `search_conversations` tool or by a later #198 content mode, SHALL use the same ranked candidate path but SHALL NOT present a projection snippet as canonical evidence. For an FTS or trigram content winner, it SHALL reauthorize and hydrate the winning projection document through `conversation-reads`, select every matching logical source line plus at most one immediately preceding and following source line, transitively merge overlapping/touching windows within each message, and return exact current visible-message text with versioned source references. Matches in different messages SHALL remain separate attributed passages and MUST NOT be concatenated into one quote. Synthetic projection labels and contextual anchors SHALL NOT appear in a canonical passage. A result selected only by chat title SHALL be marked metadata-only and carry no invented message passage.

A vector-only winning document SHALL resolve through the same canonical source locator but SHALL return a bounded exact `retrieval_context` aligned to that document's source interval, not a `quote`, `matchedLine`, translated text, or semantic support claim. Retrieval-basis diagnostics SHALL remain distinct from source provenance, and no raw lexical, cosine, or fused score SHALL be exposed as evidence confidence. A winning document that cannot be currently authorized or hydrated SHALL be omitted rather than replaced by stored projection bytes.

#### Scenario: Web content match retains derived preview

- **WHEN** the web command palette receives a content match
- **THEN** its stable result shape carries the derived best-region snippet used for navigation
- **AND** the client does not treat that snippet as the model's canonical quote contract

#### Scenario: Content match returns a highlighted snippet

- **WHEN** a query matches message content in a chat
- **THEN** the web result carries a snippet excerpting the best-matching derived region with contributing user/assistant role labels retained
- **AND** the model result uses separately hydrated canonical source text instead of that snippet

#### Scenario: Lexical model result carries exact source lines

- **WHEN** `search_conversations` selects a lexical/trigram document whose match occupies one source line
- **THEN** the model-facing result contains that exact current source line plus at most its immediately adjacent source lines and a versioned source reference
- **AND** it contains no synthetic role label, source hash, part identity, or line-number prefix

#### Scenario: Overlapping source windows merge

- **WHEN** one winning document contains several lexical matches in one message whose adjacent-line windows overlap or touch
- **THEN** the tool returns their deterministic transitive union once
- **AND** the passage coordinates identify the complete returned source window

#### Scenario: Matches in separate messages remain separate

- **WHEN** one winning document contains matching source lines in two messages
- **THEN** the model result returns two ordered passages with independent message attribution and source references
- **AND** it does not serialize them as one cross-message quote or line range

#### Scenario: Vector-only result is context rather than quote

- **WHEN** a future vector leg selects a document that no lexical/trigram leg matched
- **THEN** the result returns exact original-language canonical retrieval context labeled `retrieval_context`
- **AND** it does not identify an arbitrary matching line or claim quotation support

#### Scenario: Title-only result has no fabricated source

- **WHEN** a candidate matches only the chat title
- **THEN** the model-facing result identifies the chat and title as metadata-only
- **AND** it carries no message quote or arbitrary source excerpt

#### Scenario: Web and model content discovery retain one ranking path

- **WHEN** the web palette and `search_conversations` run the same query for the same owner
- **THEN** both receive the same ranked chats from one candidate path
- **AND** each surface applies only its declared preview or canonical-evidence shaping

#### Scenario: Both surfaces upgrade together

- **WHEN** the web palette and model-facing content discovery run the same query for the same owner
- **THEN** both are served by the same ranked repository path and return the same ranked chats
- **AND** surface-specific shaping does not duplicate the candidate query

#### Scenario: Stale candidate never becomes evidence

- **WHEN** a winning derived document cannot resolve to a currently authorized immutable source
- **THEN** the model-facing search omits that candidate or returns fewer results
- **AND** it never substitutes projection content as canonical evidence
