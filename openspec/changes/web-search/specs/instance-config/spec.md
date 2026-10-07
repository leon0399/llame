## ADDED Requirements

### Requirement: Operator configuration declares web search engines and a chain

The config file SHALL accept an optional top-level `webSearch` object with an `engines` array and a `chain` array under the closed published schema. Each engine SHALL have a non-empty `id`, unique within `engines`, and a `type` discriminating its shape. `chain` SHALL be a non-empty, duplicate-free ordered list of engine ids. The built-in default SHALL be absent.

#### Scenario: Minimal configuration loads

- **WHEN** the file sets `webSearch` to one `brave` engine with id `brave`, a `key`, and `chain: ["brave"]`
- **THEN** startup succeeds with that engine as the only chain entry

#### Scenario: Unknown engine key fails startup

- **WHEN** a `brave` engine entry carries an unrecognized key `region`
- **THEN** startup fails naming that key's path

#### Scenario: Duplicate engine id fails startup

- **WHEN** two `webSearch.engines` entries share the id `brave`
- **THEN** startup fails naming `webSearch.engines` and the duplicate id

### Requirement: Web search engine entries have fixed per-type shapes

Each engine entry MAY set `timeoutSeconds`, a positive integer defaulting to 60. `brave`, `exa`, and `perplexity` SHALL require `key`; `exa-mcp` SHALL accept an optional `key`; `searxng` SHALL require an absolute `http:` or `https:` `baseUrl`; `duckduckgo` SHALL accept no other field; `aggregate` SHALL require `engines` with two or more distinct ids; and `model-hosted` SHALL require `model` and accept an optional `effort`. `key` and `baseUrl` SHALL be interpolated secrets.

#### Scenario: Missing key fails startup

- **WHEN** a `perplexity` engine has no `key`
- **THEN** startup fails naming that entry's `key` path

#### Scenario: Interpolated key is never disclosed

- **WHEN** a `brave` engine's `key` is `{env:BRAVE_API_KEY}`, the variable is set, and the engine's requests fail with HTTP 401
- **THEN** the variable's value appears in no startup error, tool output, Run event, or log

#### Scenario: Relative SearXNG URL fails startup

- **WHEN** a `searxng` engine sets `baseUrl` to `search.local/`
- **THEN** startup fails naming that entry's `baseUrl` path

### Requirement: Web search references are validated at startup

Every id in `webSearch.chain` and in an `aggregate` entry's `engines` SHALL name a defined engine. An `aggregate` child SHALL be a `brave`, `exa`, `exa-mcp`, `perplexity`, `searxng`, or `duckduckgo` engine. A `model-hosted` entry's `model` SHALL name a `models[]` entry whose provider type is `openai-responses`, `openai-codex`, or `anthropic-messages`, and its `effort`, when set, SHALL be one of that model's declared effort levels. Any violation SHALL fail startup naming the offending path.

#### Scenario: Unknown chain id fails startup

- **WHEN** `webSearch.chain` contains `exa` and no engine has that id
- **THEN** startup fails naming `webSearch.chain`

#### Scenario: Nested aggregate fails startup

- **WHEN** an `aggregate` entry lists another `aggregate` entry among its `engines`
- **THEN** startup fails naming that entry's `engines` path

#### Scenario: Hosted engine on an unsupported wire fails startup

- **WHEN** a `model-hosted` entry names a model whose provider type is `openai-completions`
- **THEN** startup fails naming that entry's `model` path

#### Scenario: Duplicate aggregate child fails startup

- **WHEN** an `aggregate` entry sets `engines` to `["brave", "brave"]`
- **THEN** startup fails naming that entry's `engines` path

#### Scenario: Hosted effort outside the model's levels fails startup

- **WHEN** a `model-hosted` entry sets `effort: "minimal"` and its model declares no `minimal` effort level
- **THEN** startup fails naming that entry's `effort` path

#### Scenario: Hosted engine inside an aggregate fails startup

- **WHEN** an `aggregate` entry lists a `model-hosted` engine
- **THEN** startup fails naming that entry's `engines` path

### Requirement: Allowlisting web search requires a configured chain

When `tools.allowed` contains `web_search`, startup SHALL fail unless `webSearch.chain` is configured, naming `webSearch.chain`. A configured `webSearch` without that allowlist entry SHALL load and SHALL NOT expose the tool.

#### Scenario: Allowlisted without configuration

- **WHEN** `tools.allowed` contains `web_search` and the file has no `webSearch`
- **THEN** startup fails naming `webSearch.chain`

#### Scenario: Configured but not allowlisted

- **WHEN** `webSearch` is configured and `tools.allowed` omits `web_search`
- **THEN** startup succeeds and no attempt declares `web_search`
