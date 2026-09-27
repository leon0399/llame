## MODIFIED Requirements

### Requirement: First-slice setting surface

The schema SHALL cover the shape-stable operator settings and SHALL be extended by consumer changes, each adding its own keys (add-when-consumed). The settings include: `defaults.modelId`, `defaults.titleGenerationModelId` (instance-level model _pointers_ — not the catalog itself, which lives in the top-level `models` array), `runs.maxOutputTokens`, `runs.heartbeatSeconds`, `runs.timeoutSeconds`, `http.trustProxy`, the `tools` namespace (`tools.allowed`, default empty = no tools, fail closed; `tools.permissions`, default explicit portable code-owned policy without affecting availability; `tools.maxStepsPerRun`, default 100; `tools.callTimeoutSeconds`, default 120;
`tools.webAdapters`, whose absent value selects the documented final built-in
list and whose present array is an explicit replacement, including `[]` to
disable adapters), the top-level `mcpServers` named object (default empty = no MCP servers of any transport; entries are `type`-discriminated and may be remote Streamable HTTP or local stdio), the optional `knowledge.root` absolute path (default absent = no local Knowledge capability), the `providers` array (provider connections), and the `models` array (the executable catalog). `tools.allowed` SHALL accept registered code-owned ids, exact canonical configured-MCP ids, and the single configured-MCP namespace wildcard form `mcp__<server>__*`. Provider connection settings (formerly the `OPENAI_BASE_URL` / `OPENAI_API_KEY` environment variables) SHALL be expressed as `providers[]` entries; those environment variables remain valid **interpolation inputs** (`{env:OPENAI_API_KEY:-}`) but are no longer read directly. No `compaction.*` or context-window-fallback setting SHALL exist at the instance level: compaction is driven by the model — every model declares its `contextWindowTokens`, and its trigger threshold resolves per-model via the optional `models[].compactionThresholdTokens`, never by an instance knob.

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

#### Scenario: Absent web adapter setting selects the current default list

- **WHEN** the file omits `tools.webAdapters` while `tools` is otherwise configured
- **THEN** the effective adapter list is the built-in list shipped by the current stack layer
- **AND** no undeclared service or rewrite origin is contacted

## ADDED Requirements

### Requirement: Web adapter configuration is a closed operator replacement

The optional `tools.webAdapters` setting SHALL be an ordered array of unique
entries. Each entry SHALL contain a non-empty operator id and a `use` value
from exactly `github`, `telegram`, `fxembed`, or `rewrite`. The array SHALL be
an explicit replacement, not an extension of defaults: absent selects the
current built-in list, while present `[]` disables every adapter. A
`github` entry MAY contain only an optional `token`; a `telegram` entry SHALL
contain no options; an `fxembed` entry SHALL require an HTTPS `baseUrl` with
no userinfo, query, or fragment and a path that is empty or `/` (an explicit
port is allowed), and MAY contain interpolated secret `headers`; a `rewrite`
entry SHALL contain the validated match and target fields, and MAY contain
interpolated secret `headers`. Header names SHALL be case-folded for
validation; `host`, `user-agent`, `accept`, `accept-encoding`, `cookie`,
`content-length`, `connection`, and `transfer-encoding` SHALL be rejected,
while `authorization` is allowed for service routes. Unknown uses, duplicate
ids, unknown fields, invalid origins, malformed rewrite templates, non-http(s)
rewrite targets, and rewrite userinfo SHALL fail startup before serving
requests. An `{env:…}` or `{path:…}` token in any non-secret field SHALL fail
startup naming the entry and field. A GitHub `token` SHALL be absent or use an
interpolation token; a literal token SHALL fail boot rather than be treated as
redacted. Literal service/rewrite header values are allowed but are not
redacted unless an interpolation token supplies them. The loader SHALL reuse
the existing single-pass `{env:…}` and `{path:…}` interpolation and redaction
behavior for secret fields.

#### Scenario: Explicit replacement disables defaults

- **WHEN** the file sets `tools.webAdapters: []`
- **THEN** no built-in or third-party adapter is enabled
- **AND** a matching GitHub, Telegram, x.com service, or rewrite URL uses only the generic ladder

#### Scenario: Declared service is the only third-party contact

- **WHEN** the file declares one `fxembed` entry with `baseUrl: "https://api.fxtwitter.com"`
- **THEN** only that ordered service adapter is enabled in addition to any explicitly listed built-ins
- **AND** absent or undeclared delegated services are not contacted

#### Scenario: GitHub token uses existing secret interpolation

- **WHEN** a GitHub entry sets `token` to `{env:GITHUB_READ_TOKEN}` or `{path:/run/secrets/github-token}`
- **THEN** startup resolves the token through the existing interpolation resolver
- **AND** the resolved value is not written to logs, errors, diagnostics, or model-visible adapter notes

#### Scenario: Unknown adapter use fails closed

- **WHEN** an entry sets `use: "nitter"` or contains an unknown field
- **THEN** startup fails naming `tools.webAdapters` and that entry
- **AND** no partial adapter list is applied

#### Scenario: Duplicate adapter ids fail boot

- **WHEN** two entries use the same `id`
- **THEN** startup fails before serving requests
- **AND** neither entry is silently replaced

#### Scenario: Invalid delegated origin fails boot

- **WHEN** an `fxembed` base URL contains userinfo, a query, a fragment, a path below `/`, a non-HTTPS scheme, or an invalid URL
- **THEN** startup fails naming the entry and `baseUrl`
- **AND** no request is sent to the invalid origin

#### Scenario: Invalid rewrite target fails boot

- **WHEN** a rewrite target produces `file:///tmp/x`, `https://user:secret@example.test/x`, or a malformed template
- **THEN** startup fails naming the entry and target
- **AND** the instance does not start with that rewrite enabled

#### Scenario: Literal configuration does not gain secret status

- **WHEN** a rewrite or service header is literal text and contains no interpolation token
- **THEN** the loader does not claim it resolved a secret
- **AND** any interpolated segments remain redacted under the existing secret rules

#### Scenario: Reserved adapter headers fail boot

- **WHEN** an adapter declares `Host`, `User-Agent`, `Accept`, `Accept-Encoding`, `Cookie`, `Content-Length`, `Connection`, or `Transfer-Encoding`
- **THEN** startup fails naming the entry and header
- **AND** no adapter request is issued

#### Scenario: Non-secret interpolation fails boot

- **WHEN** `{env:HOST}` or `{path:/run/secrets/value}` appears in a match host, match path, base URL, rewrite origin, target template, or other non-secret field
- **THEN** startup fails naming the entry and field before resolving the token
- **AND** no partial adapter configuration is applied

#### Scenario: Literal GitHub token is rejected

- **WHEN** a GitHub entry supplies a literal token rather than an `{env:...}` or `{path:...}` interpolation
- **THEN** startup fails naming the token field because the literal cannot receive secret redaction
- **AND** no GitHub request is issued
