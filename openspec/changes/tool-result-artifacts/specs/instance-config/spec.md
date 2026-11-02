## MODIFIED Requirements

### Requirement: Operator configuration declares web search engines and a chain

The config file MUST accept an optional top-level `webSearch` object under the
closed published schema. It holds an `engines` array, a `chain` array, and an
optional `fetchLimit`. Each engine MUST have an `id` of 1 to 64 characters,
unique within `engines`, and a `type` that selects its shape. `chain` MUST be a
non-empty ordered list of engine ids with no duplicate. The built-in default
MUST be absent.

#### Scenario: Minimal configuration loads

- **WHEN** the file sets `webSearch` to one `brave` engine with id `brave`, a `key`, and `chain: ["brave"]`
- **THEN** startup succeeds with that engine as the only chain entry

#### Scenario: Unknown engine key fails startup

- **WHEN** a `brave` engine entry carries an unrecognized key `region`
- **THEN** startup fails and names the path of that key

#### Scenario: Duplicate engine id fails startup

- **WHEN** two `webSearch.engines` entries share the id `brave`
- **THEN** startup fails and names `webSearch.engines` and the duplicate id

## ADDED Requirements

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
