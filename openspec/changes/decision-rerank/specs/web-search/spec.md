# Spec Delta

## MODIFIED Requirements

### Requirement: Output fields are bounded within the result cap

Lengths MUST count JavaScript UTF-16 code units, cut at a code-point boundary.
Titles MUST hold at most 200 units, snippets 300, and answers 8,000.
`published` MUST be present only as an ISO 8601 date.
The output MUST hold at most the fetch size of results and 20 citations.
An aggregate with `webSearch.rerank.model` set MUST retain its whole merged
result set instead of the fetch-size count cap.
The inline and artifact bounds still apply.
`notes` MUST hold at most 10 notes of at most 200 units each.
Without a rank failure, the tenth note MUST summarize any excess as `<n> more engines`.
With a rank failure, the system MUST reserve the last note for `rerank: unavailable`.
The removal note MUST stay first.
The last available engine-note slot MUST summarize any excess engine notes as `<n> more engines`.

#### Scenario: Long snippet is cut

- **WHEN** an engine returns a 2,000-character snippet
- **THEN** the stored snippet and the snippet that the model reads are at most 300 characters

#### Scenario: Long answer is cut

- **WHEN** a hosted engine answers with 12,000 units of text and three citations
- **THEN** the answer is cut to 8,000 units with a note and all three citations remain

#### Scenario: A failure note stays visible at the note cap

- **WHEN** a ranked call has a removal note, eleven engine notes, and a failed rank call
- **THEN** `notes` holds ten entries
- **AND** the removal note is first, seven engine notes follow, the ninth note is `4 more engines`
- **AND** the last note is `rerank: unavailable`

### Requirement: Aggregate engines fan out and merge by rank fusion

An `aggregate` MUST run each child that accepts the query concurrently.
It MUST wait until each child settles.
It MUST group results by canonical URL, without `www.` at the host start
and without `/` at the path end.
It MUST score each URL by `Σ 1/(60 + rank)` over the children that return it.
It MUST order the results by score.
A group MUST use its best-ranked URL and the longest snippet.
Without `webSearch.rerank.model`, the aggregate MUST cut the merged list
to the fetch size.
With that setting, it MUST retain the whole merged list for the guard,
rank call, and artifact.
If the rank call fails, the retained list MUST keep its rank-fusion order.
An aggregate with no result MUST be empty when a child was empty.
In other cases it MUST fail.

#### Scenario: Shared result ranks first

- **WHEN** child A returns `[u1, u2]` and child B returns `[u3, u1]`
- **THEN** the merged order starts with `u1`

#### Scenario: A grouped result keeps a real spelling

- **WHEN** child A returns `https://www.example.com/docs/` first and child B returns `https://example.com/docs` second
- **THEN** the aggregate emits one merged entry with the URL `https://www.example.com/docs/`

#### Scenario: Partial failure still answers

- **WHEN** one child fails with `rate_limited` and another returns results
- **THEN** the aggregate returns the results of the successful child with a note that names the failed child

#### Scenario: A failed and an empty child are empty

- **WHEN** one child fails with `auth` and the other returns no results
- **THEN** the aggregate outcome is empty and the chain advances

#### Scenario: Every child fails

- **WHEN** every child of an aggregate fails
- **THEN** the aggregate outcome is `upstream_error` and the chain advances

#### Scenario: Cancellation aborts every child

- **WHEN** the owner cancels the Run while two aggregate children are in flight
- **THEN** llame aborts both requests

#### Scenario: Every skipped child fails as unsupported

- **WHEN** the query limit skips each child of an aggregate
- **THEN** the aggregate outcome is `unsupported` and the chain advances

#### Scenario: A configured rank call sees every merged candidate

- **WHEN** two children each return 20 distinct results, the fetch size is 20, `limit` is 10, and `webSearch.rerank.model` is set
- **THEN** all 40 merged results become cards
- **AND** the first 10 results in rank order appear inline
- **AND** the artifact holds all 40 when the Run can read artifacts and the output fits the artifact bound

#### Scenario: An aggregate without a rank model keeps its fetch-size cut

- **WHEN** two children each return 20 distinct results, the fetch size is 20, and no rank model is set
- **THEN** the aggregate returns the first 20 merged results in rank-fusion order

#### Scenario: A failed rank call keeps the full merged candidate set

- **WHEN** two children each return 20 distinct results, the fetch size is 20, and the configured rank call fails
- **THEN** the retained 40 results keep rank-fusion order and the output carries `rerank: unavailable`
- **AND** the artifact holds all 40 when the Run can read artifacts and the output fits the artifact bound

## ADDED Requirements

### Requirement: The aggregate candidate bound follows its children

A retained aggregate result set MUST hold at most the sum of its children's
admitted result counts.
Each child MUST keep its existing per-engine result bound and configured
fetch-size bound.
The rank stage MUST NOT add a separate candidate cut.

#### Scenario: A larger aggregate uses parallel requests

- **WHEN** three children each return 100 distinct admitted results and the fetch size is 100
- **AND** a rank model is configured
- **THEN** the rank call receives all 300 cards in two parallel requests
- **AND** the artifact holds all 300 when the Run can read artifacts and the output fits the artifact bound

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

When `webSearch.rerank.model` is set, the system MUST rank each `results`
outcome unless the whole result fits inline. The rank MUST precede the
inline cut and the artifact. Each result MUST give one card
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

The system MUST make no decision call when at most `limit` deduplicated
results fit wholly within the 15,000-unit inline bound. No minimum number
of results applies. Such a call MUST keep engine order and MUST NOT store
`display.rerank`.

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
answers MUST NOT stop the rank call. Ranking MUST NOT change admission, retained
counts, or removal rules. The `left out` count MUST reflect the ranked inline cut.

#### Scenario: A tie keeps engine order

- **WHEN** two results receive the same score
- **THEN** the result with the earlier engine rank comes first

#### Scenario: The engine type does not stop the rank call

- **WHEN** `parallel` answers the call and `webSearch.rerank.model` is set
- **THEN** the system ranks the results of `parallel` like any other engine's results

#### Scenario: Counts and removal do not change

- **WHEN** a ranked call fetches 20 results, `limit` is 10, removal drops two entries, and ten results fit inline
- **THEN** the first note states that the call removed two entries
- **AND** the `left out` count is 8

#### Scenario: Ranked text changes the number of visible results

- **WHEN** ranking moves long results first and only seven of eighteen retained results fit inline
- **THEN** the `left out` notice reports eleven omitted results

### Requirement: A failed rank call keeps engine order and adds one note

An ordinary backend failure MUST NOT fail the tool call.
This rule MUST NOT override enclosing cancellation or timeout.
A rank call fails when no card receives an answer.
The system MUST keep the engine order and MUST add one note
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
