## MODIFIED Requirements

### Requirement: The Continue Run log starts with the kept parts

The event log of the Continue Run MUST record the kept parts before its first model event. Each
attempt of the first segment of the Continue Run MUST start from those parts. A later segment,
which a delivery of `run-steering` starts, MUST NOT start from them. A stream replay of the first
segment MUST show the kept text, reasoning, and tool parts, then the new parts. The reply of the
first segment MUST hold the kept parts once, then the new parts, in stored order.

#### Scenario: A refresh shows the whole continued reply

- **WHEN** the owner reloads the Chat while a Continue Run streams its second new step
- **THEN** the resumed stream shows the kept text, reasoning, and tool parts, then the new parts

#### Scenario: A worker death does not lose the kept parts

- **WHEN** the worker of a Continue Run dies after its dispatch and after it stored an in-Run item
- **AND** the queue starts a second attempt of that Run
- **THEN** the second attempt starts from the same kept parts
- **AND** the final reply holds each kept part and each kept context item once, then the parts of the second attempt

#### Scenario: A failed Continue keeps the kept parts

- **WHEN** a Continue Run fails after one new settled tool call
- **THEN** the reply holds the kept parts, then the new step

#### Scenario: A delivered message does not repeat the kept parts

- **WHEN** a Continue Run delivers a steer after its first new step
- **THEN** the reply of the delivered message holds only the parts of the second segment
