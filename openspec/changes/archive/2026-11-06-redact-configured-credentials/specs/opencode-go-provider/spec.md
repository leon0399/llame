## MODIFIED Requirements

### Requirement: Upstream failures are mirrored under the existing contract

The provider MUST surface the gateway's failures at request time. It MUST apply
the Chat Completions wire's failure contract to them, exactly as for an
`openai-completions` entry. That contract is `provider-api-selection`, "Chat
Completions failures reach the run as bounded messages".

The request's failure message MUST be the gateway's parsed error message. That
message applies whether the message arrives on a failure response or inside
the response stream. The SDK's own retry rules for retryable statuses apply
first. The run MUST show that message to the owner whose run failed and record
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

The system MUST NOT validate a model's eligibility or route at boot. It MUST
NOT keep a compiled model, route, or capability table. It MUST NOT classify Go
failures into llame-owned error types. It MUST NOT replace the gateway's
parsed message with a fixed one, other than for a redirect response. It MUST
NOT introduce a quota ledger or a typed quota error. It MUST NOT retry against
or fall back to another provider, wire, or model because a request failed.

The operator runbook MUST record the accepted upstream shapes. A model that
the gateway's format gate rejects fails with the gateway's "not supported for
format" message, and the runbook MUST name the remedy. A usage-limit rejection
fails with the gateway's message after the SDK's retries, and the runbook MUST
state that llame tracks no quota.

#### Scenario: A rejected model surfaces at request time

- **WHEN** the gateway's format gate does not accept a configured model for the route llame uses
- **THEN** startup succeeded earlier and did not check eligibility
- **AND** the request fails at request time with the gateway's own message as the failure
- **AND** no other provider, wire, or model is tried in its place

#### Scenario: A quota rejection is reported without inventing state

- **WHEN** the gateway rejects a request because a usage limit is exhausted
- **THEN** the affected request fails under the current failure and retry rules with the gateway's message
- **AND** llame reports no quota state of its own and claims no cost
- **AND** no paid fallback is attempted

#### Scenario: Raw upstream details stay out of every surface

- **WHEN** the gateway's failure response carries a body, headers, or metadata beyond its message
- **THEN** owner events, persisted errors, logs, and telemetry carry the parsed message (or the status text when the body is not the envelope)
- **AND** no credential, response body, response header, or request body appears in any of them

#### Scenario: An unreadable stream event from the gateway is not quoted

- **WHEN** the gateway's stream delivers an event that is not JSON or does not match the wire's chunk shape. The event can also carry an error value without a string message
- **THEN** the run fails with the Chat Completions wire's fixed unreadable-event text
- **AND** none of that event's content appears in owner events, persisted errors, or the run's failure log line

#### Scenario: The runbook names the accepted upstream shapes

- **WHEN** the operator runbook for this provider is read
- **THEN** it states that a misdeclared model fails with the gateway's "not supported for format" message and names the remedy
- **AND** it states that a usage-limit rejection surfaces after the SDK's retries and that llame tracks no quota
