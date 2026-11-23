## MODIFIED Requirements

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
