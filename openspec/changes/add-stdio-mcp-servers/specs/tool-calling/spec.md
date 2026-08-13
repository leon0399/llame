## MODIFIED Requirements

### Requirement: First tool is internal, read-only, own-data

The first code-owned tool SHALL remain conversation search over the requesting user's own chats, implemented against the **same server-side search service the web chat search uses**. Code-owned tools SHALL take authorization identity only from trusted Run context and SHALL remain tenant-scoped by datastore enforcement.

MCP tools MAY perform reads outside llame only through the `mcp-tools` capability, on either transport: a remote Streamable HTTP endpoint, or a local server llame runs as a child process. The operator SHALL explicitly configure the source and allowlist each executable namespaced tool exactly or allowlist that configured server's namespace. An exact entry SHALL attest that operation as read-only; a namespace wildcard SHALL attest every current and future safely admitted operation from that server as read-only. MCP execution SHALL receive no llame tenant authorization context, and no credential beyond what the operator configured for that server — request headers for a remote server, declared environment values and arguments for a local one. A local server additionally executes with the host privileges of the llame process itself, which the operator accepts by configuring it; llame bounds the protocol it speaks, not what the program does. Operators MUST NOT allowlist write, send, delete, execute, financial, or administrative MCP operations under either form or transport; llame does not infer or verify semantic effects from MCP metadata.

#### Scenario: Conversation search over own chats

- **WHEN** the model invokes the conversation-search tool with a query
- **THEN** it returns matches only from chats owned by the run's owner

#### Scenario: Tool and UI search share one implementation

- **WHEN** the conversation-search tool and the web chat search execute the same query for the same user
- **THEN** both are served by the same underlying search service

#### Scenario: No external network egress from tools

- **WHEN** the shipped code-owned toolset is enumerated
- **THEN** none performs outbound network requests
- **AND** the only external-tool exception is an explicitly configured MCP read selected by an exact entry or matching namespace wildcard under the operator's read-only attestation

#### Scenario: Explicit MCP read is the only external-tool exception

- **WHEN** the shipped toolset is enumerated
- **THEN** external network tools are limited to explicitly configured MCP ids carrying the operator's exact or namespace-wide read-only attestation
- **AND** no remote tool receives llame's trusted tenant datastore context
