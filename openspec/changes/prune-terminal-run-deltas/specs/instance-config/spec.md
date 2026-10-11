## ADDED Requirements

### Requirement: Operators set the delta retention window

`runs.deltaRetentionDays` SHALL be an optional positive integer, or a
whole-value interpolation token resolving to one, that sets the retention window
for delta events of finished Runs. Absent, it SHALL default to `7`. An explicit
`null` SHALL disable pruning. Zero, a negative number, or a fraction SHALL fail
startup naming the path.

#### Scenario: The default window applies

- **WHEN** the file omits `runs.deltaRetentionDays`
- **THEN** delta events of finished Runs are pruned after seven days

#### Scenario: Null disables pruning

- **WHEN** the file sets `runs.deltaRetentionDays` to `null`
- **THEN** no delta event is deleted

#### Scenario: An invalid window fails startup

- **WHEN** `runs.deltaRetentionDays` resolves to `0`, `-1`, or `1.5`
- **THEN** startup fails naming `runs.deltaRetentionDays`
