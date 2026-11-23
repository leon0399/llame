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

- **WHEN** the title model answers with a Codex `usage_limit_reached` and a reset in two days
- **THEN** the title request fails, and no Run waits for it

#### Scenario: A model-switch compaction hits a usage limit

- **WHEN** the source-model summary of a model switch fails with `quota_exhausted` and a reset in two days
- **THEN** the Run fails with `error.code` `context_incompatible`, and it does not wait

#### Scenario: A quota cell switches in place of the wait

- **WHEN** a role Run gets a usage limit with a reset in two days, and its `quota` cell is `on`
- **THEN** the Run does not enter `awaiting_quota`, and it continues on the next candidate
