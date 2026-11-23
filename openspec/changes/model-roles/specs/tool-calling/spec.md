## MODIFIED Requirements

### Requirement: A failed attempt stays in later context as the user saw it

The prospective cutover boundary in `context-injection` MUST govern the retention of failed
attempts. The system MUST NOT filter or rebuild the current conversation state after the fact. A
failed, cancelled, expired, or superseded attempt MUST stay in later context as the user saw it. A
follow-up Run from `turn-actions` can replace the reply. A model switch of `model-roles` removes the
cut of the failed send from the reply before it closes the reply. Its reasoning parts follow the
model rule of `reasoning-output`.

#### Scenario: A cancelled call is projected as cancelled

- **WHEN** an unsuccessful Run termination settled an earlier call
- **THEN** operational and UI replay report its matched `cancelled` result
- **AND** the persisted output of that failed attempt stays part of model history
- **AND** it stays different from an error that a tool produced

#### Scenario: A follow-up Run replaces the record of a failed attempt

- **WHEN** a failed reply holds a settled tool pair and an unfinished step, and the owner regenerates the turn
- **THEN** after the Regenerate Run dispatches, later turns do not replay that tool pair or that step

#### Scenario: A model switch removes the failed send

- **WHEN** a send streams text with no tool call, fails, and the Run switches to the next candidate
- **THEN** the closed reply does not hold that text, and no later request replays it
