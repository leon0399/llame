## Purpose

Execute OpenCode Go's subscription models through the gateway's Chat
Completions route under llame's existing configuration, execution, telemetry,
and failure contracts. Destination selection, the operator-owned configuration
posture, credential non-disclosure, and the transport-neutral Chat identity are
owned by `provider-api-selection` and `instance-config`; this capability
specifies only what the Go gateway adds: a fixed destination for a key-only
entry, the conversation identity every request must carry including auxiliary
calls, client self-identification, the absence of client-side cache control,
the failure boundary with its accepted upstream misreports, unknown cost unless
the operator declares pricing, and the operator runbook.

## ADDED Requirements

### Requirement: Fixed transport for a key-only entry

An `opencode-go` provider entry SHALL execute the Chat Completions wire at the
endpoint fixed in llame's code, using the entry's own credential, and SHALL
accept no operator-supplied destination: the entry declares a `key` and no
endpoint field, and a configuration that supplies one SHALL fail at boot. The
credential SHALL be resolved once at startup through the existing interpolation
contract and SHALL never appear in a log, error, telemetry record, model
context, or owner-visible output. A `key` that resolves empty SHALL fail
startup naming the entry and the field, because the gateway authenticates every
request and a keyless Go entry is not a usable configuration. Startup SHALL
contact no endpoint and SHALL validate no model's eligibility.

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

### Requirement: Every request for a Chat carries its session identity

The client SHALL send the Chat's identity as the gateway's session header on
every language-model request it makes, including requests that are not the
conversation's main turn: the Chat's own identifier, sent verbatim, for the
main turn and for compaction, and the Chat's identifier with a `title` suffix
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
- **THEN** the request carries the Chat's identifier with the `title` suffix
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
existing failure contract, with sanitized diagnostics and no credential,
workspace, or account disclosure. The system SHALL NOT validate a model's
eligibility or route at boot, SHALL NOT keep a compiled model, route, or
capability table, SHALL NOT classify Go failures into llame-owned error types,
SHALL NOT introduce a quota ledger or a typed quota error, and SHALL NOT retry
or fall back to another provider, wire, or model because a request failed. The
operator runbook SHALL record the two accepted upstream misreports: a model the
gateway's format gate rejects arrives as an authentication-shaped failure whose
body names the unsupported format, and a request that lacks the session header
surfaces on some models as a model-unavailability failure instead of a named
session error.

#### Scenario: A rejected model surfaces at request time

- **WHEN** a configured model is not accepted by the gateway's format gate for the route llame uses
- **THEN** startup already succeeded without checking eligibility
- **AND** the request fails at request time with the gateway's own bounded diagnostic
- **AND** no other provider, wire, or model is tried in its place

#### Scenario: A quota rejection is reported without inventing state

- **WHEN** the gateway rejects a request because a usage limit is exhausted
- **THEN** the affected request fails under the existing failure and retry rules with a sanitized diagnostic
- **AND** llame reports no quota state of its own and claims no cost
- **AND** no paid fallback is attempted

#### Scenario: Diagnostics stay secret-free

- **WHEN** the gateway echoes credential, account, workspace, or request details in a failure
- **THEN** owner events, persisted errors, logs, and telemetry contain only sanitized diagnostics

#### Scenario: The runbook names the accepted misreports

- **WHEN** the operator runbook for this provider is read
- **THEN** it states that a rejected model reads as an authentication failure and names the body field that identifies it
- **AND** it states that a missing session header surfaces on some models as a model-unavailability failure

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
the follow-up issue that owns it), the two accepted misreported failures, the
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
