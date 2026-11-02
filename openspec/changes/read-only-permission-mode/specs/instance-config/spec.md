## MODIFIED Requirements

### Requirement: Operator configuration enables Run permission modes

The configuration can contain an optional `tools.permissionModes` array under the closed published schema. Its built-in default MUST be `["default"]`. Each item MUST be one of the known mode values `"default"`, `"bypass"`, and `"read-only"`. A supplied array MUST be non-empty, MUST contain no duplicate, and MUST contain `"default"`. These cases MUST fail startup with a diagnostic that names `tools.permissionModes`. The cases are an empty array, an unknown value, a non-string item, a duplicate, and an array without `"default"`. The failure MUST occur before the process serves requests or claims jobs. Item values are literal, and the configuration MUST NOT accept interpolation tokens in them. The system MUST keep the array order as the publication order of the enabled modes.

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
