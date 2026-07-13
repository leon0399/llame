## ADDED Requirements

### Requirement: Provider list configuration

The config file SHALL support a top-level `providers` array of duplicable provider entries, each `{ id, type, key?, baseUrl? }`. `id` SHALL be a non-empty operator-chosen identifier, unique within the array. `type` SHALL select the client implementation and SHALL be constrained by the schema to the set of executable provider types (this slice: exactly `"openai"`, covering native OpenAI and any OpenAI-compatible endpoint). `key` and `baseUrl` SHALL be strings supporting `{env:…}`/`{path:…}` interpolation. A `key` that resolves to empty SHALL mark the provider **keyless** (no credential), preserving the empty-resolution-means-unset semantics. Duplicate ids, or a `type` outside the schema enum, SHALL fail startup naming the offending entry.

Resolved `key` values SHALL never be written to logs, errors, or diagnostics; a load-time error on a provider field SHALL identify the entry by `id` and the field name, never the resolved value.

#### Scenario: Duplicable providers of the same type coexist

- **WHEN** the file defines two `type: "openai"` providers with distinct ids (e.g. a hosted OpenAI and a local Ollama on a different `baseUrl`)
- **THEN** both are loaded as distinct providers keyed by `id`
- **AND** startup succeeds

#### Scenario: Unsupported provider type fails at boot

- **WHEN** a provider entry sets `type` to a value outside the schema enum (e.g. `"anthropic"` before the adapter exists)
- **THEN** startup fails naming the entry and the invalid `type`

#### Scenario: Keyless provider

- **WHEN** a provider's `key` is `"{env:OLLAMA_API_KEY:-}"` and `OLLAMA_API_KEY` is unset
- **THEN** the provider is loaded as keyless
- **AND** startup succeeds

#### Scenario: Provider key is never exposed

- **WHEN** a provider `key` resolves to a credential
- **THEN** the resolved value appears in no log line, error, or diagnostic output
- **AND** any error about that entry names it by `id` and field, not by value

### Requirement: Model catalog configuration

The config file SHALL support a top-level `models` array that is the executable model catalog, superseding any hardcoded catalog. Each entry SHALL include a required opaque `id`, a required `provider` referencing a defined `providers[].id`, a required server-only `providerModelId`, and a required positive-integer `contextWindowTokens`. Each entry MAY include `pricingUsdPer1M`, an optional per-model `compactionThresholdTokens`, and the optional display fields of the public model contract. A `models[].provider` that does not reference a defined provider id SHALL fail startup naming the model id and the dangling provider reference.

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

## MODIFIED Requirements

### Requirement: First-slice setting surface

The schema SHALL cover the shape-stable operator settings and SHALL be extended by consumer changes, each adding its own keys (add-when-consumed). The settings include: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — not the catalog itself, which lives in the top-level `models` array), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.heartbeatStaleSeconds`, `runs.timeoutSeconds`, `http.trustProxy`, the `tools` namespace (`tools.allowed`, default empty = no tools, fail closed; `tools.maxStepsPerRun`, default 8; `tools.callTimeoutSeconds`, default 15), the `providers` array (provider connections), and the `models` array (the executable catalog). Provider connection settings (formerly the `OPENAI_BASE_URL` / `OPENAI_API_KEY` environment variables) SHALL be expressed as `providers[]` entries; those environment variables remain valid **interpolation inputs** (`{env:OPENAI_API_KEY:-}`) but are no longer read directly. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model — every model declares its `contextWindowTokens`, and its trigger threshold resolves per-model via the optional `models[].compactionThresholdTokens`, never by an instance knob.

#### Scenario: Migrated settings resolve from the file

- **WHEN** the file sets `defaults.modelId` and `runs.timeoutSeconds`
- **THEN** model selection defaults and the run-timeout deadman use those values

#### Scenario: No instance-level compaction knob

- **WHEN** the file attempts to set any `compaction.*` key
- **THEN** startup fails as an unknown key (the setting does not exist at this layer)

#### Scenario: Provider connection is config, not a direct env read

- **WHEN** the instance resolves provider credentials or base URL for execution
- **THEN** it reads them from the matching `providers[]` entry (whose `key`/`baseUrl` may interpolate `{env:…}`/`{path:…}`)
- **AND** it does not read `OPENAI_API_KEY` or `OPENAI_BASE_URL` as bare environment variables

#### Scenario: Tools allowlist resolves from the file

- **WHEN** the file sets `tools.allowed` to a list of registered tool ids
- **THEN** exactly those tools are available to runs (see the `tool-calling` capability for gate semantics)

#### Scenario: Absent tools namespace means no tools

- **WHEN** the file does not set the `tools` namespace
- **THEN** the allowlist is empty and no tool is advertised or executable
