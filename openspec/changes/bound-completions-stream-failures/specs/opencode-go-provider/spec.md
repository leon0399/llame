## MODIFIED Requirements

### Requirement: Upstream failures are mirrored under the existing contract

The provider SHALL surface the gateway's failures at request time under the
Chat Completions wire's failure contract, exactly as for an
`openai-completions` entry (`provider-api-selection`, "Chat Completions
failures reach the run as bounded messages"): the gateway's parsed error
message, whether it arrives on a failure response or inside the response
stream, is the request's failure message, shown to the owner whose run failed
and recorded on the run, after the SDK's own retry rules for retryable
statuses; the failure response's body and headers, the request body, and the
credential SHALL NOT reach owner output, the persisted run, logs, or
telemetry; a failure body that is not the gateway's envelope SHALL surface as
the HTTP status text; a refused redirect and a stream event the adapter cannot
read SHALL surface as that contract's fixed texts, which carry no byte of the
redirect target or of the event. The parsed message MAY name request values
the gateway chose to echo. The system SHALL NOT validate a model's eligibility
or route at boot, SHALL NOT keep a compiled model, route, or capability table,
SHALL NOT classify Go failures into llame-owned error types or replace the
gateway's message with a fixed one, SHALL NOT introduce a quota ledger or a
typed quota error, and SHALL NOT retry against or fall back to another
provider, wire, or model because a request failed. The operator runbook SHALL
record the accepted upstream shapes: a model the gateway's format gate rejects
fails with the gateway's "not supported for format" message and its remedy,
and a usage-limit rejection fails with the gateway's message after the SDK's
retries.

#### Scenario: A rejected model surfaces at request time

- **WHEN** a configured model is not accepted by the gateway's format gate for the route llame uses
- **THEN** startup already succeeded without checking eligibility
- **AND** the request fails at request time with the gateway's own message as the failure
- **AND** no other provider, wire, or model is tried in its place

#### Scenario: A quota rejection is reported without inventing state

- **WHEN** the gateway rejects a request because a usage limit is exhausted
- **THEN** the affected request fails under the existing failure and retry rules with the gateway's message
- **AND** llame reports no quota state of its own and claims no cost
- **AND** no paid fallback is attempted

#### Scenario: Raw upstream details stay out of every surface

- **WHEN** the gateway's failure response carries a body, headers, or metadata beyond its message
- **THEN** owner events, persisted errors, logs, and telemetry carry the parsed message (or the status text when the body is not the envelope)
- **AND** no credential, response body, response header, or request body appears in any of them

#### Scenario: An unreadable stream event from the gateway is not quoted

- **WHEN** the gateway's stream delivers an event the adapter cannot read
- **THEN** the run fails with the Chat Completions wire's fixed unreadable-event text
- **AND** no byte of that event appears in owner events, persisted errors, or logs

#### Scenario: The runbook names the accepted upstream shapes

- **WHEN** the operator runbook for this provider is read
- **THEN** it states that a misdeclared model fails with the gateway's "not supported for format" message and names the remedy
- **AND** it states that a usage-limit rejection surfaces after the SDK's retries and that llame tracks no quota
