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

The config file SHALL support a top-level `models` array that is the executable model catalog, superseding any hardcoded catalog. Each entry SHALL include a required opaque `id`, a required `provider` referencing a defined `providers[].id`, a required server-only `providerModelId`, and a required positive-integer `contextWindowTokens`. Each entry MAY include `pricingUsdPer1M`, an optional per-model `compactionThresholdTokens`, an optional `reasoning` object, and the optional display fields of the public model contract. A `models[].provider` that does not reference a defined provider id SHALL fail startup naming the model id and the dangling provider reference.

The optional `reasoning` object declares that the model accepts a reasoning-effort request parameter and what values it accepts. Its presence is the declaration; there SHALL be no separate availability flag. It SHALL contain a required non-empty `effortLevels` array, a required `defaultEffort` string, and an optional `cacheInvalidatedByEffortChange` boolean defaulting to `false`.

Each `effortLevels` item SHALL be either a bare nonblank string (the level's `value`, with no display label) or an object `{ "value": <string>, "label": <string> }` whose `value` and `label` are both required and nonblank. An object that omits `label`, supplies a blank `label`, omits `value`, or supplies a blank `value` SHALL fail startup naming the model id. The system SHALL NOT invent a label from a bare string.

`value` entries SHALL be opaque provider-native tokens. The system SHALL NOT constrain them to a llame-owned enumeration, and SHALL NOT impose a character pattern, casing rule, or length limit on them: provider effort vocabularies differ between providers and change between model releases, so any format constraint is a llame-owned vocabulary by another name. Integrity constraints on values: a `value` SHALL be nonblank, `value`s SHALL be unique within an entry, and `defaultEffort` SHALL equal one of those `value`s. Duplicate `label`s across different `value`s are permitted.

`effortLevels` order is operator-authored and SHALL be preserved wherever the levels are published, so a consumer can present them as an ordered scale without inferring one. A level's `value` SHALL be treated as an identifier rather than a display string; a consumer MAY render an operator-authored `label` when present, otherwise the `value` itself as a fallback, but SHALL NOT derive meaning, magnitude, or ordering from either string's text.

At load time the system SHALL normalize every item to `{ value, label? }` (omitting `label` when the config used a bare string) before the catalog is published or used for validation. `defaultEffort` SHALL be required whenever `reasoning` is present; the system SHALL NOT imply a default from list position. A `defaultEffort` that is not equal to any item's `value` SHALL fail startup naming the model id and both values. An empty `effortLevels`, a blank `value`, or a repeated `value` SHALL fail startup naming the model id.

The system SHALL NOT verify that a declared level is accepted by the provider. A misdeclared level surfaces as a provider request error at execution time, consistent with provider credentials not being prevalidated at boot.

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

The schema SHALL cover the shape-stable operator settings and SHALL be extended by consumer changes, each adding its own keys (add-when-consumed). The settings include: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — not the catalog itself, which lives in the top-level `models` array), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.timeoutSeconds`, `http.trustProxy`, the `tools` namespace (`tools.allowed`, default empty = no tools, fail closed; `tools.maxStepsPerRun`, default 20; `tools.callTimeoutSeconds`, default 120), the top-level `mcpServers` named object (default empty = no MCP servers of any transport; entries are `type`-discriminated and may be remote Streamable HTTP or local stdio), the optional `knowledge.root` absolute path (default absent = no local Knowledge capability), the `providers` array (provider connections), and the `models` array (the executable catalog). `tools.allowed` SHALL accept registered code-owned ids, exact canonical configured-MCP ids, and the single configured-MCP namespace wildcard form `mcp__<server>__*`. Provider connection settings (formerly the `OPENAI_BASE_URL` / `OPENAI_API_KEY` environment variables) SHALL be expressed as `providers[]` entries; those environment variables remain valid **interpolation inputs** (`{env:OPENAI_API_KEY:-}`) but are no longer read directly. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model — every model declares its `contextWindowTokens`, and its trigger threshold resolves per-model via the optional `models[].compactionThresholdTokens`, never by an instance knob.

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

- **WHEN** the file sets `tools.allowed` to registered code-owned ids, exact configured-MCP ids, or configured-MCP namespace wildcards
- **THEN** exactly those eligible tools may become available to Runs under the `tool-calling` capability's gate semantics

#### Scenario: MCP servers resolve from the file

- **WHEN** the file declares entries under the top-level `mcpServers` object
- **THEN** those entries are the complete instance-managed MCP server set across both transports

#### Scenario: Knowledge root resolves from the file

- **WHEN** the file declares `knowledge.root`
- **THEN** it is the process-local root for trusted stable-ID child resolution
- **AND** an absent `knowledge` namespace leaves Knowledge provisioning and tools unavailable

#### Scenario: Absent tools namespace means no tools

- **WHEN** the file does not set the `tools` namespace
- **THEN** the allowlist is empty and no tool is advertised or executable

#### Scenario: MCP servers without an allowlist expose no tools

- **WHEN** the file configures `mcpServers` but omits `tools.allowed`
- **THEN** the servers may connect or launch but no discovered tool is advertised or executable

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

At startup, every code-owned id in `tools.allowed` SHALL still be required to exist in the code-owned registry. An exact entry beginning with `mcp__` SHALL instead be parsed with `mcp-tool-id-v1`'s exact namespace grammar, 64-character bound, configured-server lookup, and canonical tool-segment rules. The only wildcard entry SHALL be exactly `mcp__<server>__*`, where `<server>` is a canonical configured MCP server id and `*` is the entire tool segment. Startup SHALL reject bare `*`, partial or mid-string globs, multiple wildcards, wildcard server names, malformed separators, noncanonical server ids, and references to unconfigured servers. Validation of either MCP entry form SHALL NOT depend on connecting to that server or discovering a remote tool. Any other unknown entry SHALL fail startup.

Both exact and namespace MCP entries SHALL be permission predicates over the safely admitted process-local inventory supplied by their configured server. Neither form SHALL create an eligible identity when that inventory does not contain or remember one. Runtime admission and source ownership therefore remain authoritative: a matching exact id becomes available only after fresh discovery and admission, and neither permission form grants authority to an unmatching or refused declaration.

#### Scenario: Unknown code-owned id still fails boot

- **WHEN** `tools.allowed` contains `not_a_real_tool`
- **THEN** startup fails naming `tools.allowed` and the unknown id

#### Scenario: Offline MCP tool id does not fail boot

- **WHEN** `tools.allowed` contains `mcp__web__search`, server `web` is configured, and that server is offline
- **THEN** startup succeeds
- **AND** the permission does not fabricate an eligible or unavailable tool identity

#### Scenario: Offline MCP namespace wildcard does not fail boot

- **WHEN** `tools.allowed` contains `mcp__web__*`, server `web` is configured, and a fresh process has not successfully discovered that server
- **THEN** startup succeeds without waiting for discovery
- **AND** the permission does not fabricate any exact tool identity

#### Scenario: MCP id names an undeclared server

- **WHEN** `tools.allowed` contains `mcp__missing__search` or `mcp__missing__*` and no MCP server id `missing` is configured
- **THEN** startup fails naming the allowlist entry and missing server declaration

#### Scenario: Malformed MCP id fails boot

- **WHEN** an allowlist entry begins with `mcp__` but is neither an exact canonical MCP tool id nor the exact namespace wildcard form
- **THEN** startup fails naming the malformed entry

#### Scenario: Broad and partial wildcard forms fail boot

- **WHEN** `tools.allowed` contains bare `*`, a wildcard server segment, a partial tool-name glob, a mid-string wildcard, or multiple wildcards
- **THEN** startup fails naming the unsupported entry

#### Scenario: Similar server prefix does not match

- **WHEN** `mcp__web__*` is configured alongside servers `web` and `webExtra`
- **THEN** the pattern names only the canonical `web` namespace
- **AND** startup validation does not treat `webExtra` as a match

### Requirement: Embedding model catalog configuration

The config file SHALL support an optional top-level `embeddingModels` array declaring the embedding models an instance may use. Each entry SHALL include a required opaque `id` (the stable internal key that stored vectors reference), a required `provider` referencing a defined `providers[].id`, a required server-only `providerModelId`, and a required positive-integer `dimensions`. Each entry MAY include a distance metric, a model revision, a positive-integer `batchSize` bounding how many documents are sent per provider request, and optional asymmetric `documentPrefix` / `queryPrefix` strings. Embedding models SHALL reuse the existing `providers[]` connections rather than introducing a parallel credential or endpoint concept, so the same interpolation, keyless-provider, and secret-redaction rules apply unchanged.

The config file SHALL additionally support a per-corpus intended-embedding-model setting naming an `embeddingModels[].id`. Selection SHALL be expressed per corpus rather than as one instance-wide flag, so corpora embedding at different rates cannot strand one another; a corpus with no setting has no intended model and produces no embedding work.

Embedding selection is **operator** configuration, not tenant configuration: background indexing is instance-scoped and is not performed per request or per user, so no per-user embedding credential exists.

A duplicate `id`, an entry whose `provider` does not reference a defined provider, a non-positive `dimensions`, or a corpus activation naming an undeclared embedding model id SHALL fail startup naming the offending entry and the dangling reference, applying no partial catalog.

#### Scenario: Embedding model references a defined provider

- **WHEN** an `embeddingModels[]` entry's `provider` names a provider defined in `providers[]`
- **THEN** the embedding model is loaded against that provider connection
- **AND** startup succeeds

#### Scenario: Embedding model references an undefined provider

- **WHEN** an `embeddingModels[]` entry's `provider` matches no `providers[].id`
- **THEN** startup fails naming the embedding model id and the unknown provider reference
- **AND** no partial catalog is applied

#### Scenario: A self-hosted embedding backend needs no new configuration concept

- **WHEN** an operator declares a keyless local provider in `providers[]` and an `embeddingModels[]` entry referencing it
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
