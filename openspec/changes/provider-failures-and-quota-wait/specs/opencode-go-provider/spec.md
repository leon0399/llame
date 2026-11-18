## MODIFIED Requirements

### Requirement: Upstream failures are mirrored under the existing contract

The provider MUST surface gateway failures under the resolved wire's existing
failure contract in `provider-api-selection`, with credential redaction and
no fallback to another route.

For Chat Completions, the request's failure message MUST be the gateway's parsed error message. That
message applies whether the message arrives on a failure response or inside
the response stream. The request retries of `provider-failures` apply
first, and the SDK makes no retry. The run MUST show that message to the owner whose run failed and record
it.

The failure response's body and headers, the request body, and the credential
MUST NOT reach owner output, the persisted run, logs, or telemetry. A
non-redirect failure body that is not the gateway's envelope MUST surface as
the HTTP status text. A redirect response MUST surface as that contract's fixed
redirect text. A stream event that is not JSON or does not match the wire's
chunk shape MUST surface as that contract's fixed unreadable-event text. The
same rule applies to an event that carries an error value without a string
message. Those texts MUST NOT contain the redirect's `Location` value or the
event's content.

The parsed message can name request values that the gateway chose to echo,
except a configured credential. llame MUST redact that credential
(`provider-api-selection`, "Provider failures never carry a configured
credential").

The system MUST NOT probe a model's eligibility or route at boot. It MUST
resolve model wires from bundled provider-specific metadata or an explicit
override under `provider-api-selection`. It MUST classify each Go failure
under `provider-failures`. It MUST NOT replace the gateway's parsed message
with a fixed one, other than for a redirect response. It MUST NOT introduce a
quota ledger. It MUST NOT send a failed request to another provider, wire, or
model.

The operator runbook MUST record the accepted upstream shapes. A model that
the gateway's format gate rejects fails with the gateway's "not supported for
format" message, and the runbook MUST name the remedy. A `GoUsageLimitError`
with a `Retry-After` can make the Run wait, as `quota-wait` defines. The runbook
MUST state this, and it MUST state that llame tracks no quota of its own.

#### Scenario: A rejected model surfaces at request time

- **WHEN** the gateway's format gate does not accept a configured model for the Chat Completions route llame uses
- **THEN** startup succeeded earlier and did not check eligibility
- **AND** the request fails at request time with the gateway's own message as the failure
- **AND** no other provider, wire, or model is tried in its place

#### Scenario: A quota rejection is reported without inventing state

- **WHEN** the gateway rejects a Run request with HTTP 429, `GoUsageLimitError`, a `metadata.limitName`, and `Retry-After: 3600`
- **THEN** the Run enters `awaiting_quota` with a reset time 3,600 seconds after receipt
- **AND** llame reports no quota state of its own and claims no cost
- **AND** no paid fallback is attempted

#### Scenario: A usage limit without Retry-After fails

- **WHEN** the gateway rejects a Run request with `GoUsageLimitError` and no `Retry-After`
- **THEN** the Run fails with `error.code` `quota_exhausted` and the gateway's parsed message

#### Scenario: Raw upstream details stay out of every surface

- **WHEN** the gateway's Chat Completions failure response carries a body, headers, or metadata beyond its message
- **THEN** owner events, persisted errors, logs, and telemetry carry the parsed message (or the status text when the body is not the envelope)
- **AND** no credential, response body, response header, or request body appears in any of them

#### Scenario: An unreadable stream event from the gateway is not quoted

- **WHEN** the gateway's Chat Completions stream delivers an event that is not JSON or does not match the wire's chunk shape. The event can also carry an error value without a string message
- **THEN** the run fails with the Chat Completions wire's fixed unreadable-event text
- **AND** none of that event's content appears in owner events, persisted errors, or the run's failure log line

#### Scenario: The runbook names the accepted upstream shapes

- **WHEN** the operator runbook for this provider is read
- **THEN** it states that a misdeclared model fails with the gateway's "not supported for format" message and names the remedy
- **AND** it states that a usage-limit rejection with a `Retry-After` waits for that reset, and that llame tracks no quota of its own
