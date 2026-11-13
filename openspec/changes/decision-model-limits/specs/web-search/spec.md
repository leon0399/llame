## MODIFIED Requirements

### Requirement: The aggregate candidate bound follows its children

A retained aggregate result set MUST hold at most the sum of its children's
admitted result counts.
Each child MUST keep its existing per-engine result bound and configured
fetch-size bound.
The rank stage MUST NOT add a separate candidate cut.

#### Scenario: A larger aggregate uses parallel requests

- **WHEN** three children each return 100 distinct admitted results and the fetch size is 100
- **AND** a rank model is configured
- **THEN** the rank call receives all 300 cards and judges the first 256 in requests of at most 32 cards
- **AND** the other 44 cards stay unjudged in their canonical order
- **AND** the artifact holds all 300 when the Run can read artifacts and the output fits the artifact bound
