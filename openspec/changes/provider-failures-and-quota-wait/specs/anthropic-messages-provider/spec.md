## MODIFIED Requirements

### Requirement: Failure boundaries are bounded and sanitized

The client MUST assign each failure a failure class of `provider-failures` before it sanitizes the
diagnostic. Authentication failures, unknown or invalid model identifiers, and rejected request
options MUST fail the affected request under the run failure contract with sanitized diagnostics.
A rate limit or an overload MUST get the request retries and the quota wait of
`provider-failures`. It MUST fail the request with a sanitized diagnostic only after they end. The
client MUST NOT retry with a different credential, or fall back to another provider or provider
type. It MUST NOT represent a failure as a successful run. Already-recorded parts and tool effects
MUST stay under the durability rules. `provider-api-selection` defines how rejected and unrecognized
`providerOptions` keys reach the provider.

#### Scenario: Authentication failure is bounded to the request

- **WHEN** an Anthropic endpoint rejects the configured credential
- **THEN** the affected run fails with a sanitized diagnostic and the failure class `auth`
- **AND** models on other providers remain executable
- **AND** no automatic retry or credential substitution occurs

#### Scenario: Rate limits are reported without fallback

- **WHEN** the provider rate-limits a request, and each of its request retries
- **THEN** the failure is reported as a bounded diagnostic with the failure class `rate_limited`
- **AND** no paid or alternative-provider fallback occurs

#### Scenario: Upstream error bodies are not disclosed

- **WHEN** an upstream failure echoes request details
- **THEN** owner-visible output, persisted errors, logs, and telemetry contain only sanitized
  diagnostics
