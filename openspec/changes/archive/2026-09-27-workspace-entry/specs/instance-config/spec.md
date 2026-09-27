## MODIFIED Requirements

### Requirement: First-slice setting surface

The schema SHALL cover the shape-stable operator settings and SHALL be extended by consumer changes, each adding its own keys (add-when-consumed). The settings include: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — not the catalog itself, which lives in the top-level `models` array), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.timeoutSeconds`, `http.trustProxy`, the `tools` namespace (`tools.allowed`, default empty = no tools, fail closed; `tools.permissions`, default explicit portable code-owned policy without affecting availability; `tools.maxStepsPerRun`, default 100; `tools.callTimeoutSeconds`, default 120), the top-level `mcpServers` named object (default empty = no MCP servers of any transport; entries are `type`-discriminated and may be remote Streamable HTTP or local stdio), the optional `knowledge.root` absolute path (default absent = no local Knowledge capability), the `providers` array (provider connections), and the `models` array (the executable catalog). `tools.allowed` SHALL accept registered code-owned ids, exact canonical MCP ids, and the namespace wildcard form `mcp__<server>__*` for any grammar-valid MCP server id, whether or not a server with that id is currently configured. Provider connection settings (formerly the `OPENAI_BASE_URL` / `OPENAI_API_KEY` environment variables) SHALL be expressed as `providers[]` entries; those environment variables remain valid **interpolation inputs** (`{env:OPENAI_API_KEY:-}`) but are no longer read directly. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model — every model declares its `contextWindowTokens`, and its trigger threshold resolves per-model via the optional `models[].compactionThresholdTokens`, never by an instance knob.

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

- **WHEN** the file sets `tools.allowed` to registered code-owned ids, exact canonical MCP ids, or namespace wildcards for grammar-valid server ids
- **THEN** exactly matching admitted tools may become eligible for Runs under the `tool-calling` capability's gates
- **AND** each MCP call still requires authorization by `tools.permissions`

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

### Requirement: Tool allowlist validation distinguishes code-owned and declared dynamic ids

At startup, every code-owned id in `tools.allowed` SHALL still be required to exist in the code-owned registry. An exact entry beginning with `mcp__` SHALL instead be parsed with `mcp-tool-id-v1`'s exact namespace grammar, 64-character bound, and canonical tool-segment rules, without looking up the server id in the currently configured MCP servers. The only wildcard entry SHALL be exactly `mcp__<server>__*`, where `<server>` satisfies the MCP server-id grammar and bound (1–56 ASCII letters, digits, `_`, or `-`, excluding `__`) and `*` is the entire tool segment. Startup SHALL accept an otherwise valid exact id or wildcard whether or not a matching MCP server is currently configured or discovered. It SHALL reject bare `*`, partial or mid-string globs, multiple wildcards, wildcard server names, malformed separators, noncanonical or malformed server ids, and noncanonical exact tool segments. Validation of either MCP entry form SHALL NOT depend on connecting to a server or discovering a remote tool. Any other unknown entry SHALL fail startup.

Both exact and namespace MCP entries SHALL be eligibility predicates over the safely admitted process-local inventory supplied by a matching server. Neither form SHALL create an eligible identity when that inventory does not contain or remember one. Runtime admission and source ownership therefore remain authoritative: a matching exact id becomes available only after fresh discovery and admission. `tools.permissions` SHALL independently authorize each call, and neither allowlist entries nor MCP metadata SHALL bypass a rejecting or absent permission group.

#### Scenario: Unknown code-owned id still fails boot

- **WHEN** `tools.allowed` contains `not_a_real_tool`
- **THEN** startup fails naming `tools.allowed` and the unknown id

#### Scenario: Offline MCP tool id does not fail boot

- **WHEN** `tools.allowed` contains `mcp__web__search`, server `web` is configured, and that server is offline
- **THEN** startup succeeds
- **AND** the allowlist does not fabricate an eligible or unavailable tool identity

#### Scenario: MCP id names an undeclared server

- **WHEN** `tools.allowed` contains `mcp__playwright__search` or `mcp__playwright__*` and no MCP server named `playwright` is configured
- **THEN** startup succeeds without waiting for server discovery
- **AND** neither entry fabricates an eligible or unavailable tool identity

#### Scenario: Offline MCP namespace wildcard does not fail boot

- **WHEN** `tools.allowed` contains `mcp__web__*`, server `web` is configured, and a fresh process has not successfully discovered that server
- **THEN** startup succeeds without waiting for discovery
- **AND** the allowlist does not fabricate any exact tool identity

#### Scenario: Malformed MCP id fails boot

- **WHEN** an allowlist entry begins with `mcp__` but is neither an exact canonical MCP tool id nor the exact namespace wildcard form, including an id with an invalid server-id segment
- **THEN** startup fails naming the malformed entry

#### Scenario: Broad and partial wildcard forms fail boot

- **WHEN** `tools.allowed` contains bare `*`, a wildcard server segment, a partial tool-name glob, a mid-string wildcard, or multiple wildcards
- **THEN** startup fails naming the unsupported entry

#### Scenario: Similar server prefix does not match

- **WHEN** `mcp__web__*` is configured alongside servers `web` and `webExtra`
- **THEN** the pattern names only the canonical `web` namespace
- **AND** startup validation does not treat `webExtra` as a match
