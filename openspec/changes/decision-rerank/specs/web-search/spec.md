# Spec Delta

## ADDED Requirements

### Requirement: One engine's results are deduplicated by URL

Before the rank call, the guard, and the output, the system MUST collapse the
results of the call that share the aggregate grouping key. The key MUST be the
canonical URL without a leading `www.` and without a trailing `/`. The first
occurrence MUST win. Later steps MUST use the deduplicated results, with their
count. The deduplication MUST NOT add a note.

#### Scenario: A repeated URL yields one result

- **WHEN** an engine returns the same URL twice
- **THEN** the output holds that URL once

#### Scenario: The first spelling wins

- **WHEN** an engine returns `https://www.example.com/docs/` before `https://example.com/docs`
- **THEN** the output holds one result with the URL `https://www.example.com/docs/`

#### Scenario: The left out count measures the deduplicated results

- **WHEN** an engine returns 13 results with one repeated URL, `limit` is 10, and the Run cannot read artifacts
- **THEN** the inline text holds 10 results
- **AND** the last line states that the call left out 2 results

#### Scenario: A repeat can remove the need to rank

- **WHEN** `webSearch.rerank.model` is set, `limit` is 10, and an engine returns 11 results with one repeated URL
- **THEN** the call sends no decision request
- **AND** the output holds the 10 results in engine order

### Requirement: Results are ranked by the objective before the inline cut

When `webSearch.rerank.model` is set and a call returns `kind: "results"`, the
system MUST rank the results once, before the inline cut and the artifact,
unless the next requirement applies. Each result MUST give one card
`[k] <title> — <host> — <snippet>` of at most 400 units. The key `k` MUST be
`p<index>`: the zero-based engine position, zero-padded to the width of the
last index. The system MUST judge each card against the `objective`, or against
the query when `objective` is absent.

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

### Requirement: A call that shows every result makes no decision call

The system MUST make no decision call when the deduplicated results number at
most `limit` and the inline text holds all of them within 15,000 units. No
minimum number of results applies. Such a call MUST keep engine order and MUST
NOT store `display.rerank`.

#### Scenario: A fetched set within the limit makes no rank call

- **WHEN** `webSearch.rerank.model` is set, `limit` is 10, and the engine returns 5 results that fit inline
- **THEN** the call sends no decision request
- **AND** the output keeps the engine order and stores no `display.rerank`

#### Scenario: The size bound makes ranking useful

- **WHEN** `webSearch.rerank.model` is set, `limit` is 10, the engine returns 10 results, and the 15,000-unit bound cuts the text at 7 results
- **THEN** the system ranks the 10 results
- **AND** the inline text shows the first 7 results in the rank order

#### Scenario: A small set over the limit is ranked

- **WHEN** `webSearch.rerank.model` is set, `limit` is 1, and the engine returns 2 results
- **THEN** the system sends one card for each of the 2 results

### Requirement: Ranked results sort by score and keep engine order on a tie

The system MUST sort the judged results by score, highest first. A tie MUST
keep the engine order of the results. A result that the system did not judge
MUST follow the judged results in engine order. The type of the engine that
answers MUST NOT stop the rank call. The rank call MUST NOT change the counts,
the `left out` notice, or the removal rules.

#### Scenario: A tie keeps engine order

- **WHEN** two results receive the same score
- **THEN** the result with the earlier engine rank comes first

#### Scenario: The engine type does not stop the rank call

- **WHEN** `parallel` answers the call and `webSearch.rerank.model` is set
- **THEN** the system ranks the results of `parallel` like any other engine's results

#### Scenario: Counts and removal do not change

- **WHEN** a ranked call fetches 20 results, `limit` is 10, and removal drops two entries
- **THEN** the first note states that the call removed two entries
- **AND** the `left out` count is 8

### Requirement: A failed rank call keeps engine order and adds one note

A rank call that fails MUST NOT fail the tool call. A call fails when no card
receives an answer. The system MUST keep the engine order and MUST add one note
with the text `rerank: unavailable`. The system MUST NOT store
`display.rerank` for that call. When the rank call judges only some results,
the system MUST use the rank order and MUST NOT add the note.

#### Scenario: A failed rank call is noted

- **WHEN** the decision endpoint fails for a call that ranks 20 results
- **THEN** the call succeeds with the results in engine order
- **AND** the output carries one note with the text `rerank: unavailable`
- **AND** the output stores no `display.rerank`

#### Scenario: A response with absent answers adds the failure note

- **WHEN** the decision endpoint answers only 15 of 20 questions in one request
- **THEN** the request fails and all 20 results keep engine order
- **AND** the notes contain `rerank: unavailable`
- **AND** the output stores no `display.rerank`

### Requirement: The rank record is display data

A ranked call MUST store `display.rerank` beside its output. The record MUST
hold `model`, `order`, `scores`, `latencyMs`, and `costUsd`. `model` MUST be the
served model id. `order` MUST list every card key in the applied order. `scores`
MUST hold the judged keys only. `latencyMs` MUST measure the whole decision call.
`costUsd` MUST be a number or `null`. The model-facing text MUST NOT contain
the record.

#### Scenario: The record names the served model and the order

- **WHEN** a rank call completes for a call with five judged results
- **THEN** `display.rerank` holds the served model id, the five card keys, their scores, `latencyMs`, and `costUsd`

#### Scenario: The model reads the results without the record

- **WHEN** the model reads the tool result of a ranked call
- **THEN** the text holds the results and the notes and no score

#### Scenario: A call without a rank model stores no record

- **WHEN** `webSearch.rerank.model` is not set
- **THEN** the output has no `display.rerank`
