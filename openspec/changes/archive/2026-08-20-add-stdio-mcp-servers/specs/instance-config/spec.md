## MODIFIED Requirements

### Requirement: Remote MCP servers use the portable named-object shape

The top-level `mcpServers` setting SHALL be an object that maps server names to entries discriminated by `type`, matching the portable `.mcp.json` convention rather than inventing an array form. A remote entry SHALL be shaped exactly as `{ type, url, headers? }`. A server name SHALL contain 1–56 provider-safe ASCII letters, digits, `_`, or `-`, SHALL exclude the reserved `__` namespace separator, and SHALL be unique as a JSON object key. The 56-character bound SHALL be derived from the fixed provider-independent 64-character `mcp__<server>__<tool>` budget while reserving one character for the shortest valid normalized tool segment, and configuration validation SHALL use the same bound as `mcp-tool-id-v1`. These naming rules SHALL apply to every entry regardless of `type`. Duplicate properties MUST be rejected rather than silently overwritten. `type` SHALL accept `"http"` and the explicit MCP name `"streamable-http"` as aliases for the same Streamable HTTP transport, and SHALL accept `"stdio"` for the local-process transport specified separately; any other value SHALL fail startup. `type` SHALL be required rather than inferred from which sibling fields are present. `url` SHALL be an absolute `http` or `https` URL with empty username and password components; userinfo SHALL be rejected before transport construction. `headers`, when present, SHALL map non-empty header names to string values supporting llame's existing `{env:…}` and `{path:…}` interpolation rules. Header names that collide under ASCII case-folding SHALL be rejected before transport construction. Attempts to override `Accept`, `Content-Type`, `MCP-Protocol-Version`, `MCP-Session-Id`, `Last-Event-ID`, or another transport-owned header SHALL be detected by the same ASCII-case-folded comparison. Fields belonging to another transport's variant SHALL be rejected as unknown for this one. Unknown fields, invalid names, invalid URLs, URL userinfo, empty or colliding header names, and transport-owned headers SHALL fail startup naming only the configuration path, without printing resolved header values or credential-bearing URL text.

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

#### Scenario: Missing type fails startup

- **WHEN** an `mcpServers` entry omits `type`
- **THEN** startup fails naming the entry rather than inferring a transport from its other fields

#### Scenario: Cross-variant field is rejected

- **WHEN** a remote entry also declares a field belonging to the stdio variant
- **THEN** startup fails naming the unknown field for that entry

### Requirement: First-slice setting surface

The schema SHALL cover the shape-stable operator settings and SHALL be extended by consumer changes, each adding its own keys (add-when-consumed). The settings include: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — not the catalog itself, which lives in the top-level `models` array), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.heartbeatStaleSeconds`, `runs.timeoutSeconds`, `http.trustProxy`, the `tools` namespace (`tools.allowed`, default empty = no tools, fail closed; `tools.maxStepsPerRun`, default 8; `tools.callTimeoutSeconds`, default 15), the top-level `mcpServers` named object (default empty = no MCP servers of any transport; entries are `type`-discriminated and may be remote Streamable HTTP or local stdio), the `providers` array (provider connections), and the `models` array (the executable catalog). `tools.allowed` SHALL accept registered code-owned ids, exact canonical configured-MCP ids, and the single configured-MCP namespace wildcard form `mcp__<server>__*`. Provider connection settings (formerly the `OPENAI_BASE_URL` / `OPENAI_API_KEY` environment variables) SHALL be expressed as `providers[]` entries; those environment variables remain valid **interpolation inputs** (`{env:OPENAI_API_KEY:-}`) but are no longer read directly. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model — every model declares its `contextWindowTokens`, and its trigger threshold resolves per-model via the optional `models[].compactionThresholdTokens`, never by an instance knob.

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

#### Scenario: Absent tools namespace means no tools

- **WHEN** the file does not set the `tools` namespace
- **THEN** the allowlist is empty and no tool is advertised or executable

#### Scenario: MCP servers without an allowlist expose no tools

- **WHEN** the file configures `mcpServers` but omits `tools.allowed`
- **THEN** the servers may connect or launch but no discovered tool is advertised or executable

## ADDED Requirements

### Requirement: Local stdio MCP servers use a command-and-arguments entry shape

An `mcpServers` entry whose `type` is `"stdio"` SHALL be shaped exactly as `{ type, command, args?, env?, cwd? }`. `command` SHALL be a non-empty string naming an executable, resolved against the child process's search path or given as a host path. `args`, when present, SHALL be an ordered array of strings. There SHALL be no field accepting a whole command line as one shell-interpreted string. `env`, when present, SHALL map non-empty variable names to string values. `cwd`, when present, SHALL be a string naming the child process's working directory. There SHALL be no field for disabling an entry in place; the configuration file is JSONC, so an entry that should not run is commented out or removed.

`command`, each element of `args`, and each `env` value SHALL support llame's existing `{env:…}` and `{path:…}` interpolation rules. No other interpolation syntax SHALL be introduced for these fields; a `${…}` sequence carries no meaning and is ordinary text.

Unknown fields, an empty `command`, a non-string argument, an empty variable name, and fields belonging to a remote entry SHALL fail startup naming only the configuration path, without printing resolved argument or environment values.

The operator-facing surface SHALL state plainly that a configured stdio server executes on the llame host with llame's own filesystem and network access and is not sandboxed, so configuring one is a trust decision equivalent to installing software on that host. It SHALL also state that a credential interpolated into `args` becomes part of that child process's argv, observable by another process on the host, and that `env` SHALL be used for credential values instead — the `mcp-tools` capability's protected-value redaction covers what llame itself logs, persists, and sends to a model, and cannot reach argv visible to another process.

#### Scenario: Portable stdio entry loads

- **WHEN** `mcpServers.files` contains `{ "type": "stdio", "command": "node", "args": ["/srv/mcp/files.js"] }`
- **THEN** llame configures the stdio server named `files`

#### Scenario: Interpolated environment secret loads

- **WHEN** a stdio entry declares `"env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "{env:GITHUB_MCP_PAT}" }`
- **THEN** the resolved value is supplied to that server's child process
- **AND** its value is treated as a secret by every downstream surface

#### Scenario: Shell-style interpolation is literal text

- **WHEN** a stdio entry's argument contains `${HOME}`
- **THEN** that text is passed through unchanged rather than expanded

#### Scenario: Unknown stdio field fails startup

- **WHEN** a stdio entry declares a field outside `type`, `command`, `args`, `env`, and `cwd`
- **THEN** startup fails naming the unknown configuration path

#### Scenario: Secret-bearing stdio error stays opaque

- **WHEN** a stdio entry's `env` interpolation references a missing secret
- **THEN** startup fails naming the configuration path without printing any resolved or partial value
