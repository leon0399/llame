## MODIFIED Requirements

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
