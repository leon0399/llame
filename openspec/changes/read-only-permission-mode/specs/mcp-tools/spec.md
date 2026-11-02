## ADDED Requirements

### Requirement: A read-only attempt starts and uses no Workspace MCP client

A `read-only` attempt MUST NOT start a Workspace MCP server, at attempt start or at Workspace entry. It MUST NOT use, hold, or take tools from a Workspace MCP client that another attempt started. Thus the attempt has no Workspace MCP declaration. The attempt MUST still stop the stale clients of the Chat at attempt start. For a `read-only` attempt, this rule MUST take precedence over each rule that starts Workspace MCP clients.

#### Scenario: A bound Workspace starts no server process

- **WHEN** a Chat is bound to a Workspace whose `.mcp.json` declares a stdio server, and a `read-only` Run of that Chat starts
- **THEN** the system starts no process for that server
- **AND** the attempt declares no tool of that server

#### Scenario: A client that a default Run started is not used

- **WHEN** a `default` Run started the Workspace MCP clients of a Chat in a worker
- **AND** the next `read-only` Run of the Chat executes in the same worker
- **THEN** the `read-only` attempt declares no Workspace MCP tool
- **AND** the declarations of the attempt are the same as in a worker that never started those clients

#### Scenario: A stale client stops in a read-only attempt

- **WHEN** a worker holds a Workspace MCP client of a Chat for an earlier binding generation, and a `read-only` attempt of that Chat starts
- **THEN** the worker stops that client

#### Scenario: The next default Run starts the clients again

- **WHEN** a `read-only` Run of a bound Chat ends, and the owner then sends a `default` turn
- **THEN** the `default` attempt starts the Workspace MCP clients of the binding before it composes its tools

### Requirement: Workspace entry reports a server that read-only did not start

When a `read-only` attempt enters a Workspace, the entry result MUST list each server that the Workspace MCP configuration declares as `unavailable`. The reason MUST be `not started in a read-only Run`. A server or a file that the configuration reports as unavailable MUST keep its own reason. This rule applies to a same-root re-entry, which then reads the configuration again. The listing MUST start no process.

#### Scenario: The entry result names the reason

- **WHEN** a `read-only` attempt enters a Workspace whose `.mcp.json` declares the server `docs`
- **THEN** the entry result reports `docs` with state `unavailable` and reason `not started in a read-only Run`

#### Scenario: A Machine Workspace reports the reason

- **WHEN** a `read-only` attempt enters `machine://devbox/repo`, and the Workspace configuration on that Machine declares the server `docs`
- **THEN** the entry result reports `docs` with state `unavailable` and reason `not started in a read-only Run`
- **AND** the Machine starts no server process

#### Scenario: A malformed configuration keeps its diagnostic

- **WHEN** a `read-only` attempt enters a Workspace whose `.mcp.json` is not valid JSON
- **THEN** the entry result reports that file as unavailable with its diagnostic, not with the read-only reason

#### Scenario: A same-root re-entry reports the read-only state

- **WHEN** a `default` Run started the Workspace MCP clients of a Chat, and a `read-only` attempt then enters the same root again
- **THEN** the entry result reports each server as `unavailable` with reason `not started in a read-only Run`
- **AND** the attempt takes no tool from the clients that the `default` Run started
