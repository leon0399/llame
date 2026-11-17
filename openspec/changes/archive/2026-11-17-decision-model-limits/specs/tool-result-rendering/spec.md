## MODIFIED Requirements

### Requirement: A rank record is stored under display

A `grep` or `web_search` result that a rank call ordered MUST carry
`display.rerank`. The record MUST hold `model`, `order`, `scores`,
`latencyMs`, and `costUsd`. `order` MUST list every card key in the applied
order. `scores` MUST map each judged key to its answered score.

#### Scenario: A ranked grep result stores its record

- **WHEN** a `grep` call ranks 162 file runs
- **THEN** the stored part carries `display.rerank` with `model`, `order`, `scores`, `latencyMs`, and `costUsd`
- **AND** `order` holds 162 keys in the order that the text applies

#### Scenario: A ranked web search stores its record

- **WHEN** a `web_search` call ranks five results
- **THEN** the stored part carries `display.rerank` with five keys in `order`
- **AND** `scores` holds one score for each judged key

#### Scenario: A partial answer lists unjudged keys last

- **WHEN** a 300-card rank call judges its first 256 cards and leaves 44 cards unjudged
- **THEN** `order` holds all 300 keys, with the 256 judged keys first by score
- **AND** `scores` holds 256 keys
