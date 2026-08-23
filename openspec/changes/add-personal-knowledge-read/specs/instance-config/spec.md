## ADDED Requirements

### Requirement: Operator configuration declares one private local Knowledge root

The instance configuration SHALL accept an optional `knowledge.root` string containing one absolute process-local path beneath which server-managed personal Knowledge Space directories exist. The built-in default SHALL be absent. The path SHALL use the configuration system's existing string interpolation rules and SHALL be validated as absolute after interpolation.

Schema validation SHALL remain closed: unknown Knowledge fields, relative roots, and wrong value types fail startup at the offending configuration path. Configuration loading SHALL NOT require the root to exist, resolve it, or probe filesystem permissions. Live validity belongs to provisioning and execution.

Every process that authors Chat Runs SHALL declare `knowledge.root` when Knowledge tools are enabled so accept-time availability is independent of the accepting API instance. Every process serving Knowledge Space provisioning SHALL additionally resolve the root and have permission to create the owner's stable-ID child. Every process consuming `runs` SHALL resolve the corresponding root and have read access to all owner directories its queue may execute. Absolute root paths MAY differ by process when they expose the same logical stable-ID children.

The Knowledge configuration SHALL contain no owner identity, Knowledge Space identifier, child-directory name, source map, accepted ref, remote URL, Git credential, cache path, checkout policy, clone instruction, or discovery rule. The root SHALL remain private to operator diagnostics and trusted local resolution and SHALL NOT enter public configuration, model context, tool results, Run events, or owner-facing errors.

#### Scenario: No root configured

- **WHEN** `knowledge.root` is absent
- **THEN** configuration loading succeeds without a Knowledge filesystem dependency
- **AND** provisioning and Knowledge tools remain unavailable

#### Scenario: Absolute process-local root is configured

- **WHEN** an operator configures a valid absolute interpolated Knowledge root
- **THEN** trusted provisioning and Run workers may resolve stable-ID children beneath it
- **AND** the root is omitted from public and model-facing configuration

#### Scenario: Configuration loading does not probe the root

- **WHEN** an HTTP process loads a syntactically valid absolute Knowledge root that is not mounted there
- **THEN** schema loading succeeds without a filesystem probe
- **AND** a later provisioning or execution attempt fails closed if that process requires access

#### Scenario: Relative root fails startup

- **WHEN** the configured Knowledge root resolves to a relative path
- **THEN** startup fails naming the configuration field
- **AND** no Knowledge setting is partially applied

#### Scenario: Configuration cannot assign an owner or source

- **WHEN** the `knowledge` object attempts to include an owner, resource identifier, child path, source map, Git field, remote, credential, or unknown field
- **THEN** closed-schema validation rejects it

## MODIFIED Requirements

### Requirement: First-slice setting surface

The schema SHALL cover the shape-stable operator settings and SHALL be extended by consumer changes, each adding its own keys (add-when-consumed). The settings include: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — not the catalog itself, which lives in the top-level `models` array), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.heartbeatStaleSeconds`, `runs.timeoutSeconds`, `http.trustProxy`, the `tools` namespace (`tools.allowed`, default empty = no tools, fail closed; `tools.maxStepsPerRun`, default 8; `tools.callTimeoutSeconds`, default 15), the top-level `mcpServers` named object (default empty = no MCP servers of any transport; entries are `type`-discriminated and may be remote Streamable HTTP or local stdio), the optional `knowledge.root` absolute path (default absent = no local Knowledge capability), the `providers` array (provider connections), and the `models` array (the executable catalog). `tools.allowed` SHALL accept registered code-owned ids, exact canonical configured-MCP ids, and the single configured-MCP namespace wildcard form `mcp__<server>__*`. Provider connection settings (formerly the `OPENAI_BASE_URL` / `OPENAI_API_KEY` environment variables) SHALL be expressed as `providers[]` entries; those environment variables remain valid **interpolation inputs** (`{env:OPENAI_API_KEY:-}`) but are no longer read directly. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model — every model declares its `contextWindowTokens`, and its trigger threshold resolves per-model via the optional `models[].compactionThresholdTokens`, never by an instance knob.

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
