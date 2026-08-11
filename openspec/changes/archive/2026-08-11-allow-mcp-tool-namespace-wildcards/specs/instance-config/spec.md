## MODIFIED Requirements

### Requirement: First-slice setting surface

The schema SHALL cover the shape-stable operator settings and SHALL be extended by consumer changes, each adding its own keys (add-when-consumed). The settings include: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — not the catalog itself, which lives in the top-level `models` array), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.heartbeatStaleSeconds`, `runs.timeoutSeconds`, `http.trustProxy`, the `tools` namespace (`tools.allowed`, default empty = no tools, fail closed; `tools.maxStepsPerRun`, default 8; `tools.callTimeoutSeconds`, default 15), the top-level `mcpServers` named object (default empty = no remote MCP servers), the `providers` array (provider connections), and the `models` array (the executable catalog). `tools.allowed` SHALL accept registered code-owned ids, exact canonical configured-MCP ids, and the single configured-MCP namespace wildcard form `mcp__<server>__*`. Provider connection settings (formerly the `OPENAI_BASE_URL` / `OPENAI_API_KEY` environment variables) SHALL be expressed as `providers[]` entries; those environment variables remain valid **interpolation inputs** (`{env:OPENAI_API_KEY:-}`) but are no longer read directly. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model — every model declares its `contextWindowTokens`, and its trigger threshold resolves per-model via the optional `models[].compactionThresholdTokens`, never by an instance knob.

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
- **THEN** the source inventory is filtered once and each matching exact tool candidate may become eligible to Runs under the `tool-calling` capability's gate semantics

#### Scenario: MCP servers resolve from the file

- **WHEN** the file declares entries under the top-level `mcpServers` object
- **THEN** those entries are the complete instance-managed remote MCP server set

#### Scenario: Absent tools namespace means no tools

- **WHEN** the file does not set the `tools` namespace
- **THEN** the allowlist is empty and no tool is advertised or executable

#### Scenario: MCP servers without an allowlist expose no tools

- **WHEN** the file configures `mcpServers` but omits `tools.allowed`
- **THEN** the remote servers may connect but no discovered tool is advertised or executable

### Requirement: Tool allowlist validation distinguishes code-owned and declared dynamic ids

At startup, every code-owned id in `tools.allowed` SHALL still be required to exist in the code-owned registry. An exact entry beginning with `mcp__` SHALL instead be parsed with `mcp-tool-id-v1`'s exact namespace grammar, 64-character bound, configured-server lookup, and canonical tool-segment rules. The only wildcard entry SHALL be exactly `mcp__<server>__*`, where `<server>` is a canonical configured MCP server id and `*` is the entire tool segment. Startup SHALL reject bare `*`, partial or mid-string globs, multiple wildcards, wildcard server names, malformed separators, noncanonical server ids, and references to unconfigured servers. Validation of either MCP entry form SHALL NOT depend on connecting to that server or discovering a remote tool. Any other unknown entry SHALL fail startup.

Both exact and namespace MCP entries SHALL be permission predicates over the safely admitted process-local inventory supplied by their configured server. Neither form SHALL create an eligible identity when that inventory does not contain or remember one. Runtime admission and source ownership therefore remain authoritative: a matching exact id becomes available only after fresh discovery and admission, and neither permission form grants authority to an unmatching or refused declaration.

#### Scenario: Unknown code-owned id still fails boot

- **WHEN** `tools.allowed` contains `not_a_real_tool`
- **THEN** startup fails naming `tools.allowed` and the unknown id

#### Scenario: Offline MCP tool id does not fail boot

- **WHEN** `tools.allowed` contains `mcp__web__search`, server `web` is configured, and a fresh process has not successfully discovered that server
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
