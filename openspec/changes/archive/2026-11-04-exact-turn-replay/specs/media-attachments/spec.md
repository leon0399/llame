## MODIFIED Requirements

### Requirement: Retained bytes count toward no text budget

The tool-result truncation cap, the prompt-import output bound, and each
request-size estimate MUST exclude retained bytes. An attached image MUST keep its dimension
charge, and an attached PDF MUST keep its page charge.

#### Scenario: A large retained PDF does not clear its pair

- **WHEN** a later turn replays a `read` result whose retained original is 18 MiB
- **THEN** the replayed result carries its whole text
- **AND** the retained bytes add no text to it

#### Scenario: Truncation does not cut retained bytes

- **WHEN** a `read` returns an image whose model variant is 3 MiB
- **THEN** the tool result is not marked `truncated` because of the model variant
- **AND** the retained bytes are complete

#### Scenario: Retained bytes do not change the estimate

- **WHEN** two otherwise identical requests each carry one retained 2000×1125 image, one model
  variant of 200 KiB and one of 3.7 MiB
- **THEN** both requests receive the same estimate
