## ADDED Requirements

### Requirement: Operators set the delta retention window

`runs.deltaRetentionDays` SHALL be an optional positive integer, or a
whole-value interpolation token resolving to one, that enables pruning of delta
events of finished Runs older than that many days. Absent or `null`, it SHALL be
unset and nothing is pruned, consistent with every other nullable `runs.*`
setting. Zero, a negative number, or a fraction SHALL fail startup naming the
path.

#### Scenario: Pruning is opt-in

- **WHEN** the file omits `runs.deltaRetentionDays` or sets it to `null`
- **THEN** no delta event is deleted

#### Scenario: A window enables pruning

- **WHEN** the file sets `runs.deltaRetentionDays` to `7`
- **THEN** delta events of finished Runs are pruned after seven days

#### Scenario: An invalid window fails startup

- **WHEN** `runs.deltaRetentionDays` resolves to `0`, `-1`, or `1.5`
- **THEN** startup fails naming `runs.deltaRetentionDays`
