## ADDED Requirements

### Requirement: Operator configuration bounds tool-result artifacts

`tools.artifacts.maxBytes` MUST accept a positive integer or a whole-value
interpolation token. Its default is 8,388,608 (8 MiB). Zero, a negative value,
a fraction, or an unknown key in `tools.artifacts` MUST fail startup and name
the path.

#### Scenario: The default bound applies

- **WHEN** the configuration has no `tools.artifacts` object
- **THEN** each artifact is bounded at 8,388,608 bytes

#### Scenario: A zero bound fails startup

- **WHEN** `tools.artifacts.maxBytes` is 0
- **THEN** startup fails and names `tools.artifacts.maxBytes`

### Requirement: Operator configuration sets the web search fetch size

`webSearch.fetchLimit` MUST accept an integer from 1 to 100. Its default is 20. A value outside that range MUST fail startup and name the path.

#### Scenario: The default fetch size applies

- **WHEN** `webSearch` sets no `fetchLimit`
- **THEN** each call asks the engines for 20 results, clamped by each vendor maximum

#### Scenario: An out-of-range fetch size fails startup

- **WHEN** `webSearch.fetchLimit` is 500
- **THEN** startup fails and names `webSearch.fetchLimit`
