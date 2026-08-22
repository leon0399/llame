## ADDED Requirements

### Requirement: Operator configuration declares private local Knowledge sources

The instance configuration SHALL accept an optional `knowledge.sources` object whose keys are opaque operator-chosen source identifiers and whose values contain one absolute repository-root path. The built-in default SHALL be an empty object. A source identifier SHALL match `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` and be unique within the object. It is suitable only for private linkage and MUST NOT be presented as Knowledge Space identity.

Repository roots SHALL use the configuration system's existing string interpolation rules and SHALL be validated as absolute after interpolation. Schema validation SHALL remain closed: unknown Knowledge fields, relative roots, malformed source identifiers, and wrong value types fail startup at the offending configuration path. Live repository validity and accepted refs belong to trusted provisioning rather than the raw configuration schema.

Every process that authors Chat Runs SHALL declare the same complete logical source-key set so accept-time tool availability is independent of the accepting API instance. Configuration loading SHALL NOT require those paths to exist on an HTTP-only process that consumes no `runs` jobs. Every process that does consume `runs` SHALL additionally have Git and accessible repository mounts for the complete set.

The source map SHALL contain no owner identity, accepted ref, remote URL, Git credential, cache path, checkout policy, clone instruction, or automatic discovery rule. Resolved source keys and paths SHALL remain private to operator diagnostics and trusted repository resolution and SHALL NOT enter public configuration, model context, tool results, Run events, or owner-facing errors.

#### Scenario: No sources configured

- **WHEN** `knowledge.sources` is absent
- **THEN** the resolved source map is empty
- **AND** startup succeeds without a repository or Git dependency

#### Scenario: Absolute process-local source is configured

- **WHEN** an operator configures a valid source key with an absolute interpolated repository root
- **THEN** trusted provisioning and Run workers can resolve that key to the local root
- **AND** the path is omitted from public and model-facing configuration

#### Scenario: HTTP-only API declares keys without mounting repositories

- **WHEN** an API process authors Runs but its worker profile consumes no `runs` jobs
- **THEN** it declares the same logical source keys used by the execution workers
- **AND** configuration loading does not probe or require access to those repository paths

#### Scenario: Relative source root fails startup

- **WHEN** a configured source root resolves to a relative path
- **THEN** startup fails naming the configuration field
- **AND** no source entry is partially applied

#### Scenario: Configuration cannot assign an owner or remote

- **WHEN** a source entry attempts to include an owner, accepted ref, remote URL, credential, clone instruction, or unknown field
- **THEN** closed-schema validation rejects the entry

## MODIFIED Requirements

### Requirement: First-slice setting surface

The schema SHALL cover the shape-stable operator settings and SHALL be extended by consumer changes, each adding its own keys (add-when-consumed). The settings include: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — not the catalog itself, which lives in the top-level `models` array), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.heartbeatStaleSeconds`, `runs.timeoutSeconds`, `http.trustProxy`, the `tools` namespace (`tools.allowed`, default empty = no tools, fail closed; `tools.maxStepsPerRun`, default 8; `tools.callTimeoutSeconds`, default 15), the top-level `mcpServers` named object (default empty = no MCP servers of any transport; entries are `type`-discriminated and may be remote Streamable HTTP or local stdio), the `knowledge.sources` named object (default empty = no local Knowledge sources), the `providers` array (provider connections), and the `models` array (the executable catalog). `tools.allowed` SHALL accept registered code-owned ids, exact canonical configured-MCP ids, and the single configured-MCP namespace wildcard form `mcp__<server>__*`. Provider connection settings (formerly the `OPENAI_BASE_URL` / `OPENAI_API_KEY` environment variables) SHALL be expressed as `providers[]` entries; those environment variables remain valid **interpolation inputs** (`{env:OPENAI_API_KEY:-}`) but are no longer read directly. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model — every model declares its `contextWindowTokens`, and its trigger threshold resolves per-model via the optional `models[].compactionThresholdTokens`, never by an instance knob.

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

#### Scenario: Knowledge sources resolve from the file

- **WHEN** the file declares entries under `knowledge.sources`
- **THEN** those entries are the complete process-local map of trusted logical source keys to repository roots
- **AND** an absent `knowledge` namespace resolves to an empty source map

#### Scenario: Absent tools namespace means no tools

- **WHEN** the file does not set the `tools` namespace
- **THEN** the allowlist is empty and no tool is advertised or executable

#### Scenario: MCP servers without an allowlist expose no tools

- **WHEN** the file configures `mcpServers` but omits `tools.allowed`
- **THEN** the servers may connect or launch but no discovered tool is advertised or executable
