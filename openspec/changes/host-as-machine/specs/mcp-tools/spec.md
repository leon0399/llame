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
