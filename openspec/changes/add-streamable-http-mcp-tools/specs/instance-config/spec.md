## MODIFIED Requirements

### Requirement: First-slice setting surface

The schema SHALL cover the shape-stable operator settings and SHALL be extended by consumer changes, each adding its own keys (add-when-consumed). The settings include: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — not the catalog itself, which lives in the top-level `models` array), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.heartbeatStaleSeconds`, `runs.timeoutSeconds`, `http.trustProxy`, the `tools` namespace (`tools.allowed`, default empty = no tools, fail closed; `tools.maxStepsPerRun`, default 8; `tools.callTimeoutSeconds`, default 15), the top-level `mcpServers` named object (default empty = no remote MCP servers), the `providers` array (provider connections), and the `models` array (the executable catalog). Provider connection settings (formerly the `OPENAI_BASE_URL` / `OPENAI_API_KEY` environment variables) SHALL be expressed as `providers[]` entries; those environment variables remain valid **interpolation inputs** (`{env:OPENAI_API_KEY:-}`) but are no longer read directly. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model — every model declares its `contextWindowTokens`, and its trigger threshold resolves per-model via the optional `models[].compactionThresholdTokens`, never by an instance knob.

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

- **WHEN** the file sets `tools.allowed` to code-owned and namespaced dynamic tool ids
- **THEN** exactly those eligible tools may become available to Runs under the `tool-calling` capability's gate semantics

#### Scenario: Absent tools namespace means no tools

- **WHEN** the file does not set the `tools` namespace
- **THEN** the allowlist is empty and no tool is advertised or executable

#### Scenario: MCP servers resolve from the file

- **WHEN** the file declares entries under the top-level `mcpServers` object
- **THEN** those entries are the complete instance-managed remote MCP server set

#### Scenario: Absent tools namespace means no tools

- **WHEN** the file sets neither the `tools` namespace nor `mcpServers`
- **THEN** the allowlist and MCP server list are empty and no tool is advertised or executable

#### Scenario: MCP servers without an allowlist expose no tools

- **WHEN** the file configures `mcpServers` but omits `tools.allowed`
- **THEN** the remote servers may connect but no discovered tool is advertised or executable

## ADDED Requirements

### Requirement: Remote MCP servers use the portable named-object shape

The top-level `mcpServers` setting SHALL be an object that maps server names to entries shaped exactly as `{ type, url, headers? }`, matching the portable `.mcp.json` convention rather than inventing an array form. A server name SHALL contain 1–56 provider-safe ASCII letters, digits, `_`, or `-`, SHALL exclude the reserved `__` namespace separator, and SHALL be unique as a JSON object key. The 56-character bound SHALL be derived from the fixed provider-independent 64-character `mcp__<server>__<tool>` budget while reserving one character for the shortest valid normalized tool segment, and configuration validation SHALL use the same bound as `mcp-tool-id-v1`. Duplicate properties MUST be rejected rather than silently overwritten. `type` SHALL accept `"http"` and the explicit MCP name `"streamable-http"` as aliases for the same Streamable HTTP transport; any other value SHALL fail startup. `url` SHALL be an absolute `http` or `https` URL with empty username and password components; userinfo SHALL be rejected before transport construction. `headers`, when present, SHALL map non-empty header names to string values supporting llame's existing `{env:…}` and `{path:…}` interpolation rules. Header names that collide under ASCII case-folding SHALL be rejected before transport construction. Attempts to override `Accept`, `Content-Type`, `MCP-Protocol-Version`, `MCP-Session-Id`, `Last-Event-ID`, or another transport-owned header SHALL be detected by the same ASCII-case-folded comparison. Unknown fields, invalid names, invalid URLs, URL userinfo, empty or colliding header names, and transport-owned headers SHALL fail startup naming only the configuration path, without printing resolved header values or credential-bearing URL text.

#### Scenario: Static bearer header resolves from a secret

- **WHEN** an MCP server header is `"Authorization": "Bearer {env:SEARCH_TOKEN}"`
- **THEN** the resolved header is supplied to that server's transport
- **AND** its value is treated as a secret by every downstream surface

#### Scenario: Portable HTTP entry loads

- **WHEN** `mcpServers.web` contains `{ "type": "http", "url": "https://example.test/mcp" }`
- **THEN** llame configures the Streamable HTTP server named `web`

#### Scenario: Explicit Streamable HTTP alias loads

- **WHEN** `mcpServers.web.type` is `streamable-http`
- **THEN** llame configures the same transport as `http`

#### Scenario: Duplicate server property fails startup

- **WHEN** the JSONC source declares `mcpServers.web` more than once
- **THEN** startup fails naming the duplicate property instead of keeping one value

#### Scenario: Reserved namespace separator is rejected

- **WHEN** an MCP server name contains `__`
- **THEN** startup fails before any namespaced tool id can become ambiguous

#### Scenario: Overlength server name fails startup

- **WHEN** an MCP server name contains more than 56 ASCII characters
- **THEN** startup fails before discovery using the same generated-id bound as `mcp-tool-id-v1`

#### Scenario: Reserved transport header is rejected

- **WHEN** an entry attempts to configure a transport-owned header using any case variant, such as `mcp-session-id` or `Mcp-Protocol-Version`
- **THEN** startup fails naming the header path without printing its value

#### Scenario: URL userinfo is rejected without disclosure

- **WHEN** `mcpServers.web.url` contains a username or password component
- **THEN** startup fails naming `mcpServers.web.url` without printing the credential-bearing URL

#### Scenario: Case-variant duplicate headers are rejected

- **WHEN** one server entry configures both `Authorization` and `authorization`
- **THEN** startup fails naming the colliding header paths without printing either value

### Requirement: Tool allowlist validation distinguishes code-owned and declared dynamic ids

At startup, every code-owned id in `tools.allowed` SHALL still be required to exist in the code-owned registry. An id beginning with `mcp__` SHALL instead be parsed with `mcp-tool-id-v1`'s exact namespace grammar, 64-character bound, configured-server lookup, and canonical tool-segment rules; startup SHALL NOT depend on connecting to that server or discovering the named remote tool. Any other unknown id SHALL fail startup. This split MUST NOT weaken the runtime allowlist: a valid configured MCP id remains unavailable until fresh discovery and admission produce that exact id.

#### Scenario: Unknown code-owned id still fails boot

- **WHEN** `tools.allowed` contains `not_a_real_tool`
- **THEN** startup fails naming `tools.allowed` and the unknown id

#### Scenario: Offline MCP tool id does not fail boot

- **WHEN** `tools.allowed` contains `mcp__web__search`, server `web` is configured, and that server is offline
- **THEN** startup succeeds
- **AND** the tool is recorded as eligible but unavailable rather than advertised

#### Scenario: MCP id names an undeclared server

- **WHEN** `tools.allowed` contains `mcp__missing__search` and no MCP server id `missing` is configured
- **THEN** startup fails naming the allowlist entry and missing server declaration

#### Scenario: Malformed MCP id fails boot

- **WHEN** an allowlist entry begins with `mcp__` but does not contain valid server and tool segments
- **THEN** startup fails naming the malformed id
