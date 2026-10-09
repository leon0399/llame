## MODIFIED Requirements

### Requirement: First-slice setting surface

The schema SHALL cover the shape-stable operator settings and SHALL be extended by consumer changes, each adding its own keys (add-when-consumed). The settings include: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — not the catalog itself, which lives in the top-level `models` array), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.timeoutSeconds` (default `null`, meaning no wall-clock budget; otherwise a positive integer of seconds below the Run execution ceiling defined by `durable-runs`), `http.trustProxy`, the `tools` namespace (`tools.allowed`, default empty = no tools, fail closed; `tools.permissions`, default explicit portable code-owned policy without affecting availability; `tools.maxStepsPerRun`, default `null` (no step cap), otherwise a positive integer; `tools.callTimeoutSeconds`, default 120; `tools.webAdapters`, absent SHALL mean `[]` (no adapter is enabled), and present SHALL be an explicit replacement containing only `github`, `bluesky`, `npm`, `huggingface`, `arxiv`, `stackexchange`, `crates`, `hackernews`, `doi`, `discourse`, `devto`, `substack`, `osv`, `wikipedia`, `telegram`, and `rewrite` entries), the top-level `mcpServers` named object (default empty = no MCP servers of any transport; entries are `type`-discriminated and may be remote Streamable HTTP or local stdio), the optional `knowledge.root` absolute path (default absent = no local Knowledge capability), the `providers` array (provider connections), and the `models` array (the executable catalog). `tools.allowed` SHALL accept registered code-owned ids, exact canonical MCP ids, and the namespace wildcard form `mcp__<server>__*` for any grammar-valid MCP server id, whether or not a server with that id is currently configured. Provider connection settings (formerly the `OPENAI_BASE_URL` / `OPENAI_API_KEY` environment variables) SHALL be expressed as `providers[]` entries; those environment variables remain valid **interpolation inputs** (`{env:OPENAI_API_KEY:-}`) but are no longer read directly. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model — every model declares its `contextWindowTokens`, and its trigger threshold resolves per-model via the optional `models[].compactionThresholdTokens`, never by an instance knob.

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

### Requirement: Web adapter configuration is a closed operator replacement

The optional `tools.webAdapters` setting SHALL be an ordered array of unique
entries. Each entry SHALL have the shape `{ id, use, ... }`, where `id` is a
non-empty operator-chosen identifier and `use` is exactly `github`, `bluesky`,
`npm`, `huggingface`, `arxiv`, `stackexchange`, `crates`, `hackernews`, `doi`, `discourse`, `devto`, `substack`, `osv`, `wikipedia`, `telegram`, or `rewrite`. The array SHALL be an explicit replacement: absent SHALL mean
`[]`, while present SHALL enable exactly the listed entries. A `github` entry
SHALL have the shape `{ id, use: "github", token? }`; `token`, when present,
SHALL be an `{env:...}` or `{path:...}` interpolation token. A `bluesky` entry
SHALL have the shape `{ id, use: "bluesky" }` and accepts no credential; an
`npm` entry SHALL have the shape `{ id, use: "npm" }`, a `huggingface`
entry `{ id, use: "huggingface" }`, an `arxiv` entry
`{ id, use: "arxiv" }`, a `stackexchange` entry
`{ id, use: "stackexchange" }`, a `crates` entry `{ id, use: "crates" }`, a
`hackernews` entry `{ id, use: "hackernews" }`, a `doi` entry
`{ id, use: "doi" }`, a `devto` entry `{ id, use: "devto" }`, a `substack`
entry `{ id, use: "substack" }`, an `osv` entry `{ id, use: "osv" }`, a
`wikipedia` entry `{ id, use: "wikipedia" }`, and a `telegram` entry
`{ id, use: "telegram" }`; none accepts a credential. A `discourse` entry SHALL have
the shape `{ id, use: "discourse", hosts }`, where `hosts` is a non-empty
array of canonical lowercase hostnames without a port, validated like a
rewrite entry's `hosts`; it accepts no credential. A
`rewrite` entry SHALL
have the shape `{ id, use: "rewrite", hosts, pathPattern?, target }`, where
`hosts` is an array of exact canonical host matches,
`pathPattern` is an optional RE2-compatible regular expression compiled by
the same bounded matcher `tools.permissions` uses, searched unanchored
against the canonical path, and `target` is a literal `http` or `https`
origin followed by a path/query template. The target SHALL contain no
userinfo or fragment. `{path}` SHALL appear only in the path portion and
expands to the canonical path as-is; `{query}` SHALL appear only in the path
or query portion and expands to
`encodeURIComponent` of the canonical query without `?`. No other placeholder
is permitted.
Unknown fields, unknown uses, duplicate ids, invalid targets, malformed
templates, and invalid, oversized, or unsupported `pathPattern` values SHALL
fail startup before serving requests.
An `{env:...}` or `{path:...}` token in any non-secret field SHALL fail startup
naming the entry and field. A GitHub `token` SHALL be absent or use an
interpolation token; a literal token SHALL fail boot rather than be treated as
redacted. The loader SHALL reuse the existing single-pass interpolation and
redaction behavior for secret fields.

#### Scenario: An explicit empty list enables no adapter

- **WHEN** the file sets `tools.webAdapters: []`
- **THEN** no adapter is enabled
- **AND** a matching URL uses only the generic ladder, with no adapter origin
  contacted

#### Scenario: Declared rewrite is the only third-party contact

- **WHEN** the file declares one rewrite entry matching a URL
- **THEN** only that declared rewrite origin may be contacted for adapter
  fetching
- **AND** an unclaimed URL uses the generic ladder with no adapter request and
  no adapter note

#### Scenario: GitHub token uses existing secret interpolation

- **WHEN** a GitHub entry sets `token` to `{env:GITHUB_READ_TOKEN}` or
  `{path:/run/secrets/github-token}`
- **THEN** startup resolves the token through the existing interpolation
  resolver
- **AND** the resolved value is not written to logs, errors, diagnostics, or
  model-visible adapter notes

#### Scenario: Unknown adapter use fails closed

- **WHEN** an entry sets `use: "nitter"`
- **THEN** startup fails naming `tools.webAdapters` and that entry
- **AND** no partial adapter list is applied

#### Scenario: Duplicate adapter ids fail boot

- **WHEN** two entries use the same `id`
- **THEN** startup fails before serving requests
- **AND** neither entry is silently replaced

#### Scenario: Invalid rewrite target fails boot

- **WHEN** a rewrite target is non-http(s) such as `file:///tmp/x`, contains
  userinfo such as `https://user:secret@example.test/x`, has a fragment,
  places `{path}` in its scheme, host, port, or query, uses an unknown
  placeholder
  such as `{source}`, or has a malformed template
- **THEN** startup fails naming the entry and `target`
- **AND** the instance does not start with that rewrite enabled

#### Scenario: Invalid rewrite path pattern fails boot

- **WHEN** a rewrite entry supplies an invalid, oversized, or unsupported (for
  example a backreference or lookbehind) `pathPattern`
- **THEN** startup fails naming the entry and `pathPattern`
- **AND** no partial adapter configuration is applied

#### Scenario: Non-secret interpolation fails boot

- **WHEN** `{env:HOST}` or `{path:/run/secrets/value}` appears in
  `hosts`, `target`, `pathPattern`, or another non-secret field
- **THEN** startup fails naming the entry and field before resolving the token
- **AND** no partial adapter configuration is applied

#### Scenario: Literal GitHub token is rejected

- **WHEN** a GitHub entry supplies a literal token rather than an
  `{env:...}` or `{path:...}` interpolation
- **THEN** startup fails naming the token field because the literal cannot
  receive secret redaction
- **AND** no GitHub request is issued

#### Scenario: Adapter headers field fails boot

- **WHEN** any entry declares a `headers` field
- **THEN** startup fails naming the entry and unknown field
- **AND** no adapter request is issued
