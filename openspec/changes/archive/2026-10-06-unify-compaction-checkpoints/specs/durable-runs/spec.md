# Spec Delta

## MODIFIED Requirements

### Requirement: Final assistant-message projection preserves replay order

The final assistant message written for a run SHALL be an ordered projection of the same reasoning, text, and tool activity represented by the durable run-event log. It SHALL not regroup all reasoning before tools or all text after tools. A partial message persisted after a model error SHALL retain the same ordering rule for every part observed before failure.

#### Scenario: Completed run projects event order into message parts

- **WHEN** a completed run emits reasoning, text, tool activity, reasoning, and text in that order
- **THEN** its assistant message stores parts in that same order

#### Scenario: Failed run projects observed part order

- **WHEN** a run emits reasoning and text before a model error
- **THEN** its partial assistant message retains the observed reasoning-before-text order

The prospective cutover boundary in `context-injection` SHALL govern these publication rules; existing conversation state SHALL not be retrospectively filtered or rebuilt.

Operational and UI replay SHALL retain a failed attempt's observed part order, and that persisted record SHALL become model history. A failed, cancelled, expired, or superseded attempt keeps the partial assistant turn the user saw, entering later model context, model-facing recall, and compaction like any other committed turn. Only attempt-owned staged rail context withholds until a successful turn publishes it. Within a successful attempt, an individually failed tool call remains a normal paired observation.

A Run's first model request MAY be preceded by a compaction checkpoint that publishes before that request. The checkpoint row and the re-baked epoch state it names SHALL commit in one transaction before the model request, and SHALL be retained when that attempt later fails, cancelled, or expires: a checkpoint describes committed history only, so it is correct regardless of the attempt's outcome. A checkpoint row is committed history, not attempt-owned staged rail context, and SHALL NOT be withheld or retracted on the attempt's outcome. A later attempt of the same Run SHALL reuse the published checkpoint rather than pay a second summary call.

#### Scenario: Failed attempt output stays visible and is model history

- **WHEN** an attempt streams reasoning, text, or tool results and then fails
- **THEN** operational/UI replay retains the observed order
- **AND** that partial output remains part of the record and enters later model context, recall, and compaction like any other committed turn, while its staged rail items never publish

#### Scenario: A checkpoint published before a failed attempt survives it

- **WHEN** an attempt publishes a compaction checkpoint and its re-baked epoch state before its first model request and that request then fails
- **THEN** the checkpoint row and the epoch state it names remain committed
- **AND** the Run's next attempt replays the same checkpoint instead of summarizing the same prefix again

#### Scenario: Fresh retry succeeds after an earlier failure

- **WHEN** attempt B succeeds after attempt A failed
- **THEN** the committed assistant turn and availability baseline derive only from B
- **AND** A's events cannot be merged into B's assistant projection
