## MODIFIED Requirements

### Requirement: A longer stated wait parks the request or ends it

A failure with a reset time more than 60 seconds away MUST NOT get a request retry. A request of a
Run to the model of its current segment MUST then enter the quota wait of `quota-wait`. The `quota`
cell of `model-failover` can switch the Run in place of the wait. Any other request MUST fail. A `rate_limited` hint
more than 60 seconds away MUST fail the request at once. For another class, such a hint MUST NOT
change the random delay.

#### Scenario: An unclassified long hint

- **WHEN** an endpoint answers with HTTP 429, `Retry-After: 300`, and no classified usage limit
- **THEN** the request fails at once with the failure class `rate_limited`

#### Scenario: An overload with a long hint

- **WHEN** an endpoint answers with HTTP 503 and `Retry-After: 120`
- **THEN** the request gets request retries with the random delay

#### Scenario: A title request hits a usage limit

- **WHEN** an exact title model, or the last candidate of a title role, answers with a Codex `usage_limit_reached` and a reset in two days
- **THEN** the title request fails, and no Run waits for it

#### Scenario: A model-switch compaction hits a usage limit

- **WHEN** the source-model summary of a model switch fails with `quota_exhausted` and a reset in two days
- **THEN** the Run fails with `error.code` `context_incompatible`, and it does not wait

#### Scenario: A quota cell switches in place of the wait

- **WHEN** a role Run gets a usage limit with a reset in two days, and its `quota` cell is `on`
- **THEN** the Run does not enter `awaiting_quota`, and it continues on the next candidate

### Requirement: A caller sees a failure only after the retries and the quota wait

A caller failure rule MUST apply only when a request ends without success. That is when its request
retries end, or its quota wait cannot apply or ends without success. A `quota` cell of
`model-failover` is the one exception: it can switch the Run where the quota wait can apply. The
quota wait of a request MUST NOT count as a failure of that request.

#### Scenario: A step-boundary compaction hits a usage limit

- **WHEN** the summary request of a step-boundary compaction fails with a Codex usage limit and a reset in one hour
- **AND** no `quota` cell switches the Run
- **THEN** the Run enters `awaiting_quota`, and no compaction failure is recorded
