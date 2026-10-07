## RENAMED Requirements

- FROM: `### Requirement: Code-owned tools stay internal and own-data while MCP is the only external-tool path`
- TO: `### Requirement: Code-owned tools stay own-data, and only MCP, web read, and web search fetch external content for the model`

## MODIFIED Requirements

### Requirement: Code-owned tools stay own-data, and only MCP, web read, and web search fetch external content for the model

The first code-owned tool SHALL remain conversation search over the requesting user's own chats, implemented against the **same server-side search service the web chat search uses**. Code-owned tools SHALL take authorization identity only from trusted Run context and SHALL remain tenant-scoped by datastore enforcement.

MCP tools MAY perform reads or other operations on external systems only through the `mcp-tools` capability, on either transport: a remote Streamable HTTP endpoint, or a local server llame runs as a child process. The operator SHALL explicitly configure the source, or permit entry into a Workspace whose MCP configuration supplies it, and SHALL allowlist each executable namespaced tool exactly or allowlist that server's namespace. An exact entry or namespace wildcard SHALL determine eligibility for matching, safely admitted MCP declarations; neither SHALL attest that an operation is read-only. The executing process's `tools.permissions` policy SHALL authorize each invocation. MCP execution SHALL receive no llame tenant authorization context, and an operator-configured server SHALL receive no credential beyond what the operator configured for that server — request headers for a remote server, declared environment values and arguments for a local one. A Workspace MCP server is an explicit exception to that source-bound credential statement: its configuration MAY interpolate values from the executing process's environment and filesystem, including llame's own process environment; this is an accepted risk of permitting entry into an audited repository, and the resolved values remain subject to the protections of `mcp-tools`. A local server additionally executes with the host privileges of the llame process itself, which the operator accepts by configuring it; llame bounds the protocol it speaks, not what the program does. The operator MAY allowlist write, send, delete, execute, financial, or administrative MCP operations, but each such invocation still requires an applicable `tools.permissions` allow; llame does not infer or verify semantic effects from MCP metadata.

Code-owned tools MAY reach external networks only as their own capabilities define. Two of them fetch external content on the model's behalf: native `read` on an `http:` or `https:` locator, including its operator-declared adapter targets, under `native-file-tools`, and `web_search`, through operator-configured engines, under `web-search`. Each SHALL be authorized per call by `tools.permissions` before any request and SHALL receive no llame tenant datastore context. Host `bash` executes with the llame process's own network access under `bash-execution`, and a search tool that embeds its query sends it to the operator's embedding provider under `search-embeddings`.

#### Scenario: Conversation search over own chats

- **WHEN** the model invokes the conversation-search tool with a query
- **THEN** it returns matches only from chats owned by the run's owner

#### Scenario: Tool and UI search share one implementation

- **WHEN** the conversation-search tool and the web chat search execute the same query for the same user
- **THEN** both are served by the same underlying search service

#### Scenario: No external network egress from tools

- **WHEN** the shipped code-owned toolset is enumerated
- **THEN** none fetches external content on the model's behalf except native `read` on an `http:` or `https:` locator and `web_search`
- **AND** each of those two sends a request only after its `tools.permissions` decision allows the call
- **AND** beyond those two code-owned tools, the only external-tool exception is an operator-permitted MCP tool from either an explicitly configured operator server or a successfully entered Workspace MCP server, selected by an exact entry or matching namespace wildcard and authorized by `tools.permissions`

#### Scenario: Explicit MCP tools are the only external-tool exception

- **WHEN** the shipped toolset is enumerated
- **THEN** external network tools are limited to explicitly configured operator MCP ids or MCP ids supplied by a successfully entered Workspace, matching the operator's exact or namespace allowlist and authorized by `tools.permissions`, plus the code-owned native `read` and `web_search` tools when allowlisted and authorized by `tools.permissions`
- **AND** no remote tool receives llame's trusted tenant datastore context

## ADDED Requirements

### Requirement: Code-owned web search uses the attempt-local read-only loop

The code-owned tool inventory SHALL include `web_search`. It SHALL declare `read_only`, require its own exact `tools.allowed` entry, and participate in the existing declaration admission, attempt-local runtime catalog, trusted executor binding, timeout, cooperative cancellation, settlement, persistence, replay, compaction, neutralization, and truncation contracts. Its engine behavior and its dedicated browser rendering are owned by `web-search`.

#### Scenario: Allowlisted web search is declared

- **WHEN** `tools.allowed` contains `web_search`, `webSearch.chain` is configured, and an attempt composes its catalog
- **THEN** the model receives a `web_search` declaration with the `web-search` input schema

#### Scenario: Unlisted web search is absent

- **WHEN** `tools.allowed` omits `web_search`
- **THEN** no attempt declares `web_search`, and a model call naming it is refused with a recorded, non-fatal tool error and the run continues
