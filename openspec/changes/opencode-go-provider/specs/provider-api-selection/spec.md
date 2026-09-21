## MODIFIED Requirements

### Requirement: Provider type selects the wire API

A provider entry with `type: "openai-responses"` SHALL execute against the OpenAI Responses wire at its configured `baseUrl` (default: the OpenAI API); an entry with `type: "openai-completions"` SHALL execute against the Chat Completions wire at its configured `baseUrl`; an entry with `type: "anthropic-messages"` SHALL execute against the Anthropic Messages wire at its configured `baseUrl` (default: the Anthropic API); an entry with `type: "opencode-go"` SHALL execute against the Chat Completions wire at the endpoint fixed in llame's code, which its entry cannot override because it declares no endpoint field. Every language-model request llame makes on behalf of that entry — streaming chat, structured generation, and compaction — SHALL use the entry's declared wire. Embedding requests are wire-independent and are exempt: an entry of either OpenAI wire type may back an embedding model, and its embedding calls are not routed by wire. The provider's `id` SHALL NOT select or alter the wire, and no wire behavior SHALL be inferred from an entry's `id`, its `baseUrl`, or any host matching. An entry whose endpoint does not serve its declared wire SHALL be used exactly as authored: startup SHALL succeed, the entry SHALL NOT be migrated, reinterpreted, or re-pointed, and the resulting failure SHALL appear at request time under the existing failure contract rather than as a boot failure, a silent retarget, or a silent rewrite of the request.

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

#### Scenario: An OpenCode Go-typed provider uses Chat Completions at the fixed endpoint

- **WHEN** a model resolves to a `type: "opencode-go"` provider
- **THEN** the request is sent in the Chat Completions shape to the endpoint fixed in llame's code
- **AND** the entry supplies no destination of its own, so no `baseUrl`, `id`, or ambient environment variable can move the request

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
- **THEN** the request is sent on that entry's declared wire using that wire's own structured-generation mechanism (a forced tool choice on the OpenAI wires, the adapter's structured-output path on the Messages wire)
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

### Requirement: Every provider request identifies llame

Every language-model request llame makes on behalf of any provider entry SHALL carry a `User-Agent` whose value names llame and llame's version, taken from the API package's own version. The value SHALL NOT be the adapter's or SDK's identifier alone: a provider that inspects the header SHALL see llame's product token, not a bare HTTP library or SDK name. llame SHALL NOT claim another product's client identity on any request, and SHALL NOT let a model entry or an operator override the identity through `providerOptions` or any other configuration surface. The identity is a product token, never a credential: it carries no key, account, owner, Chat, or tenant value, and it SHALL NOT be derived from any of them. An adapter that appends its own token after llame's is out of llame's control and does not violate this requirement.

#### Scenario: A request from any provider type carries the identity

- **WHEN** a language-model request is made through an entry of any executable provider type
- **THEN** the request carries the llame identity header
- **AND** the same value is sent whichever type, wire, or endpoint served the request

#### Scenario: The identity names llame and its version

- **WHEN** a request's `User-Agent` value is inspected
- **THEN** it begins with llame's product token and the API package's version
- **AND** it is never the adapter's or SDK's identifier alone

### Requirement: Language-model requests carry the Chat identity

Both model-client input contracts — the streaming input and the structured-generation input — SHALL carry a required, transport-neutral Chat identity: the Chat's identifier and the lane the request belongs to, where the lane is `main` or `title`. The field SHALL be required, so every call site supplies it and the type checker enumerates every construction site rather than allowing a default. Call sites SHALL supply facts only, never a rendered header value or a transport name: each client renders the identity in the form its own provider requires, or ignores it entirely when it has no consumer. The main turn and every compaction path SHALL send the `main` lane, because compaction reuses the conversation's own prefix; title generation SHALL send the `title` lane. The value SHALL be stable across retries, worker restarts, compaction, and model switches within the same Chat. The identity is not a credential: it is the Chat's own identifier, which llame already records, and it SHALL NOT reach model context or persisted message parts and SHALL add nothing to owner-visible output.

#### Scenario: The main turn and compaction carry the main lane

- **WHEN** a run's streaming request and a compaction request for the same Chat are made
- **THEN** both carry that Chat's identifier under the `main` lane
- **AND** the value is the same for both, so the compaction request can reuse the conversation's prefix identity

#### Scenario: Title generation carries the title lane

- **WHEN** the title service generates a title for a Chat
- **THEN** its request carries that Chat's identifier under the `title` lane
- **AND** a client that renders the lane distinguishes it from the Chat's main-lane requests

#### Scenario: A client with no consumer sends nothing extra

- **WHEN** a request is made through a client whose provider has no use for the Chat identity
- **THEN** the request carries no additional header or body field derived from the identity
- **AND** the request is otherwise unchanged from the same request made before this field existed

#### Scenario: The identity is not a credential

- **WHEN** the identity is supplied to a client and the request is inspected
- **THEN** the identity value appears only in the provider-bound header the client renders
- **AND** it appears in no model context or persisted part, and adds nothing to owner-visible output
