## MODIFIED Requirements

### Requirement: Earlier reasoning replays only for the model that produced it

A reasoning part of an earlier turn MUST replay only when two conditions are
true. Its reply came from a Run with the llame model id of the request, and that
Run completed. Otherwise the system MUST omit the part and its provider metadata.
Within one turn, and in the kept parts of a Continue Run, a reasoning part MUST
replay on the model of its Run. The segments of one Run are one turn for this rule,
also before the Run completes. A reasoning part that an interrupt cut MUST NOT
replay in any later request, whatever the status of its reply. In a reply that an
interrupt closed, a reasoning part with no later kept part MUST NOT replay either. The system MUST NOT select reasoning parts by
their content or their age.

#### Scenario: The same model keeps earlier reasoning

- **WHEN** turn 1 completed on the model `sonnet` with a reasoning part, and turn 2 runs on `sonnet`
- **THEN** the first request of turn 2 carries that reasoning part with its provider metadata

#### Scenario: A model switch omits earlier reasoning

- **WHEN** turn 1 completed on `sonnet` with a reasoning part, and turn 2 runs on `glm-5`
- **THEN** the first request of turn 2 carries no reasoning part of turn 1
- **AND** it carries the text and the tool activity of turn 1

#### Scenario: The reasoning of a failed reply is omitted

- **WHEN** the Run of turn 1 failed after a reasoning part, and turn 2 runs on the same model
- **THEN** the first request of turn 2 carries no reasoning part of turn 1
- **AND** it carries the text and the tool activity of turn 1

#### Scenario: Continue keeps the reasoning of a failed Run

- **WHEN** the owner continues a `failed` Run on its model, and a kept step holds a reasoning part
- **THEN** the first request of the Continue Run carries that reasoning part with its provider metadata

#### Scenario: A return to the first model replays its reasoning

- **WHEN** turn 1 completed on `sonnet`, turn 2 completed on `glm-5`, and turn 3 runs on `sonnet`
- **THEN** the first request of turn 3 carries the reasoning parts of turn 1
- **AND** it carries no reasoning part of turn 2

#### Scenario: A later segment keeps the reasoning of an earlier segment

- **WHEN** the first segment of a Run on `sonnet` stored a reasoning part, and a steer starts a second segment
- **THEN** the first request of the second segment carries that reasoning part with its provider metadata

#### Scenario: An interrupted reply keeps only reasoning with a later part

- **WHEN** an interrupt closes a reply with a signed reasoning part, a text part, a second signed reasoning part, and a cut part
- **THEN** a later request of the same Run carries the first reasoning part and the text part
- **AND** it carries neither the second reasoning part nor the cut part

#### Scenario: A withdrawn interrupt's completed reply keeps the cut part out of later turns

- **WHEN** an interrupt cuts a reasoning part, the owner withdraws the item, and the reply then completes
- **THEN** the next turn on the same model does not carry the cut part
