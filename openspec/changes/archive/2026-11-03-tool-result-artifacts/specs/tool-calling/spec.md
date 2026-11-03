## ADDED Requirements

### Requirement: A replayed pair keeps its artifact locator

When a stored tool part names an artifact, its replayed result MUST carry the
line `Artifact: <locator>` after its outcome. The line is part of the identity
and outcome of the pair, not its payload. The replay MUST keep the line when
it clears the payload. The line MUST count toward the replay budgets.

#### Scenario: A cleared grep result still names its artifact

- **WHEN** a `grep` result of 15,000 units with `artifact://grep-7` is replayed on the next turn and its payload is cleared
- **THEN** the replayed result carries the outcome and `Artifact: artifact://grep-7`

#### Scenario: A result without an artifact has no line

- **WHEN** a stored tool part names no artifact
- **THEN** its replayed result carries no `Artifact:` line

#### Scenario: A dropped pair drops its line

- **WHEN** the replay drops a whole pair to fit the turn budget
- **THEN** its `Artifact:` line is not in the request
- **AND** `read("artifact://")` still lists that artifact
