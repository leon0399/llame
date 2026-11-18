## MODIFIED Requirements

### Requirement: The sidebar shows a background state

The sidebar MUST show the state `background` for a Chat when its `runningJobs` is above 0 and no
Run of it is live. It MUST also show `background` while the live Run of the Chat is in
`awaiting_jobs` or `awaiting_quota`. The order of precedence MUST be `processing`, `background`,
`failed`, `unread`.

#### Scenario: A monitor with no live Run

- **WHEN** a Chat has one job in state `running` and no live Run
- **THEN** its sidebar row shows the `background` state on each device of the owner

#### Scenario: A Run that waits

- **WHEN** the live Run of a Chat is in `awaiting_jobs`
- **THEN** its sidebar row shows `background`, not `processing`

#### Scenario: A Run that waits for a quota reset

- **WHEN** the live Run of a Chat is in `awaiting_quota`
- **THEN** its sidebar row shows `background`, not `processing`
