# opencode-go-provider

## Purpose

Execute OpenCode Go's subscription models through the gateway's Chat
Completions route under llame's existing configuration, execution, telemetry,
and failure contracts. Destination selection, the operator-owned configuration
posture, credential non-disclosure, and the transport-neutral Chat identity are
owned by `provider-api-selection` and `instance-config`; this capability
specifies only what the Go gateway adds: a fixed destination for a key-only
entry, the conversation identity every request must carry including auxiliary
calls, client self-identification, the absence of client-side cache control,
the failure boundary with its accepted upstream shapes, unknown cost unless
the operator declares pricing, and the operator runbook.

## Requirements

### Requirement: Fixed transport for a key-only entry

An `opencode-go` provider entry SHALL execute the Chat Completions wire at the
endpoint fixed in llame's code, using the entry's own credential, and SHALL
accept no operator-supplied destination: the entry declares a `key` and no
endpoint field, and a configuration that supplies one SHALL fail at boot. The
credential SHALL be resolved once at startup through the existing interpolation
contract and SHALL never appear in a log, error, telemetry record, model
context, or owner-visible output. A `key` that resolves empty SHALL fail
startup naming the entry and the field, because the gateway authenticates every
request and a keyless Go entry is not a usable configuration. The client SHALL
reject redirects, so neither the credential nor the session header follows a
redirect off the fixed endpoint. Startup SHALL contact no endpoint and SHALL
validate no model's eligibility. No ambient environment variable SHALL move or
authenticate a request.

#### Scenario: An entry boots from its key alone

- **WHEN** an operator declares an `opencode-go` provider with a `key` that resolves nonblank
- **THEN** the entry is loaded and its models are executable against the fixed endpoint
- **AND** no other field is required to construct it

#### Scenario: The fixed endpoint is used whatever the entry is named

- **WHEN** a model resolves to an `opencode-go` provider whose `id` is anything the operator chose
- **THEN** the request is sent to the endpoint fixed in llame's code
- **AND** no `id`, ambient environment variable, or configuration value moves it

#### Scenario: A destination field fails at boot

- **WHEN** an `opencode-go` entry declares a `baseUrl` or any other endpoint field
- **THEN** startup fails naming the offending configuration path
- **AND** no request is ever issued with a substituted destination

#### Scenario: A missing credential fails at boot

- **WHEN** an `opencode-go` entry's `key` is absent, or resolves to empty through interpolation
- **THEN** startup fails naming the entry and the field without exposing a resolved value
- **AND** the entry is not loaded as keyless

#### Scenario: No endpoint is contacted at startup

- **WHEN** an instance with a valid `opencode-go` entry starts
- **THEN** startup completes without contacting the gateway
- **AND** an unreachable or invalid credential surfaces at request time, not at boot

#### Scenario: A redirect is not followed

- **WHEN** the fixed endpoint answers a request with a redirect
- **THEN** the request fails without sending the credential or the session header to the redirect destination

### Requirement: The provider identifies itself as `opencode-go` and composes options under its own namespace

A model client built for an `opencode-go` entry SHALL report `opencode-go` as its provider identifier in run events, telemetry, and model metadata, not the name of the wire module it is composed over. The operator's `models[].providerOptions` for such a model SHALL be composed under the namespace the Chat Completions adapter derives from that identifier, under the shipped fixed precedence, with the Chat Completions wire's reserved paths stripped exactly as for an `openai-completions` entry; no `opencode-go`-specific option key, default, or invariant is added.

#### Scenario: Runs record the Go provider identifier

- **WHEN** a run executes through an `opencode-go` model
- **THEN** its run events and telemetry name the provider `opencode-go`
- **AND** the wire module's own name does not appear as the provider

#### Scenario: Operator options reach the adapter under the Go namespace

- **WHEN** an `opencode-go` model entry declares `providerOptions`
- **THEN** the request carries them under the namespace the adapter derives from `opencode-go`
- **AND** a reserved Chat Completions path in that object is stripped before composition

### Requirement: Every request for a Chat carries its session identity

The client SHALL send the Chat's identity as the gateway's session header on
every language-model request it makes, including requests that are not the
conversation's main turn: the Chat's own identifier, sent verbatim, for the
main turn and for compaction, and the Chat's identifier under a `title:` prefix
for title generation. The value SHALL be the same for every request that
belongs to the same lane of the same Chat, and SHALL remain stable across
retries, worker restarts, compaction, and model switches within that Chat.
Because the identity is required on the model-client input contract, no
fallback value exists and no request can be made without it. The identity SHALL
NOT be treated as a secret; it is the Chat's own identifier, which llame already
records, and it SHALL NOT reach model context or persisted message parts and
SHALL add nothing to owner-visible output.

#### Scenario: The main turn carries the Chat identity

- **WHEN** a run streams its main turn through an `opencode-go` provider
- **THEN** the request carries the Chat's identifier in the session header
- **AND** the gateway accepts the request without a missing-session rejection

#### Scenario: Compaction carries the conversation's own identity

- **WHEN** a source-model compaction request is made for a Chat on the same provider
- **THEN** it carries the same session value as that Chat's main turn
- **AND** the summarization request can reuse the conversation's prefix identity

#### Scenario: Title generation carries the title lane

- **WHEN** the title service generates a title through an `opencode-go` provider
- **THEN** the request carries the Chat's identifier under the `title:` prefix
- **AND** a title failure leaves the completed answer unaffected under the existing title contract

#### Scenario: The identity survives a retry, a restart, and a compaction

- **WHEN** the same Chat's turn is retried, executed by a restarted worker, or preceded by a compaction
- **THEN** each request carries the same session value for that lane
- **AND** no request mints a new identity for an existing Chat

### Requirement: Requests identify llame as the client

The client SHALL send llame's product `User-Agent` as `provider-api-selection`
requires of every provider, and SHALL additionally send the gateway's client
header naming llame. It SHALL NOT send the gateway's request-identifier or
project headers, and SHALL NOT claim another product's client identity. Neither
header is a credential and neither carries owner, Chat, tenant, or credential
data.

#### Scenario: Both identity headers are sent

- **WHEN** a language-model request is made through an `opencode-go` provider
- **THEN** it carries llame's `User-Agent` and the gateway client header naming llame
- **AND** the gateway can attribute the request to llame

#### Scenario: No other gateway header is invented

- **WHEN** the request headers llame sends to the gateway are inspected
- **THEN** no request-identifier, project, or affinity header is present
- **AND** no header value names a different product

### Requirement: llame sends no cache control for this provider

The client SHALL send no cache-control field and no cache-breakpoint marker on
requests to this provider. Prompt caching is the gateway's own behavior, keyed
on the session identity the client sends; llame neither requests it, configures
it, nor counts breakpoints for this type. A request that observes no cache hit
SHALL remain a successful request.

#### Scenario: A request carries no cache control

- **WHEN** a language-model request is rendered for an `opencode-go` model
- **THEN** it carries no cache-control field and no cache-breakpoint marker authored by llame

#### Scenario: A reused prefix is served from the gateway's cache

- **WHEN** a Chat repeats a stable prefix within the gateway's cache window under the same session identity
- **THEN** the gateway reports the reuse in the usage it returns, where it exposes such a count
- **AND** llame records the reported usage as it does for any other provider

#### Scenario: No cache hit is not a failure

- **WHEN** a request is not served from the gateway's cache
- **THEN** the run completes normally
- **AND** the absence of a cache hit is not reported as an error

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
telemetry; a non-redirect failure body that is not the gateway's envelope
SHALL surface as the HTTP status text; a redirect response and a stream event
that is not JSON, does not match the wire's chunk shape, or carries an error
value without a string message SHALL surface as that contract's fixed texts,
which contain none of the redirect's `Location` value or of the event's
content. The parsed message MAY name request values the gateway chose to echo.
The system SHALL NOT validate a model's eligibility or route at boot, SHALL NOT
keep a compiled model, route, or capability table, SHALL NOT classify Go
failures into llame-owned error types or replace the gateway's parsed message
with a fixed one other than for a redirect response, SHALL NOT introduce a
quota ledger or a typed quota error, and SHALL NOT retry against or fall back
to another provider, wire, or model because a request failed. The operator
runbook SHALL record the accepted upstream shapes: a model the gateway's
format gate rejects fails with the gateway's "not supported for format"
message and its remedy, and a usage-limit rejection fails with the gateway's
message after the SDK's retries.

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

- **WHEN** the gateway's stream delivers an event that is not JSON, does not match the wire's chunk shape, or carries an error value without a string message
- **THEN** the run fails with the Chat Completions wire's fixed unreadable-event text
- **AND** none of that event's content appears in owner events, persisted errors, or the run's failure log line

#### Scenario: The runbook names the accepted upstream shapes

- **WHEN** the operator runbook for this provider is read
- **THEN** it states that a misdeclared model fails with the gateway's "not supported for format" message and names the remedy
- **AND** it states that a usage-limit rejection surfaces after the SDK's retries and that llame tracks no quota

### Requirement: Cost is unknown unless the operator declares pricing

When a model entry for this provider declares no `pricingUsdPer1M`, the system
SHALL record the usage and latency the provider reports with an unknown dollar
cost under the existing `costUsd: null` contract. When an operator declares
pricing, the system SHALL price the recorded usage at those declared rates,
which are llame's own accounting of a subscription quota rather than money paid
per token. The system SHALL NOT invent quota consumption or estimate cost from a
provider-side price table.

#### Scenario: An unpriced Go model records unknown cost

- **WHEN** a configured `opencode-go` model without declared pricing completes a request
- **THEN** the available usage and latency are recorded
- **AND** the dollar cost is null rather than zero or an estimate

#### Scenario: A declared price is used as authored

- **WHEN** an operator declares `pricingUsdPer1M` on an `opencode-go` model
- **THEN** the recorded cost uses those rates against the provider-reported usage
- **AND** the operator documentation states that the figure accounts for a subscription quota rather than a per-token bill

### Requirement: The operator runbook records the provider's ceiling and its divergence

An operator runbook SHALL document this provider: how to obtain and configure
the subscription credential, the fixed endpoint and the route ceiling of this
slice (the one model reachable only through a route llame does not yet use, and
the follow-up issue that owns it), the accepted upstream failure shapes, the
per-model privacy divergence inside the provider (retention and training terms
that differ between its models, with the models the example configuration
excludes), the subscription's usage windows, and the upstream overage toggle
llame can neither observe nor set.

#### Scenario: The runbook names the route ceiling

- **WHEN** the runbook is read
- **THEN** it names the route this slice uses, the model that route cannot reach, and the issue that owns per-model routing

#### Scenario: The runbook records the privacy divergence

- **WHEN** the runbook is read
- **THEN** it states that retention and training terms differ between models of this provider
- **AND** it names the models the shipped example configuration excludes and why

#### Scenario: The runbook records the quota and overage boundary

- **WHEN** the runbook is read
- **THEN** it describes the subscription's usage windows
- **AND** it states that the upstream overage toggle is outside llame's control
