## MODIFIED Requirements

### Requirement: Workspace MCP configuration is portable and protects interpolated values

A bound Workspace MUST load its MCP server entries from `<root>/.mcp.json` and `<root>/.llame/mcp.json`. An entry in `<root>/.llame/mcp.json` MUST replace an entry with the same name in `<root>/.mcp.json`. Workspace entries MUST use the portable named-server shape. An entry with `command` and no `type` MUST be read as stdio. `type: "http"` or `type: "streamable-http"` MUST select the remote Streamable HTTP transport. A stdio entry can supply ordered `args`, `env`, and `cwd`. A remote entry MUST supply its URL and can supply headers.

A stdio entry with no `cwd` MUST use the Workspace root, and a relative `cwd` MUST resolve from that root. The environment of a Workspace stdio child MUST be built as for an operator stdio server: the declared `env` values of the entry, after interpolation, over the fixed MCP base environment allowlist. The child MUST NOT inherit other variables of the environment that starts it.

Workspace server string values MUST support `${VAR}`, `${VAR:-default}`, `{env:…}`, and `{path:…}` interpolation. These tokens MUST resolve from the environment and filesystem of the Machine daemon of the Workspace, the host Machine included. A relative `{path:LOCATION}` MUST resolve from the Workspace root, and an absolute location MUST resolve as written. `${VAR:-default}` MUST use the literal default when `VAR` is unset or empty. Interpolation MUST be single-pass and not recursive: the system MUST NOT scan a resolved value again for tokens.

An unset variable without a default, or a file that cannot be read, MUST make the affected server unavailable. Its diagnostic MUST name the variable or the file location but never the resolved value. Command and argument fields MUST pass as literal text. A shell MUST NOT interpret them. A token can read the environment of the Machine daemon and pass a selected value to a Workspace server. That is an accepted risk of entry into an audited Workspace.

Every non-empty resolved interpolation value MUST join the protected-value set of that Workspace server. A literal that is only the `:-default` fallback in a stdio `command`, `args`, or `env` field, or in a remote `headers` entry, is the exception. A remote `headers` substitution MUST join in its trimmed form, as the HTTP runtime sends it. The non-empty trimmed whole value of a Workspace remote `Authorization`, `Proxy-Authorization`, or `Cookie` header MUST also join the protected-value set, whether literal or interpolated. Header names match ASCII case-insensitively.

Literal stdio `command`, `args`, and `env` text, and literal text of another remote header, MUST NOT join the protected-value set only because it is literal. The system MUST redact protected values before they can appear in the declarations, call arguments, results, diagnostics, entry result, receipts, persisted errors, or model-facing content of that server. This guarantee covers the traffic of that server and output from it. Another tool that reads the same source separately is outside this guarantee.

A malformed Workspace MCP file, an invalid server name or entry, an unsupported transport, or an interpolation that cannot resolve MUST NOT fail Workspace entry. The system MUST report each affected Workspace MCP server as unavailable, and it MUST contribute no callable tools.

#### Scenario: Workspace-local config overrides the portable config

- **WHEN** `<root>/.mcp.json` and `<root>/.llame/mcp.json` both define a server with the same name
- **THEN** the `.llame/mcp.json` entry is used for that server
- **AND** entries with different names from both files remain available to the Workspace

#### Scenario: Portable stdio and remote entries load

- **WHEN** a Workspace MCP entry has `command` but no `type`, or has `type: "http"` or `type: "streamable-http"`
- **THEN** it is interpreted as stdio or Streamable HTTP respectively
- **AND** a stdio server with omitted `cwd` runs from the Workspace root

#### Scenario: Relative stdio cwd resolves from the Workspace root

- **WHEN** a Workspace stdio entry declares a relative `cwd`
- **THEN** the child process uses that path resolved from the Workspace root

#### Scenario: Relative {path:} interpolation resolves from the Workspace root

- **WHEN** a Workspace MCP field contains `{path:secrets/token}` and `<root>/secrets/token` exists
- **THEN** the token reads that file relative to the Workspace root

#### Scenario: Workspace interpolation can read llame's process environment

- **WHEN** a Workspace MCP field contains `${LLAME_ONLY}` or `{env:LLAME_ONLY}` and the Machine daemon of the Workspace defines that variable
- **THEN** its value is used for that field
- **AND** for a Workspace on the host Machine, a variable that only the worker process defines is unset

#### Scenario: Unreferenced ambient variable is not inherited

- **WHEN** llame's environment defines `LLAME_AMBIENT_ONLY` and no Workspace MCP field references or declares it
- **THEN** a Workspace stdio child does not receive `LLAME_AMBIENT_ONLY` in its environment

#### Scenario: Interpolated values are protected and redacted

- **WHEN** a Workspace MCP field resolves a non-empty value using `${VAR}`, `${VAR:-default}` from a set variable, `{env:…}`, or `{path:…}`
- **THEN** the resolved value is protected for that Workspace server
- **AND** no protected value reaches that server's declarations, traffic, diagnostics, entry result, receipts, or model-facing content

#### Scenario: Unresolvable Workspace interpolation leaves the server unavailable

- **WHEN** a server field contains an unset `${MISSING}` or `{env:MISSING}` without a default, or a `{path:LOCATION}` whose file cannot be read
- **THEN** Workspace entry succeeds
- **AND** the affected server is reported unavailable with no callable tools
- **AND** the diagnostic names `MISSING` or `LOCATION` without printing the resolved value

#### Scenario: Workspace interpolation is single-pass

- **WHEN** `OUTER` resolves to the literal text `${INNER}` and a field contains `${OUTER}`
- **THEN** the field contains the literal `${INNER}`
- **AND** that value is not interpolated again

#### Scenario: Fallback literal is not protected solely by interpolation

- **WHEN** `${MISSING:-literal-default}` supplies a fallback in a Workspace stdio `command`, `args`, or `env` field
- **THEN** `literal-default` is not added to the protected-value set solely because it was a fallback

#### Scenario: Literal stdio configuration text is not protected

- **WHEN** a Workspace stdio `command`, `args`, or `env` field contains non-empty literal text
- **THEN** that text is not added to the protected-value set solely because it is literal
- **AND** traffic and results containing that text are neither refused nor redacted solely because of that literal

#### Scenario: Literal Workspace Authorization header is redacted

- **WHEN** a Workspace remote server has a non-empty literal `Authorization` header and echoes that header value in a result
- **THEN** the header value is protected for that Workspace server
- **AND** the echoed value is redacted before it reaches diagnostics, receipts, persisted errors, or model-facing content

#### Scenario: Literal Workspace non-credential header is not protected

- **WHEN** a Workspace remote server has a literal non-credential header such as `X-MCP-Readonly: true`
- **THEN** that value is not added to the Workspace server's protected-value set
- **AND** results containing it are neither refused nor redacted solely because of that literal

#### Scenario: Workspace commands and arguments are not shell-interpreted

- **WHEN** a Workspace command or argument contains shell metacharacters
- **THEN** the child process receives the literal text
- **AND** no shell evaluates it

#### Scenario: Unsupported Workspace transport leaves entry successful

- **WHEN** a Workspace MCP entry declares a transport other than stdio, `http`, or `streamable-http`
- **THEN** Workspace entry succeeds
- **AND** that server is reported unavailable with no callable tools

#### Scenario: Malformed Workspace MCP configuration leaves entry successful

- **WHEN** a Workspace MCP file is malformed or contains an invalid server name or entry
- **THEN** Workspace entry succeeds
- **AND** each affected server is reported unavailable rather than partially admitted

### Requirement: Workspace MCP clients are isolated, generation-keyed, and lifecycle-managed per Chat

Workspace MCP clients SHALL be owned by one Chat in the process executing that Chat's Run and SHALL be keyed by the tuple of Chat, canonical Workspace root, and integer binding generation. The binding generation SHALL increment on every enter that establishes a binding, switch, exit that clears a binding, or detach; a same-root re-entry and an exit on an unbound Chat leave it unchanged. One Chat's Workspace clients, discovered declarations, call state, and results SHALL never be used to serve another Chat or another owner. Workspace tools SHALL be resolved only from the current Chat's matching Workspace client set; they SHALL never be resolved for another Chat merely because server ids match.

Workspace candidates and executors SHALL remain outside the process-wide operator MCP runtime. Attempt composition SHALL take Workspace candidates from the current Chat's client set for its `(chatId, canonical root, generation)` binding, apply shadowing per Chat, and layer that Chat's Workspace executors over the operator executors for the attempt.

A Workspace client set SHALL start when the Chat enters the Workspace or, if it is not running in the current process, at the start of a Run for a bound Chat. At every attempt start, the executing process SHALL compare every client it holds for that Chat with the current binding, stop and discard each client whose Chat, canonical root, or generation does not match, and start clients keyed to the current binding before composing the Run's available tools. A process other than the one executing the binding change SHALL discard stale clients at its next attempt for that Chat or at the 30-minute idle timeout.

Each new Workspace client start SHALL re-read the current Workspace MCP configuration and reapply interpolation. A same-root re-entry is a no-op success returning the current state; it SHALL neither restart clients nor re-read Workspace configuration. Exit, switch, and detach SHALL stop the old clients in the executing process after the new binding or clear commits; other processes SHALL discard them through the generation check. A subsequent Run for a still-bound Chat SHALL start its matching clients again before composing the Run's available tools. Failure to start or discover a Workspace server SHALL leave the Workspace binding intact and report that server as unavailable; it SHALL NOT fail Workspace entry or prevent unrelated tools from operating.

Starting a Workspace MCP server SHALL NOT require a separate per-server permission check. Permission to enter the Workspace SHALL be the trust decision for reading and starting that Workspace's MCP configuration, including each later client start. This SHALL NOT waive the `tools.allowed` eligibility gate or `tools.permissions` authorization for any MCP tool call.

#### Scenario: Entry starts clients for its Chat

- **WHEN** a Chat successfully enters a Workspace containing a valid MCP server
- **THEN** the executing process starts a Workspace MCP client keyed to that Chat, canonical root, and binding generation
- **AND** the entry result reports that server's state

#### Scenario: Bound Chat starts matching clients in a new process

- **WHEN** a Run starts for a bound Chat whose matching Workspace clients are not running in that process
- **THEN** that process discards any stale clients for the Chat
- **AND** it starts clients keyed to the current binding before composing available tools

#### Scenario: Generation mismatch discards stale clients in another process

- **WHEN** another process holds Workspace clients for a Chat at an older root or binding generation and a later attempt observes a different current binding
- **THEN** that process stops and discards the stale clients and their declarations
- **AND** it starts only clients keyed to the current binding, if the Chat remains bound

#### Scenario: Idle clients stop and restart on the next Run

- **WHEN** a Chat has no Run in the executing process for 30 minutes and later runs again while still bound
- **THEN** its idle Workspace clients have been stopped
- **AND** its next Run re-reads Workspace configuration and starts a fresh matching client set before composing available tools

#### Scenario: Exit, switch, and detach stop current clients

- **WHEN** the Chat exits or switches Workspace, or detaches, and the new binding or clear commits with a new generation
- **THEN** the executing process stops the clients for the previous binding and withdraws their tools
- **AND** other processes discard those stale clients at their next attempt for the Chat or at the 30-minute idle timeout

#### Scenario: Same-root re-entry preserves clients and configuration

- **WHEN** a Chat is already bound to canonical root `machine://devl/workspace` and enters `machine://devl/workspace` again
- **THEN** the operation succeeds with the current Workspace state
- **AND** it does not restart clients or re-read Workspace configuration

#### Scenario: A new client start re-reads Workspace configuration

- **WHEN** a bound Chat needs a new client set after a process change, idle stop, or stale-generation discard
- **THEN** the executing process reads the current Workspace MCP files before starting those clients
- **AND** it does not reuse a prior process's configuration or declarations

#### Scenario: Server start uses Workspace entry as the trust decision

- **WHEN** `enter_workspace` permission is granted but no `tools.permissions` group authorizes a tool from a configured Workspace server
- **THEN** the server may start and be reported as available
- **AND** a call to its tool is rejected without an accepting permission

#### Scenario: Chat B does not receive Chat A's Workspace tools

- **WHEN** Chat A has started Workspace MCP clients and Chat B runs in the same process without those clients
- **THEN** Chat B receives no Workspace declarations, clients, call state, or results belonging to Chat A
- **AND** Chat B uses only its own eligible tools

#### Scenario: Another owner does not receive Workspace clients

- **WHEN** two different owners have Chats running in the same process
- **THEN** neither owner's Workspace clients or tool state are available to the other owner's Chat

#### Scenario: Chats with matching server ids use their own Workspace executors

- **WHEN** Chat A and Chat B are bound to different Workspaces in one process and each Workspace defines server id `web` with an admitted tool of the same id
- **THEN** Chat A's call to that tool is executed by Chat A's Workspace server and Chat B's call is executed by Chat B's Workspace server
- **AND** neither Chat receives the other Chat's declaration, client, call state, result, or executor
