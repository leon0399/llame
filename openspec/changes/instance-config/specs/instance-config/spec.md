## ADDED Requirements

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

### Requirement: File precedence over ambient environment

Where the same operator setting can be expressed both in the config file and as a legacy environment variable, the file value SHALL take precedence, and the environment variable SHALL be honored only as a fallback when the file does not set that key, with documented built-in defaults last. A key that is **present** in the file counts as set even when its value is an explicit `null` (or a nullable interpolation that resolves to unset) — an explicit `null` overrides the environment fallback, so the file can affirmatively disable an env-provided value; only an **absent** key falls back. This SHALL be applied consistently so an operator can migrate a setting from env to file without changing its effect.

#### Scenario: File overrides a legacy env var

- **WHEN** both the file sets a setting and its legacy environment variable is set
- **THEN** the file value is used

#### Scenario: Env var used as fallback

- **WHEN** the file does not set a key but its legacy environment variable is set
- **THEN** the environment variable's value populates that setting

#### Scenario: Explicit null in the file suppresses the env fallback

- **WHEN** the file sets a nullable key to explicit `null` (e.g. `"trustProxy": null`) while its legacy environment variable is set
- **THEN** the setting is unset (null) — the environment fallback does not trigger

#### Scenario: Neither set falls to built-in default

- **WHEN** neither the file nor the legacy environment variable sets a key that has a documented default
- **THEN** the built-in default is used

### Requirement: First-slice setting surface

The initial schema SHALL cover exactly the shape-stable operator settings: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — deliberately not under a `models` key, which is reserved for the future model-catalog list), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.heartbeatStaleSeconds`, `runs.timeoutSeconds`, and `http.trustProxy`. Provider connection settings (`OPENAI_BASE_URL`, `OPENAI_API_KEY`) SHALL remain environment variables in this slice — they migrate into a future `providers[]` list in a follow-up change. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model (every model declares its context window; threshold resolution is per-model), never by instance settings.

#### Scenario: Migrated settings resolve from the file

- **WHEN** the file sets `defaults.modelId` and `runs.timeoutSeconds`
- **THEN** model selection defaults and the run-timeout deadman use those values

#### Scenario: No instance-level compaction knob

- **WHEN** the file attempts to set any `compaction.*` key
- **THEN** startup fails as an unknown key (the setting does not exist at this layer)
