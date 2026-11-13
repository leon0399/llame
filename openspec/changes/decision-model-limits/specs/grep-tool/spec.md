## MODIFIED Requirements

### Requirement: The rank makes one card for each file run

The tool MUST make one card for each file run and send every card to the rank call.
A decision model MUST judge only the cards within the decision lane's call bound.
A card MUST use a path excerpt and up to three matching-line excerpts within
384 UTF-16 code units. Keys MUST use `p<index>` with canonical zero-based indices,
padded to the last index's width. Excerpt cuts MUST NOT change stored passages;
the required protected-key presentation exception MUST still apply.

#### Scenario: A refused file supplies no card

- **WHEN** a host walk and a `kb://space/app` walk each match one file that the `read` group refuses
- **THEN** the cards hold runs of admitted files only
- **AND** the refused paths appear in no card and in no passage of the result

#### Scenario: A card holds the path and three matching lines

- **WHEN** a file run holds six matching lines of under 100 units each and its path is 40 code units long
- **THEN** its card holds the path and the first three matching lines
- **AND** the card stays at or below 384 UTF-16 code units

#### Scenario: A walk has more runs than the call bound

- **WHEN** a walk with 300 file runs ranks through a decision model
- **THEN** the rank call receives 300 cards and judges the first 256
- **AND** the other 44 runs follow the judged runs in canonical order

#### Scenario: A path exceeds the card bound

- **WHEN** an admitted path exceeds 384 UTF-16 units
- **THEN** its card uses a bounded path excerpt and the result keeps the full path except for required protected-key replacement

### Requirement: A ranking failure keeps walk order and says so

If no card receives an answer, the tool MUST keep canonical order and store
`ranking: "unavailable"` without `display.rerank`.
Enclosing timeout and cancellation MUST take precedence.
For partial success, judged runs MUST precede unjudged runs in canonical
order, without the `ranking` field.
`tool-result-rendering` specifies the failure line.

#### Scenario: An unreachable endpoint keeps the walk order

- **WHEN** the decision endpoint refuses every request of a 30-run call
- **THEN** the text follows the canonical order
- **AND** the output carries `ranking: "unavailable"` and no `display.rerank`
- **AND** `complete`, `warnings`, and the counts are unchanged

#### Scenario: A partial answer ranks the judged runs

- **WHEN** one request of a 40-card call fails and the other cards carry scores
- **THEN** the judged runs sort by score and the unjudged runs follow in the canonical order
- **AND** the output carries no `ranking` field
