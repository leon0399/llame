## ADDED Requirements

### Requirement: A follow-up Run announces a model change against the turn's last model

A follow-up Run from `turn-actions` MUST compare its model with the target model of the last
model-switch item on the triggering user message. When the message has no such item, it MUST
compare with the model of the most recent prior reply below the triggering user message. When
the models differ, it MUST store a model-switch item from that model to its own model. When they
are equal, it MUST store no model-switch item.

#### Scenario: Regenerate with a new model appends a switch

- **WHEN** the first Run of a turn stored a switch item from model `A` to model `B`, and the owner regenerates the turn with model `C`
- **THEN** the Regenerate Run stores a switch item from `B` to `C`
- **AND** it stores that item after the stored item

#### Scenario: Regenerate back to the earlier model appends a switch

- **WHEN** the first Run of a turn stored a switch item from model `A` to model `B`, and the owner regenerates the turn with model `A`
- **THEN** the Regenerate Run stores a switch item from `B` to `A`

#### Scenario: Regenerate with the same model adds no switch

- **WHEN** the first Run of a turn used the model of the prior reply and stored no switch item
- **AND** the owner regenerates the turn with that model
- **THEN** the Regenerate Run stores no switch item
