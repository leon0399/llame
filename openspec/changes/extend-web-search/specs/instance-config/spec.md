# Spec Delta

## MODIFIED Requirements

### Requirement: Web search engine entries have fixed per-type shapes

Each engine entry except `aggregate` can set `timeoutSeconds`, a positive integer with the default 60. An `aggregate` entry MUST NOT set it. `brave`, `exa`, and `perplexity` MUST have a `key`, and `exa-mcp` can have one. `searxng` MUST have an absolute `http:` or `https:` `baseUrl`. `duckduckgo` has no field for its type. `aggregate` MUST have `engines` with two or more distinct ids. `model-hosted` MUST have `model`. Each `key` and `baseUrl` MUST be an interpolated secret.

#### Scenario: Missing key fails startup

- **WHEN** a `perplexity` engine has no `key`
- **THEN** startup fails and names the `key` path of that entry

#### Scenario: Interpolated key is never disclosed

- **WHEN** the `key` of a `brave` engine is `{env:BRAVE_API_KEY}`, the variable is set, and the requests of the engine fail with HTTP 401
- **THEN** the value of the variable occurs in no startup error, tool output, Run event, or log

#### Scenario: Relative SearXNG URL fails startup

- **WHEN** a `searxng` engine sets `baseUrl` to `search.local/`
- **THEN** startup fails and names the `baseUrl` path of that entry

### Requirement: Web search references are validated at startup

Each id in `webSearch.chain` and in the `engines` of an `aggregate` entry MUST name a defined engine. An `aggregate` child MUST NOT be an `aggregate`. The `model` of a `model-hosted` entry MUST name a `models[]` entry with the provider type `openai-responses`, `openai-codex`, or `anthropic-messages`. Each violation MUST fail startup and name the path of the violation.

#### Scenario: Unknown chain id fails startup

- **WHEN** `webSearch.chain` contains `exa` and no engine has that id
- **THEN** startup fails and names `webSearch.chain`

#### Scenario: Nested aggregate fails startup

- **WHEN** an `aggregate` entry lists another `aggregate` entry in its `engines`
- **THEN** startup fails and names the `engines` path of that entry

#### Scenario: Hosted engine on an unsupported wire fails startup

- **WHEN** a `model-hosted` entry names a model with the provider type `openai-completions`
- **THEN** startup fails and names the `model` path of that entry

#### Scenario: Duplicate aggregate child fails startup

- **WHEN** an `aggregate` entry sets `engines` to `["brave", "brave"]`
- **THEN** startup fails and names the `engines` path of that entry

#### Scenario: Hosted engine inside an aggregate fails startup

- **WHEN** an `aggregate` entry lists a `model-hosted` engine whose model has the provider type `openai-completions`
- **THEN** startup fails and names the `model` path of that hosted entry

#### Scenario: Hosted engine inside an aggregate loads

- **WHEN** an `aggregate` entry lists a `model-hosted` engine on a supported provider type and a `brave` engine
- **THEN** startup succeeds

## ADDED Requirements

### Requirement: New web search engine types have fixed shapes

A `deepseek` entry MUST have a `key`. A `parallel` entry MUST have a `key` and can have `mode` with the value `turbo`, `fast`, `basic`, or `advanced`. The default `mode` is `fast`. A `parallel-mcp` entry MUST NOT have a `key` or another field for its type. Each `key` MUST be an interpolated secret.

#### Scenario: Unknown Parallel mode fails startup

- **WHEN** a `parallel` engine sets `mode` to `deep`
- **THEN** startup fails and names the `mode` path of that entry

#### Scenario: Parallel mode defaults to fast

- **WHEN** a `parallel` engine sets no `mode`
- **THEN** startup succeeds and the engine sends `mode: "fast"`

#### Scenario: Keyless Parallel MCP refuses a key

- **WHEN** a `parallel-mcp` engine sets `key`
- **THEN** startup fails and names the `key` path of that entry

### Requirement: Yandex web search engines have fixed shapes

A `yandex` or `yandex-gen` entry MUST have a `key` and a `searchType` with the value `ru`, `tr`, `com`, `kk`, `be`, or `uz`. It can have a `folderId`. The `key` and the `folderId` MUST be interpolated secrets.

#### Scenario: Missing search type fails startup

- **WHEN** a `yandex` engine has no `searchType`
- **THEN** startup fails and names the `searchType` path of that entry

#### Scenario: Interpolated folder id is never disclosed

- **WHEN** the `folderId` of a `yandex-gen` engine is `{env:YANDEX_FOLDER_ID}` and its requests fail with HTTP 403
- **THEN** the value of the variable occurs in no startup error, tool output, Run event, or log

### Requirement: Web search engine entries can carry a model-facing description

Each `webSearch.engines` entry, also an `aggregate`, can have a `description` of 1 to 200 characters on one line. The value MUST be literal text. An interpolation token or a line break MUST fail startup and name the `description` path. The value is not a secret, and the model can read it.

#### Scenario: A description loads

- **WHEN** a `yandex` engine sets `description` to `Russian-language and CIS sources`
- **THEN** startup succeeds

#### Scenario: An interpolated description fails startup

- **WHEN** an engine sets `description` to `{env:ENGINE_NOTE}`
- **THEN** startup fails and names the `description` path of that entry

#### Scenario: A multi-line description fails startup

- **WHEN** an engine `description` contains a line break
- **THEN** startup fails and names the `description` path of that entry
