## MODIFIED Requirements

### Requirement: First-slice setting surface

The schema SHALL cover the shape-stable operator settings and SHALL be extended by consumer changes, each adding its own keys (add-when-consumed). The settings include: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — not the catalog itself, which lives in the top-level `models` array), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.timeoutSeconds`, `http.trustProxy`, the `tools` namespace (`tools.allowed`, default empty = no tools, fail closed; `tools.permissions`, default explicit portable code-owned policy without affecting availability; `tools.maxStepsPerRun`, default 20; `tools.callTimeoutSeconds`, default 120), the top-level `mcpServers` named object (default empty = no MCP servers of any transport; entries are `type`-discriminated and may be remote Streamable HTTP or local stdio), the optional `knowledge.root` absolute path (default absent = no local Knowledge capability), the `providers` array (provider connections), and the `models` array (the executable catalog). `tools.allowed` SHALL accept registered code-owned ids, exact canonical configured-MCP ids, and the single configured-MCP namespace wildcard form `mcp__<server>__*`. Provider connection settings (formerly the `OPENAI_BASE_URL` / `OPENAI_API_KEY` environment variables) SHALL be expressed as `providers[]` entries; those environment variables remain valid **interpolation inputs** (`{env:OPENAI_API_KEY:-}`) but are no longer read directly. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model — every model declares its `contextWindowTokens`, and its trigger threshold resolves per-model via the optional `models[].compactionThresholdTokens`, never by an instance knob.

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

## ADDED Requirements

### Requirement: Operator tool permissions compile before process startup completes

The configuration SHALL accept optional `tools.permissions` under the closed published schema. When omitted, the system SHALL create no permission groups, so every call is rejected; the shipped example documents the recommended portable map. There is no built-in fallback policy. A supplied map SHALL be the complete effective policy without merging; an explicit empty map SHALL reject all calls. It SHALL use the groups, clauses, matching syntax, and bounds defined by `tool-call-permissions`. Unknown or no-longer-configured permission keys SHALL be accepted and simply never match, so an MCP server change does not fail startup; malformed clauses, all-fields allow clauses, and invalid or unsupported regex SHALL fail startup before serving requests or claiming jobs. Diagnostics SHALL identify configuration locations and static reasons without printing patterns, resolved values, or matched input. Permission strings SHALL follow the existing single-pass interpolation and doubled-opening-brace escaping contract.

#### Scenario: A no-longer-configured permission key does not fail startup

- **WHEN** a valid `tools.permissions` map contains a key for a tool that is not currently registered or configured
- **THEN** startup succeeds and the group simply never matches
- **AND** malformed clauses or invalid regex still fail startup

#### Scenario: Omitted permissions reject calls

- **WHEN** an otherwise valid configuration lists a tool in `tools.allowed` and omits `tools.permissions`
- **THEN** startup succeeds and the existing catalog remains available
- **AND** a call to any advertised tool is rejected because no group exists
- **AND** an MCP tool is likewise rejected

#### Scenario: Explicit empty policy disables execution

- **WHEN** an operator supplies `tools.permissions: {}`
- **THEN** no built-in permission groups are inherited
- **AND** available tools remain visible but all calls are rejected

#### Scenario: Invalid regex is not silently ignored

- **WHEN** a configured permission regex is invalid or exceeds the supported regex syntax or size
- **THEN** the process refuses startup with a safe configuration-path diagnostic
- **AND** no partially compiled policy executes

#### Scenario: Pattern braces use existing configuration escaping

- **WHEN** an operator writes a regex quantifier using doubled opening braces in the source configuration
- **THEN** the matcher compiles the single-brace expression produced by the existing interpolation pass
- **AND** an interpolation failure follows the existing fail-closed configuration behavior
