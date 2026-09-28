## ADDED Requirements

### Requirement: Operator configuration enables Run permission modes

The configuration SHALL accept an optional `tools.permissionModes` array under the closed published schema. Its built-in default SHALL be `["default"]`. Each item SHALL be one of the known mode values `"default"` and `"bypass"`. A supplied array SHALL be non-empty, SHALL contain no duplicate, and SHALL contain `"default"`; an empty array, an unknown value, a non-string item, a duplicate, or an array without `"default"` SHALL fail startup naming `tools.permissionModes`, before the process serves requests or claims jobs. Item values are literal: interpolation tokens SHALL NOT be accepted in them. The array order SHALL be preserved as the order in which enabled modes are published.

Enabling `"bypass"` SHALL let every authenticated user select it for their own Runs; the configuration SHALL provide no per-user restriction. `tools.permissionModes` SHALL NOT change `tools.allowed`, `tools.permissions`, or any other setting's meaning.

#### Scenario: Omitted modes enable only default

- **WHEN** the configuration omits `tools.permissionModes`
- **THEN** startup succeeds and the enabled modes are `["default"]`

#### Scenario: Bypass is enabled explicitly

- **WHEN** the configuration sets `tools.permissionModes` to `["default", "bypass"]`
- **THEN** startup succeeds and both modes are enabled in that order

#### Scenario: A list without default fails startup

- **WHEN** the configuration sets `tools.permissionModes` to `["bypass"]` or `[]`
- **THEN** startup fails with a diagnostic naming `tools.permissionModes`

#### Scenario: Unknown or repeated modes fail startup

- **WHEN** the configuration sets `tools.permissionModes` to `["default", "yolo"]` or `["default", "default"]`
- **THEN** startup fails with a diagnostic naming `tools.permissionModes`

#### Scenario: Interpolated mode values are rejected

- **WHEN** an item of `tools.permissionModes` is `{env:LLAME_MODE}`
- **THEN** startup fails with a diagnostic naming `tools.permissionModes`
