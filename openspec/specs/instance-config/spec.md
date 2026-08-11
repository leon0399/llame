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

### Requirement: Model prompt files are dedicated visible-content configuration

Each `models[]` entry MAY include a `systemPromptFile` string naming a complete system-prompt file. The setting SHALL be handled as a host path, not as `{path:...}` secret interpolation, because the resolved prompt contents are intentionally visible to the chat owner. An omitted field SHALL select the versioned project-default prompt. A configured field SHALL replace the default completely for that model; models MUST NOT inherit or compose prompts from other model entries.

Relative prompt paths SHALL resolve against the directory containing the resolved instance configuration file, and absolute paths SHALL remain absolute. The loader SHALL read prompt files at boot, normalize CRLF/CR line endings to LF, remove trailing whitespace only at the end of the file, and require non-empty rendered content.

Prompt files SHALL be **Handlebars templates**. The loader SHALL parse each template at boot and validate its abstract syntax tree, failing startup and naming the model id together with the offending construct on anything it does not explicitly permit.

Validation SHALL permit only these node kinds: literal content, a value expression, a block expression, and a comment. Everything else SHALL be rejected. An allowlist is used because it is simpler than enumerating bad forms and does not need revisiting when the engine adds a node kind — partials, for example, exist in three syntactic forms that a blocklist would have to name individually.

Within permitted node kinds:

- a value expression SHALL reference an allowlisted context path and SHALL carry no parameters, since a parameterized value expression is a helper invocation;
- a context path SHALL be validated on its **parsed segments and depth**, not on its display string: a bracketed path such as `{{[model.id]}}` reports an allowlisted display string while parsing to a single literal segment, so accepting it would silently render empty instead of failing boot, and a parent-context path (`../`) escapes the projection entirely;
- a block expression SHALL be `if` or `unless`, SHALL take exactly one parameter, and SHALL carry neither hash arguments nor block parameters — a hash pair can hold a subexpression, which is a helper invocation the parameter check alone does not see; a wrong argument count left to the engine surfaces at render time as an unwrapped error naming neither the model nor the field; and `as |x|` binds a name outside the projected context;
- unescaped output SHALL be rejected.

Fragments stay rejected because `model-system-prompts` forbids prompt composition; with an allowlist this costs nothing to enforce.

A template SHALL be rejected at boot as empty when it contains no literal text at all. Literal text SHALL count wherever it appears, **including inside a conditional body** — a prompt may legitimately consist of nothing but an `if` block wrapping its only prose, and rejecting that would defeat the conditional idiom this capability exists to enable.

Template **rendering** SHALL be lenient where validation is strict: a context path that is allowlisted but has no value at render time SHALL render as empty rather than raising, so that data absent at request time can never fail a run. Boot-time validation SHALL be performed against the template rather than against any rendered output.

Rendered values SHALL be neutralized in two regimes, by field kind. **Model and account-identity values** (`model.*`, `user.name`, `user.email`) SHALL be escaped by replacing exactly `&`, `<`, and `>` with character references — short single-line strings with no legitimate markup. **Owner-authored values** (the `user.personalization.*` text fields) SHALL instead pass through a tag sanitizer enforcing exactly two rules:

1. **A value SHALL never close a tag it did not open within that same value.** A closing tag passes through only when it names a tag opened earlier in the same value (closing past unclosed intermediate openers is permitted, as in HTML recovery, so a prose mention that merely reads as an opening tag cannot cause a legitimate closer to be escaped). An unmatched closing tag, or one whose spelling is malformed or whitespace-padded, SHALL be entity-escaped regardless of what is open — fail closed, because a model may honor a spelling a strict parser rejects. This rule is deliberately template-agnostic: it protects whatever wrapper the surrounding template uses without the sanitizer knowing its name.
2. **A reserved tag name SHALL never be emitted as a tag at all**, opening or closing, matched or not. Rule 1 alone is insufficient: a value that both opens and closes the wrapper's own name satisfies it while rendering a complete forged copy of the wrapper inside the real one. The reserved set SHALL contain the packaged default prompt's delimiter name. An operator whose replacement template wraps per-user content in a differently-named tag retains rule 1's protection but not rule 2's, and this limitation SHALL be documented rather than implied away.

Everything else — self-contained markup under a non-reserved name, unmatched opening tags, prose comparisons, ampersands — SHALL pass byte-for-byte, because owners legitimately author tag-structured preference text and entity-mangling it destroys the structure it exists to convey. In both regimes no other character SHALL be altered, so apostrophes, quotation marks, equals signs, backticks, and other prose punctuation survive verbatim; the engine's default escaping MUST NOT be used, because it converts all of those and mangles both prose and code fragments. Neutralization SHALL be applied when building the context and the value marked already-safe, so the engine emits it without a second pass. The engine's global escaping behavior MUST NOT be mutated: a created environment shares its utility object with the global one, so replacing that function process-wide would alter behavior for every other consumer.

The template **context** SHALL be an explicit, hand-constructed projection containing only values intended to be renderable. A database row, ORM entity, or configuration object MUST NOT be passed as context, so that no column, field, or secret becomes reachable merely because it exists on a record — including when the context is extended with per-user values. The renderable set SHALL be the selected model's public id and configured public name, plus the **per-user paths** `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.name`, and `user.email`.

Per-user paths SHALL be validated at boot exactly like any other identifier, while their **values** resolve per run because no owner is in scope at startup. The loader SHALL therefore expose a template that the run path renders, rather than returning a string rendered at boot. Boot SHALL render each template with BOTH an absent and a populated per-user context, and SHALL fail if either renders empty. One probe is not sufficient: `unless` is a permitted helper over the per-user gates, so a template whose only content sits inside `{{#unless user}}` renders non-empty with no owner and empty for precisely the owners who personalized. The earlier claim that an absent per-user context yields the minimum possible output is therefore false, and probing one gate state would pass such a template at boot and ship an empty prompt in production. A template that references no per-user path SHALL remain valid and MUST NOT fail startup; that model simply forgoes per-user context.

A missing, unreadable, non-file, or empty configured prompt SHALL fail startup naming the model id and field; it MUST NOT silently use the project default. An allowlisted path whose value is simply absent SHALL NOT fail startup — it renders empty, so that a conditional over a possibly-absent value is expressible; this SHALL apply to per-user paths at boot, where no value can exist by construction. The built-in project prompt SHALL be validated at startup as a packaged application asset.

The **packaged project-default prompt** SHALL reference the per-user paths, each inside a conditional, so that a stock installation applies an owner's personalization with no operator action and an owner's `shareAccountIdentity` toggle governs their account identity directly. An operator who replaces the default with a prompt referencing no per-user path SHALL silently forgo personalization for that model; this consequence SHALL be documented, and it is accepted rather than reported, because per-model activation reporting is out of scope.

The resolved public model catalog and all user-facing APIs MUST omit `systemPromptFile` and every resolved host path. The resolved prompt contents and a source label MAY be exposed only through the owner-authorized run context receipt defined by the `model-system-prompts` capability. Config errors and operator logs MUST NOT print prompt contents.

#### Scenario: Relative model prompt path resolves

- **WHEN** a model declares `systemPromptFile: "prompts/reasoning-model.md"`
- **THEN** the loader resolves it relative to the active `llame.config.json` directory
- **AND** the model uses the normalized non-empty file contents as its complete prompt

#### Scenario: Absolute model prompt path resolves

- **WHEN** a model declares a valid absolute `systemPromptFile`
- **THEN** the loader reads that exact file at startup
- **AND** no additional path sandbox is applied beyond the administrator-controlled process permissions

#### Scenario: Prompt override is omitted

- **WHEN** a model entry omits `systemPromptFile`
- **THEN** the resolved model uses the packaged project-default prompt
- **AND** startup does not require a model-specific file

#### Scenario: Configured prompt file is invalid

- **WHEN** `systemPromptFile` resolves to a missing, unreadable, non-file, or empty prompt
- **THEN** startup fails naming the model id and field
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
- **THEN** startup fails naming the model id and that path
- **AND** no prompt contents are printed

#### Scenario: Path only appears allowlisted in its display form

- **WHEN** a configured prompt file uses a bracketed path whose display string matches an allowlisted path but whose parsed segments do not, or a parent-context path
- **THEN** startup fails naming the model id and that path
- **AND** the template is not accepted to render empty at request time

#### Scenario: Conditional has the wrong argument count

- **WHEN** a configured prompt file uses an `if` or `unless` block with no parameter or more than one
- **THEN** startup fails with the capability's own configuration error, naming the model id and the construct
- **AND** the failure does not surface later as an unwrapped engine error at render time

#### Scenario: Conditional declares block parameters

- **WHEN** a configured prompt file declares block parameters on a conditional
- **THEN** startup fails naming the model id and the construct

#### Scenario: Template requests unescaped output

- **WHEN** a configured prompt file emits a value through unescaped output
- **THEN** startup fails naming the model id and that expression
- **AND** the template is not loaded with escaping bypassed

#### Scenario: Template references a fragment

- **WHEN** a configured prompt file references a partial in any of its syntactic forms
- **THEN** startup fails naming the model id and the construct

#### Scenario: Template invokes a helper

- **WHEN** a configured prompt file invokes any helper other than `if` or `unless`, in either value or block position
- **THEN** startup fails naming the model id and the helper
- **AND** `if` and `unless` continue to load successfully

#### Scenario: Comment is permitted

- **WHEN** a configured prompt file contains a template comment
- **THEN** startup succeeds and the comment does not appear in rendered output

#### Scenario: Helper smuggled through a block hash argument

- **WHEN** a configured prompt file passes a hash argument holding a subexpression to an `if` or `unless` block
- **THEN** startup fails naming the model id and the helper invocation
- **AND** the helper is never executed at render time

#### Scenario: Conditional holds the only literal content

- **WHEN** a configured prompt file consists solely of a conditional block whose body carries its only literal text
- **THEN** startup succeeds rather than rejecting the template as empty
- **AND** the block renders its content when the tested path has a value

#### Scenario: Allowlisted value is missing at render time

- **WHEN** an allowlisted context path has no value when a prompt is rendered
- **THEN** the expression renders as empty and rendering succeeds
- **AND** neither startup nor the run fails

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
- **AND** their values resolve per run instead

#### Scenario: Template names an unknown per-user field

- **WHEN** a configured prompt file references a per-user path outside the allowlist
- **THEN** startup fails naming the model id and that path
- **AND** the allowlist is not silently extended

#### Scenario: Template references no per-user path

- **WHEN** an operator's configured prompt file references no per-user context path
- **THEN** startup succeeds
- **AND** that model forgoes per-user context rather than failing startup or falling back to the project default

#### Scenario: Context extension does not pass records

- **WHEN** the run path renders a prompt referencing per-user paths
- **THEN** the context contains only explicitly projected scalar values
- **AND** no personalization row, user row, or configuration object is reachable through any context path

#### Scenario: Authored markup survives while the enclosing structure stays closed to it

- **WHEN** an owner's authored field contains self-contained tag markup under a non-reserved name and, elsewhere, a closing tag for a tag the value never opened
- **THEN** the self-contained markup renders verbatim
- **AND** the unmatched closing tag is escaped as content, so the surrounding template structure cannot be terminated from inside the value

#### Scenario: Authored value spells the delimiter's own name as a balanced pair

- **WHEN** an owner's authored field contains a well-formed opening and closing tag pair naming the packaged prompt's delimiter
- **THEN** both tags are escaped as content even though the pair is balanced
- **AND** the rendered prompt contains exactly one opening and one closing delimiter, the template's own

#### Scenario: Packaged default carries the per-user block

- **WHEN** the packaged project-default prompt is validated at startup
- **THEN** it references the per-user paths, each inside a conditional
- **AND** a stock installation applies an owner's personalization without an operator editing any file

### Requirement: First-slice setting surface

The schema SHALL cover the shape-stable operator settings and SHALL be extended by consumer changes, each adding its own keys (add-when-consumed). The settings include: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — not the catalog itself, which lives in the top-level `models` array), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.heartbeatStaleSeconds`, `runs.timeoutSeconds`, `http.trustProxy`, the `tools` namespace (`tools.allowed`, default empty = no tools, fail closed; `tools.maxStepsPerRun`, default 8; `tools.callTimeoutSeconds`, default 15), the top-level `mcpServers` named object (default empty = no remote MCP servers), the `providers` array (provider connections), and the `models` array (the executable catalog). Provider connection settings (formerly the `OPENAI_BASE_URL` / `OPENAI_API_KEY` environment variables) SHALL be expressed as `providers[]` entries; those environment variables remain valid **interpolation inputs** (`{env:OPENAI_API_KEY:-}`) but are no longer read directly. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model — every model declares its `contextWindowTokens`, and its trigger threshold resolves per-model via the optional `models[].compactionThresholdTokens`, never by an instance knob.

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

- **WHEN** the file sets `tools.allowed` to code-owned and namespaced dynamic tool ids
- **THEN** exactly those eligible tools may become available to Runs under the `tool-calling` capability's gate semantics

#### Scenario: MCP servers resolve from the file

- **WHEN** the file declares entries under the top-level `mcpServers` object
- **THEN** those entries are the complete instance-managed remote MCP server set

#### Scenario: Absent tools namespace means no tools

- **WHEN** the file does not set the `tools` namespace
- **THEN** the allowlist is empty and no tool is advertised or executable

#### Scenario: MCP servers without an allowlist expose no tools

- **WHEN** the file configures `mcpServers` but omits `tools.allowed`
- **THEN** the remote servers may connect but no discovered tool is advertised or executable

### Requirement: Remote MCP servers use the portable named-object shape

The top-level `mcpServers` setting SHALL be an object that maps server names to entries shaped exactly as `{ type, url, headers? }`, matching the portable `.mcp.json` convention rather than inventing an array form. A server name SHALL contain 1–56 provider-safe ASCII letters, digits, `_`, or `-`, SHALL exclude the reserved `__` namespace separator, and SHALL be unique as a JSON object key. The 56-character bound SHALL be derived from the fixed provider-independent 64-character `mcp__<server>__<tool>` budget while reserving one character for the shortest valid normalized tool segment, and configuration validation SHALL use the same bound as `mcp-tool-id-v1`. Duplicate properties MUST be rejected rather than silently overwritten. `type` SHALL accept `"http"` and the explicit MCP name `"streamable-http"` as aliases for the same Streamable HTTP transport; any other value SHALL fail startup. `url` SHALL be an absolute `http` or `https` URL with empty username and password components; userinfo SHALL be rejected before transport construction. `headers`, when present, SHALL map non-empty header names to string values supporting llame's existing `{env:…}` and `{path:…}` interpolation rules. Header names that collide under ASCII case-folding SHALL be rejected before transport construction. Attempts to override `Accept`, `Content-Type`, `MCP-Protocol-Version`, `MCP-Session-Id`, `Last-Event-ID`, or another transport-owned header SHALL be detected by the same ASCII-case-folded comparison. Unknown fields, invalid names, invalid URLs, URL userinfo, empty or colliding header names, and transport-owned headers SHALL fail startup naming only the configuration path, without printing resolved header values or credential-bearing URL text.

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

### Requirement: Tool allowlist validation distinguishes code-owned and declared dynamic ids

At startup, every code-owned id in `tools.allowed` SHALL still be required to exist in the code-owned registry. An id beginning with `mcp__` SHALL instead be parsed with `mcp-tool-id-v1`'s exact namespace grammar, 64-character bound, configured-server lookup, and canonical tool-segment rules; startup SHALL NOT depend on connecting to that server or discovering the named remote tool. Any other unknown id SHALL fail startup. This split MUST NOT weaken the runtime allowlist: a valid configured MCP id remains unavailable until fresh discovery and admission produce that exact id.

#### Scenario: Unknown code-owned id still fails boot

- **WHEN** `tools.allowed` contains `not_a_real_tool`
- **THEN** startup fails naming `tools.allowed` and the unknown id

#### Scenario: Offline MCP tool id does not fail boot

- **WHEN** `tools.allowed` contains `mcp__web__search`, server `web` is configured, and that server is offline
- **THEN** startup succeeds
- **AND** the tool is recorded as eligible but unavailable rather than advertised

#### Scenario: MCP id names an undeclared server

- **WHEN** `tools.allowed` contains `mcp__missing__search` and no MCP server id `missing` is configured
- **THEN** startup fails naming the allowlist entry and missing server declaration

#### Scenario: Malformed MCP id fails boot

- **WHEN** an allowlist entry begins with `mcp__` but does not contain valid server and tool segments
- **THEN** startup fails naming the malformed id
