## MODIFIED Requirements

### Requirement: First-slice setting surface

The schema SHALL cover the shape-stable operator settings and SHALL be extended by consumer changes, each adding its own keys (add-when-consumed). The settings include: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — not the catalog itself, which lives in the top-level `models` array), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.timeoutSeconds` (default `null`, meaning no wall-clock budget; otherwise a positive integer of seconds below the Run execution ceiling defined by `durable-runs`), `http.trustProxy`, the `tools` namespace (`tools.allowed`, default empty = no tools, fail closed; `tools.permissions`, default explicit portable code-owned policy without affecting availability; `tools.maxStepsPerRun`, default `null` (no step cap), otherwise a positive integer; `tools.callTimeoutSeconds`, default 120; `tools.webAdapters`, absent SHALL mean `[]` (no adapter is enabled), and present SHALL be an explicit replacement containing only `github` and `rewrite` entries), the top-level `mcpServers` named object (default empty = no MCP servers of any transport; entries are `type`-discriminated and may be remote Streamable HTTP or local stdio), the optional `knowledge.root` absolute path (default absent = no local Knowledge capability), the `providers` array (provider connections), and the `models` array (the executable catalog). `tools.allowed` SHALL accept registered code-owned ids, exact canonical MCP ids, and the namespace wildcard form `mcp__<server>__*` for any grammar-valid MCP server id, whether or not a server with that id is currently configured. Provider connection settings (formerly the `OPENAI_BASE_URL` / `OPENAI_API_KEY` environment variables) SHALL be expressed as `providers[]` entries; those environment variables remain valid **interpolation inputs** (`{env:OPENAI_API_KEY:-}`) but are no longer read directly. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model — every model declares its `contextWindowTokens`, and its trigger threshold resolves per-model via the optional `models[].compactionThresholdTokens`, never by an instance knob.

#### Scenario: Migrated settings resolve from the file

- **WHEN** the file sets `defaults.modelId` and `runs.timeoutSeconds`
- **THEN** model selection defaults and the Run wall-clock budget use those values

#### Scenario: Run limits are unlimited unless configured

- **WHEN** the file omits `runs.timeoutSeconds` and `tools.maxStepsPerRun`, or sets either to `null`
- **THEN** startup succeeds and Runs have no wall-clock budget and no tool-step cap

#### Scenario: A non-positive or over-ceiling Run limit fails startup

- **WHEN** `runs.timeoutSeconds` or `tools.maxStepsPerRun` resolves to zero, a negative number, or a fraction, or `runs.timeoutSeconds` is at or above the Run execution ceiling
- **THEN** startup fails naming the configuration path, and zero is never read as unlimited

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

#### Scenario: Absent web adapter setting enables no adapter

- **WHEN** the file omits `tools.webAdapters` while `tools` is otherwise configured
- **THEN** no adapter is enabled and the URL uses only the generic ladder
- **AND** no adapter origin is contacted
