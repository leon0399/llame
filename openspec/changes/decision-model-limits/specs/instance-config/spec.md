## MODIFIED Requirements

### Requirement: Provider list configuration

The config file MUST accept a top-level `providers` array of duplicable
provider entries. Each entry MUST have a `type` that selects its shape. `id`
MUST be a nonblank operator-chosen string that is unique in the array.

`type` MUST select the client implementation and the wire API it speaks. The
schema MUST close `type` to the set of executable provider types:
`openai-responses`, `openai-completions`, `anthropic-messages`,
`openai-codex`, `opencode-go`, `system-one`, and `cohere-rerank`.

`openai-responses` MUST execute the Responses wire through `@ai-sdk/openai`.
`openai-completions` MUST execute the Chat Completions wire through
`@ai-sdk/openai-compatible`. `anthropic-messages` MUST execute the Messages
wire through `@ai-sdk/anthropic`. `openai-codex` MUST use the Codex
subscription backend. `opencode-go` MUST use the OpenCode Go subscription
gateway. That gateway MUST execute the Chat Completions wire at an endpoint
fixed in llame's code. `system-one` MUST execute the System One decision wire
at `{baseUrl}/systemone`. `cohere-rerank` MUST execute the Cohere v2 rerank
wire at `{baseUrl}/rerank` through `@ai-sdk/cohere`.

The `openai-responses` variant MUST accept `{ id, type, key?, baseUrl?,
billing?, headers? }`, and `baseUrl` MUST default to the OpenAI API. The
`openai-completions` variant MUST accept `{ id, type, key?, baseUrl, billing?,
headers? }`, and `baseUrl` MUST be present. The `anthropic-messages` variant
MUST accept `{ id, type, key?, baseUrl?, billing?, headers? }`, and `baseUrl`
MUST default to the Anthropic API.

The `opencode-go` variant MUST accept `{ id, type, key, billing?, headers? }`
and MUST NOT accept another field. It MUST reject `baseUrl` and `accountId` at
boot. Its `key` MUST be a string with `{env:…}` or `{path:…}` interpolation
that resolves nonblank.

The `system-one` variant MUST accept `{ id, type, key, baseUrl, billing?, headers?,
maxConcurrentRequests? }`. It MUST reject `accountId`. Its `key` and `baseUrl`
MUST be strings with `{env:…}` or `{path:…}` interpolation that resolve
nonblank. The variant MUST NOT load as keyless. `maxConcurrentRequests` MUST
be a positive integer, or a whole-value interpolation that resolves to one.

The `cohere-rerank` variant MUST accept `{ id, type, key?, baseUrl?, billing?,
headers? }`, and `baseUrl` MUST default to `https://api.cohere.com/v2`. It MUST
reject `accountId`. Its `key` and `baseUrl` MUST accept `{env:…}` and
`{path:…}`. A `key` that resolves to empty MUST mark it keyless. A keyless
entry MUST set `baseUrl`. A present `baseUrl` that resolves blank MUST fail
startup and name the field.

For `openai-responses`, `openai-completions`, and `anthropic-messages`, `key`
and `baseUrl` MUST be strings with `{env:…}` or `{path:…}` interpolation. A
`key` that resolves to empty MUST mark the provider **keyless**, with no
credential. An empty resolution MUST keep the unset meaning.

A duplicate `id` MUST fail startup and name the entry. A `type` outside the
schema set MUST fail startup and name the entry. The set MUST exclude the
retired `"openai"` and a bare `"anthropic"`.

The optional `billing` key on every variant is defined by the billing-mode
requirement below. The optional `headers` key on every variant is defined by
the `provider-request-headers` capability.

Resolved `key` values MUST NOT appear in logs, errors, or diagnostics. A
load-time error on a provider field MUST name the entry by `id` and the field
name, and MUST NOT show the resolved value.

The `openai-codex` variant MUST require `{ id, type, key, accountId }` and can
declare `billing` and `headers`. Its `key` and `accountId` MUST resolve to
nonblank strings and MUST support interpolation. It MUST reject `baseUrl`.
Resolved `accountId` values MUST have the same non-disclosure protection as
credentials.

An embedding model entry MUST NOT reference an `openai-codex`,
`anthropic-messages`, or `opencode-go` provider.

#### Scenario: Duplicable providers of the same type coexist

- **WHEN** the file defines two providers of the same `type` with different ids
- **THEN** both load as different providers keyed by `id`
- **AND** startup succeeds

#### Scenario: Unsupported provider type fails at boot

- **WHEN** a provider entry sets `type` to a value outside the schema set (e.g. the retired `"openai"`, or a bare `"anthropic"`)
- **THEN** startup fails and names the entry and the invalid `type`

#### Scenario: OpenAI-completions provider loads by shape

- **WHEN** the file defines a `type: "openai-completions"` provider with a `baseUrl` and a `key` that resolves to empty
- **THEN** it loads as a keyless provider for that base URL
- **AND** startup succeeds and contacts no endpoint

#### Scenario: OpenAI-completions provider requires a base URL

- **WHEN** the file defines a `type: "openai-completions"` provider with no `baseUrl`, or with a `baseUrl` that resolves to empty
- **THEN** startup fails and names the entry and the `baseUrl` field

#### Scenario: Anthropic provider loads by shape

- **WHEN** the file defines an `anthropic-messages` provider with no `baseUrl`
- **AND** another such provider targets a non-Anthropic host with a `key` that resolves to empty
- **THEN** both load as different providers keyed by `id`
- **AND** the first provider targets the Anthropic API, and the second provider stays keyless against its authored base URL
- **AND** startup succeeds and contacts no endpoint

#### Scenario: OpenCode Go provider loads by shape

- **WHEN** the file defines a `type: "opencode-go"` provider with a `key` that resolves nonblank
- **THEN** it loads as a provider keyed by `id` with its resolved key, and with no endpoint field of its own
- **AND** startup succeeds and contacts no gateway

#### Scenario: OpenCode Go provider rejects a base URL

- **WHEN** the file defines a `type: "opencode-go"` provider that also sets `baseUrl`
- **THEN** startup fails and names the offending configuration path
- **AND** the entry never loads with the field ignored, and no endpoint receives a request

#### Scenario: OpenCode Go provider requires a non-empty key

- **WHEN** the file defines a `type: "opencode-go"` provider whose `key` is absent, or resolves to empty through interpolation
- **THEN** startup fails and names the entry and the `key` field
- **AND** the provider never loads as keyless, because the gateway authenticates every request

#### Scenario: Keyless provider

- **WHEN** an `openai-completions` provider has `key: "{env:OLLAMA_API_KEY:-}"` and `OLLAMA_API_KEY` is unset
- **THEN** the provider loads as keyless
- **AND** startup succeeds

#### Scenario: Provider key is never exposed

- **WHEN** a provider `key` resolves to a credential
- **THEN** the resolved value appears in no log line, error, or diagnostic output
- **AND** an error about that entry names it by `id` and field, not by value

#### Scenario: Codex credentials resolve at startup

- **WHEN** a Codex provider has nonblank access token and account ID references
- **THEN** each API process and worker process loads them once at startup
- **AND** its provider is available through the model catalog, with no network authentication probe

#### Scenario: Missing or invalid Codex configuration

- **WHEN** a Codex entry has an absent credential file, invalid JSON or pointer, a blank resolved credential, or a forbidden endpoint field
- **THEN** startup fails with a diagnostic that names the field, and shows no resolved value and no file content

#### Scenario: Subscription provider cannot back embeddings

- **WHEN** an embedding model entry references a Codex provider
- **THEN** startup fails and identifies the unsupported provider binding

#### Scenario: Anthropic provider cannot back embeddings

- **WHEN** an embedding model entry references an `anthropic-messages` provider
- **THEN** startup fails and identifies the unsupported provider binding

#### Scenario: OpenCode Go provider cannot back embeddings

- **WHEN** an embedding model entry references an `opencode-go` provider
- **THEN** startup fails and identifies the unsupported provider binding
- **AND** no partial catalog applies

#### Scenario: System One provider loads by shape

- **WHEN** the file defines a `type: "system-one"` provider with a `key` and a `baseUrl` that resolve nonblank
- **THEN** it loads as a provider keyed by `id` for the System One decision wire
- **AND** startup succeeds and contacts no endpoint

#### Scenario: System One provider requires a key and a base URL

- **WHEN** the file defines a `type: "system-one"` provider with no `key`, no `baseUrl`, or a field that resolves to empty
- **THEN** startup fails and names the entry and that field
- **AND** the provider never loads as keyless, because the endpoint authenticates every request

#### Scenario: System One provider rejects an account ID

- **WHEN** the file defines a `type: "system-one"` provider that also sets `accountId`
- **THEN** startup fails and names the offending configuration path
- **AND** the entry does not load

#### Scenario: System One provider sets an invalid concurrency bound

- **WHEN** a `system-one` provider sets `maxConcurrentRequests` to `0`, to `2.5`, or to a value that resolves to a non-integer
- **THEN** startup fails and names the entry and `maxConcurrentRequests`

#### Scenario: A rerank provider with an account id fails startup

- **WHEN** the file defines a `type: "cohere-rerank"` provider that also sets `accountId`
- **THEN** startup fails and names the entry and `accountId`

#### Scenario: A rerank provider base URL resolves blank

- **WHEN** a `cohere-rerank` entry sets `baseUrl` to `{env:RERANK_URL:-}` and the variable is unset
- **THEN** startup fails and names the entry and `baseUrl`
- **AND** no request goes to the default Cohere URL

### Requirement: Decision model catalog configuration

The config file MUST accept an optional top-level `decisionModels` array
beside `embeddingModels`. An absent array MUST mean that no decision model
exists. Each entry MUST be `{ id, provider, model, limits? }`. `limits` MUST
accept only `perQuestionContextTokens`, `perRequestContextTokens`, and
`maxQuestionsPerRequest`. Each limit MUST be a positive integer, or a
whole-value interpolation that resolves to one. When an entry declares both
token limits, the per-question limit MUST NOT exceed the per-request limit. An
invalid limit MUST fail startup and name its array-index path.

#### Scenario: A decision model catalog loads

- **WHEN** the file declares one `decisionModels` entry with an `id`, a `provider` of `type: "system-one"`, and a `model`
- **THEN** startup succeeds with that entry in the catalog
- **AND** no endpoint receives a request

#### Scenario: An absent catalog is valid

- **WHEN** the file declares no `decisionModels` array
- **THEN** startup succeeds
- **AND** no tool ranks its results

#### Scenario: A catalog entry declares limits

- **WHEN** a `decisionModels` entry sets `limits` to `{ perQuestionContextTokens: 1024, maxQuestionsPerRequest: 16 }`
- **THEN** startup succeeds
- **AND** the entry uses the default per-request limit

#### Scenario: A catalog entry declares an invalid limit

- **WHEN** the first `decisionModels` entry sets `limits.perRequestContextTokens` to `-1`, or sets an unknown `limits` field
- **THEN** startup fails and names the `decisionModels[0].limits` path

#### Scenario: A per-question limit exceeds the per-request limit

- **WHEN** the first `decisionModels` entry sets `perQuestionContextTokens: 65536` and `perRequestContextTokens: 32768`
- **THEN** startup fails and names the `decisionModels[0].limits` path
