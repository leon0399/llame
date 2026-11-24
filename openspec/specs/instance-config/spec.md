# instance-config

## Purpose

Operator config-as-code: an optional, strictly-validated `llame.config.jsonc` (default; loadable as JSONC, YAML, or TOML by extension) is the sole source of operator/system settings above built-in defaults (model defaults, provider connections, the executable model catalog, run timers, trust proxy). The published JSON Schema is itself the boot validator; string values interpolate `{env:NAME}` / `{env:NAME:-default}` / `{path:LOCATION}` so 12-factor env injection and Docker/K8s file-mounted secrets work without bare env-var fallbacks — the environment reaches configuration only through tokens written in the file. Tenant-owned (per-user, per-chat) settings are out of scope: they are database rows under RLS, never file entries.

## Requirements

### Requirement: Optional operator config file

The system SHALL load an operator-owned configuration file at startup and use its contents as the source of system-wide (operator) settings. The default location SHALL be `llame.config.jsonc` in the API's runtime working directory (co-located with `.env.local`), overridable via the `LLAME_CONFIG_PATH` environment variable (absolute path wins when set). The file SHALL be optional: when absent, the system SHALL boot on documented built-in defaults without error. The file SHALL be parsed by extension: `.jsonc` and `.json` as **JSONC** (JSON with comments and trailing commas), `.yaml` and `.yml` as YAML (with anchors and merge keys resolved), and `.toml` as TOML; any other extension SHALL fail startup naming the file. When no `LLAME_CONFIG_PATH` override is set, the system SHALL load whichever single `llame.config.jsonc`, `llame.config.json`, `llame.config.yaml`, `llame.config.yml`, or `llame.config.toml` exists in that directory, and SHALL fail startup naming the files when more than one exists. It is deploy-time, version-controllable source of truth (config-as-code) and SHALL NOT hold tenant-owned (per-user, per-chat) data.

#### Scenario: File present and valid

- **WHEN** the instance starts with a well-formed `llame.config.jsonc`
- **THEN** its values populate the operator/system settings
- **AND** startup succeeds

#### Scenario: Any supported extension is discovered

- **WHEN** no `LLAME_CONFIG_PATH` is set and the only config file is `llame.config.json` (or `.yaml`, `.yml`, `.toml`)
- **THEN** that file is loaded, `.json` parsed as JSONC
- **AND** startup succeeds without requiring a rename

#### Scenario: Ambiguous default config

- **WHEN** no `LLAME_CONFIG_PATH` is set and more than one `llame.config.*` file with a supported extension exists
- **THEN** startup fails naming those files

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

- **WHEN** the instance starts with a config file that is not valid for its format (JSONC, YAML, or TOML)
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

String config values SHALL support a `{path:LOCATION}` interpolation token. Without a JSON selector, the token SHALL resolve to the trimmed contents of the file at `LOCATION`. `LOCATION` MAY end with `|json:POINTER`, where `POINTER` is an RFC 6901 JSON Pointer; the file SHALL be parsed as UTF-8 JSON and the pointer SHALL select a JSON string whose value is used as the resolution (without additional trimming). Token content runs to the first `}`; a `LOCATION` containing a literal `}` is unsupported and documented as such. A `LOCATION` whose path portion contains the literal substring `|json:` is unsupported and documented as such.

#### Scenario: Secret file exists

- **WHEN** a config value contains `{path:/run/secrets/openai_key}` and that file exists
- **THEN** the resolved value is the file's contents with surrounding whitespace trimmed

#### Scenario: Required secret file missing

- **WHEN** a config value contains `{path:LOCATION}` and no file exists at `LOCATION`
- **THEN** startup fails loudly, naming the config path and the missing file location
- **AND** the token is never left unresolved

#### Scenario: JSON pointer selects a string

- **WHEN** a config value contains `{path:/run/secrets/auth.json|json:/providers/openai/key}` and that file is valid JSON whose pointer selects a string
- **THEN** the resolved value is that string

#### Scenario: JSON pointer must select a string

- **WHEN** a `{path:…|json:…}` token's pointer selects a non-string JSON value
- **THEN** startup fails loudly, naming the config path and the file location
- **AND** the selected value does not appear in the error

#### Scenario: Invalid JSON or missing pointer

- **WHEN** a `{path:…|json:…}` token's file is not valid JSON, or the pointer does not select a value
- **THEN** startup fails loudly, naming the config path and the file location
- **AND** file contents do not appear in the error

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

The config file MUST accept a top-level `providers` array of duplicable
provider entries. Each entry MUST have a `type` that selects its shape. `id`
MUST be a nonblank operator-chosen string that is unique in the array.

`type` MUST select the account profile and routing defaults. The schema MUST
accept `openai`, `anthropic`, `openrouter`, `opencode-zen`,
`openai-responses`, `openai-completions`, `anthropic-messages`,
`openai-codex`, `opencode-go`, `system-one`, and `cohere-rerank`.
Every model catalogue MUST accept an optional `wire`; its resolution and
supported combinations MUST follow `provider-api-selection`.

The vendor profiles `openai`, `anthropic`, `openrouter`, and `opencode-zen`
MUST accept `{ id, type, key?, baseUrl?, billing?, headers? }`. Their API bases
MUST default respectively to `https://api.openai.com/v1`,
`https://api.anthropic.com/v1`, `https://openrouter.ai/api/v1`, and
`https://opencode.ai/zen/v1`. A supplied base MUST resolve nonblank.
Credentials and headers MUST retain the same interpolation and protection
rules as the explicit wire profiles. Account metadata MUST remain server-only.

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
schema set MUST fail startup and name the entry.

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
`opencode-go`, or `opencode-zen` provider. Other accounts require a supported
embedding default or explicit embedding wire.

#### Scenario: Duplicable providers of the same type coexist

- **WHEN** the file defines two providers of the same `type` with different ids
- **THEN** both load as different providers keyed by `id`
- **AND** startup succeeds

#### Scenario: Unsupported provider type fails at boot

- **WHEN** a provider entry sets `type` to a value outside the schema set
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

#### Scenario: Anthropic provider has no default embedding wire

- **WHEN** an embedding model entry references an `anthropic-messages` provider without an explicit `wire`
- **THEN** startup fails and identifies the unsupported model wire

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

#### Scenario: A rerank provider with an account id fails startup

- **WHEN** the file defines a `type: "cohere-rerank"` provider that also sets `accountId`
- **THEN** startup fails and names the entry and `accountId`

#### Scenario: A rerank provider base URL resolves blank

- **WHEN** a `cohere-rerank` entry sets `baseUrl` to `{env:RERANK_URL:-}` and the variable is unset
- **THEN** startup fails and names the entry and `baseUrl`
- **AND** no request goes to the default Cohere URL

### Requirement: Model catalog configuration

The config file MUST accept a top-level `models` array. This array is the executable model catalog,
and it replaces any compiled catalog. Each entry MUST hold an opaque `id`, a `provider` that names a
defined `providers[].id`, a server-only `providerModelId`, and a positive-integer
`contextWindowTokens`. An `id` MUST NOT start with `@`, as `model-roles` defines.

Each entry can hold these optional fields: `pricingUsdPer1M`, `compactionThresholdTokens`,
`maxOutputTokens`, `input`, `reasoning`, a server-only `providerOptions`, and the display fields of
the public model contract. `maxOutputTokens` MUST be a positive integer. It can be a whole-value
interpolation token, and the system MUST validate it after resolution, as for `contextWindowTokens`.
`pricingUsdPer1M` can hold `cacheWrite` next to `input`, `cachedInput`, and `output`. The system
MUST validate `cacheWrite` as it validates the other rates. A `models[].provider` that names no
defined provider MUST fail startup. The error MUST name the model id and the dangling reference.

The optional `reasoning` object declares that the model accepts a reasoning-effort parameter. It
also declares the accepted values. Its presence is the declaration, and a separate flag MUST NOT
exist. It MUST hold a non-empty `effortLevels` array and a `defaultEffort` string. It can hold
`cacheInvalidatedByEffortChange`, a boolean with the default `false`.

Each `effortLevels` item MUST be a bare nonblank string or an object `{ "value": <string>, "label":
<string> }`. A bare string is the `value` of the level, with no label. In the object form, `value`
and `label` MUST both be present and nonblank. An object that breaks this rule MUST fail startup, and
the error MUST name the model id. The system MUST NOT make a label from a bare string.

Each `value` MUST be an opaque token of the provider. The system MUST NOT limit values to a llame
vocabulary. It MUST NOT apply a character pattern, a case rule, or a length limit to them. Provider
vocabularies differ, and they change between model releases. A `value` MUST be nonblank, and it MUST
be unique in its entry. `defaultEffort` MUST equal one of the values. Two values can have the same
`label`.

The system MUST keep the operator order of `effortLevels` wherever it publishes the levels. Thus a
consumer can show them as an ordered scale. A consumer MUST use a `value` as an identifier, not as
display text. It can show the operator `label`, or the `value` when no label exists. It MUST NOT
derive meaning, size, or order from the text of either string.

At load time, the system MUST change each item to `{ value, label? }` before it publishes or uses the
catalog. It MUST omit `label` for a bare string. `defaultEffort` MUST be present when `reasoning` is
present. The system MUST NOT take a default from the list position. A `defaultEffort` that equals no
`value` MUST fail startup, and the error MUST name the model id and both values. An empty
`effortLevels`, a blank `value`, or a repeated `value` MUST fail startup and name the model id.

The system MUST NOT check whether the provider accepts a declared level. A wrong level shows as a
provider request error at execution time. This agrees with the rule that boot does not check
provider credentials.

The optional `providerOptions` object holds the native request options of the adapter that the
resolved wire of the entry selects. Its keys follow the documentation of that adapter. The published
schema MUST declare it as a typed free-form object. Thus the closed-schema rule applies to the
`providerOptions` key and not to its contents.

At load time, the system MUST validate only that `providerOptions` is a JSON object. It MUST keep the
object unchanged. It MUST NOT limit, interpret, or check its keys or values against the adapter or
the provider, because the provider owns those vocabularies. `{env:…}` or `{path:…}` syntax in a
string value at any depth MUST fail startup before any token resolves. The error MUST name the model
id and the field. Thus no interpolated secret gets into a request option.

The `providerOptions` object is not a credential channel. The system does not redact its contents,
and an operator MUST NOT put a secret in it. The object is server-only, and the public model catalog
MUST NOT publish it. `provider-api-selection` specifies how the options and `maxOutputTokens` reach
the provider, and which values have precedence over them.

The optional `input` array declares the input modalities of the model. Its items MUST come from the
closed set `text`, `image`, and `pdf`. The array MUST hold `text` and MUST NOT repeat an item. An
absent `input` MUST resolve to `["text"]`. The system MUST keep a present array in its declared order.
An item outside the set, an array without `text`, or a repeated item MUST fail startup. The error MUST
name the model id and the field.

The system MUST NOT check whether the provider accepts a declared modality. A model with `image` that
rejects images shows the provider error when a Run sends it an image. The same applies to `pdf`. The
available-model entry of the model MUST publish the resolved array, as `available-models` requires.

#### Scenario: Model references a defined provider

- **WHEN** the `provider` of a model entry names a provider in `providers[]`
- **THEN** the system loads the model as executable on that provider
- **AND** startup succeeds

#### Scenario: Model references an undefined provider

- **WHEN** the `provider` of a model entry matches no `providers[].id`
- **THEN** startup fails, and the error names the model id and the unknown provider reference
- **AND** the system applies no part of the catalog

#### Scenario: Context window is required on every model entry

- **WHEN** a model entry omits `contextWindowTokens` or sets a value that is not positive
- **THEN** startup fails, and the error names the model id

#### Scenario: Default model must reference the catalog

- **WHEN** `defaults.selector`, or a present `defaults.titleGenerationSelector`, names no `models[].id` and no role
- **THEN** startup fails, and the error names the dangling default reference
- **AND** the instance does not start to serve requests

#### Scenario: Reasoning object declares an effort vocabulary

- **WHEN** a model entry declares `reasoning` with a non-empty `effortLevels` and a `defaultEffort` that equals the `value` of one item
- **THEN** the system loads the model as a model that accepts a reasoning-effort parameter with exactly those values
- **AND** startup succeeds

#### Scenario: Mixed bare strings and labeled objects are accepted

- **WHEN** `effortLevels` holds bare strings and `{ value, label }` objects, and each `value` is unique and nonblank
- **THEN** startup succeeds
- **AND** each item becomes `{ value, label? }`, and only the object items have a `label`

#### Scenario: Provider-native levels are accepted verbatim

- **WHEN** the `value` of an `effortLevels` item is a token that no llame vocabulary holds
- **THEN** startup succeeds, and the system keeps the `value` unchanged
- **AND** the system does not rewrite, change the case of, reorder, or convert any value

#### Scenario: No character pattern is imposed on a level

- **WHEN** the `value` of an `effortLevels` item is a nonblank token of any case, length, or characters
- **THEN** startup succeeds
- **AND** the system rejects the value only when it is blank or repeats another value of the entry

#### Scenario: Object form requires both value and label

- **WHEN** an `effortLevels` object has no `label`, a blank `label`, no `value`, or a blank `value`
- **THEN** startup fails, and the error names the model id

#### Scenario: Default effort must be one of the declared levels

- **WHEN** the `reasoning.defaultEffort` of a model entry equals no `value` of its `effortLevels`
- **THEN** startup fails, and the error names the model id, the default, and the declared values
- **AND** the system applies no part of the catalog

#### Scenario: Default effort is required when reasoning is declared

- **WHEN** a model entry declares `reasoning` with no `defaultEffort`
- **THEN** startup fails, and the error names the model id
- **AND** the system takes no level from the order or the length of `effortLevels`

#### Scenario: Empty or malformed level list is rejected

- **WHEN** the `reasoning.effortLevels` of a model entry is empty, holds a blank value, or repeats a value
- **THEN** startup fails, and the error names the model id

#### Scenario: Model without a reasoning object accepts no effort

- **WHEN** a model entry omits `reasoning`
- **THEN** the model is executable and accepts no reasoning-effort parameter

#### Scenario: Cache invalidation is operator-declared and optional

- **WHEN** a model entry declares `reasoning` with no `cacheInvalidatedByEffortChange`
- **THEN** the resolved value is `false`
- **AND** the system does not take the value from the provider, the model id, or the declared levels

#### Scenario: Declared levels are not verified against the provider

- **WHEN** a model entry declares a level that the provider does not accept
- **THEN** startup succeeds
- **AND** the error shows as a provider request error when a Run uses that level

#### Scenario: Provider options are retained as an opaque object

- **WHEN** a model entry declares `providerOptions` as a JSON object with keys that the system does not know, for example `{ "thinking": { "type": "adaptive" } }` on an `anthropic-messages` model
- **THEN** startup succeeds, and the system keeps the object unchanged for that model
- **AND** boot does not check a key or a value against the adapter or the provider

#### Scenario: Provider options must be an object

- **WHEN** a model entry sets `providerOptions` to a string, a number, a boolean, an array, or null
- **THEN** startup fails, and the error names the model id and the field

#### Scenario: Provider options reject interpolation tokens

- **WHEN** a string value at any depth of the `providerOptions` of a model entry holds `{env:…}` or `{path:…}` syntax
- **THEN** startup fails before the token resolves, and the error names the model id and the field
- **AND** the system shows no resolved value

#### Scenario: Provider options stay server-only

- **WHEN** a caller reads the available-model catalog
- **THEN** the response holds no `providerOptions` content for any model

#### Scenario: Output-token limit is optional and validated

- **WHEN** a model entry declares `maxOutputTokens` as a positive integer, or as a whole-value token that resolves to one, or omits it
- **THEN** startup succeeds, and the system keeps the resolved value or its absence for that model
- **AND** a value that resolves to a number that is not a positive integer fails startup and names the model id and the field

#### Scenario: Cache-write rate is optional

- **WHEN** the `pricingUsdPer1M` of a model entry declares `cacheWrite`, or omits it and declares other rates
- **THEN** startup succeeds
- **AND** a negative or non-numeric `cacheWrite` fails startup and names the model id and the field

#### Scenario: Input modalities default to text only

- **WHEN** a model entry omits `input`
- **THEN** startup succeeds
- **AND** the resolved `input` of the model is `["text"]`

#### Scenario: Image input is declared explicitly

- **WHEN** a model entry sets `input` to `["text", "image"]`
- **THEN** startup succeeds
- **AND** the resolved `input` of the model is `["text", "image"]`

#### Scenario: PDF input is declared explicitly

- **WHEN** a model entry sets `input` to `["text", "pdf"]`
- **THEN** startup succeeds
- **AND** the resolved `input` of the model is `["text", "pdf"]`

#### Scenario: Input without text fails startup

- **WHEN** a model entry sets `input` to `["image"]` or to `[]`
- **THEN** startup fails, and the error names the model id and the `input` field
- **AND** the system applies no part of the catalog

#### Scenario: Unknown input modality fails startup

- **WHEN** a model entry sets `input` to `["text", "audio"]`
- **THEN** startup fails, and the error names the model id and the `input` field

#### Scenario: Repeated input modality fails startup

- **WHEN** a model entry sets `input` to `["text", "text"]` or `["text", "image", "image"]`
- **THEN** startup fails, and the error names the model id and the `input` field

#### Scenario: Repeated PDF modality fails startup

- **WHEN** a model entry sets `input` to `["text", "pdf", "pdf"]`
- **THEN** startup fails, and the error names the model id and the `input` field
- **AND** the system applies no part of the catalog

#### Scenario: Declared image input is not verified against the provider

- **WHEN** a model entry declares `input: ["text", "image"]` for a provider model that rejects images
- **THEN** startup succeeds
- **AND** the provider request error shows when a Run sends that model an image

### Requirement: Model prompt files are dedicated visible-content configuration

A model entry can declare `systemPromptFile` as its complete system-prompt file. This MUST be a host path, not secret interpolation. Its contents are owner-visible. Omission MUST select the versioned packaged default. An override MUST replace that default completely. Models MUST NOT inherit or compose prompts.

Relative paths MUST resolve against the active configuration directory. Absolute paths MUST remain absolute. Worker boot MUST read files, normalize CRLF and CR to LF, and remove trailing whitespace only at the file end. Rendered content MUST be nonempty.

Files MUST use Handlebars templates. Worker boot MUST validate their parsed syntax trees. Errors MUST name the model and offending construct without prompt contents. Only literal content, value expressions, block expressions, and comments are permitted. All other nodes MUST fail validation.

Value expressions MUST name allowlisted paths without parameters. Validation MUST inspect parsed segments and depth, not display strings. Bracketed literal segments MUST NOT impersonate dotted paths. Parent-context paths MUST fail validation.

Blocks MUST use only permitted `if`, `unless`, or bounded `each` forms from model-system-prompts. Each MUST take exactly one permitted subject, without hash arguments or block parameters. Unescaped output, fragments, partials, and other helpers MUST fail validation before rendering.

A template without literal text MUST fail boot validation. Literal text inside a conditional MUST count. Missing allowlisted values MUST render empty, not fail expression resolution. Complete prompts and admitted descriptions MUST remain nonempty per attempt. Validation and boot probes MUST NOT require an absent tool to exist.

Model values and account identity values MUST escape exactly `&`, `<`, and `>` with character references. Owner-authored personalization fields MUST use the following tag rules instead:

1. A value MUST NOT close a tag it did not open. A closing tag can close an earlier opener across unclosed intermediate openers. The sanitizer MUST escape unmatched, malformed, or whitespace-padded closing tags.
2. Reserved tag names MUST never render as tags, even in balanced pairs. The reserved set MUST include the packaged delimiter. Documentation MUST disclose that custom delimiter names receive only the first rule unless reserved.

Other self-contained markup, unmatched openers, comparisons, and punctuation MUST remain byte-identical. Neutralization MUST happen during context construction. Context construction MUST mark values safe against another escaping pass. Code MUST NOT change the engine's global escape function, because created environments share its utility object.

Both template kinds MUST use one explicit renderable projection from model-system-prompts, including temporal paths and conditional-only `tools.<exact-id>` predicates. They MUST NOT receive database rows, ORM entities, configuration records, secrets, or unrequested capability flags. The projection MUST contain no `chats` namespace.

Worker boot MUST validate attempt-dependent paths without resolving owner data. Values MUST resolve per attempt through the exposed template. Without tool predicates, probes MUST vary `user`, `skills`, and `webSearch` independently across supported absent and populated states. Every probe MUST include an unconditional representative temporal anchor. Any empty probe MUST fail boot.

Lockstep optional gates and absent anchors are invalid probes. A prompt without per-user paths MUST remain valid.

Missing, unreadable, non-file, or empty configured files MUST fail boot naming the model and field, without fallback. Missing allowlisted values MUST remain empty, not configuration errors. Worker boot MUST validate the packaged default as an application asset.

The packaged default MUST reference per-user paths inside conditionals. It MUST apply personalization without operator edits and obey `shareAccountIdentity`. An override without those paths MUST forgo that context silently. Documentation MUST explain the consequence. No per-model activation report is required.

Public catalogs and APIs MUST omit `systemPromptFile` and all resolved host paths. Only an authorized owner receipt can expose resolved prompt contents and a source label. Configuration errors and operator logs MUST NOT print prompt contents.

#### Scenario: A mixed optional-context state renders empty

- **WHEN** a template passes lockstep probes but renders empty with absent `user`, populated `skills`, and absent `webSearch`
- **THEN** independent gate probes reject it at worker boot

#### Scenario: A template uses only temporal context

- **WHEN** an otherwise-valid template renders non-empty text using only `context.systemTime` and `context.systemTimezone`
- **THEN** every boot probe supplies the anchor and succeeds
- **AND** absence of optional context values does not invalidate it

#### Scenario: Relative model prompt path resolves

- **WHEN** a model declares `systemPromptFile: "prompts/reasoning-model.md"`
- **THEN** the loader resolves it relative to the active config file directory
- **AND** the model uses the normalized non-empty file contents as its complete prompt

#### Scenario: Absolute model prompt path resolves

- **WHEN** a model declares a valid absolute `systemPromptFile`
- **THEN** the loader reads that exact file at worker startup
- **AND** no additional path sandbox is applied beyond the administrator-controlled process permissions

#### Scenario: Prompt override is omitted

- **WHEN** a model entry omits `systemPromptFile`
- **THEN** the resolved model uses the packaged project-default prompt
- **AND** startup does not require a model-specific file

#### Scenario: Configured prompt file is invalid

- **WHEN** `systemPromptFile` resolves to a missing, unreadable, non-file, or empty prompt
- **THEN** worker startup fails naming the model id and field
- **AND** neither prompt contents nor partial model catalog state is exposed
- **AND** the project default is not used as a silent recovery path

#### Scenario: Public model catalog is requested

- **WHEN** any caller retrieves the available-model catalog
- **THEN** no `systemPromptFile`, absolute path, relative path, or server-only prompt-source location is returned

#### Scenario: Two models declare different files

- **WHEN** two model entries declare different valid `systemPromptFile` values
- **THEN** each model resolves its own complete prompt independently
- **AND** changing one model's file does not alter the other model's effective prompt

#### Scenario: Template references an unknown identifier

- **WHEN** a configured prompt file references a context path outside the allowlist
- **THEN** worker startup fails naming the model id and that path
- **AND** no prompt contents are printed

#### Scenario: Path only appears allowlisted in its display form

- **WHEN** a configured template uses a deceptive bracketed display path with different parsed segments, or a parent-context path
- **THEN** boot rejects it naming the model and path
- **AND** it cannot silently render empty at request time

#### Scenario: Conditional has the wrong argument count

- **WHEN** a configured prompt file uses an `if` or `unless` block with no parameter or more than one
- **THEN** worker startup fails with the capability's own configuration error, naming the model id and the construct
- **AND** the failure does not surface later as an unwrapped engine error at render time

#### Scenario: Conditional declares block parameters

- **WHEN** a configured prompt file declares block parameters on a conditional
- **THEN** worker startup fails naming the model id and the construct

#### Scenario: Template requests unescaped output

- **WHEN** a configured prompt file emits a value through unescaped output
- **THEN** worker startup fails naming the model id and that expression
- **AND** the template is not loaded with escaping bypassed

#### Scenario: Template references a fragment

- **WHEN** a configured prompt file references a partial in any of its syntactic forms
- **THEN** worker startup fails naming the model id and the construct

#### Scenario: Template invokes a helper

- **WHEN** a configured prompt file invokes any helper outside the shared `if`/`unless`/bounded-`each` rules
- **THEN** worker startup fails naming the model id and the helper
- **AND** `if` and `unless` continue to load successfully

#### Scenario: Comment is permitted

- **WHEN** a configured prompt file contains a template comment
- **THEN** worker startup succeeds and the comment does not appear in rendered output

#### Scenario: Helper smuggled through a block hash argument

- **WHEN** a configured prompt file passes a hash argument holding a subexpression to an `if` or `unless` block
- **THEN** worker startup fails naming the model id and the helper invocation
- **AND** the helper is never executed at render time

#### Scenario: Conditional holds the only literal content

- **WHEN** a configured prompt file consists solely of a conditional block whose body carries its only literal text
- **THEN** worker startup succeeds rather than rejecting the template as empty
- **AND** the block renders its content when the tested path has a value

#### Scenario: Allowlisted value is missing at render time

- **WHEN** an allowlisted context path has no value and the surrounding template produces nonempty final text
- **THEN** the expression renders as empty and rendering succeeds
- **AND** the missing value itself causes no startup or attempt failure

#### Scenario: Escaping alters exactly three characters

- **WHEN** a rendered model or account-identity value contains `&`, `<`, `>`, an apostrophe, a quotation mark, an equals sign, and a backtick
- **THEN** only `&`, `<`, and `>` are replaced with character references
- **AND** every other character appears verbatim in the prompt

#### Scenario: Rendered value cannot introduce markup characters

- **WHEN** a rendered model or account-identity value contains `<` or `>`
- **THEN** they appear as character references rather than as markup

#### Scenario: Context is a projection rather than a record

- **WHEN** the loader renders any prompt
- **THEN** the context contains only explicitly projected renderable values
- **AND** no database row, ORM entity, or configuration object is reachable through any context path

#### Scenario: Template references per-user paths

- **WHEN** a configured prompt file references personalization or account-identity paths
- **THEN** startup accepts them as allowlisted identifiers without resolving any owner data
- **AND** their values resolve per execution attempt instead

#### Scenario: Template names an unknown per-user field

- **WHEN** a configured prompt file references a per-user path outside the allowlist
- **THEN** worker startup fails naming the model id and that path
- **AND** the allowlist is not silently extended

#### Scenario: Template references no per-user path

- **WHEN** an operator's configured prompt file references no per-user context path
- **THEN** worker startup succeeds
- **AND** that model forgoes per-user context rather than failing startup or falling back to the project default

#### Scenario: Context extension does not pass records

- **WHEN** the run path renders a prompt referencing per-user paths
- **THEN** the context contains only explicitly projected scalar values
- **AND** no personalization row, user row, or configuration object is reachable through any context path

#### Scenario: Authored markup survives while the enclosing structure stays closed to it

- **WHEN** an authored value contains balanced non-reserved markup and a separate closing tag without its own opener
- **THEN** the balanced markup renders verbatim
- **AND** the unmatched closing tag renders escaped and cannot close the surrounding structure

#### Scenario: Authored value spells the delimiter's own name as a balanced pair

- **WHEN** an owner's authored field contains a well-formed opening and closing tag pair naming the packaged prompt's delimiter
- **THEN** both tags are escaped as content even though the pair is balanced
- **AND** the rendered prompt contains exactly one opening and one closing delimiter, the template's own

#### Scenario: Packaged default carries the per-user block

- **WHEN** the packaged project-default prompt is validated at worker startup
- **THEN** it references the per-user paths, each inside a conditional
- **AND** a stock installation applies an owner's personalization without an operator editing any file

### Requirement: Operator config declares skill source directories

Instance configuration SHALL accept `skills.directories` as an ordered array of at most 32 non-empty directory paths, defaulting to an empty array. Each source SHALL contain skill directories rather than require per-skill enumeration. Relative paths SHALL resolve against the configuration file directory; a leading `~/` SHALL resolve against the operator process home. These intentionally public path entries SHALL be literal path settings: `{env:...}` and `{path:...}` interpolation syntax SHALL be rejected before resolution, and shell evaluation SHALL NOT occur. Other configuration fields SHALL retain their existing interpolation behavior. No implicit home or repository scanning SHALL occur. Configuration changes SHALL use the existing restart boundary; changes to package files inside configured sources SHALL be observed live without restart. No per-owner source mutation API SHALL be introduced.

#### Scenario: Configuration is omitted

- **WHEN** the operator supplies no skills configuration
- **THEN** the catalog is empty and existing tool availability is unchanged

#### Scenario: Explicit home source

- **WHEN** the operator configures `~/.agents/skills`
- **THEN** immediate package directories beneath that explicitly selected source are discovered
- **AND** no other client home directories are scanned

#### Scenario: Package update does not require config reload

- **WHEN** a package file changes inside an already configured source
- **THEN** its next invocation reads current content without restarting the app

#### Scenario: Public source rejects secret interpolation

- **WHEN** a skill source contains `{env:SKILL_ROOT}` or `{path:/run/secrets/value}`
- **THEN** configuration validation fails before resolving that token, identifies the configuration field, and exposes no resolved value

#### Scenario: Collection root contains the skill directories

- **WHEN** `skills.directories` contains `/opt/skills` and `/opt/skills/pdf/SKILL.md` exists
- **THEN** the `pdf` package is discovered
- **AND** the operator does not configure `/opt/skills/pdf` for this layout; a source directory's own `SKILL.md` is not a discovered child package
  API-only processes SHALL validate configuration shape and model references without loading prompt-file contents. A process hosting a Run consumer SHALL perform file loading and executable-template validation before it consumes jobs. Tool-aware templates SHALL follow the absent-tool and actual-attempt empty-render rules in `tool-prompt-templates`; an absent tool cannot fail worker boot.

### Requirement: Tool prompt files support instance and model precedence

Configuration SHALL accept optional `tools.promptFiles` and
`models[].toolPromptFiles` maps from registered llame-owned exact tool ids to
complete prompt-file paths. For each id, the selected model's entry SHALL win
over the instance entry, which SHALL win over the packaged default. Missing or
null entries SHALL follow existing absence semantics; an empty map SHALL not
clear lower-level entries. Selection SHALL not compose multiple files.

Worker boot SHALL validate all packaged and configured files, including
shadowed and disabled-tool entries, using system-prompt visible-content path
rules, normalization, and shared template validation. Relative paths SHALL
resolve against the active instance config directory. An explicit invalid file
SHALL fail worker startup without fallback. Unknown override targets, MCP
override targets, and wildcard keys SHALL be rejected. This key validation
SHALL not reject a valid template predicate merely because its target is absent.

File/config changes SHALL require restarting the executing process. The worker
SHALL render its boot-loaded sources with newly resolved attempt inputs.
Catalogs, owner receipts, and public APIs SHALL not disclose override paths or
raw configuration. System-only receipts SHALL expose the actual rendered
system prompt; rendered tool descriptions SHALL not be stored in receipts.

#### Scenario: Highest applicable file wins

- **WHEN** a model and the instance both override Bash
- **THEN** the model uses its complete Bash file
- **AND** a model without that key uses the instance file

#### Scenario: Overrides inherit independently

- **WHEN** the model overrides read and the instance overrides Bash
- **THEN** each tool resolves its highest-priority entry independently
- **AND** tools with no entry use their packaged defaults

#### Scenario: Empty maps do not disable tools

- **WHEN** a map is missing, null, or empty
- **THEN** absent keys resolve from the next level
- **AND** template selection does not alter tool admission

#### Scenario: Invalid shadowed file fails worker boot

- **WHEN** an explicit instance override is invalid but shadowed by every model
- **THEN** worker startup fails at that field without a fallback

#### Scenario: Unknown predicate is valid while unknown override target is not

- **WHEN** a valid registered-tool override checks an unregistered `tools.never_registered`
- **THEN** worker boot succeeds and that predicate is false
- **AND** an override map entry targeting the unregistered `never_registered` tool itself is rejected

#### Scenario: Worker restart applies file edits

- **WHEN** a worker restarts after a valid file edit
- **THEN** its next execution attempt renders the new file
- **AND** running workers retain their existing boot-loaded source

#### Scenario: API-only process schedules work without file access

- **WHEN** configuration shape is valid and an API-only process has no mounted prompt files
- **THEN** it can accept the selected model's Run
- **AND** only its executing worker needs to load and validate those files

### Requirement: Prompt-file rules govern replaceable files only

The prompt-file requirements of this capability, namely boot-time Handlebars validation, the permitted node kinds, the context-path allowlist, bounded iteration, and the value-escaping regime under "Model prompt files are dedicated visible-content configuration" and "Tool prompt files support instance and model precedence", SHALL govern configured prompt files and the packaged defaults an operator may replace through `systemPromptFile`, `tools.promptFiles`, or `models[].toolPromptFiles`. A packaged template that no configuration can select or replace SHALL be outside those requirements; its rendering rules are owned by the capability that renders it: `context-injection` for rail item bodies, `model-system-prompts` for summarization instructions and title prompts, and `tool-calling` for the output framing and closed notices llame places inside tool results.

The reserved-delimiter neutralization rules this capability defines for owner-authored values SHALL continue to apply wherever a producer neutralizes untrusted text, regardless of which template renders it. The shared template engine's default escaping SHALL remain unused by every template.

#### Scenario: A packaged internal template uses a producer-specific variable

- **WHEN** a packaged, non-replaceable template references a variable that is not on the configured-prompt allowlist
- **THEN** worker startup succeeds
- **AND** the configured-prompt allowlist is unchanged

#### Scenario: A configured prompt file uses a producer-specific variable

- **WHEN** a configured system-prompt or tool-description file references a variable that exists only in a producer's packaged template
- **THEN** worker startup fails naming the model id and the unsupported construct
- **AND** no producer variable is added to the configured-prompt allowlist by that reference

#### Scenario: Neutralization is independent of the rendering template

- **WHEN** a producer renders an owner-authored value through a packaged template
- **THEN** the value is neutralized under the same reserved-delimiter rules as a configured prompt would apply
- **AND** the rendered output is not re-evaluated as a template

#### Scenario: One source text compiled under both regimes

- **WHEN** identical template text is compiled once for a configured prompt file and once for a packaged template
- **THEN** each render uses the compilation for its own regime
- **AND** neither regime's escaping behavior leaks into the other through a shared compile cache

### Requirement: Operator configuration declares one private local Knowledge root

The instance configuration SHALL accept an optional `knowledge.root` string containing one absolute process-local path beneath which server-managed personal Knowledge Space directories exist. The built-in default SHALL be absent. The path SHALL use the configuration system's existing string interpolation rules and SHALL be validated as absolute after interpolation.

Schema validation SHALL remain closed: unknown Knowledge fields, relative roots, and wrong value types fail startup at the offending configuration path. Configuration loading SHALL NOT require the root to exist, resolve it, or probe filesystem permissions. Live validity belongs to provisioning and execution.

Every process that authors Chat Runs SHALL declare `knowledge.root` when Knowledge tools are enabled so accept-time availability is independent of the accepting API instance. Every process serving Knowledge Space provisioning SHALL additionally resolve the root and have permission to create the owner's stable-ID child. Every process consuming `runs` SHALL resolve the corresponding root and have read access to all owner directories its queue may execute. Absolute root paths MAY differ by process when they expose the same logical stable-ID children.

The Knowledge configuration SHALL contain no owner identity, Knowledge Space identifier, child-directory name, source map, accepted ref, remote URL, Git credential, cache path, checkout policy, clone instruction, or discovery rule. The root SHALL remain private to operator diagnostics and trusted local resolution and SHALL NOT enter public configuration, model context, tool results, Run events, or owner-facing errors.

#### Scenario: No root configured

- **WHEN** `knowledge.root` is absent
- **THEN** configuration loading succeeds without a Knowledge filesystem dependency
- **AND** provisioning and Knowledge tools remain unavailable

#### Scenario: Absolute process-local root is configured

- **WHEN** an operator configures a valid absolute interpolated Knowledge root
- **THEN** trusted provisioning and Run workers may resolve stable-ID children beneath it
- **AND** the root is omitted from public and model-facing configuration

#### Scenario: Configuration loading does not probe the root

- **WHEN** an HTTP process loads a syntactically valid absolute Knowledge root that is not mounted there
- **THEN** schema loading succeeds without a filesystem probe
- **AND** a later provisioning or execution attempt fails closed if that process requires access

#### Scenario: Relative root fails startup

- **WHEN** the configured Knowledge root resolves to a relative path
- **THEN** startup fails naming the configuration field
- **AND** no Knowledge setting is partially applied

#### Scenario: Configuration cannot assign an owner or source

- **WHEN** the `knowledge` object attempts to include an owner, resource identifier, child path, source map, Git field, remote, credential, or unknown field
- **THEN** closed-schema validation rejects it

### Requirement: First-slice setting surface

The schema MUST cover the shape-stable operator settings. Each consumer change MUST add its own keys
when it consumes them. The settings include `defaults.selector` and
`defaults.titleGenerationSelector`. These are instance-level selectors, and the catalog itself is the
top-level `models` array. The settings also include `runs.maxOutputTokens`, `runs.heartbeatSeconds`,
`runs.timeoutSeconds`, and `http.trustProxy`. They also include the `tools` namespace, the top-level
`mcpServers` object, the optional `knowledge.root`, the `providers` array, and the `models` array.

`runs.timeoutSeconds` has the default `null`, which means no wall-clock budget. Another value MUST be
a positive integer of seconds below the Run execution ceiling of `durable-runs`.

In the `tools` namespace, `tools.allowed` has the default empty list, which means no tools. The
system fails closed. `tools.permissions` has the default explicit portable code-owned policy, and it
does not change availability. `tools.maxStepsPerRun` has the default `null`, which means no step cap.
Another value MUST be a positive integer. `tools.callTimeoutSeconds` has the default 120.

An absent `tools.webAdapters` MUST mean `[]`, and no adapter is enabled. A present value MUST be an
explicit replacement. It MUST hold only `github`, `bluesky`, `npm`, `huggingface`, `arxiv`,
`stackexchange`, `crates`, `hackernews`, `doi`, `discourse`, `devto`, `substack`, `osv`, `wikipedia`,
`telegram`, `lobsters`, `luma`, and `rewrite` entries.

The `mcpServers` object has the default empty object, which means no MCP servers. Its entries have a
`type` discriminator, and each is a remote Streamable HTTP server or a local stdio server. An absent
`knowledge.root` means no local Knowledge capability. `knowledge.root` is an absolute path.

`tools.allowed` MUST accept registered code-owned ids, exact canonical MCP ids, and the wildcard form
`mcp__<server>__*`. The wildcard is valid for any grammar-valid MCP server id, also when no server
with that id is configured.

The settings of a provider connection MUST be `providers[]` entries. The `OPENAI_BASE_URL` and
`OPENAI_API_KEY` variables stay valid as interpolation inputs, such as `{env:OPENAI_API_KEY:-}`. The
system MUST NOT read them directly.

A `compaction.*` setting and a context-window fallback setting MUST NOT exist at the instance level.
The model drives compaction. Each model declares its `contextWindowTokens`. Its trigger threshold
resolves for each model from the optional `models[].compactionThresholdTokens`, never from an
instance setting.

#### Scenario: Migrated settings resolve from the file

- **WHEN** the file sets `defaults.selector` and `runs.timeoutSeconds`
- **THEN** the default selection and the Run wall-clock budget use those values

#### Scenario: Run limits are unlimited unless configured

- **WHEN** the file omits `runs.timeoutSeconds` and `tools.maxStepsPerRun`, or sets either to `null`
- **THEN** startup succeeds, and Runs have no wall-clock budget and no tool-step cap

#### Scenario: A non-positive or over-ceiling Run limit fails startup

- **WHEN** `runs.timeoutSeconds` or `tools.maxStepsPerRun` resolves to zero, a negative number, or a fraction, or `runs.timeoutSeconds` is at or above the Run execution ceiling
- **THEN** startup fails, and the error names the configuration path
- **AND** the system never reads zero as unlimited

#### Scenario: No instance-level compaction knob

- **WHEN** the file sets any `compaction.*` key
- **THEN** startup fails for an unknown key, because the setting does not exist at this layer

#### Scenario: Provider connection is config, not a direct env read

- **WHEN** the instance resolves the provider credentials or the base URL for execution
- **THEN** it reads them from the `providers[]` entry of the model, whose `key` and `baseUrl` can interpolate `{env:…}` and `{path:…}`
- **AND** it does not read `OPENAI_API_KEY` or `OPENAI_BASE_URL` as bare variables

#### Scenario: Tools allowlist resolves from the file

- **WHEN** the file sets `tools.allowed` to registered code-owned ids, exact canonical MCP ids, or wildcards for grammar-valid server ids
- **THEN** the admitted tools that match exactly can become eligible for Runs under the gates of `tool-calling`
- **AND** each MCP call still needs authorization from `tools.permissions`

#### Scenario: MCP servers resolve from the file

- **WHEN** the file declares entries in the top-level `mcpServers` object
- **THEN** those entries are the complete instance-managed MCP server set for both transports

#### Scenario: Knowledge root resolves from the file

- **WHEN** the file declares `knowledge.root`
- **THEN** it is the process-local root for trusted stable-ID child resolution
- **AND** an absent `knowledge` namespace keeps Knowledge provisioning and tools unavailable

#### Scenario: Absent tools namespace means no tools

- **WHEN** the file does not set the `tools` namespace
- **THEN** the allowlist is empty, and the system advertises and executes no tool

#### Scenario: MCP servers without an allowlist expose no tools

- **WHEN** the file configures `mcpServers` and omits `tools.allowed`
- **THEN** the servers can connect or start, and the system advertises and executes no discovered tool

#### Scenario: Absent web adapter setting enables no adapter

- **WHEN** the file omits `tools.webAdapters`, and it configures other `tools` settings
- **THEN** no adapter is enabled, and the URL uses only the generic ladder
- **AND** the system contacts no adapter origin

#### Scenario: The old default keys fail startup

- **WHEN** the file sets `defaults.modelId` or `defaults.titleGenerationModelId`
- **THEN** startup fails for an unknown key, and the error names that key

### Requirement: Operator tool permissions compile before process startup completes

The configuration SHALL accept optional `tools.permissions` under the closed published schema. When omitted, the system SHALL create no permission groups, so every call is rejected; the shipped example documents the recommended portable map. There is no built-in fallback policy. A supplied map SHALL be the complete effective policy without merging; an explicit empty map SHALL reject all calls. Every `tools.permissions` evaluation in this capability governs an attempt whose effective permission mode is `default`; a `bypass` attempt evaluates no permission group, as `tool-call-permissions` defines. It SHALL use the groups, clauses, matching syntax, and bounds defined by `tool-call-permissions`. Unknown or no-longer-configured permission keys SHALL be accepted and simply never match, so an MCP server change does not fail startup; malformed clauses, all-fields allow clauses, and invalid or unsupported regex SHALL fail startup before serving requests or claiming jobs. Diagnostics SHALL identify configuration locations and static reasons without printing patterns, resolved values, or matched input. Permission strings SHALL follow the existing single-pass interpolation and doubled-opening-brace escaping contract.

#### Scenario: A no-longer-configured permission key does not fail startup

- **WHEN** a valid `tools.permissions` map contains a key for a tool that is not currently registered or configured
- **THEN** startup succeeds and the group simply never matches
- **AND** malformed clauses or invalid regex still fail startup

#### Scenario: Omitted permissions reject calls

- **WHEN** an otherwise valid configuration lists a tool in `tools.allowed` and omits `tools.permissions`
- **THEN** startup succeeds and the existing catalog remains available
- **AND** a call to any advertised tool is rejected because no group exists
- **AND** an MCP tool is likewise rejected

#### Scenario: Explicit empty policy disables execution

- **WHEN** an operator supplies `tools.permissions: {}`
- **THEN** no built-in permission groups are inherited
- **AND** available tools remain visible but all calls are rejected

#### Scenario: Invalid regex is not silently ignored

- **WHEN** a configured permission regex is invalid or exceeds the supported regex syntax or size
- **THEN** the process refuses startup with a safe configuration-path diagnostic
- **AND** no partially compiled policy executes

#### Scenario: Pattern braces use existing configuration escaping

- **WHEN** an operator writes a regex quantifier using doubled opening braces in the source configuration
- **THEN** the matcher compiles the single-brace expression produced by the existing interpolation pass
- **AND** an interpolation failure follows the existing fail-closed configuration behavior

### Requirement: Remote MCP servers use the portable named-object shape

The top-level `mcpServers` setting SHALL be an object that maps server names to entries discriminated by `type`, matching the portable `.mcp.json` convention rather than inventing an array form. A remote entry SHALL be shaped exactly as `{ type, url, headers? }`. A server name SHALL contain 1–56 provider-safe ASCII letters, digits, `_`, or `-`, SHALL exclude the reserved `__` namespace separator, and SHALL be unique as a JSON object key. The 56-character bound SHALL be derived from the fixed provider-independent 64-character `mcp__<server>__<tool>` budget while reserving one character for the shortest valid normalized tool segment, and configuration validation SHALL use the same bound as `mcp-tool-id-v1`. These naming rules SHALL apply to every entry regardless of `type`. Duplicate properties MUST be rejected rather than silently overwritten. `type` SHALL accept `"http"` and the explicit MCP name `"streamable-http"` as aliases for the same Streamable HTTP transport, and SHALL accept `"stdio"` for the local-process transport specified separately; any other value SHALL fail startup. `type` SHALL be required rather than inferred from which sibling fields are present. `url` SHALL be an absolute `http` or `https` URL with empty username and password components; userinfo SHALL be rejected before transport construction. `headers`, when present, SHALL map non-empty header names to string values supporting llame's existing `{env:…}` and `{path:…}` interpolation rules. Header names that collide under ASCII case-folding SHALL be rejected before transport construction. Attempts to override `Accept`, `Content-Type`, `MCP-Protocol-Version`, `MCP-Session-Id`, `Last-Event-ID`, or another transport-owned header SHALL be detected by the same ASCII-case-folded comparison. Fields belonging to another transport's variant SHALL be rejected as unknown for this one. Unknown fields, invalid names, invalid URLs, URL userinfo, empty or colliding header names, and transport-owned headers SHALL fail startup naming only the configuration path, without printing resolved header values or credential-bearing URL text.

#### Scenario: Static bearer header resolves from a secret

- **WHEN** an MCP server header is `"Authorization": "Bearer {env:SEARCH_TOKEN}"`
- **THEN** the resolved header is supplied to that server's transport
- **AND** its value is treated as a secret by every downstream surface

#### Scenario: Portable HTTP entry loads

- **WHEN** `mcpServers.web` contains `{ "type": "http", "url": "https://example.test/mcp" }`
- **THEN** llame configures the Streamable HTTP server named `web`

#### Scenario: Explicit Streamable HTTP alias loads

- **WHEN** `mcpServers.web.type` is `streamable-http`
- **THEN** llame configures the same transport as `http`

#### Scenario: Duplicate server property fails startup

- **WHEN** the JSONC source declares `mcpServers.web` more than once
- **THEN** startup fails naming the duplicate property instead of keeping one value

#### Scenario: Reserved namespace separator is rejected

- **WHEN** an MCP server name contains `__`
- **THEN** startup fails before any namespaced tool id can become ambiguous

#### Scenario: Overlength server name fails startup

- **WHEN** an MCP server name contains more than 56 ASCII characters
- **THEN** startup fails before discovery using the same generated-id bound as `mcp-tool-id-v1`

#### Scenario: Reserved transport header is rejected

- **WHEN** an entry attempts to configure a transport-owned header using any case variant, such as `mcp-session-id` or `Mcp-Protocol-Version`
- **THEN** startup fails naming the header path without printing its value

#### Scenario: URL userinfo is rejected without disclosure

- **WHEN** `mcpServers.web.url` contains a username or password component
- **THEN** startup fails naming `mcpServers.web.url` without printing the credential-bearing URL

#### Scenario: Case-variant duplicate headers are rejected

- **WHEN** one server entry configures both `Authorization` and `authorization`
- **THEN** startup fails naming the colliding header paths without printing either value

#### Scenario: Missing type fails startup

- **WHEN** an `mcpServers` entry omits `type`
- **THEN** startup fails naming the entry rather than inferring a transport from its other fields

#### Scenario: Cross-variant field is rejected

- **WHEN** a remote entry also declares a field belonging to the stdio variant
- **THEN** startup fails naming the unknown field for that entry

### Requirement: Local stdio MCP servers use a command-and-arguments entry shape

An `mcpServers` entry whose `type` is `"stdio"` SHALL be shaped exactly as `{ type, command, args?, env?, cwd? }`. `command` SHALL be a non-empty string naming an executable, resolved against the child process's search path or given as a host path. `args`, when present, SHALL be an ordered array of strings. There SHALL be no field accepting a whole command line as one shell-interpreted string. `env`, when present, SHALL map non-empty variable names to string values. `cwd`, when present, SHALL be a string naming the child process's working directory. There SHALL be no field for disabling an entry in place; the configuration file is JSONC, so an entry that should not run is commented out or removed.

`command`, each element of `args`, and each `env` value SHALL support llame's existing `{env:…}` and `{path:…}` interpolation rules. No other interpolation syntax SHALL be introduced for these fields; a `${…}` sequence carries no meaning and is ordinary text.

Unknown fields, an empty `command`, a non-string argument, an empty variable name, and fields belonging to a remote entry SHALL fail startup naming only the configuration path, without printing resolved argument or environment values.

The operator-facing surface SHALL state plainly that a configured stdio server executes on the llame host with llame's own filesystem and network access and is not sandboxed, so configuring one is a trust decision equivalent to installing software on that host. It SHALL also state that a credential interpolated into `args` becomes part of that child process's argv, observable by another process on the host, and that `env` SHALL be used for credential values instead — the `mcp-tools` capability's protected-value redaction covers what llame itself logs, persists, and sends to a model, and cannot reach argv visible to another process.

#### Scenario: Portable stdio entry loads

- **WHEN** `mcpServers.files` contains `{ "type": "stdio", "command": "node", "args": ["/srv/mcp/files.js"] }`
- **THEN** llame configures the stdio server named `files`

#### Scenario: Interpolated environment secret loads

- **WHEN** a stdio entry declares `"env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "{env:GITHUB_MCP_PAT}" }`
- **THEN** the resolved value is supplied to that server's child process
- **AND** its value is treated as a secret by every downstream surface

#### Scenario: Shell-style interpolation is literal text

- **WHEN** a stdio entry's argument contains `${HOME}`
- **THEN** that text is passed through unchanged rather than expanded

#### Scenario: Unknown stdio field fails startup

- **WHEN** a stdio entry declares a field outside `type`, `command`, `args`, `env`, and `cwd`
- **THEN** startup fails naming the unknown configuration path

#### Scenario: Secret-bearing stdio error stays opaque

- **WHEN** a stdio entry's `env` interpolation references a missing secret
- **THEN** startup fails naming the configuration path without printing any resolved or partial value

### Requirement: Tool allowlist validation distinguishes code-owned and declared dynamic ids

At startup, every code-owned id in `tools.allowed` SHALL still be required to exist in the code-owned registry. An exact entry beginning with `mcp__` SHALL instead be parsed with `mcp-tool-id-v1`'s exact namespace grammar, 64-character bound, and canonical tool-segment rules, without looking up the server id in the currently configured MCP servers. The only wildcard entry SHALL be exactly `mcp__<server>__*`, where `<server>` satisfies the MCP server-id grammar and bound (1–56 ASCII letters, digits, `_`, or `-`, excluding `__`) and `*` is the entire tool segment. Startup SHALL accept an otherwise valid exact id or wildcard whether or not a matching MCP server is currently configured or discovered. It SHALL reject bare `*`, partial or mid-string globs, multiple wildcards, wildcard server names, malformed separators, noncanonical or malformed server ids, and noncanonical exact tool segments. Validation of either MCP entry form SHALL NOT depend on connecting to a server or discovering a remote tool. Any other unknown entry SHALL fail startup.

Both exact and namespace MCP entries SHALL be eligibility predicates over the safely admitted process-local inventory supplied by a matching server. Neither form SHALL create an eligible identity when that inventory does not contain or remember one. Runtime admission and source ownership therefore remain authoritative: a matching exact id becomes available only after fresh discovery and admission. `tools.permissions` SHALL independently authorize each call, and neither allowlist entries nor MCP metadata SHALL bypass a rejecting or absent permission group.

#### Scenario: Unknown code-owned id still fails boot

- **WHEN** `tools.allowed` contains `not_a_real_tool`
- **THEN** startup fails naming `tools.allowed` and the unknown id

#### Scenario: Offline MCP tool id does not fail boot

- **WHEN** `tools.allowed` contains `mcp__web__search`, server `web` is configured, and that server is offline
- **THEN** startup succeeds
- **AND** the allowlist does not fabricate an eligible or unavailable tool identity

#### Scenario: Offline MCP namespace wildcard does not fail boot

- **WHEN** `tools.allowed` contains `mcp__web__*`, server `web` is configured, and a fresh process has not successfully discovered that server
- **THEN** startup succeeds without waiting for discovery
- **AND** the allowlist does not fabricate any exact tool identity

#### Scenario: MCP id names an undeclared server

- **WHEN** `tools.allowed` contains `mcp__playwright__search` or `mcp__playwright__*` and no MCP server named `playwright` is configured
- **THEN** startup succeeds without waiting for server discovery
- **AND** neither entry fabricates an eligible or unavailable tool identity

#### Scenario: Malformed MCP id fails boot

- **WHEN** an allowlist entry begins with `mcp__` but is neither an exact canonical MCP tool id nor the exact namespace wildcard form, including an id with an invalid server-id segment
- **THEN** startup fails naming the malformed entry

#### Scenario: Broad and partial wildcard forms fail boot

- **WHEN** `tools.allowed` contains bare `*`, a wildcard server segment, a partial tool-name glob, a mid-string wildcard, or multiple wildcards
- **THEN** startup fails naming the unsupported entry

#### Scenario: Similar server prefix does not match

- **WHEN** `mcp__web__*` is configured alongside servers `web` and `webExtra`
- **THEN** the pattern names only the canonical `web` namespace
- **AND** startup validation does not treat `webExtra` as a match

### Requirement: Embedding model catalog configuration

The config file SHALL support an optional top-level `embeddingModels` array declaring the embedding models an instance may use. Each entry SHALL include a required opaque `id` (the stable internal key that stored vectors reference), a required `provider` referencing a defined `providers[].id` whose type supports embeddings (`openai-responses` or `openai-completions`; the embeddings call is wire-independent), a required server-only `providerModelId`, and a required positive-integer `dimensions`. Each entry MAY include a distance metric, a model revision, a positive-integer `batchSize` bounding how many documents are sent per provider request, and optional asymmetric `documentPrefix` / `queryPrefix` strings. Embedding models SHALL reuse the existing `providers[]` connections rather than introducing a parallel credential or endpoint concept, so the same interpolation, keyless-provider, and secret-redaction rules apply unchanged.

The config file SHALL additionally support a per-corpus intended-embedding-model setting naming an `embeddingModels[].id`. Selection SHALL be expressed per corpus rather than as one instance-wide flag, so corpora embedding at different rates cannot strand one another; a corpus with no setting has no intended model and produces no embedding work.

Embedding selection is **operator** configuration, not tenant configuration: background indexing is instance-scoped and is not performed per request or per user, so no per-user embedding credential exists.

A duplicate `id`, an entry whose `provider` does not reference a defined provider with embedding support, a non-positive `dimensions`, or a corpus activation naming an undeclared embedding model id SHALL fail startup naming the offending entry and the dangling reference, applying no partial catalog.

#### Scenario: Embedding model references a defined provider

- **WHEN** an `embeddingModels[]` entry's `provider` names an `openai-responses` or `openai-completions` provider defined in `providers[]`
- **THEN** the embedding model is loaded against that provider connection
- **AND** startup succeeds

#### Scenario: Embedding model references an undefined provider

- **WHEN** an `embeddingModels[]` entry's `provider` matches no `providers[].id`
- **THEN** startup fails naming the embedding model id and the unknown provider reference
- **AND** no partial catalog is applied

#### Scenario: A self-hosted embedding backend needs no new configuration concept

- **WHEN** an operator declares a keyless local `openai-completions` provider in `providers[]` and an `embeddingModels[]` entry referencing it
- **THEN** the embedding model is loaded against that local endpoint
- **AND** no embedding-specific credential, endpoint, or interpolation rule is introduced

#### Scenario: Dimensions are required and validated

- **WHEN** an entry omits `dimensions` or sets it non-positive
- **THEN** startup fails naming the offending embedding model id

#### Scenario: Corpus activation must reference the catalog

- **WHEN** a corpus is configured to be served by an embedding model id that matches no `embeddingModels[].id`
- **THEN** startup fails naming the dangling reference
- **AND** the instance does not begin serving requests

#### Scenario: Omitting the section is valid and degrades to lexical

- **WHEN** the config file declares no `embeddingModels`
- **THEN** startup succeeds, no embedding work is scheduled, and search behavior is unchanged

#### Scenario: Embedding provider credentials are never exposed

- **WHEN** an embedding model's provider `key` resolves to a credential and a load-time or runtime error concerns that entry
- **THEN** the error names the embedding model id and the field, and the resolved value appears in no log line, error, or diagnostic output

#### Scenario: Subscription inference provider is not an embedding backend

- **WHEN** an embedding model references an `openai-codex` provider
- **THEN** startup fails identifying the unsupported embedding binding
- **AND** no partial catalog is applied

### Requirement: Boolean reasoning metadata is replaced by the reasoning object

The `models[].reasoning` boolean SHALL NOT be accepted. A config file setting `reasoning` to a boolean SHALL fail startup naming the model id and directing the operator to the object form. The system SHALL NOT coerce, migrate, or default the boolean into an object, because a boolean carries no effort vocabulary and any inferred vocabulary would be a guess about the provider.

#### Scenario: Boolean reasoning field is rejected

- **WHEN** a model entry sets `reasoning` to `true` or `false`
- **THEN** startup fails naming the model id and the expected object form
- **AND** no partial catalog is applied

#### Scenario: No silent migration from the boolean form

- **WHEN** a config file predating this change is loaded
- **THEN** the instance does not start with an inferred effort vocabulary
- **AND** the operator must author `effortLevels` and `defaultEffort` explicitly

### Requirement: Providers and models may declare their billing mode

A `providers[]` entry and a `models[]` entry can each declare an optional `billing` key. Its value
MUST be exactly `"usage"`, `"subscription"`, or `"free"`. `usage` means a price for each token.
`subscription` means a flat plan, under which a declared price is notional. `free` means the model is
never billed, and a declared price is also notional.

Another value MUST fail startup. A non-string and an interpolation token also fail. The error MUST
name the entry and the field. The system MUST accept the key on each provider `type`. The key is
server-only, and `GET /api/v1/models` MUST NOT return it. A config that omits it everywhere MUST
start as before. `run-usage-accounting` owns the resolution order of the billing mode, and
`model-roles` owns the derived `paid` flag of a role candidate.

#### Scenario: Declared billing modes boot

- **WHEN** a provider entry declares `"billing": "subscription"`, and one of its models declares `"billing": "usage"`
- **THEN** startup succeeds

#### Scenario: An unknown billing value fails startup

- **WHEN** a provider or model entry declares `"billing": "metered"`
- **THEN** startup fails, and the error names that entry and its `billing` field
- **AND** the system applies no part of the config

#### Scenario: A non-string or interpolated billing value fails startup

- **WHEN** a provider or model entry declares `"billing": true` or `"billing": "{env:BILLING}"`
- **THEN** startup fails before any interpolation resolves, and the error names that entry and its `billing` field

#### Scenario: Billing mode is not exposed in the model catalog

- **WHEN** an authenticated caller reads `GET /api/v1/models` for a model whose provider declares `billing`
- **THEN** the model entry holds no billing field

#### Scenario: A free model boots

- **WHEN** a model entry declares `"billing": "free"` and `pricingUsdPer1M`
- **THEN** startup succeeds

### Requirement: Web adapter configuration is a closed operator replacement

The optional `tools.webAdapters` setting SHALL be an ordered array of unique
entries. Each entry SHALL have the shape `{ id, use, ... }`, where `id` is a
non-empty operator-chosen identifier and `use` is exactly `github`, `bluesky`,
`npm`, `huggingface`, `arxiv`, `stackexchange`, `crates`, `hackernews`, `doi`, `discourse`, `devto`, `substack`, `osv`, `wikipedia`, `telegram`, `lobsters`, `luma`, `linkedin`, or `rewrite`. The array SHALL be an explicit replacement: absent SHALL mean
`[]`, while present SHALL enable exactly the listed entries. A `github` entry
SHALL have the shape `{ id, use: "github", token? }`; `token`, when present,
SHALL be an `{env:...}` or `{path:...}` interpolation token. A `bluesky` entry
SHALL have the shape `{ id, use: "bluesky" }` and accepts no credential; an
`npm` entry SHALL have the shape `{ id, use: "npm" }`, a `huggingface`
entry `{ id, use: "huggingface" }`, an `arxiv` entry
`{ id, use: "arxiv" }`, a `stackexchange` entry
`{ id, use: "stackexchange" }`, a `crates` entry `{ id, use: "crates" }`, a
`hackernews` entry `{ id, use: "hackernews" }`, a `doi` entry
`{ id, use: "doi" }`, a `devto` entry `{ id, use: "devto" }`, a `substack`
entry `{ id, use: "substack" }`, an `osv` entry `{ id, use: "osv" }`, a
`wikipedia` entry `{ id, use: "wikipedia" }`, a `telegram` entry
`{ id, use: "telegram" }`, a `lobsters` entry `{ id, use: "lobsters" }`, a
`luma` entry `{ id, use: "luma" }`, and a `linkedin` entry
`{ id, use: "linkedin" }`;
none accepts a credential. A `discourse` entry SHALL have
the shape `{ id, use: "discourse", hosts }`, where `hosts` is a non-empty
array of canonical lowercase hostnames without a port, validated like a
rewrite entry's `hosts`; it accepts no credential. A
`rewrite` entry SHALL
have the shape `{ id, use: "rewrite", hosts, pathPattern?, target }`, where
`hosts` is an array of exact canonical host matches,
`pathPattern` is an optional RE2-compatible regular expression compiled by
the same bounded matcher `tools.permissions` uses, searched unanchored
against the canonical path, and `target` is a literal `http` or `https`
origin followed by a path/query template. The target SHALL contain no
userinfo or fragment. `{path}` SHALL appear only in the path portion and
expands to the canonical path as-is; `{query}` SHALL appear only in the path
or query portion and expands to
`encodeURIComponent` of the canonical query without `?`. No other placeholder
is permitted.
Unknown fields, unknown uses, duplicate ids, invalid targets, malformed
templates, and invalid, oversized, or unsupported `pathPattern` values SHALL
fail startup before serving requests.
An `{env:...}` or `{path:...}` token in any non-secret field SHALL fail startup
naming the entry and field. A GitHub `token` SHALL be absent or use an
interpolation token; a literal token SHALL fail boot rather than be treated as
redacted. The loader SHALL reuse the existing single-pass interpolation and
redaction behavior for secret fields.

#### Scenario: An explicit empty list enables no adapter

- **WHEN** the file sets `tools.webAdapters: []`
- **THEN** no adapter is enabled
- **AND** a matching URL uses only the generic ladder, with no adapter origin
  contacted

#### Scenario: Declared rewrite is the only third-party contact

- **WHEN** the file declares one rewrite entry matching a URL
- **THEN** only that declared rewrite origin may be contacted for adapter
  fetching
- **AND** an unclaimed URL uses the generic ladder with no adapter request and
  no adapter note

#### Scenario: GitHub token uses existing secret interpolation

- **WHEN** a GitHub entry sets `token` to `{env:GITHUB_READ_TOKEN}` or
  `{path:/run/secrets/github-token}`
- **THEN** startup resolves the token through the existing interpolation
  resolver
- **AND** the resolved value is not written to logs, errors, diagnostics, or
  model-visible adapter notes

#### Scenario: Unknown adapter use fails closed

- **WHEN** an entry sets `use: "nitter"`
- **THEN** startup fails naming `tools.webAdapters` and that entry
- **AND** no partial adapter list is applied

#### Scenario: Duplicate adapter ids fail boot

- **WHEN** two entries use the same `id`
- **THEN** startup fails before serving requests
- **AND** neither entry is silently replaced

#### Scenario: Invalid rewrite target fails boot

- **WHEN** a rewrite target is non-http(s) such as `file:///tmp/x`, contains
  userinfo such as `https://user:secret@example.test/x`, has a fragment,
  places `{path}` in its scheme, host, port, or query, uses an unknown
  placeholder
  such as `{source}`, or has a malformed template
- **THEN** startup fails naming the entry and `target`
- **AND** the instance does not start with that rewrite enabled

#### Scenario: Invalid rewrite path pattern fails boot

- **WHEN** a rewrite entry supplies an invalid, oversized, or unsupported (for
  example a backreference or lookbehind) `pathPattern`
- **THEN** startup fails naming the entry and `pathPattern`
- **AND** no partial adapter configuration is applied

#### Scenario: Non-secret interpolation fails boot

- **WHEN** `{env:HOST}` or `{path:/run/secrets/value}` appears in
  `hosts`, `target`, `pathPattern`, or another non-secret field
- **THEN** startup fails naming the entry and field before resolving the token
- **AND** no partial adapter configuration is applied

#### Scenario: Literal GitHub token is rejected

- **WHEN** a GitHub entry supplies a literal token rather than an
  `{env:...}` or `{path:...}` interpolation
- **THEN** startup fails naming the token field because the literal cannot
  receive secret redaction
- **AND** no GitHub request is issued

#### Scenario: Adapter headers field fails boot

- **WHEN** any entry declares a `headers` field
- **THEN** startup fails naming the entry and unknown field
- **AND** no adapter request is issued

### Requirement: Operator configuration enables Run permission modes

The configuration MUST accept an optional `tools.permissionModes` array under the closed published schema. Its built-in default MUST be `["default"]`. Each item MUST be one of the known mode values `"default"`, `"bypass"`, and `"read-only"`. A supplied array MUST be non-empty, MUST contain no duplicate, and MUST contain `"default"`. These cases MUST fail startup with a diagnostic that names `tools.permissionModes`. The cases are an empty array, an unknown value, a non-string item, a duplicate, and an array without `"default"`. The failure MUST occur before the process serves requests or claims jobs. Item values are literal, and the configuration MUST NOT accept interpolation tokens in them. The system MUST keep the array order as the publication order of the enabled modes.

When the operator enables a mode other than `"default"`, every authenticated user can select it for their own Runs. The configuration MUST NOT provide a per-user restriction. `tools.permissionModes` MUST NOT change the meaning of `tools.allowed`, `tools.permissions`, or any other setting.

#### Scenario: Omitted modes enable only default

- **WHEN** the configuration omits `tools.permissionModes`
- **THEN** startup succeeds and the enabled modes are `["default"]`

#### Scenario: Bypass is enabled explicitly

- **WHEN** the configuration sets `tools.permissionModes` to `["default", "bypass"]`
- **THEN** startup succeeds and both modes are enabled in that order

#### Scenario: A list without default fails startup

- **WHEN** the configuration sets `tools.permissionModes` to `["bypass"]` or `[]`
- **THEN** startup fails with a diagnostic that names `tools.permissionModes`

#### Scenario: Unknown or repeated modes fail startup

- **WHEN** the configuration sets `tools.permissionModes` to `["default", "yolo"]` or `["default", "default"]`
- **THEN** startup fails with a diagnostic that names `tools.permissionModes`

#### Scenario: Interpolated mode values are rejected

- **WHEN** an item of `tools.permissionModes` is `{env:LLAME_MODE}`
- **THEN** startup fails with a diagnostic that names `tools.permissionModes`

#### Scenario: Read-only is enabled explicitly

- **WHEN** the configuration sets `tools.permissionModes` to `["default", "read-only", "bypass"]`
- **THEN** startup succeeds and the three modes are enabled in that order

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

### Requirement: Web search engine entries have fixed per-type shapes

Each engine entry except `aggregate` can set `timeoutSeconds`, a positive integer with the default 60. An `aggregate` entry MUST NOT set it. `brave`, `exa`, and `perplexity` MUST have a `key`, and `exa-mcp` can have one. `searxng` MUST have an absolute `http:` or `https:` `baseUrl`. `duckduckgo` has no field for its type. `aggregate` MUST have `engines` with two or more distinct ids. `model-hosted` MUST have `model`. Each `key` and `baseUrl` MUST be an interpolated secret.

#### Scenario: Missing key fails startup

- **WHEN** a `perplexity` engine has no `key`
- **THEN** startup fails and names the `key` path of that entry

#### Scenario: Interpolated key is never disclosed

- **WHEN** the `key` of a `brave` engine is `{env:BRAVE_API_KEY}`, the variable is set, and the requests of the engine fail with HTTP 401
- **THEN** the value of the variable occurs in no startup error, tool output, Run event, or log

#### Scenario: Relative SearXNG URL fails startup

- **WHEN** a `searxng` engine sets `baseUrl` to `search.local/`
- **THEN** startup fails and names the `baseUrl` path of that entry

### Requirement: Web search references are validated at startup

Each id in `webSearch.chain` and in the `engines` of an `aggregate` entry MUST name a defined engine. An `aggregate` child MUST NOT be an `aggregate`. The `model` of a `model-hosted` entry MUST name a `models[]` entry with the resolved wire `openai-responses`, `openai-codex`, or `anthropic-messages`. This admission checks the wire, not the gateway's support for hosted search tools. Each violation MUST fail startup and name the path of the violation.

#### Scenario: Unknown chain id fails startup

- **WHEN** `webSearch.chain` contains `exa` and no engine has that id
- **THEN** startup fails and names `webSearch.chain`

#### Scenario: Nested aggregate fails startup

- **WHEN** an `aggregate` entry lists another `aggregate` entry in its `engines`
- **THEN** startup fails and names the `engines` path of that entry

#### Scenario: Hosted engine on an unsupported wire fails startup

- **WHEN** a `model-hosted` entry names a model with the resolved wire `openai-completions`
- **THEN** startup fails and names the `model` path of that entry

#### Scenario: A gateway model has a hosted-search-capable wire

- **WHEN** a `model-hosted` entry names an OpenCode Go `claude-haiku-5-5` model
- **THEN** startup accepts its resolved `anthropic-messages` wire
- **AND** any gateway rejection of hosted search is a request failure, not a fallback to another wire

#### Scenario: Duplicate aggregate child fails startup

- **WHEN** an `aggregate` entry sets `engines` to `["brave", "brave"]`
- **THEN** startup fails and names the `engines` path of that entry

#### Scenario: Hosted engine inside an aggregate fails startup

- **WHEN** an `aggregate` entry lists a `model-hosted` engine whose model has the provider type `openai-completions`
- **THEN** startup fails and names the `model` path of that hosted entry

#### Scenario: Hosted engine inside an aggregate loads

- **WHEN** an `aggregate` entry lists a `model-hosted` engine on a supported provider type and a `brave` engine
- **THEN** startup succeeds

### Requirement: Allowlisting web search requires a configured chain

When `tools.allowed` contains `web_search`, startup SHALL fail unless `webSearch.chain` is configured, naming `webSearch.chain`. A configured `webSearch` without that allowlist entry SHALL load and SHALL NOT expose the tool.

#### Scenario: Allowlisted without configuration

- **WHEN** `tools.allowed` contains `web_search` and the file has no `webSearch`
- **THEN** startup fails naming `webSearch.chain`

#### Scenario: Configured but not allowlisted

- **WHEN** `webSearch` is configured and `tools.allowed` omits `web_search`
- **THEN** startup succeeds and no attempt declares `web_search`

### Requirement: New web search engine types have fixed shapes

A `deepseek` entry MUST have a `key`. A `parallel` entry MUST have a `key` and can have `mode` with the value `turbo`, `fast`, `basic`, or `advanced`. The default `mode` is `fast`. A `parallel-mcp` entry MUST NOT have a `key` or another field for its type. Each `key` MUST be an interpolated secret.

#### Scenario: Unknown Parallel mode fails startup

- **WHEN** a `parallel` engine sets `mode` to `deep`
- **THEN** startup fails and names the `mode` path of that entry

#### Scenario: Parallel mode defaults to fast

- **WHEN** a `parallel` engine sets no `mode`
- **THEN** startup succeeds and the engine sends `mode: "fast"`

#### Scenario: Keyless Parallel MCP refuses a key

- **WHEN** a `parallel-mcp` engine sets `key`
- **THEN** startup fails and names the `key` path of that entry

### Requirement: Yandex web search engines have a fixed shape

A `yandex` entry MUST have a `key` and a `searchType` with the value `ru`, `tr`, `com`, `kk`, `be`, or `uz`. It can have a `folderId`. The `key` and the `folderId` MUST be interpolated secrets.

#### Scenario: Missing search type fails startup

- **WHEN** a `yandex` engine has no `searchType`
- **THEN** startup fails and names the `searchType` path of that entry

#### Scenario: Interpolated folder id is never disclosed

- **WHEN** the `folderId` of a `yandex` engine is `{env:YANDEX_FOLDER_ID}` and its requests fail with HTTP 403
- **THEN** the value of the variable occurs in no startup error, tool output, Run event, or log

### Requirement: Web search engine entries can carry a model-facing description

Each `webSearch.engines` entry, also an `aggregate`, can have a `description` of 1 to 200 characters on one line. The value MUST be literal text. An interpolation token or a line break MUST fail startup and name the `description` path. The model reads the value, so it MUST NOT hold a secret.

#### Scenario: A description loads

- **WHEN** a `yandex` engine sets `description` to `Russian-language and CIS sources`
- **THEN** startup succeeds

#### Scenario: An interpolated description fails startup

- **WHEN** an engine sets `description` to `{env:ENGINE_NOTE}`
- **THEN** startup fails and names the `description` path of that entry

#### Scenario: A multi-line description fails startup

- **WHEN** an engine `description` contains a line break
- **THEN** startup fails and names the `description` path of that entry

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
a `decisionModels[].id` or a `rerankModels[].id` and MUST resolve nonblank. An absent `rerank`
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

- **WHEN** the file sets `tools.grep.rerank.model` to an id that neither `decisionModels[]` nor `rerankModels[]` defines
- **THEN** startup fails and names `tools.grep.rerank.model`
- **AND** no walk ranks its results

#### Scenario: A blank grep rerank model fails startup

- **WHEN** the file sets `tools.grep.rerank.model` to a blank string or a value that resolves to blank
- **THEN** startup fails and names `tools.grep.rerank.model`
- **AND** no walk ranks its results

#### Scenario: An absent grep rerank block keeps walk order

- **WHEN** the file sets no `tools.grep.rerank` object
- **THEN** startup succeeds and every `grep` call keeps walk order

#### Scenario: The grep rerank block names a rerank model

- **WHEN** the file sets `tools.grep.rerank.model` to an id in `rerankModels[]`
- **THEN** startup succeeds and `grep` can rank its file runs with that rerank model

### Requirement: Operator configuration bounds tool-result artifacts

`tools.artifacts.maxBytes` MUST accept an integer of at least 131,072, or a
whole-value interpolation token. Its default is 8,388,608 (8 MiB). A smaller
value, a fraction, or an unknown key in `tools.artifacts` MUST fail startup
and name the path.

#### Scenario: The default bound applies

- **WHEN** the configuration has no `tools.artifacts` object
- **THEN** each artifact part is bounded at 8,388,608 bytes

#### Scenario: A bound below the floor fails startup

- **WHEN** `tools.artifacts.maxBytes` is 4,096
- **THEN** startup fails and names `tools.artifacts.maxBytes`

### Requirement: Operator configuration sets the web search fetch size

`webSearch.fetchLimit` MUST accept an integer from 1 to 100. Its default is 20. A value outside that range MUST fail startup and name the path.

#### Scenario: The default fetch size applies

- **WHEN** `webSearch` sets no `fetchLimit`
- **THEN** each call asks the engines for 20 results, clamped by each vendor maximum

#### Scenario: An out-of-range fetch size fails startup

- **WHEN** `webSearch.fetchLimit` is 500
- **THEN** startup fails and names `webSearch.fetchLimit`

### Requirement: Configured credentials form one protected set

At startup the API process MUST derive one set of configured credentials. The
set MUST stay in process memory and MUST NOT change after startup. llame MUST
NOT serialize it to an API, an event, a log, or model context, or send it to a
Machine or a remote host. llame sends values without the whitespace at their
two ends. If that trimmed form of a member passes the gate, the trimmed form
MUST also be a member.

#### Scenario: The set is never serialized

- **WHEN** a provider `key` resolves to `sk-canary-7Qx2Lm9Vb4Rt8Wn3` and an owner requests the model catalog or any other configuration-derived response
- **THEN** no response contains `sk-canary-7Qx2Lm9Vb4Rt8Wn3`

#### Scenario: A padded credential also counts trimmed

- **WHEN** a provider `key` resolves to `sk-canary-7Qx2Lm9Vb4Rt8Wn3` with two spaces at each end
- **THEN** the set contains the padded value and `sk-canary-7Qx2Lm9Vb4Rt8Wn3`

#### Scenario: The set never reaches a Machine or a remote host

- **WHEN** a run whose set holds `sk-canary-7Qx2Lm9Vb4Rt8Wn3` sends an `ssh://` command and a Machine command that do not contain it
- **THEN** neither request to the remote host nor request to the Machine contains `sk-canary-7Qx2Lm9Vb4Rt8Wn3`

### Requirement: Only high-entropy values are members

A member MUST have at least 16 characters and an estimated entropy of at
least 64 bits. The estimate is the length times the Shannon entropy per
character of the value's own characters. A value below either bound MUST NOT
be a member, so llame does not redact it from a command result or an upstream
failure. llame MUST NOT detect a credential by its format.

#### Scenario: A short or simple value is not a member

- **WHEN** `POSTGRES_URL` is `postgres://app:app@db:5432/llame` and a provider declares the literal `key` `app`
- **THEN** the set contains neither `app` nor `postgres`
- **AND** a bash result that prints `apps/api/src` is unchanged

#### Scenario: A long repetitive value is not a member

- **WHEN** a provider declares the literal `key` `aaaaaaaaaaaaaaaaaaaa`
- **THEN** the set does not contain it

#### Scenario: A 32-character hexadecimal key is a member

- **WHEN** a provider declares the literal `key` `9f2c7b1e4d8a6350c9e2b7f4a1d8635e`
- **THEN** the set contains that key

#### Scenario: A long passphrase is a member

- **WHEN** a provider declares the literal `key` `correct horse battery staple`
- **THEN** the set contains that key

#### Scenario: A format alone does not make a member

- **WHEN** a provider declares the literal `key` `sk-1065-short`
- **THEN** the set does not contain it, although the value begins with `sk-`

### Requirement: Credential fields are members

The set MUST contain each provider `key` that passes the gate. This rule
covers every provider type. A keyless provider MUST contribute no value. The
set MUST contain each web search engine `key` and the `github` web adapter
`token` that passes the gate.

#### Scenario: Credential fields are members

- **WHEN** a provider declares `key: "{env:OPENAI_KEY}"` and `OPENAI_KEY` holds `sk-canary-7Qx2Lm9Vb4Rt8Wn3`. A `brave` engine declares the literal key `brave-7Qx2Lm9Vb4Rt8Wn3`. A `yandex` engine declares `key: "{env:YANDEX_KEY}"` and `YANDEX_KEY` holds `yandex-7Qx2Lm9Vb4Rt8Wn3`. The `github` adapter declares `token: "{env:GH_TOKEN}"` and `GH_TOKEN` holds `ghp_9rT2xK7pLm4Vb8Qn1Wc6Zd3Fh5Js0YaE`
- **THEN** the set contains each of those four resolved values

### Requirement: A selected JSON document contributes its credential leaves

A `{path:…|json:…}` substitution in a member position selects a document. Each
credential-shaped string leaf of that document that passes the gate MUST be a
member, whether or not the selected value passes. A name is credential-shaped
when it contains, without regard to case, `authorization`, `cookie`,
`credential`, `token`, `key`, `secret`, `passw`, or `signature`. Array
elements under such a name count as leaves. The loader MUST read the leaves in
the same file read that selects the value.

#### Scenario: A Codex auth document contributes its tokens

- **WHEN** an `openai-codex` provider's `key` is `{path:/run/secrets/codex-auth.json|json:/tokens/access_token}` and the access token is `at-7Qx2Lm9Vb4Rt8Wn3`. That file also holds `tokens.refresh_token` `rt-7Qx2Lm9Vb4Rt8Wn3`, `tokens.id_token` `id-7Qx2Lm9Vb4Rt8Wn3`, and a `last_refresh` timestamp
- **THEN** the set contains the access token, the refresh token, and the id token
- **AND** it does not contain the timestamp

#### Scenario: An array under a credential name contributes its elements

- **WHEN** the selected document holds `tokens.api_keys` as the array `["ak-7Qx2Lm9Vb4Rt8Wn3", "bk-7Qx2Lm9Vb4Rt8Wn3"]`
- **THEN** the set contains both elements

### Requirement: Environment credentials are members

The set MUST contain the `POSTGRES_URL` password, as written and
percent-decoded, and `PGPASSWORD`, each when it passes the gate. The loader
MUST read them from the process environment that it was given. The set MUST
NOT contain the whole `POSTGRES_URL`.

#### Scenario: The database password and PGPASSWORD are members

- **WHEN** `POSTGRES_URL` is `postgres://app:pw%407Qx2Lm9Vb4Rt8Wn3@db:5432/llame` and `PGPASSWORD` is `pgp-7Qx2Lm9Vb4Rt8Wn3`
- **THEN** the set contains `pw%407Qx2Lm9Vb4Rt8Wn3`, `pw@7Qx2Lm9Vb4Rt8Wn3`, and `pgp-7Qx2Lm9Vb4Rt8Wn3`
- **AND** it does not contain the whole `POSTGRES_URL`

### Requirement: Header and stdio env substitutions are members

Each resolved `{env:…}` or `{path:…}` substitution in a provider or remote MCP
server's `headers` MUST be a member when it passes the gate. The same rule
applies to each stdio MCP server `env` value. The set MUST NOT contain literal
text around a substitution or `:-` fallback text.

#### Scenario: Header and stdio env substitutions are members

- **WHEN** a provider header is `"Authorization": "Bearer {path:/run/secrets/gw}"` and the file holds `gw-7Qx2Lm9Vb4Rt8Wn3`. A remote MCP header is `{env:MCP_GW_KEY}` and `MCP_GW_KEY` holds `mcp-gw-7Qx2Lm9Vb4Rt8Wn3`. A stdio MCP server's `env` value is `{env:MCP_TOKEN}` and `MCP_TOKEN` holds `mcp-7Qx2Lm9Vb4Rt8Wn3`
- **THEN** the set contains `gw-7Qx2Lm9Vb4Rt8Wn3`, `mcp-gw-7Qx2Lm9Vb4Rt8Wn3`, and `mcp-7Qx2Lm9Vb4Rt8Wn3`
- **AND** it does not contain `Bearer`, a header name, a variable name, or text around a substitution

#### Scenario: A fallback text is not a member

- **WHEN** a provider header is `X-Api-Key: {env:GW_KEY:-fb-7Qx2Lm9Vb4Rt8Wn3}` and `GW_KEY` is unset
- **THEN** the set does not contain `fb-7Qx2Lm9Vb4Rt8Wn3` or `X-Api-Key`

### Requirement: Other settings are not members

The set MUST NOT contain a provider `baseUrl`, a remote MCP `url`, or any part
of either. It MUST NOT contain a substitution in a stdio `command` or `args`,
or a literal header value. It MUST NOT contain the `openai-codex` `accountId`,
the `yandex` `folderId`, or a resolved `{session:…}` value. It MUST NOT
contain the keyless placeholder. It MUST NOT contain any configuration value
that the membership requirements do not name.

#### Scenario: URLs and their parts are not members

- **WHEN** a remote MCP `url` is the literal `https://mcp.example/mcp?apiKey=sk-canary-7Qx2Lm9Vb4Rt8Wn3&region=eu-west-1`. A provider `baseUrl` is `{env:GATEWAY_URL}` and `GATEWAY_URL` holds `https://gateway.example/v1?signature=gw-7Qx2Lm9Vb4Rt8Wn3`
- **THEN** the set contains no part of either URL

#### Scenario: A stdio command and args are not members

- **WHEN** a stdio MCP server's `command` is `{env:MCP_BIN}` and an `args` value is `{env:MCP_TOKEN}`, and those variables hold `mcp-bin-7Qx2Lm9Vb4Rt8Wn3` and `mcp-token-7Qx2Lm9Vb4Rt8Wn3`
- **THEN** the set contains neither value

#### Scenario: A literal header value is not a member

- **WHEN** a remote MCP server declares a literal `X-Api-Key` header whose value is `hdr-7Qx2Lm9Vb4Rt8Wn3`, and a literal `X-Region` header whose value is `eu-west-1`
- **THEN** the set contains neither value

#### Scenario: The account ID, session value, and folder ID are not members

- **WHEN** an `openai-codex` provider declares `accountId: acct-7Qx2Lm9Vb4Rt8Wn3`, a header holds `{session:id}` with the value `sess-7Qx2Lm9Vb4Rt8Wn3`, and a `yandex` engine declares `folderId: folder-7Qx2Lm9Vb4Rt8Wn3`
- **THEN** the set contains none of those values

#### Scenario: Other interpolations are not members

- **WHEN** `knowledge.root` is `{env:KB_ROOT}`, a numeric configuration value is `{env:POOL_SIZE}`, and the `searxng` `baseUrl` is `{env:SEARXNG_URL}`
- **THEN** none of those resolved values is in the set

#### Scenario: A keyless provider contributes nothing

- **WHEN** a provider's `key` is omitted or resolves blank
- **THEN** no value from that provider's `key` is in the set. The keyless placeholder that llame sends on the wire is also not a member

### Requirement: Decision model catalog configuration

The config file MUST accept an optional top-level `decisionModels` array
beside `embeddingModels`. An absent array MUST mean that no decision model
exists. Each entry MUST be `{ id, provider, providerModelId, wire?, limits? }`.
`limits` MUST accept only `perQuestionContextTokens`,
`perRequestContextTokens`, `maxQuestionsPerRequest`, and
`maxConcurrentRequests`. Each limit MUST be a positive integer, or a
whole-value interpolation that resolves to one. When an entry declares both
token limits, the per-question limit MUST NOT exceed the per-request limit. An
invalid limit MUST fail startup and name its array-index path.

#### Scenario: A decision model catalog loads

- **WHEN** the file declares one `decisionModels` entry with an `id`, a `provider` of `type: "system-one"`, and a `providerModelId`
- **THEN** startup succeeds with that entry in the catalog
- **AND** no endpoint receives a request

#### Scenario: An absent catalog is valid

- **WHEN** the file declares no `decisionModels` array
- **THEN** startup succeeds
- **AND** no tool ranks its results

#### Scenario: A catalog entry declares limits

- **WHEN** a `decisionModels` entry sets `limits` to `{ perQuestionContextTokens: 1024, maxQuestionsPerRequest: 16, maxConcurrentRequests: 1 }`
- **THEN** startup succeeds
- **AND** the entry uses the default per-request limit

#### Scenario: A catalog entry declares an invalid limit

- **WHEN** the first `decisionModels` entry sets `limits.perRequestContextTokens` to `-1`, sets `limits.maxConcurrentRequests` to `2.5`, or sets an unknown `limits` field
- **THEN** startup fails and names the `decisionModels[0].limits` path

#### Scenario: A per-question limit exceeds the per-request limit

- **WHEN** the first `decisionModels` entry sets `perQuestionContextTokens: 65536` and `perRequestContextTokens: 32768`
- **THEN** startup fails and names the `decisionModels[0].limits` path

### Requirement: Decision model catalog ids are unique

Each `decisionModels[].id` MUST be a nonblank string, and an id MUST be unique
in the array. A blank or duplicate id MUST fail startup and name the
affected array-index paths, never an interpolated value.

#### Scenario: A duplicate decision model id fails startup

- **WHEN** two `decisionModels` entries share the id `jev`
- **THEN** startup fails and names the two `decisionModels` array indices

#### Scenario: A blank decision model id fails startup

- **WHEN** a `decisionModels` entry has an `id` that is blank or resolves to blank
- **THEN** startup fails and names that entry's `decisionModels[<index>].id` path

### Requirement: Decision model catalog entries name a supported account

Each `decisionModels[].provider` MUST name a `providers[].id`.
An unknown provider MUST fail startup naming its array-index `.provider` path.
The entry MUST resolve a decision wire (`system-one` or
`openrouter-decisions`) and a nonblank account key;
unsupported routing MUST fail startup at the entry's `.wire` path.

#### Scenario: An unknown decision model provider fails startup

- **WHEN** a `decisionModels` entry names a `provider` that `providers[]` does not define
- **THEN** startup fails and names `decisionModels[0].provider` for the first entry

#### Scenario: A decision model without a default or override fails startup

- **WHEN** a decision entry names an `openai-completions` provider and declares no wire
- **THEN** startup fails and names `decisionModels[0].wire` for the first entry
- **AND** no decision client is built

### Requirement: Decision model catalog entries carry a provider model id

Each `decisionModels[].providerModelId` MUST be a nonblank string, sent
verbatim as the wire `model`. A blank `providerModelId` MUST fail startup and
name the array-index path, such as `decisionModels[0].providerModelId`. An
entry that sets `model` MUST fail startup.

#### Scenario: A catalog entry carries a model id

- **WHEN** a `decisionModels` entry sets `providerModelId` to `jev-1.13`
- **THEN** startup succeeds and the provider receives that model id on every call
- **AND** the entry has no field for a price

#### Scenario: A blank decision model name fails startup

- **WHEN** a `decisionModels` entry has a `providerModelId` that is blank or resolves to blank
- **THEN** startup fails and names `decisionModels[0].providerModelId` for the first entry

#### Scenario: The former field name fails startup

- **WHEN** a `decisionModels` entry sets `model` instead of `providerModelId`
- **THEN** startup fails and names the first entry of `decisionModels`

### Requirement: Decision model catalog fields accept interpolation

`id`, `provider`, and `providerModelId` MUST accept `{env:…}` and `{path:…}`
interpolation. A field that resolves blank MUST fail startup and name its
array-index path. Diagnostics MUST NOT print interpolated catalog values.

#### Scenario: An interpolated provider id resolves at startup

- **WHEN** a `decisionModels` entry sets `provider` to `{env:DECISION_PROVIDER}` and the variable holds a System One provider id
- **THEN** startup succeeds and the entry binds to that provider

#### Scenario: An empty interpolation fails startup

- **WHEN** a `decisionModels` entry sets `providerModelId` to `{env:DECISION_MODEL:-}` and the variable is unset
- **THEN** startup fails and names `decisionModels[0].providerModelId` for the first entry

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
MUST name a `decisionModels[].id` or a `rerankModels[].id` and MUST resolve nonblank. An absent
`rerank` object MUST mean no ranking. An unknown id or a blank `model` MUST
fail startup and name `webSearch.rerank.model`.

#### Scenario: The web search rerank block names a catalog entry

- **WHEN** the file sets `webSearch.rerank.model` to an id in `decisionModels[]`
- **THEN** startup succeeds and `web_search` can rank the results of its calls with that decision model

#### Scenario: An unknown web search rerank model fails startup

- **WHEN** the file sets `webSearch.rerank.model` to an id that neither `decisionModels[]` nor `rerankModels[]` defines
- **THEN** startup fails and names `webSearch.rerank.model`
- **AND** no call ranks its results

#### Scenario: A blank web search rerank model fails startup

- **WHEN** the file sets `webSearch.rerank.model` to a blank string or a value that resolves to blank
- **THEN** startup fails and names `webSearch.rerank.model`
- **AND** no call ranks its results

#### Scenario: An absent web search rerank block keeps engine order

- **WHEN** the file sets no `webSearch.rerank` object
- **THEN** startup succeeds and every `web_search` result keeps engine order

#### Scenario: The web search rerank block names a rerank model

- **WHEN** the file sets `webSearch.rerank.model` to an id in `rerankModels[]`
- **THEN** startup succeeds and `web_search` can rank the results of its calls with that rerank model

### Requirement: Model kinds require a supported wire

Each model entry MUST resolve a supported wire for its catalogue kind before
startup succeeds. Explicit overrides MAY select a supported wire at the same
account destination; a provider without a default for that kind MUST require
an override. Startup failures MUST name the model's `.wire` field.

#### Scenario: A chat model names a decision profile without a wire

- **WHEN** a `models[]` entry names a `system-one` provider with no wire override
- **THEN** startup fails naming `models[<id>].wire`
- **AND** no chat client is built

#### Scenario: An embedding model names a rerank profile without a wire

- **WHEN** an `embeddingModels[]` entry names a `cohere-rerank` provider with no override
- **THEN** startup fails naming `embeddingModels[<id>].wire`
- **AND** no partial catalogue applies

#### Scenario: A shared gateway explicitly supports another kind

- **WHEN** a model declares a valid kind-specific wire at a configurable account
- **THEN** startup accepts the explicit route without duplicating the account

### Requirement: Operator configuration bounds host commands

`tools.bash.backgroundAfterSeconds` MUST accept an integer of at least 1, and its default is 120.
`tools.bash.maxProcesses` MUST accept an integer of at least 1, and its default is 64. Each
value can be a whole-value interpolation token. A smaller value, a fraction, an unsafe integer,
or an unknown key in `tools.bash` MUST fail startup and name the path.

#### Scenario: The defaults apply

- **WHEN** the configuration has no `tools.bash` object and no `tools.callTimeoutSeconds`
- **THEN** a host command that still runs after 120 seconds moves to the background, and one worker process runs at most 64 commands

#### Scenario: An unknown key fails startup

- **WHEN** `tools.bash.timeoutSeconds` is set
- **THEN** startup fails and names `tools.bash.timeoutSeconds`

### Requirement: Operator configuration bounds background jobs

`tools.jobs.maxSeconds` MUST accept an integer of at least 60, and its default is 7,200.
`tools.jobs.allowUnlimited` MUST accept a boolean, and its default is `false`. A smaller value, a
fraction, or an unknown key in `tools.jobs` MUST fail startup and name the path. The API MUST
NOT return these values to a client.

#### Scenario: A lifetime below the floor fails startup

- **WHEN** `tools.jobs.maxSeconds` is 10
- **THEN** startup fails and names `tools.jobs.maxSeconds`

### Requirement: The call timeout caps the foreground bound of host bash

The foreground bound of a host `bash` call MUST be the lesser of
`tools.bash.backgroundAfterSeconds` and `tools.callTimeoutSeconds`. At that bound the command
MUST move to the background, and it MUST NOT stop. `tools.callTimeoutSeconds` MUST still stop a
`bash` call on an `ssh://` directory and a `bash` call on a `machine://` directory.
The call timeout MUST NOT abort a host command. Its final result follows the durable promotion
settlement rules of `bash-execution`.

#### Scenario: A higher call timeout does not delay the background move

- **WHEN** `tools.callTimeoutSeconds` is 600 and `tools.bash.backgroundAfterSeconds` is 120
- **THEN** a host command moves to the background after 120 seconds

#### Scenario: A lower call timeout moves the command earlier

- **WHEN** `tools.callTimeoutSeconds` is 30 and `tools.bash.backgroundAfterSeconds` is 120
- **THEN** a host command moves to the background after 30 seconds, and it is not stopped

### Requirement: The operator caps the quota wait

`runs.quotaWaitMaxSeconds` MUST be a positive integer of seconds. Its default MUST be 691,200, which
is 8 days. It also accepts a whole-value interpolation token. A zero, negative, or fractional value
MUST fail startup and name the configuration path.

#### Scenario: The default cap

- **WHEN** the file omits `runs.quotaWaitMaxSeconds`
- **THEN** a Run waits for a reset time at most 691,200 seconds away

#### Scenario: A zero cap fails startup

- **WHEN** `runs.quotaWaitMaxSeconds` resolves to 0
- **THEN** startup fails and names `runs.quotaWaitMaxSeconds`, and zero is never read as no wait

### Requirement: A model entry can set its first-token timeout

A model entry can set `firstTokenTimeoutSeconds`. It MUST be a positive integer of seconds, or a
whole-value interpolation token that resolves to one. Startup MUST fail for another value and name
the model id and the field. The field is server-only, and `GET /api/v1/models` MUST NOT return it.

#### Scenario: An invalid first-token timeout

- **WHEN** a model entry sets `firstTokenTimeoutSeconds` to 0.5
- **THEN** startup fails and names the model id and `firstTokenTimeoutSeconds`

#### Scenario: The timeout stays private

- **WHEN** a model entry sets `firstTokenTimeoutSeconds` to 900
- **THEN** the entry of that model in `GET /api/v1/models` has no `firstTokenTimeoutSeconds`

### Requirement: The retired conversation reader is not a configuration target

Startup MUST reject `conversation_read` in `tools.allowed`, `tools.promptFiles`, and `models[].toolPromptFiles`. Its error MUST identify the field and direct the operator to `read` with `chat://`. A stale permission-group key MUST remain inert under exact-id matching. It MUST NOT restore a declaration, executor, or authority.

#### Scenario: Old reader allowlist fails closed

- **WHEN** configuration allowlists `conversation_read`
- **THEN** startup fails with a migration diagnostic rather than a compatibility executor

#### Scenario: An old prompt override cannot survive retirement

- **WHEN** a model or instance overrides the `conversation_read` description
- **THEN** startup rejects that target even when no model admits it

### Requirement: Replaceable templates reject the retired chats namespace

Worker boot MUST reject `chats` and `chats.*` references in system prompts and tool descriptions. The diagnostic MUST identify the model or tool and the retired namespace. It MUST direct the operator to remove those references because the digest uses context items. It MUST expose no prompt contents, source Chat text, or host path.

#### Scenario: A custom digest template fails before model I/O

- **WHEN** a configured prompt references `chats.recent`
- **THEN** worker boot rejects it with an actionable diagnostic
- **AND** no model call or source Chat resolution occurs
