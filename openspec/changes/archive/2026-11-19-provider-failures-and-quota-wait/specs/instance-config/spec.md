## ADDED Requirements

### Requirement: The operator caps the quota wait

`runs.quotaWaitMaxSeconds` MUST be a positive integer of seconds. Its default MUST be 691,200, which
is 8 days. It also accepts a whole-value interpolation token. A zero, negative, or fractional value
MUST fail startup and name the configuration path.

#### Scenario: The default cap

- **WHEN** the file omits `runs.quotaWaitMaxSeconds`
- **THEN** a Run waits for a reset time at most 691,200 seconds away

#### Scenario: A zero cap fails startup

- **WHEN** `runs.quotaWaitMaxSeconds` resolves to 0
- **THEN** startup fails and names `runs.quotaWaitMaxSeconds`, and zero is never read as no wait

### Requirement: A model entry can set its first-token timeout

A model entry can set `firstTokenTimeoutSeconds`. It MUST be a positive integer of seconds, or a
whole-value interpolation token that resolves to one. Startup MUST fail for another value and name
the model id and the field. The field is server-only, and `GET /api/v1/models` MUST NOT return it.

#### Scenario: An invalid first-token timeout

- **WHEN** a model entry sets `firstTokenTimeoutSeconds` to 0.5
- **THEN** startup fails and names the model id and `firstTokenTimeoutSeconds`

#### Scenario: The timeout stays private

- **WHEN** a model entry sets `firstTokenTimeoutSeconds` to 900
- **THEN** the entry of that model in `GET /api/v1/models` has no `firstTokenTimeoutSeconds`
