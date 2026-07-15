## ADDED Requirements

### Requirement: Final assistant-message projection preserves replay order

The final assistant message written for a run SHALL be an ordered projection of the same reasoning, text, and tool activity represented by the durable run-event log. It SHALL not regroup all reasoning before tools or all text after tools. A partial message persisted after a model error SHALL retain the same ordering rule for every part observed before failure.

#### Scenario: Completed run projects event order into message parts

- **WHEN** a completed run emits reasoning, text, tool activity, reasoning, and text in that order
- **THEN** its assistant message stores parts in that same order

#### Scenario: Failed run projects observed part order

- **WHEN** a run emits reasoning and text before a model error
- **THEN** its partial assistant message retains the observed reasoning-before-text order

### Requirement: Received reasoning is durable before browser delivery

Each normalized reasoning delta received by llame SHALL be durably recorded before it is forwarded to a browser stream. The run transcript SHALL retain deltas received before either a worker failure or an upstream provider failure, and SHALL project them on both successful and failed terminal runs.

#### Scenario: Successful run retains streamed reasoning

- **WHEN** llame receives reasoning deltas and the run subsequently succeeds
- **THEN** the final assistant message contains the received reasoning in durable event order

#### Scenario: Provider failure retains received reasoning

- **WHEN** llame receives reasoning deltas and the upstream provider subsequently fails
- **THEN** the terminal failed run retains every reasoning delta durably recorded before that failure

#### Scenario: Worker failure never contradicts prior browser output

- **WHEN** llame has forwarded a reasoning delta to the browser and the worker subsequently fails
- **THEN** reconnect replay includes that delta
