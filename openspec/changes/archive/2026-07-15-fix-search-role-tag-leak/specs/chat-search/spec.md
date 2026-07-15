## MODIFIED Requirements

### Requirement: Search matches titles and conversation text, case- and typo-tolerantly

Chat search SHALL match a user's chats by title and by the text content of user/assistant turns, combining full-text matching (`simple` configuration, `websearch_to_tsquery` semantics) with trigram matching (`word_similarity`) so that case differences, inflections partially, typos, and partial words still retrieve the chat. Synthetic structural role labels used to format snippets MUST NOT match or affect ranking; literal occurrences of those words in a title or user/assistant message body SHALL remain searchable. No language detection SHALL be performed; matching MUST behave consistently for English, Russian, Spanish, and mixed-language content.

#### Scenario: Exact title in different case

- **WHEN** a user searches the exact title of one of their chats in all-lowercase (including a Cyrillic title)
- **THEN** that chat is returned

#### Scenario: Typo'd content term

- **WHEN** a user searches a content word with a small typo or as an incomplete prefix
- **THEN** the chat containing the correct form is returned via the trigram leg

#### Scenario: Blank query

- **WHEN** the query is empty or whitespace-only
- **THEN** the result is an empty list and no table scan is performed

#### Scenario: Synthetic role label does not match

- **WHEN** a user searches `user` or `assistant` and those words occur only as synthetic chunk role labels
- **THEN** the chat is not returned and its labels do not influence relevance ranking

#### Scenario: Synthetic role-label prefix does not match

- **WHEN** a user searches a prefix such as `assis` that occurs only within a synthetic chunk role label
- **THEN** the chat is not returned and the trigram substring path does not contribute the label to ranking

#### Scenario: Synthetic role-label typo does not match

- **WHEN** a user searches a small typo such as `assistnt` that is similar only to a synthetic chunk role label
- **THEN** the chat is not returned and the trigram fuzzy path does not contribute the label to ranking

#### Scenario: Literal role word remains searchable

- **WHEN** a user searches `assistant` and that literal word occurs in a title or user/assistant message body
- **THEN** the chat is returned through the corresponding title or content match path

### Requirement: Results are ranked by fused relevance with stable output shape

Search SHALL rank candidates by Reciprocal Rank Fusion over the independent retrieval legs (never by mixing raw scores), aggregate document matches into chats with weighted top-N scoring, and produce a deterministic order (stable tie-breaking). The existing response contract (`id`, `title` nullable, `snippet` nullable, `updatedAt`) and the `search_conversations` tool input schema (`query`, `limit`) SHALL be preserved. A content match SHALL yield a snippet excerpting the best-matching region with its role attribution preserved; a title-only match SHALL yield a `null` snippet.

#### Scenario: Content match returns a highlighted snippet

- **WHEN** a query matches message content in a chat
- **THEN** the chat's result carries a snippet excerpting the best-matching region with the contributing user/assistant role labels retained

#### Scenario: Both surfaces upgrade together

- **WHEN** the web palette and the `search_conversations` tool run the same query for the same user
- **THEN** both are served by the same repository method and return the same ranked chats
