# Spec Delta

## MODIFIED Requirements

### Requirement: Provider list configuration

The config file MUST accept a top-level `providers` array of duplicable
provider entries. Each entry MUST have a `type` that selects its shape. `id`
MUST be a nonblank operator-chosen string that is unique in the array.

`type` MUST select the client implementation and the wire API it speaks. The
schema MUST close `type` to the set of executable provider types:
`openai-responses`, `openai-completions`, `anthropic-messages`,
`openai-codex`, `opencode-go`, and `system-one`.

`openai-responses` MUST execute the Responses wire through `@ai-sdk/openai`.
`openai-completions` MUST execute the Chat Completions wire through
`@ai-sdk/openai-compatible`. `anthropic-messages` MUST execute the Messages
wire through `@ai-sdk/anthropic`. `openai-codex` MUST use the Codex
subscription backend. `opencode-go` MUST use the OpenCode Go subscription
gateway. That gateway MUST execute the Chat Completions wire at an endpoint
fixed in llame's code. `system-one` MUST execute the System One decision wire
at `{baseUrl}/systemone`.

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

The `system-one` variant MUST accept `{ id, type, key, baseUrl, billing?, headers? }`.
It MUST reject `accountId`. Its `key` and `baseUrl` MUST be strings with
`{env:…}` or `{path:…}` interpolation that resolve nonblank. The variant
MUST NOT load as keyless.

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

### Requirement: Operator configuration can bound grep walks

The configuration MUST accept an optional `tools.grep` object with the fields
`maxFilesExamined`, `maxEntriesListed`, `maxBytesRead`, `maxFileBytes`, and
`rerank`. An absent or `null` object sets no bound and no ranking.

Each numeric field MUST be `null` or a positive integer. An absent numeric
field is `null`, and `null` sets no bound. Each numeric field MUST accept the
numeric interpolation tokens that `tools.maxStepsPerRun` accepts. Zero, a
negative number, a fraction, or an unknown field MUST fail startup and name the
configuration path.

The optional `rerank` object MUST accept one field, `model`. `model` MUST name
a `decisionModels[].id` and MUST resolve nonblank. An absent `rerank`
object MUST mean no ranking. An unknown id or a blank `model` MUST fail startup
and name `tools.grep.rerank.model`.

#### Scenario: Absent grep bounds set no bound

- **WHEN** the file omits `tools.grep`, sets it to `null`, or sets each of its fields to `null`
- **THEN** startup succeeds and a grep walk has no file, entry, byte, or file-size bound

#### Scenario: A configured grep bound applies

- **WHEN** the file sets `tools.grep.maxBytesRead` to `33554432` and a scope holds 40 MiB of text with no match
- **THEN** the grep walk stops with a `byte_bound` warning after it took 32 MiB

#### Scenario: Zero is not read as unlimited

- **WHEN** `tools.grep.maxFilesExamined` resolves to `0`
- **THEN** startup fails and names `tools.grep.maxFilesExamined`

#### Scenario: An unknown grep field fails startup

- **WHEN** the file sets `tools.grep.deadlineSeconds`
- **THEN** startup fails and names the unknown configuration path

#### Scenario: The grep rerank block names a catalog entry

- **WHEN** the file sets `tools.grep.rerank.model` to an id in `decisionModels[]`
- **THEN** startup succeeds and `grep` can rank its file runs with that decision model

#### Scenario: An unknown grep rerank model fails startup

- **WHEN** the file sets `tools.grep.rerank.model` to an id that `decisionModels[]` does not define
- **THEN** startup fails and names `tools.grep.rerank.model`
- **AND** no walk ranks its results

#### Scenario: A blank grep rerank model fails startup

- **WHEN** the file sets `tools.grep.rerank.model` to a blank string or a value that resolves to blank
- **THEN** startup fails and names `tools.grep.rerank.model`
- **AND** no walk ranks its results

#### Scenario: An absent grep rerank block keeps walk order

- **WHEN** the file sets no `tools.grep.rerank` object
- **THEN** startup succeeds and every `grep` call keeps walk order

### Requirement: Operator configuration declares web search engines and a chain

The config file MUST accept an optional top-level `webSearch` object under the
closed published schema. The object MUST hold an `engines` array, a `chain`
array, an optional `fetchLimit`, and an optional `rerank`. Each engine MUST
have an `id` of 1 to 64 characters that is unique within `engines`, and a
`type` that selects its shape. `chain` MUST be a non-empty ordered list of
engine ids with no duplicate. The built-in default MUST be absent.

#### Scenario: Minimal configuration loads

- **WHEN** the file sets `webSearch` to one `brave` engine with id `brave`, a `key`, and `chain: ["brave"]`
- **THEN** startup succeeds with that engine as the only chain entry

#### Scenario: Unknown engine key fails startup

- **WHEN** a `brave` engine entry carries an unrecognized key `region`
- **THEN** startup fails and names the path of that key

#### Scenario: Duplicate engine id fails startup

- **WHEN** two `webSearch.engines` entries share the id `brave`
- **THEN** startup fails and names `webSearch.engines` and the duplicate id

## ADDED Requirements

### Requirement: Decision model catalog configuration

The config file MUST accept an optional top-level `decisionModels` array
beside `embeddingModels`. An absent array MUST mean that no decision model
exists. Each entry MUST be `{ id, provider, model }`.

#### Scenario: A decision model catalog loads

- **WHEN** the file declares one `decisionModels` entry with an `id`, a `provider` of `type: "system-one"`, and a `model`
- **THEN** startup succeeds with that entry in the catalog
- **AND** no endpoint receives a request

#### Scenario: An absent catalog is valid

- **WHEN** the file declares no `decisionModels` array
- **THEN** startup succeeds
- **AND** no tool ranks its results

### Requirement: Decision model catalog ids are unique

Each `decisionModels[].id` MUST be a nonblank string, and an id MUST be unique
in the array. A blank or duplicate id MUST fail startup and name the
affected array-index paths, never an interpolated value.

#### Scenario: A duplicate decision model id fails startup

- **WHEN** two `decisionModels` entries share the id `jev`
- **THEN** startup fails and names the two `decisionModels` array indices

#### Scenario: A blank decision model id fails startup

- **WHEN** a `decisionModels` entry has an `id` that is blank or resolves to blank
- **THEN** startup fails and names `decisionModels`

### Requirement: Decision model catalog entries name a System One provider

Each `decisionModels[].provider` MUST name a `providers[].id` of
`type: "system-one"`. An unknown provider, or a provider of another type, MUST
fail startup and name the array-index path, such as `decisionModels[0].provider`.

#### Scenario: An unknown decision model provider fails startup

- **WHEN** a `decisionModels` entry names a `provider` that `providers[]` does not define
- **THEN** startup fails and names `decisionModels[0].provider` for the first entry

#### Scenario: A decision model provider of another type fails startup

- **WHEN** a `decisionModels` entry names a provider of `type: "openai-completions"`
- **THEN** startup fails and names `decisionModels[0].provider` for the first entry
- **AND** no decision client is built

### Requirement: Decision model catalog entries carry a model

Each `decisionModels[].model` MUST be a nonblank string. A blank `model` MUST
fail startup and name the array-index path, such as `decisionModels[0].model`.

#### Scenario: A catalog entry carries a model id

- **WHEN** a `decisionModels` entry sets `model` to `jev-1.13`
- **THEN** startup succeeds and the provider receives that model id on every call
- **AND** the entry has no field for a price

#### Scenario: A blank decision model name fails startup

- **WHEN** a `decisionModels` entry has a `model` that is blank or resolves to blank
- **THEN** startup fails and names `decisionModels[0].model` for the first entry

### Requirement: Decision model catalog fields accept interpolation

`id`, `provider`, and `model` MUST accept `{env:…}` and `{path:…}`
interpolation. A field that resolves blank MUST fail startup and name its
array-index path. Diagnostics MUST NOT print interpolated catalog values.

#### Scenario: An interpolated provider id resolves at startup

- **WHEN** a `decisionModels` entry sets `provider` to `{env:DECISION_PROVIDER}` and the variable holds a System One provider id
- **THEN** startup succeeds and the entry binds to that provider

#### Scenario: An empty interpolation fails startup

- **WHEN** a `decisionModels` entry sets `model` to `{env:DECISION_MODEL:-}` and the variable is unset
- **THEN** startup fails and names `decisionModels[0].model` for the first entry

### Requirement: Decision models stay server-only

`decisionModels` MUST be server-only. `GET /api/v1/models` MUST NOT return
decision-catalog entries or their fields. A chat-catalog entry with the same
opaque id MUST remain eligible for that endpoint.

#### Scenario: Decision models are absent from the model list

- **WHEN** the file declares a `decisionModels` entry and an authenticated caller reads `GET /api/v1/models`
- **THEN** the response lists the chat models and no decision model

#### Scenario: A catalog id resembles a secret

- **WHEN** the first decision entry's id resolves from an environment variable and its provider is invalid
- **THEN** the diagnostic names `decisionModels[0].provider` and contains no resolved catalog value

#### Scenario: Catalogs share an opaque id

- **WHEN** chat and decision catalogs both have an entry with id `shared`
- **THEN** the endpoint returns only the chat entry, without decision fields

### Requirement: Web search rerank configuration

The optional `webSearch.rerank` object MUST accept one field, `model`. `model`
MUST name a `decisionModels[].id` and MUST resolve nonblank. An absent
`rerank` object MUST mean no ranking. An unknown id or a blank `model` MUST
fail startup and name `webSearch.rerank.model`.

#### Scenario: The web search rerank block names a catalog entry

- **WHEN** the file sets `webSearch.rerank.model` to an id in `decisionModels[]`
- **THEN** startup succeeds and `web_search` can rank the results of its calls with that decision model

#### Scenario: An unknown web search rerank model fails startup

- **WHEN** the file sets `webSearch.rerank.model` to an id that `decisionModels[]` does not define
- **THEN** startup fails and names `webSearch.rerank.model`
- **AND** no call ranks its results

#### Scenario: A blank web search rerank model fails startup

- **WHEN** the file sets `webSearch.rerank.model` to a blank string or a value that resolves to blank
- **THEN** startup fails and names `webSearch.rerank.model`
- **AND** no call ranks its results

#### Scenario: An absent web search rerank block keeps engine order

- **WHEN** the file sets no `webSearch.rerank` object
- **THEN** startup succeeds and every `web_search` result keeps engine order

### Requirement: A model entry cannot name a decision provider

A `models[]` entry or an `embeddingModels[]` entry MUST NOT name a provider of
`type: "system-one"`. Startup MUST fail and name `models[<id>].provider` or
`embeddingModels[<id>].provider` and the provider type.

#### Scenario: A chat model names a decision provider

- **WHEN** a `models[]` entry sets `provider` to a `system-one` provider
- **THEN** startup fails and names `models[<id>].provider` and the type `system-one`
- **AND** no chat client is built for that entry

#### Scenario: An embedding model names a decision provider

- **WHEN** an `embeddingModels[]` entry sets `provider` to a `system-one` provider
- **THEN** startup fails and names `embeddingModels[<id>].provider` and the type `system-one`
- **AND** no partial catalog applies
