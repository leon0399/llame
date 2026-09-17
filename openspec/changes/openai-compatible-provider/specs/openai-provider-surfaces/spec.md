## Purpose

Select which OpenAI API surface a provider talks to from the provider's declared
`type` alone, and expose reasoning and schema-constrained output on both the
Responses and Chat Completions surfaces.

## ADDED Requirements

### Requirement: Provider type selects the OpenAI API surface

A model whose provider entry has `type: "openai"` SHALL execute against the official OpenAI API on the Responses surface; a `baseUrl` on such an entry names a proxy in front of OpenAI, not another vendor. A provider with `type: "openai-compatible"` SHALL execute against the Chat Completions surface at its configured endpoint. The provider's `id` SHALL NOT select or alter the surface, and no behavior SHALL be inferred from an entry's `id`, its `baseUrl`, or any host matching. No boot-time validation, warning, migration, or reinterpretation SHALL apply to an entry configured against the wrong surface: it is used exactly as authored, and any resulting failure appears at request time under the existing failure contract rather than as a boot failure, a silent retarget, or a silent rewrite of the request.

#### Scenario: A native provider uses Responses whatever its id

- **WHEN** a scheduled run's model resolves to a `type: "openai"` provider whose `id` is not `openai`
- **THEN** the request uses the Responses surface
- **AND** reasoning summary behavior is not lost to an id-dependent branch

#### Scenario: A compatible provider uses Chat Completions

- **WHEN** a model resolves to a `type: "openai-compatible"` provider
- **THEN** the request is sent in the Chat Completions shape to that provider's endpoint
- **AND** no Responses-only request field is sent

#### Scenario: An id or base URL does not select the surface

- **WHEN** a provider's `id` or `baseUrl` suggests a different surface than the entry's `type`
- **THEN** the surface is selected by `type` alone

#### Scenario: Two providers of the same type route independently

- **WHEN** two models name two distinct providers of the same OpenAI type
- **THEN** each executes against its own provider's endpoint and credential

#### Scenario: A mismatched configuration fails at request time

- **WHEN** an endpoint does not serve the surface its provider's `type` names
- **THEN** startup succeeds and no warning about the mismatch is emitted
- **AND** the failure appears at request time under the existing failure contract
- **AND** the request is neither silently rewritten nor retargeted

#### Scenario: An existing OpenAI-typed entry is used exactly as authored

- **WHEN** an entry that reached Chat Completions before this change keeps `type: "openai"`
- **THEN** its requests now use the Responses surface
- **AND** it is not migrated, warned about, or re-pointed

### Requirement: Reasoning is normalized on both OpenAI surfaces

Reasoning content that the surface's selected adapter normalizes SHALL be surfaced as the existing normalized reasoning output, and reasoning the adapter produced for a turn SHALL be returned on that turn's own follow-up requests. The system SHALL NOT add vendor-specific reasoning request fields, raw SSE parsing, tag extraction, or middleware to obtain it. A response that carries no reasoning SHALL remain a successful response.

#### Scenario: Compatible backend reasoning is displayed

- **WHEN** an OpenAI-compatible endpoint emits reasoning an adapter normalizes
- **THEN** the run collects and persists it under the existing reasoning contract
- **AND** no llame-authored parser is involved

#### Scenario: The turn's follow-up request carries prior reasoning

- **WHEN** a turn's follow-up request follows a response that carried reasoning
- **THEN** the reasoning the adapter produced for that turn is sent back to the endpoint

#### Scenario: No reasoning output is not a failure

- **WHEN** a response contains no displayable reasoning
- **THEN** the run completes normally

### Requirement: Schema-constrained output is not silently downgraded

A schema-constrained generation request SHALL reach an `openai-compatible` provider as schema-constrained output rather than being silently degraded to an unconstrained JSON mode. A provider that rejects that form SHALL fail the affected request under the existing failure contract instead of falling back to a weaker generation path.

#### Scenario: A schema-constrained request carries the schema

- **WHEN** a caller requests a schema-constrained object through an `openai-compatible` provider
- **THEN** the outgoing request declares the schema
- **AND** it is not reduced to an unconstrained JSON mode

#### Scenario: A rejection is not hidden

- **WHEN** the endpoint rejects the schema-constrained form
- **THEN** the request fails with a bounded diagnostic
- **AND** no unconstrained fallback is attempted silently
