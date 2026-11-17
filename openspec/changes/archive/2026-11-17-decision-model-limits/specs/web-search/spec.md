## MODIFIED Requirements

### Requirement: The aggregate candidate bound follows its children

A retained aggregate result set MUST hold at most the sum of its children's
admitted result counts.
Each child MUST keep its existing per-engine result bound and configured
fetch-size bound.
The rank stage MUST NOT add a separate candidate cut.
The decision lane's call bound is not a candidate cut: unjudged cards stay in
the result in canonical order.

#### Scenario: A larger aggregate uses parallel requests

- **WHEN** three children each return 100 distinct admitted results and the fetch size is 100
- **AND** the configured rank model is a `decisionModels[]` entry whose limits admit 32 cards per request
- **THEN** the rank call receives all 300 cards and judges the first 256 in requests of at most 32 cards
- **AND** the other 44 cards stay unjudged in their canonical order
- **AND** the artifact holds all 300 when the Run can read artifacts and the output fits the artifact bound

### Requirement: Results are ranked by the objective before the inline cut

When `webSearch.rerank.model` is set, the system MUST rank each `results`
outcome unless the whole result fits inline. The rank MUST precede the
inline cut and the artifact. Each result MUST give one card
`[k] <title> — <host> — <snippet>` of at most 400 units. The key `k` MUST be
`p<index>`: the zero-based engine position, zero-padded to the width of the
last index. The system MUST send every card to the rank call. A decision model
MUST judge only the cards within the decision lane's call bound, each against
the `objective`, or against the query when `objective` is absent.

#### Scenario: A fetched set over the limit is ranked

- **WHEN** `webSearch.rerank.model` is set, `limit` is 10, and the engine returns 20 results
- **THEN** the system sends one card for each of the 20 results
- **AND** the inline text shows the first 10 results in the rank order

#### Scenario: Card keys are padded to the last index

- **WHEN** a call ranks 12 results
- **THEN** the card keys run from `p00` to `p11`

#### Scenario: The query is the criterion without an objective

- **WHEN** the call sets no `objective` and the system ranks the results
- **THEN** the system judges each card against the query

#### Scenario: The artifact shares the rank order

- **WHEN** a ranked call leaves results out of the inline text and the Run can read artifacts
- **THEN** the artifact text and the artifact findings follow the rank order

#### Scenario: An answer output is not ranked

- **WHEN** `webSearch.rerank.model` is set and the engine returns `kind: "answer"`
- **THEN** the call sends no decision request
- **AND** the citations keep the citation order
