## MODIFIED Requirements

### Requirement: Model catalog configuration

The config file SHALL support a top-level `models` array that is the executable model catalog, superseding any hardcoded catalog. Each entry SHALL include a required opaque `id`, a required `provider` referencing a defined `providers[].id`, a required server-only `providerModelId`, and a required positive-integer `contextWindowTokens`. Each entry MAY include `pricingUsdPer1M`, an optional per-model `compactionThresholdTokens`, an optional `reasoning` object, and the optional display fields of the public model contract. A `models[].provider` that does not reference a defined provider id SHALL fail startup naming the model id and the dangling provider reference.

The optional `reasoning` object declares that the model accepts a reasoning-effort request parameter and what values it accepts. Its presence is the declaration; there SHALL be no separate availability flag. It SHALL contain a required non-empty `effortLevels` array of strings, a required `defaultEffort` string, and an optional `cacheInvalidatedByEffortChange` boolean defaulting to `false`.

`effortLevels` entries SHALL be opaque provider-native tokens. The system SHALL NOT constrain them to a llame-owned enumeration, and SHALL NOT impose a character pattern, casing rule, or length limit on them: provider effort vocabularies differ between providers and change between model releases, so any format constraint is a llame-owned vocabulary by another name. Exactly three constraints apply, all of them integrity rather than format — a level SHALL be nonblank, levels SHALL be unique within an entry, and `defaultEffort` SHALL be one of them.

`effortLevels` order is operator-authored and SHALL be preserved wherever the levels are published, so a consumer can present them as an ordered scale without inferring one. A level SHALL be treated as an identifier rather than a display string; a consumer MAY render the token itself as a fallback but SHALL NOT derive meaning, magnitude, or ordering from its text.

`defaultEffort` SHALL be required whenever `reasoning` is present; the system SHALL NOT imply a default from list position. A `defaultEffort` that is not a member of the same entry's `effortLevels` SHALL fail startup naming the model id and both values. An empty `effortLevels`, a duplicate level, or a blank level string SHALL fail startup naming the model id.

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

- **WHEN** a model entry declares `reasoning` with a non-empty `effortLevels` and a `defaultEffort` drawn from it
- **THEN** the model is loaded as accepting a reasoning-effort request parameter over exactly those levels
- **AND** startup succeeds

#### Scenario: Provider-native levels are accepted verbatim

- **WHEN** `effortLevels` contains a token that is not part of any llame-owned enumeration
- **THEN** startup succeeds and the token is retained verbatim
- **AND** no level is rewritten, normalized, lowercased, reordered, or coerced to a llame vocabulary

#### Scenario: No character pattern is imposed on a level

- **WHEN** `effortLevels` contains a nonblank token of any casing, length, or character composition
- **THEN** startup succeeds
- **AND** the token is rejected only if it is blank or duplicates another level in the same entry

#### Scenario: Default effort must be one of the declared levels

- **WHEN** a model entry's `reasoning.defaultEffort` is not a member of that entry's `effortLevels`
- **THEN** startup fails naming the model id, the default, and the declared levels
- **AND** no partial catalog is applied

#### Scenario: Default effort is required when reasoning is declared

- **WHEN** a model entry declares `reasoning` without `defaultEffort`
- **THEN** startup fails naming the model id
- **AND** no level is implied from `effortLevels` order or length

#### Scenario: Empty or malformed level list is rejected

- **WHEN** a model entry's `reasoning.effortLevels` is empty, contains a blank string, or repeats a level
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

## ADDED Requirements

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
