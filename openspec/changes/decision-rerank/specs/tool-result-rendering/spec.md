# Spec Delta

## MODIFIED Requirements

### Requirement: A grep page groups consecutive passages under one file line

A `grep` text MUST render each run of consecutive passages of one file under
one `## <locator>` line. That line MUST hold the file locator and no line
range. `<locator>:<start>-<end>` from a rendered line number MUST be a valid
`read` argument. One blank line MUST separate the passages under one line. A
capped twentieth passage MUST end with `[more passages in this file; read it
to see them]`. A Knowledge notice MUST render first.
For ranked output, explicit run boundaries MUST determine the headings.
Adjacent ranked runs of the same file MUST NOT merge.

After the passages, the text MUST render the lines below in this order. Each
line renders only when it applies:

- Non-empty warnings MUST render as one `[warnings: …]` line.
- A `ranking` field of `unavailable` MUST render one
  `[ranking unavailable; walk order]` line.
- An `ignored` field MUST render as one line of at most 2,000 code units. That
  line reads `[ignored <count> <noun>: <locators>; a scope that names one
  searches it]`. `<noun>` is `directory` for a count of one and `directories`
  in other cases. `<locators>` holds the first `ignored.locators` that fit in
  the line. A comma and one space separate two locators.
- When the count is larger than the rendered locators, `(+<rest> more)` MUST
  follow them after one space. When no locator fits, `(+<rest> more)` MUST
  follow the colon after one space. When `ignored.atLeast` is `true`,
  `<count>` MUST read `<count> or more` and the rest MUST read
  `(+<rest> or more)`.
- An `unfinishedFile` field MUST render as
  `[not searched to the end: <locator>]`.
- The remainder line MUST follow them. The artifact notice line MUST follow
  the remainder line.

#### Scenario: Two passages in one file share a header

- **WHEN** `src/app.ts` gives passages `:3-7` and `:40-42` in one scope
- **THEN** the text has one `## src/app.ts` line and the two passages, with a blank line between them

#### Scenario: Overlapping scopes repeat the file line

- **WHEN** scopes `src/**` and `src/app.ts` both give passages of `src/app.ts`
- **THEN** each run of passages of a scope has its own `## src/app.ts` line, in scope order

#### Scenario: Warnings render as one line

- **WHEN** the walk skipped 3 binary files and stopped at the call deadline
- **THEN** the text carries `[warnings: 3 binary, 1 deadline]`

#### Scenario: A failed rank call follows the warnings

- **WHEN** the walk skips 3 binary files, excludes 2 directories, and the result carries `ranking: "unavailable"`
- **THEN** the text carries `[warnings: 3 binary]`, then `[ranking unavailable; walk order]`, then the `[ignored …]` line
- **AND** the file blocks keep walk order

#### Scenario: A capped file is marked

- **WHEN** one file holds 25 passages and the result carries its first 20
- **THEN** the twentieth passage ends with `[more passages in this file; read it to see them]`

#### Scenario: Excluded directories render after the warnings

- **WHEN** `ignored` has count 7 and five locators `/r/a`, `/r/b`, `/r/c`, `/r/d`, and `/r/e`
- **THEN** the text carries `[ignored 7 directories: /r/a, /r/b, /r/c, /r/d, /r/e (+2 more); a scope that names one searches it]`
- **AND** that line comes after the `[warnings: …]` line and before the remainder line

#### Scenario: One excluded directory takes the singular

- **WHEN** `ignored` has count 1 and the locator `/r/node_modules`
- **THEN** the text carries `[ignored 1 directory: /r/node_modules; a scope that names one searches it]`

#### Scenario: A lower-bound count is marked

- **WHEN** `ignored` has count 1,000, five locators, and `atLeast: true`
- **THEN** the line starts with `[ignored 1000 or more directories:`
- **AND** the locators end with `(+995 or more)`

#### Scenario: An unfinished file is named

- **WHEN** the result carries `unfinishedFile` `/var/log/big.log`
- **THEN** the text carries `[not searched to the end: /var/log/big.log]`

## ADDED Requirements

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

- **WHEN** a 300-card rank call has two requests and only the 256-card request answers every question
- **THEN** `order` holds all 300 keys, with the 256 judged keys first by score
- **AND** `scores` holds 256 keys

### Requirement: Ranked grep records preserve run boundaries

A ranked `grep` record MUST also hold `runLengths`, aligned with `order`.
Each length MUST count the full run's passages before the inline cut.
The text renderer, artifact blocks, and owner UI MUST preserve those boundaries.
For a truncated inline prefix, they MUST consume the lengths only through that prefix.

#### Scenario: Reordered same-file runs stay separate

- **WHEN** canonical runs `x:10`, `y:5`, and `x:20` reorder to `x:10`, `x:20`, and `y:5`
- **THEN** the record has three run lengths and the live text, artifact, and UI keep three runs with their original scores

#### Scenario: The last visible run is truncated

- **WHEN** the inline cut retains only the first passage of a three-passage run
- **THEN** the UI shows that passage with its run's score and creates no missing passages

### Requirement: A rank record names the served model and the call cost

In `display.rerank`, `model` MUST use the decision call's representative served id.
`latencyMs` MUST give whole-call latency.
`costUsd` MUST use the decision call's aggregate wire cost, including its unknown-cost rule.

#### Scenario: The served model id is stored, not the catalog id

- **WHEN** the catalog entry `jev` reaches an endpoint that answers as `jev-1.14`
- **THEN** `model` reads `jev-1.14`
- **AND** the record does not carry the catalog id

#### Scenario: An endpoint without cost stores a null cost

- **WHEN** the decision endpoint reports no cost for a rank call
- **THEN** `costUsd` is `null`
- **AND** the record still holds `model`, `latencyMs`, and `scores`

### Requirement: A rank record is display data only

The stored part MUST keep `display.rerank` as the tool wrote it.
Live and replayed text MUST NOT render that record or its fields as rank metadata.
This rule MUST NOT remove matching source text apart from required protected-key replacement.
A result without a rank call, or with a failed rank call, MUST NOT carry `display.rerank`.

#### Scenario: Rank data never reaches the model

- **WHEN** a ranked `grep` part renders live and replays in a later turn
- **THEN** neither text renders the record or its fields as rank metadata
- **AND** both texts keep the ranked inline passages in their applied order and the stored record stays unchanged

#### Scenario: Source text resembles rank metadata

- **WHEN** an uncut selected line contains the served model id, `rerank`, or a score
- **THEN** the live and replayed texts preserve that source line except for required protected-key replacement

#### Scenario: An unranked result carries no record

- **WHEN** a `web_search` call returns results and runs no rank call
- **THEN** the stored part carries no `display.rerank`
- **AND** the live and replayed texts are unchanged

#### Scenario: A failed rank call carries no record

- **WHEN** a `grep` call ranks 40 file runs and no card receives an answer
- **THEN** the stored part carries `ranking: "unavailable"` and no `display.rerank`

### Requirement: A grep ranking failure renders one framing line

When a `grep` result carries `ranking: "unavailable"`, the text MUST keep walk
order. The text MUST carry one framing line that reads
`[ranking unavailable; walk order]`. That line MUST render after the last file
block. That line MUST follow the `[warnings: …]` line when the result carries
one. That line MUST come before the `[ignored …]` line and before the
`[not searched to the end: …]` line. That line MUST NOT name a model or a
score. A result without the field MUST NOT carry the line.

#### Scenario: A failed rank call keeps walk order

- **WHEN** a walk finds 40 files and the result carries `ranking: "unavailable"`
- **THEN** the file blocks keep walk order
- **AND** the text carries `[ranking unavailable; walk order]` after the last file block

#### Scenario: The framing line follows the warnings

- **WHEN** a `grep` result carries a warnings line and `ranking: "unavailable"`
- **THEN** `[ranking unavailable; walk order]` follows the `[warnings: …]` line
- **AND** the line comes before the `[ignored …]` line and the artifact notice line

#### Scenario: The framing line names no model and no score

- **WHEN** a rank call to model `jev-1.14` fails
- **THEN** the text holds no `jev-1.14` and no score
- **AND** the failure adds no other line

### Requirement: A web search ranking failure renders one note

When the rank call of a `web_search` results outcome fails, the text MUST keep
engine order. The text MUST carry one note line that reads
`[rerank: unavailable]`. That line MUST render after the last result or
answer. That line MUST follow the removed-entry note and the engine notes.
That line MUST NOT name a model or a score.

#### Scenario: A failed rank call keeps engine order

- **WHEN** a `web_search` call returns five results and the rank call fails
- **THEN** the results keep engine order
- **AND** the text carries `[rerank: unavailable]` after the fifth result

#### Scenario: The note comes after the other notes

- **WHEN** the output carries a removed-entry note, an engine note, and a failed rank call
- **THEN** `[rerank: unavailable]` is the last note line
- **AND** the removed-entry note stays first

#### Scenario: The note names no model and no score

- **WHEN** a rank call to model `jev-1.14` fails
- **THEN** the text holds no `jev-1.14` and no score

### Requirement: The owner UI shows the rank record

The chat MUST show one rank badge on each ranked `grep` part and each ranked
`web_search` part. The badge MUST name the served model, the latency, and the
cost. The chat MUST show a judged item's score beside its row when that row is present.
It MUST NOT create rows for omitted results merely to show their scores.
A part without `display.rerank` MUST NOT show a badge or a score.
A failed rank call MUST show the note line or the framing line of that failure.

#### Scenario: A ranked grep part shows the badge and the scores

- **WHEN** a completed `grep` part carries `display.rerank` with 162 keys
- **THEN** the part shows one badge with the model, the latency, and the cost
- **AND** each judged file block shows its score

#### Scenario: A ranked web search part shows the badge and the scores

- **WHEN** a completed `web_search` part carries `display.rerank` with five keys
- **THEN** the part shows one badge with the model, the latency, and the cost
- **AND** each judged result row shows its score

#### Scenario: Omitted results need no score rows

- **WHEN** the record has 300 judged keys but the stored output holds only five result rows
- **THEN** the part shows those five rows with their scores and creates no rows for the omitted results

#### Scenario: A part without a record shows no badge

- **WHEN** a completed `grep` part carries no `display.rerank`
- **THEN** the part shows no badge and no score

#### Scenario: A failed rank call shows its line

- **WHEN** a `web_search` part carries the note `rerank: unavailable`
- **THEN** the part shows `[rerank: unavailable]` with the other notes
