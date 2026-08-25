## MODIFIED Requirements

### Requirement: The row is immutable once written and identical on every replay

The temporal row SHALL be **persisted with the turn it belongs to as its complete final model-facing text block**. The accepted instant and timezone SHALL be validated and formatted before that block is persisted; later replay SHALL consult neither the clock, the process environment, the stored semantic payload, nor the current formatter.

The stored row SHALL be byte-identical across every application-level request that replays that turn, for the life of the turn. A later renderer, timezone-database, formatting, or instance-timezone change SHALL affect only rows authored after that change and SHALL NOT retroactively alter an existing row.

#### Scenario: A conversation is replayed after a formatter change

- **WHEN** a later release changes temporal formatting or reminder wording and replays an existing chat
- **THEN** every existing row uses its persisted complete text unchanged
- **AND** only newly accepted turns use the new rendering

#### Scenario: A conversation is replayed

- **WHEN** a request is assembled for a chat whose post-cutover turns each carry a persisted row
- **THEN** every row replays exactly as it was authored
- **AND** no row's text depends on when or by which release the replay happens

#### Scenario: The instance timezone changes

- **WHEN** the instance is reconfigured to a different timezone and an existing chat continues
- **THEN** existing rows replay unchanged
- **AND** only turns received after the change carry the new timezone

#### Scenario: A chat is forked

- **WHEN** an owner forks a chat and its private turns are copied
- **THEN** the copied turns carry their original persisted rows
- **AND** the rows state when the original turns were received

### Requirement: Temporal readings share one format, and the system's own readings share one timezone

At authoring time, the row SHALL use the same rendered shape as the anchor: absolute, carrying a numeric UTC offset, and accompanied by the IANA identifier of the zone it is expressed in. Offset and identifier SHALL be produced from a single formatting operation over one accepted instant, so the two cannot disagree.

The row and the anchor SHALL be expressed in the **instance's own local timezone** resolved where the turn is accepted. The complete row text SHALL then be persisted. Replay SHALL NOT re-resolve the timezone or reformat the instant, so a later process cannot disagree with the process that accepted the turn.

A future temporal reading of the same instant in a user's stored timezone SHALL be an additional labeled line authored within the same persisted row. A second temporal block SHALL NOT be introduced, and the new line SHALL apply only to rows authored after that capability exists unless an explicit data transition says otherwise.

#### Scenario: The instance runs in a non-UTC timezone

- **WHEN** a turn is accepted on an instance whose local timezone is not UTC
- **THEN** its persisted row is expressed in that timezone with that zone's numeric offset for that instant and that zone's IANA identifier
- **AND** later replay uses the persisted row without another timezone calculation

#### Scenario: A further reading is added later

- **WHEN** a later release introduces a further temporal reading
- **THEN** newly authored rows render it as another labeled line of the same persisted block
- **AND** existing rows remain unchanged and no second temporal block appears
