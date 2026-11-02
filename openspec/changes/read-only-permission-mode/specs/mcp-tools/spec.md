## ADDED Requirements

### Requirement: A read-only attempt starts and uses no Workspace MCP client

A `read-only` attempt MUST NOT start a Workspace MCP server, at attempt start or at Workspace entry. It MUST NOT use a Workspace MCP client that another attempt started in the same process. Thus the attempt has no Workspace MCP declaration. For a `read-only` attempt, this requirement takes precedence over each other requirement that starts Workspace MCP clients or adds their declarations.

#### Scenario: A bound Workspace starts no server process

- **WHEN** a Chat is bound to a Workspace whose `.mcp.json` declares a stdio server, and a `read-only` Run of that Chat starts
- **THEN** the system starts no process for that server
- **AND** the attempt declares no tool of that server

#### Scenario: A client that a default Run started is not used

- **WHEN** a `default` Run started the Workspace MCP clients of a Chat in a worker
- **AND** the next `read-only` Run of the Chat executes in the same worker
- **THEN** the `read-only` attempt declares no Workspace MCP tool
- **AND** the declarations of the attempt are the same as in a worker that never started those clients

#### Scenario: The next default Run starts the clients again

- **WHEN** a `read-only` Run of a bound Chat ends, and the owner then sends a `default` turn
- **THEN** the `default` attempt starts the Workspace MCP clients of the binding before it composes its tools

### Requirement: Workspace entry reports a server that read-only did not start

When a `read-only` attempt enters a Workspace, the entry result MUST report each Workspace MCP server as `unavailable`. Its reason MUST be the fixed text `not started in a read-only Run`. The result MUST NOT contain configuration values of the server.

#### Scenario: The entry result names the reason

- **WHEN** a `read-only` attempt enters a Workspace whose `.mcp.json` declares the server `docs`
- **THEN** the entry result reports `docs` with state `unavailable` and reason `not started in a read-only Run`
