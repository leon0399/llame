## MODIFIED Requirements

### Requirement: Provider list configuration

The config file SHALL support a top-level `providers` array of duplicable provider entries, discriminated by `type`. `id` SHALL be a non-empty operator-chosen identifier, unique within the array. `type` SHALL select the client implementation and the wire API it speaks, and SHALL be constrained by the schema to the set of executable provider types (`"openai-responses"` for the Responses wire through `@ai-sdk/openai`; `"openai-completions"` for the Chat Completions wire through `@ai-sdk/openai-compatible`; `"anthropic-messages"` for the Messages wire through `@ai-sdk/anthropic`; `"openai-codex"` for the Codex subscription backend). The `openai-responses` variant SHALL accept `{ id, type, key?, baseUrl? }`, with `baseUrl` defaulting to the OpenAI API; the `openai-completions` variant SHALL accept `{ id, type, key?, baseUrl }`, with `baseUrl` required; the `anthropic-messages` variant SHALL accept `{ id, type, key?, baseUrl? }`, with `baseUrl` defaulting to the Anthropic API. For all three wire types, `key` and `baseUrl` SHALL be strings supporting `{env:…}`/`{path:…}` interpolation, and a `key` that resolves to empty SHALL mark the provider **keyless** (no credential), preserving the empty-resolution-means-unset semantics. Duplicate ids, or a `type` outside the schema enum (including the retired `"openai"` and a bare `"anthropic"`), SHALL fail startup naming the offending entry.

Resolved `key` values SHALL never be written to logs, errors, or diagnostics; a load-time error on a provider field SHALL identify the entry by `id` and the field name, never the resolved value.

The `openai-codex` variant SHALL require `{ id, type, key, accountId }`, with nonblank resolved strings for `key` and `accountId`, supporting existing interpolation. It SHALL reject `baseUrl` and arbitrary headers. Resolved `accountId` values SHALL receive the same non-disclosure protections as credentials. Embedding model entries SHALL NOT reference an `openai-codex` or `anthropic-messages` provider.

#### Scenario: Duplicable providers of the same type coexist

- **WHEN** the file defines two providers of the same `type` with distinct ids (e.g. two `openai-completions` endpoints on different `baseUrl`s, or two `openai-responses` providers with different keys)
- **THEN** both are loaded as distinct providers keyed by `id`
- **AND** startup succeeds

#### Scenario: Unsupported provider type fails at boot

- **WHEN** a provider entry sets `type` to a value outside the schema enum (e.g. the retired `"openai"`, or a bare `"anthropic"`)
- **THEN** startup fails naming the entry and the invalid `type`

#### Scenario: OpenAI-completions provider loads by shape

- **WHEN** the file defines a `type: "openai-completions"` provider with a `baseUrl` and a `key` that resolves to empty
- **THEN** it is loaded as a keyless provider targeting that base URL
- **AND** startup succeeds without contacting the endpoint

#### Scenario: OpenAI-completions provider requires a base URL

- **WHEN** the file defines a `type: "openai-completions"` provider whose `baseUrl` is omitted or resolves to empty
- **THEN** startup fails naming the entry and the `baseUrl` field

#### Scenario: Anthropic provider loads by shape

- **WHEN** the file defines a `type: "anthropic-messages"` provider without a `baseUrl` and another with a `baseUrl` naming a non-Anthropic host and a `key` that resolves to empty
- **THEN** both are loaded as distinct providers keyed by `id`, the first targeting the Anthropic API and the second loaded keyless against its base URL exactly as authored
- **AND** startup succeeds without contacting either endpoint

#### Scenario: Keyless provider

- **WHEN** an `openai-completions` provider's `key` is `"{env:OLLAMA_API_KEY:-}"` and `OLLAMA_API_KEY` is unset
- **THEN** the provider is loaded as keyless
- **AND** startup succeeds

#### Scenario: Provider key is never exposed

- **WHEN** a provider `key` resolves to a credential
- **THEN** the resolved value appears in no log line, error, or diagnostic output
- **AND** any error about that entry names it by `id` and field, not by value

#### Scenario: Codex credentials resolve at startup

- **WHEN** a Codex provider has valid nonblank access token and account ID references
- **THEN** each API and worker process loads them once at startup
- **AND** its provider is available through the configured model catalog without a network authentication probe

#### Scenario: Missing or invalid Codex configuration

- **WHEN** a Codex credential file is missing, JSON is invalid, its pointer is absent or not a string, either resolved credential is blank, or a forbidden endpoint/header field is supplied
- **THEN** startup fails with a field-identifying diagnostic without resolved values or file contents

#### Scenario: Subscription provider cannot back embeddings

- **WHEN** an embedding model entry references a Codex provider
- **THEN** startup fails identifying the unsupported provider binding

#### Scenario: Anthropic provider cannot back embeddings

- **WHEN** an embedding model entry references an `anthropic-messages` provider
- **THEN** startup fails identifying the unsupported provider binding

### Requirement: Model catalog configuration

The config file SHALL support a top-level `models` array that is the executable model catalog, superseding any hardcoded catalog. Each entry SHALL include a required opaque `id`, a required `provider` referencing a defined `providers[].id`, a required server-only `providerModelId`, and a required positive-integer `contextWindowTokens`. Each entry MAY include `pricingUsdPer1M`, an optional per-model `compactionThresholdTokens`, an optional positive-integer `maxOutputTokens`, an optional `reasoning` object, an optional server-only `providerOptions` object, and the optional display fields of the public model contract. `pricingUsdPer1M` MAY carry an optional `cacheWrite` rate alongside `input`, `cachedInput`, and `output`, validated like the other rates. A `models[].provider` that does not reference a defined provider id SHALL fail startup naming the model id and the dangling provider reference.

The optional `reasoning` object declares that the model accepts a reasoning-effort request parameter and what values it accepts. Its presence is the declaration; there SHALL be no separate availability flag. It SHALL contain a required non-empty `effortLevels` array, a required `defaultEffort` string, and an optional `cacheInvalidatedByEffortChange` boolean defaulting to `false`.

Each `effortLevels` item SHALL be either a bare nonblank string (the level's `value`, with no display label) or an object `{ "value": <string>, "label": <string> }` whose `value` and `label` are both required and nonblank. An object that omits `label`, supplies a blank `label`, omits `value`, or supplies a blank `value` SHALL fail startup naming the model id. The system SHALL NOT invent a label from a bare string.

`value` entries SHALL be opaque provider-native tokens. The system SHALL NOT constrain them to a llame-owned enumeration, and SHALL NOT impose a character pattern, casing rule, or length limit on them: provider effort vocabularies differ between providers and change between model releases, so any format constraint is a llame-owned vocabulary by another name. Integrity constraints on values: a `value` SHALL be nonblank, `value`s SHALL be unique within an entry, and `defaultEffort` SHALL equal one of those `value`s. Duplicate `label`s across different `value`s are permitted.

`effortLevels` order is operator-authored and SHALL be preserved wherever the levels are published, so a consumer can present them as an ordered scale without inferring one. A level's `value` SHALL be treated as an identifier rather than a display string; a consumer MAY render an operator-authored `label` when present, otherwise the `value` itself as a fallback, but SHALL NOT derive meaning, magnitude, or ordering from either string's text.

At load time the system SHALL normalize every item to `{ value, label? }` (omitting `label` when the config used a bare string) before the catalog is published or used for validation. `defaultEffort` SHALL be required whenever `reasoning` is present; the system SHALL NOT imply a default from list position. A `defaultEffort` that is not equal to any item's `value` SHALL fail startup naming the model id and both values. An empty `effortLevels`, a blank `value`, or a repeated `value` SHALL fail startup naming the model id.

The system SHALL NOT verify that a declared level is accepted by the provider. A misdeclared level surfaces as a provider request error at execution time, consistent with provider credentials not being prevalidated at boot.

The optional `providerOptions` object carries provider-native request options for the adapter the entry's provider `type` selects, keyed as that adapter documents them. At load time the system SHALL validate only that it is a JSON object and SHALL otherwise retain it unchanged: it SHALL NOT constrain, interpret, or verify its keys or values against the adapter or the provider, because those vocabularies belong to the provider and change between releases. `{env:…}` and `{path:…}` interpolation syntax in any string value at any depth of the object SHALL fail startup naming the model id and the field before any token is resolved, so no interpolated secret can reach a request option. The object is not a credential channel: its contents are not redacted anywhere, and an operator SHALL NOT place a secret in it. The object is server-only and SHALL NOT be published in the public model catalog. How the retained options and the optional `maxOutputTokens` reach the provider, and what takes precedence over them, is specified by `provider-api-selection`.

#### Scenario: Model references a defined provider

- **WHEN** a model entry's `provider` names a provider defined in `providers[]`
- **THEN** the model is loaded as executable against that provider
- **AND** startup succeeds

#### Scenario: Model references an undefined provider

- **WHEN** a model entry's `provider` does not match any `providers[].id`
- **THEN** startup fails naming the model id and the unknown provider reference
- **AND** no partial catalog is applied

#### Scenario: Context window is required on every model entry

- **WHEN** a model entry omits `contextWindowTokens` or sets it non-positive
- **THEN** startup fails naming the offending model id

#### Scenario: Default model must reference the catalog

- **WHEN** `defaults.modelId` (or `defaults.titleGenerationModelId`, when set) does not match any `models[].id`
- **THEN** startup fails naming the dangling default reference
- **AND** the instance does not begin serving requests

#### Scenario: Reasoning object declares an effort vocabulary

- **WHEN** a model entry declares `reasoning` with a non-empty `effortLevels` and a `defaultEffort` equal to one item's `value`
- **THEN** the model is loaded as accepting a reasoning-effort request parameter over exactly those values
- **AND** startup succeeds

#### Scenario: Mixed bare strings and labeled objects are accepted

- **WHEN** `effortLevels` mixes bare strings with `{ value, label }` objects, each `value` unique and nonblank
- **THEN** startup succeeds
- **AND** every item is normalized to `{ value, label? }` with `label` present only for object entries

#### Scenario: Provider-native levels are accepted verbatim

- **WHEN** an `effortLevels` item's `value` is a token that is not part of any llame-owned enumeration
- **THEN** startup succeeds and the `value` is retained verbatim
- **AND** no value is rewritten, normalized, lowercased, reordered, or coerced to a llame vocabulary

#### Scenario: No character pattern is imposed on a level

- **WHEN** an `effortLevels` item's `value` is a nonblank token of any casing, length, or character composition
- **THEN** startup succeeds
- **AND** the value is rejected only if it is blank or duplicates another value in the same entry

#### Scenario: Object form requires both value and label

- **WHEN** an `effortLevels` item is an object missing `label`, with a blank `label`, missing `value`, or with a blank `value`
- **THEN** startup fails naming the model id

#### Scenario: Default effort must be one of the declared levels

- **WHEN** a model entry's `reasoning.defaultEffort` is not equal to any item's `value` in that entry's `effortLevels`
- **THEN** startup fails naming the model id, the default, and the declared values
- **AND** no partial catalog is applied

#### Scenario: Default effort is required when reasoning is declared

- **WHEN** a model entry declares `reasoning` without `defaultEffort`
- **THEN** startup fails naming the model id
- **AND** no level is implied from `effortLevels` order or length

#### Scenario: Empty or malformed level list is rejected

- **WHEN** a model entry's `reasoning.effortLevels` is empty, contains a blank value, or repeats a value
- **THEN** startup fails naming the model id

#### Scenario: Model without a reasoning object accepts no effort

- **WHEN** a model entry omits `reasoning`
- **THEN** the model is executable and accepts no reasoning-effort request parameter

#### Scenario: Cache invalidation is operator-declared and optional

- **WHEN** a model entry declares `reasoning` without `cacheInvalidatedByEffortChange`
- **THEN** the resolved value is `false`
- **AND** the system does not infer the value from the provider, the model id, or the declared levels

#### Scenario: Declared levels are not verified against the provider

- **WHEN** a model entry declares a level the provider does not accept
- **THEN** startup succeeds
- **AND** the mismatch surfaces as a provider request error when a run uses that level

#### Scenario: Provider options are retained as an opaque object

- **WHEN** a model entry declares `providerOptions` as a JSON object whose keys the system does not recognize (e.g. `{ "thinking": { "type": "adaptive" } }` on an `anthropic-messages` model, or `{ "reasoningSummary": "detailed" }` on an `openai-responses` model)
- **THEN** startup succeeds and the object is retained verbatim for that model
- **AND** no key or value is validated against the adapter or the provider at boot

#### Scenario: Provider options must be an object

- **WHEN** a model entry sets `providerOptions` to a string, number, boolean, array, or null
- **THEN** startup fails naming the model id and the field

#### Scenario: Provider options reject interpolation tokens

- **WHEN** any string value at any depth of a model entry's `providerOptions` contains `{env:…}` or `{path:…}` syntax
- **THEN** startup fails naming the model id and the field before resolving the token
- **AND** no resolved value is exposed

#### Scenario: Provider options stay server-only

- **WHEN** any caller retrieves the available-model catalog
- **THEN** no `providerOptions` content is returned for any model

#### Scenario: Output-token limit is optional and validated

- **WHEN** a model entry declares `maxOutputTokens` as a positive integer, or omits it
- **THEN** startup succeeds and the declared value, or its absence, is retained for that model
- **AND** a non-positive or non-integer value fails startup naming the model id and the field

#### Scenario: Cache-write rate is optional

- **WHEN** a model entry's `pricingUsdPer1M` declares `cacheWrite`, or omits it while declaring other rates
- **THEN** startup succeeds
- **AND** a negative or non-numeric `cacheWrite` fails startup naming the model id and the field
