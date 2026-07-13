# instance-config

## Purpose

Operator config-as-code: an optional, strictly-validated JSONC `llame.config.json` is the sole source of operator/system settings above built-in defaults (model defaults, provider connections, the executable model catalog, run timers, trust proxy). The published JSON Schema is itself the boot validator; string values interpolate `{env:NAME}` / `{env:NAME:-default}` / `{path:LOCATION}` so 12-factor env injection and Docker/K8s file-mounted secrets work without bare env-var fallbacks — the environment reaches configuration only through tokens written in the file. Tenant-owned (per-user, per-chat) settings are out of scope: they are database rows under RLS, never file entries.

## Requirements

### Requirement: Optional operator config file

The system SHALL load an operator-owned configuration file at startup and use its contents as the source of system-wide (operator) settings. The default location SHALL be `llame.config.json` in the API's runtime working directory (co-located with `.env.local`), overridable via the `LLAME_CONFIG_PATH` environment variable (absolute path wins when set). The file SHALL be optional: when absent, the system SHALL boot on documented built-in defaults without error. The file SHALL be parsed as **JSONC** (JSON with comments and trailing commas). It is deploy-time, version-controllable source of truth (config-as-code) and SHALL NOT hold tenant-owned (per-user, per-chat) data.

#### Scenario: File present and valid

- **WHEN** the instance starts with a well-formed `llame.config.json`
- **THEN** its values populate the operator/system settings
- **AND** startup succeeds

#### Scenario: File absent

- **WHEN** the instance starts with no config file present
- **THEN** operator settings are the documented built-in defaults
- **AND** startup succeeds with no error

#### Scenario: Comments and trailing commas are accepted

- **WHEN** the file contains `//` or `/* */` comments and trailing commas
- **THEN** it parses successfully (JSONC semantics)

#### Scenario: Path override

- **WHEN** `LLAME_CONFIG_PATH` is set to an existing file
- **THEN** that file is loaded instead of the default location

#### Scenario: Malformed file

- **WHEN** the instance starts with a config file that is not valid JSONC
- **THEN** startup fails loudly, naming the file and the parse error location
- **AND** the instance does not start serving requests

### Requirement: Strict, closed schema with a published JSON Schema

The file SHALL be validated against a strict, closed, typed schema at startup. Unknown keys and type violations SHALL fail startup loudly with a diagnostic naming the offending path; the instance SHALL NOT begin serving requests on a partially-applied or silently-defaulted config. The schema SHALL be authored and published as a **JSON Schema** document that is itself the boot-time validator (single artifact — editor autocomplete/hover and boot validation can never drift), with setting descriptions maintained in the schema. A top-level **`$schema`** key SHALL be permitted (and ignored by the loader) as the sole exemption from the closed schema, so editors can bind the published schema. New settings SHALL be added by explicitly extending the schema, so a mistyped key can never silently no-op.

#### Scenario: Unknown key is not silently ignored

- **WHEN** the file contains a key not present in the schema (e.g. a typo `runs.timoutSeconds`)
- **THEN** startup fails identifying the unknown key path
- **AND** no partial config is applied

#### Scenario: Wrong type fails at boot

- **WHEN** a setting has a value of the wrong type (e.g. a string where a number is required, with no interpolation token involved)
- **THEN** startup fails naming the path and expected type

#### Scenario: `$schema` key is exempt

- **WHEN** the file contains a top-level `$schema` key referencing the published schema
- **THEN** validation ignores it and startup succeeds

#### Scenario: Published schema is the validator

- **WHEN** the published JSON Schema document and the boot-time validation are compared
- **THEN** they are the same artifact (boot validates against the published document)

### Requirement: Environment-variable interpolation in config values

String config values SHALL support `{env:NAME}` interpolation resolving to the named environment variable at load time, and `{env:NAME:-default}` supplying a fallback when the variable is unset (bash/docker-compose `:-` semantics). `NAME` SHALL match `[A-Za-z0-9_]+`. Interpolation SHALL be single-pass and non-recursive — a resolved value is treated as a literal and never re-scanned for tokens.

#### Scenario: Environment variable is set

- **WHEN** a config value contains `{env:DEFAULT_MODEL_ID}` and that variable is set
- **THEN** the resolved value is the variable's contents

#### Scenario: Required environment variable is missing

- **WHEN** a config value contains `{env:NAME}`, `NAME` is unset, and no default is provided
- **THEN** startup fails loudly, naming the config path and the missing variable
- **AND** the token is never left unresolved in the effective config

#### Scenario: Interpolation with a default

- **WHEN** a config value uses `{env:NAME:-fallback}` and `NAME` is unset
- **THEN** the resolved value is the fallback
- **AND** startup succeeds

#### Scenario: Empty resolution on a nullable key means unset

- **WHEN** a nullable setting resolves to an empty string (e.g. `{env:TRUST_PROXY:-}` with `TRUST_PROXY` unset or empty)
- **THEN** the setting is treated as unset (null), preserving the established empty-env-var-means-unset semantics

### Requirement: File-path (secret) interpolation in config values

String config values SHALL support a `{path:LOCATION}` interpolation token resolving to the trimmed contents of the file at `LOCATION`, supporting Docker/Kubernetes file-mounted secrets so credentials are neither inlined in the config file nor exposed via the process environment. Token content runs to the first `}`; a `LOCATION` containing a literal `}` is unsupported and documented as such.

#### Scenario: Secret file exists

- **WHEN** a config value contains `{path:/run/secrets/openai_key}` and that file exists
- **THEN** the resolved value is the file's contents with surrounding whitespace trimmed

#### Scenario: Required secret file missing

- **WHEN** a config value contains `{path:LOCATION}` and no file exists at `LOCATION`
- **THEN** startup fails loudly, naming the config path and the missing file location
- **AND** the token is never left unresolved

### Requirement: Token placement, typing, and escaping

Interpolation SHALL run only inside string values. Tokens MAY be embedded within a larger string (e.g. `"https://{env:OLLAMA_HOST}/v1"`) when the schema type of the setting is string. For non-string schema types (number, boolean), the value MUST be a single whole-value token whose resolved string is coerced to the schema type after resolution; a coercion failure SHALL fail startup naming the path. To keep the single published schema valid for **both** validation contexts — editors validate the raw file (tokens present), boot validates after interpolation (tokens resolved) — every non-string setting's schema SHALL accept, alongside its primitive type, a string matching the interpolation-token grammar (a shared `$defs` pattern for whole-value `{env:…}`/`{path:…}` tokens, not a catch-all brace pattern). A literal `{` SHALL be expressible by doubling (`{{`); backslash escaping is NOT used (a lone `\{` is not a legal JSON string escape). Quotes and backslashes inside token content are handled by standard JSON string escaping at the parse layer.

#### Scenario: Embedded token in a string setting

- **WHEN** a string setting's value is `"https://{env:OLLAMA_HOST}/v1"` and `OLLAMA_HOST` is set
- **THEN** the resolved value embeds the variable's contents in place

#### Scenario: Whole-value token coerced for a numeric setting

- **WHEN** a numeric setting's value is `"{env:RUN_TIMEOUT_SECONDS:-300}"`
- **THEN** the resolved string is coerced to a number
- **AND** a non-numeric resolution fails startup naming the path

#### Scenario: Raw file with a token on a numeric setting is editor-valid

- **WHEN** the raw (pre-interpolation) file sets a numeric setting to a whole-value interpolation token and is validated against the published schema (as an editor does)
- **THEN** it validates successfully via the token branch
- **AND** a non-token string (e.g. `"abc"` or `"{foo}"`) on that setting fails validation

#### Scenario: Doubled brace escapes a literal

- **WHEN** a string value contains `{{`
- **THEN** the resolved value contains a literal `{` and no interpolation is attempted on it

### Requirement: Resolved secret values are never exposed

Values resolved from `{env:…}` or `{path:…}` interpolation SHALL never be written to logs, error messages, or any diagnostic output. Load-time errors SHALL identify the config path and the source (variable name / file location), never the resolved value.

#### Scenario: Secret does not appear in logs

- **WHEN** any interpolation resolves to a credential
- **THEN** the resolved value appears in no log line, error, or diagnostic output

### Requirement: File is the sole config source; environment only via interpolation

Operator settings SHALL resolve from exactly two sources, in order: the config file, then documented built-in defaults. Bare environment variables SHALL NOT be a configuration source — the environment reaches operator settings only through `{env:…}` interpolation tokens written in the file. An absent key (or an explicit `null` on a nullable setting) is unset and takes the built-in default.

#### Scenario: A bare legacy env var has no effect

- **WHEN** an environment variable such as `DEFAULT_MODEL_ID` or `RUN_TIMEOUT_SECONDS` is set but the file does not reference it
- **THEN** it does not populate any setting — the built-in default applies

#### Scenario: The same env var applies via a token

- **WHEN** the file sets a value to `"{env:DEFAULT_MODEL_ID}"` and that variable is set
- **THEN** the variable's value populates the setting

#### Scenario: Explicit null equals absent

- **WHEN** the file sets a nullable key to explicit `null` (e.g. `"trustProxy": null`)
- **THEN** the setting is unset, exactly as if the key were absent

#### Scenario: Unset falls to built-in default

- **WHEN** the file does not set a key that has a documented default
- **THEN** the built-in default is used

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
