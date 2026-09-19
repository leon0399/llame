## MODIFIED Requirements

### Requirement: Provider type selects the wire API

A provider entry with `type: "openai-responses"` SHALL execute against the OpenAI Responses wire at its configured `baseUrl` (default: the OpenAI API); an entry with `type: "openai-completions"` SHALL execute against the Chat Completions wire at its configured `baseUrl`; an entry with `type: "anthropic-messages"` SHALL execute against the Anthropic Messages wire at its configured `baseUrl` (default: the Anthropic API). Every language-model request llame makes on behalf of that entry — streaming chat, structured generation, and compaction — SHALL use the entry's declared wire. Embedding requests are wire-independent and are exempt: an entry of either OpenAI wire type may back an embedding model, and its embedding calls are not routed by wire. The provider's `id` SHALL NOT select or alter the wire, and no wire behavior SHALL be inferred from an entry's `id`, its `baseUrl`, or any host matching. An entry whose endpoint does not serve its declared wire SHALL be used exactly as authored: startup SHALL succeed, the entry SHALL NOT be migrated, reinterpreted, or re-pointed, and the resulting failure SHALL appear at request time under the existing failure contract rather than as a boot failure, a silent retarget, or a silent rewrite of the request.

#### Scenario: A Responses-typed provider uses the Responses wire whatever its id

- **WHEN** a scheduled run's model resolves to a `type: "openai-responses"` provider whose `id` is not `openai`
- **THEN** the request uses the Responses wire
- **AND** reasoning summary behavior is not lost to an id-dependent branch

#### Scenario: A completions-typed provider uses Chat Completions

- **WHEN** a model resolves to a `type: "openai-completions"` provider
- **THEN** the request is sent in the Chat Completions shape to that provider's `baseUrl`
- **AND** no Responses-only request field is sent

#### Scenario: A Messages-typed provider uses the Messages wire

- **WHEN** a model resolves to a `type: "anthropic-messages"` provider that sets no `baseUrl`
- **THEN** the request is sent in the Messages shape to the Anthropic API
- **AND** the response streams under the existing run contract

#### Scenario: A Responses-typed provider may name a non-OpenAI endpoint

- **WHEN** a `type: "openai-responses"` provider's `baseUrl` names a local or third-party server that serves `/v1/responses`
- **THEN** the request uses the Responses wire at that base URL
- **AND** llame neither validates nor warns about the host

#### Scenario: A Messages-typed provider may name a non-Anthropic endpoint

- **WHEN** a `type: "anthropic-messages"` provider's `baseUrl` names a proxy, gateway, or third-party server that serves `/v1/messages`
- **THEN** the request uses the Messages wire at that base URL
- **AND** llame neither validates nor warns about the host, and the destination is not rewritten to the Anthropic API

#### Scenario: An id or base URL does not select the wire

- **WHEN** a provider's `id` or `baseUrl` suggests a different wire than the entry's `type`
- **THEN** the wire is selected by `type` alone

#### Scenario: Structured generation follows the declared wire

- **WHEN** a caller requests schema-constrained structured generation (e.g. a chat title) through a provider entry
- **THEN** the request is sent on that entry's declared wire using that wire's own structured-generation mechanism (a forced tool choice on the OpenAI wires, the native output format on the Messages wire)
- **AND** a rejection falls through to the caller's existing fallback rather than another wire

#### Scenario: Embedding requests are exempt from wire selection

- **WHEN** an `openai-completions` entry backs an embedding model
- **THEN** its embedding requests are issued against the same endpoint without following the entry's language-model wire
- **AND** no wire mismatch is reported for them

#### Scenario: A mismatched configuration fails at request time

- **WHEN** an endpoint does not serve the wire its provider's `type` names
- **THEN** startup succeeds
- **AND** the failure appears at request time under the existing failure contract
- **AND** the request is neither silently rewritten nor retargeted

## ADDED Requirements

### Requirement: Model provider options are forwarded under a fixed precedence

Every language-model request llame makes on behalf of a model entry SHALL carry that entry's retained `providerOptions` in the provider-options namespace its provider `type` selects, so the same catalog field configures every adapter and no provider gets a field of its own. The effective options SHALL be composed from four layers, highest precedence first: invariants a client requires for correctness (for example the Codex transport's non-stored responses and the Anthropic thinking prefix-mismatch behavior); the run's resolved effort, placed in the adapter's effort option; the entry's `providerOptions`; and the client's documented defaults. Object-valued options SHALL merge key by key across layers, and any other value SHALL replace the value below it. An operator value of `null` SHALL remove the client default at that key, and SHALL NOT remove an invariant. The system SHALL NOT validate `providerOptions` keys or values against the adapter or the provider at boot. At request time, a value the adapter recognizes but rejects SHALL fail the request explicitly under the existing failure contract; a key the adapter does not recognize is handled by the adapter alone, which MAY drop it or forward it to the endpoint, and SHALL NOT be used by llame to retarget, rewrite, or silently downgrade the request.

#### Scenario: Operator options reach the provider namespace

- **WHEN** a model entry declares `providerOptions` and a run executes through it
- **THEN** each of its language-model requests carries those options under the namespace of the adapter the provider `type` selects
- **AND** the same catalog field is honored by every executable type

#### Scenario: The run's effort takes precedence over an operator effort option

- **WHEN** a model entry's `providerOptions` sets the adapter's effort option and the run resolves an effort from the entry's declared vocabulary
- **THEN** the request carries the run's resolved effort in that option

#### Scenario: An invariant cannot be overridden

- **WHEN** a model entry's `providerOptions` sets, or sets to `null`, an option a client requires for correctness
- **THEN** the request carries the client's invariant value
- **AND** the operator value at that key is not sent

#### Scenario: A null removes a client default

- **WHEN** a model entry's `providerOptions` sets a key the client would otherwise default to `null`
- **THEN** the request omits that key entirely
- **AND** no default is substituted

#### Scenario: Object-valued options merge with defaults

- **WHEN** a client defaults an object-valued option and the entry's `providerOptions` sets a subset of that object's keys
- **THEN** the request carries the operator's keys with the client's remaining keys
- **AND** an invariant key inside that object keeps its invariant value

#### Scenario: An invalid option value fails at request time

- **WHEN** a model entry's `providerOptions` carries a value the adapter recognizes and rejects
- **THEN** startup succeeded earlier without validating it
- **AND** the request fails explicitly under the existing failure contract rather than being sent without the option

#### Scenario: An unknown option key does not fail boot or retarget the request

- **WHEN** a model entry's `providerOptions` carries a key the adapter does not recognize
- **THEN** startup succeeds
- **AND** the adapter alone decides whether the key is dropped or forwarded, and llame neither rewrites nor retargets the request because of it
