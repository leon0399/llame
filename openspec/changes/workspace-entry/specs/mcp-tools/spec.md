## REMOVED Requirements

### Requirement: MCP execution requires an operator read-only attestation

**Reason**: An allowlist is an eligibility gate, not evidence that a remote operation is read-only; `tools.permissions` is the authorization boundary for every MCP call.

**Migration**: Existing exact and namespace allowlist entries remain eligibility rules, but no longer attest to read-only behavior. Add `tools.permissions` rejects for MCP operations that should not execute; calls with no accepting permission group are rejected.

## ADDED Requirements

### Requirement: MCP eligibility and execution authorization are separate

MCP annotations, descriptions, and server claims SHALL NOT grant execution authority or safety classification. An MCP tool SHALL be eligible for advertisement only when its exact namespaced id is present in `tools.allowed` or matches a valid namespace wildcard for its server. This allowlist SHALL determine eligibility only; it SHALL NOT authorize a call or attest that an operation is read-only. Each call SHALL execute only when `tools.permissions` authorizes that exact tool id. A missing permission group or a rejecting permission SHALL prevent the call. A tool matching neither allowlist form SHALL be neither advertised nor disclosed to the model. These gates SHALL apply to every MCP transport and source, including Workspace servers.

#### Scenario: MCP annotation does not grant authority

- **WHEN** a server annotation describes a tool as read-only but the tool's exact id is not selected by `tools.allowed`
- **THEN** the tool is neither advertised nor executable

#### Scenario: Allowlist eligibility alone does not authorize a call

- **WHEN** a valid discovered tool is selected by `tools.allowed` but no `tools.permissions` group authorizes its call
- **THEN** the tool may be eligible for advertisement
- **AND** its call is rejected

#### Scenario: Exact allowlist and permission authorize a call

- **WHEN** a safely admitted tool's exact namespaced id is selected by `tools.allowed` and an applicable `tools.permissions` group accepts its call
- **THEN** the tool is eligible for the Run toolset and the call may execute

#### Scenario: Namespace wildcard grants eligibility only

- **WHEN** a safely admitted tool's canonical id matches a `tools.allowed` namespace wildcard
- **THEN** that exact id is eligible without another allowlist change
- **AND** each call still requires an accepting `tools.permissions` group

#### Scenario: Future tool inherits namespace eligibility, not authorization

- **WHEN** a server later introduces another safely admitted tool whose exact id matches an existing namespace wildcard
- **THEN** the tool becomes eligible without a `tools.allowed` change
- **AND** no call executes unless `tools.permissions` authorizes that exact id

#### Scenario: Remote claims cannot bypass either gate

- **WHEN** an MCP server declares or implies read-only, write, send, delete, execute, financial, or administrative behavior
- **THEN** that claim does not change allowlist eligibility or permission authorization
- **AND** a missing or rejecting gate prevents the call

#### Scenario: Write-capable tools use the same gates

- **WHEN** a safely admitted write-capable MCP tool is selected by `tools.allowed` and its call is accepted by `tools.permissions`
- **THEN** the call may execute without llame claiming that the operation is read-only or independently verifying its effects

### Requirement: Workspace MCP configuration is portable and protects interpolated values

A bound Workspace SHALL load its MCP server entries from `<root>/.mcp.json`, with `<root>/.llame/mcp.json` taking precedence by server name: an entry in the latter SHALL replace an entry with the same name in the former. Workspace entries SHALL use the portable named-server shape: an entry with `command` and no `type` SHALL be interpreted as stdio; `type: "http"` or `type: "streamable-http"` SHALL select the remote Streamable HTTP transport. A stdio entry MAY supply ordered `args`, `env`, and `cwd`; a remote entry SHALL supply its URL and MAY supply headers. A stdio entry with no `cwd` SHALL use the Workspace root, and a relative `cwd` SHALL resolve from that root. A Workspace stdio child's environment SHALL be built exactly as for an operator stdio server: the entry's declared `env` values merged over the MCP client library's base environment allowlist, and nothing else from llame's process environment.

Workspace server string values SHALL support `${VAR}`, `${VAR:-default}`, `{env:…}`, and `{path:…}` interpolation using the executing host's environment and filesystem. Every non-empty resolved interpolation value SHALL be added to the protected-value set and redacted before it can appear in declarations, call arguments or results, logs, diagnostics, receipts, persisted errors, or model-facing content.

A malformed Workspace MCP file, invalid server name or entry, or unsupported transport SHALL NOT fail Workspace entry. Each affected Workspace MCP server SHALL instead be reported as unavailable and SHALL contribute no callable tools.

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

#### Scenario: Interpolated values are protected and redacted

- **WHEN** a Workspace MCP field resolves a value using `${VAR}`, `${VAR:-default}`, `{env:…}`, or `{path:…}`
- **THEN** the resolved value is protected for that Workspace server
- **AND** no protected value reaches model-facing, persisted, diagnostic, or receipt output

#### Scenario: Unsupported Workspace transport leaves entry successful

- **WHEN** a Workspace MCP entry declares a transport other than stdio, `http`, or `streamable-http`
- **THEN** Workspace entry succeeds
- **AND** that server is reported unavailable with no callable tools

#### Scenario: Malformed Workspace MCP configuration leaves entry successful

- **WHEN** a Workspace MCP file is malformed or contains an invalid server name or entry
- **THEN** Workspace entry succeeds
- **AND** each affected server is reported unavailable rather than partially admitted

### Requirement: Workspace MCP clients are isolated and lifecycle-managed per Chat

Workspace MCP clients SHALL be owned by one Chat in the process executing that Chat's Run. A Workspace client set SHALL start when the Chat enters the Workspace or, if it is not running in the current process, at the start of a Run for a bound Chat. One Chat's Workspace clients, discovered declarations, call state, and results SHALL never be used to serve another Chat or another owner.

Workspace clients SHALL stop on Workspace exit, switch, detach, process shutdown, or after 30 minutes with no Run for that Chat in the executing process. A subsequent Run for a still-bound Chat SHALL start its Workspace clients again before composing the Run's available tools. Failure to start or discover a Workspace server SHALL leave the Workspace binding intact and report that server as unavailable; it SHALL NOT fail Workspace entry or prevent unrelated tools from operating.

Starting a Workspace MCP server SHALL NOT require a separate per-server permission check. Successful Workspace entry, subject to its own permission decision, SHALL be the trust decision for reading and starting that Workspace's MCP configuration. This SHALL NOT waive the `tools.allowed` eligibility gate or `tools.permissions` authorization for any MCP tool call.

#### Scenario: Entry starts clients for its Chat

- **WHEN** a Chat successfully enters a Workspace containing a valid MCP server
- **THEN** the executing process starts a Workspace MCP client owned by that Chat
- **AND** the entry result reports that server's state

#### Scenario: Bound Chat starts clients in a new process

- **WHEN** a Run starts for a bound Chat whose Workspace clients are not running in that process
- **THEN** that process starts the Chat's Workspace MCP clients before composing available tools

#### Scenario: Idle clients stop and restart on the next Run

- **WHEN** a Chat has no Run in the executing process for 30 minutes and later runs again while still bound
- **THEN** its idle Workspace clients have been stopped
- **AND** its next Run starts a fresh client set before composing available tools

#### Scenario: Exit, switch, detach, and shutdown stop clients

- **WHEN** the Chat exits or switches Workspace, detaches, or its executing process shuts down
- **THEN** that Chat's Workspace MCP clients are stopped and their tools are withdrawn

#### Scenario: Server start uses Workspace entry as the trust decision

- **WHEN** Workspace entry is permitted but no `tools.permissions` group authorizes a tool from a configured Workspace server
- **THEN** the server may start and be reported as available
- **AND** a call to its tool is rejected without an accepting permission

#### Scenario: Chat B does not receive Chat A's Workspace tools

- **WHEN** Chat A has started Workspace MCP clients and Chat B runs in the same process without those clients
- **THEN** Chat B receives no Workspace declarations, clients, call state, or results belonging to Chat A
- **AND** Chat B uses only its own eligible tools

#### Scenario: Another owner does not receive Workspace clients

- **WHEN** two different owners have Chats running in the same process
- **THEN** neither owner's Workspace clients or tool state are available to the other owner's Chat

### Requirement: Workspace MCP servers share MCP bounds and shadow only when started

Workspace MCP servers SHALL use the same supported protocol revisions, tool-id composition, declaration admission and neutralization, discovery and per-operation bounds, protected-value handling, result handling, per-call timeout, transport-specific availability and retry behavior as operator MCP servers. MCP tool calls SHALL NOT be automatically retried on any transport. Workspace tools SHALL pass the same `tools.allowed` eligibility and `tools.permissions` authorization gates as operator tools; Workspace configuration, transport type, annotations, descriptions, and server claims SHALL grant no additional execution authority.

For a Chat, a running Workspace server SHALL shadow an operator-configured server with the same server id. Its admitted declarations SHALL use the same namespaced tool ids and exact-id permission groups. A Workspace server that has failed to start or is otherwise unavailable SHALL NOT shadow the operator server, whose tools remain available under the usual gates.

#### Scenario: Started Workspace server shadows operator server

- **WHEN** a Workspace MCP server is running for a Chat and has the same server id as an operator MCP server
- **THEN** that Chat uses the Workspace server's admitted tools under the existing namespaced ids
- **AND** the same exact-id permission groups apply

#### Scenario: Failed Workspace server does not shadow operator server

- **WHEN** a Workspace server has the same id as an operator server but the Workspace server failed to start
- **THEN** the Workspace server is reported unavailable and does not shadow
- **AND** the Chat may use the operator server's admitted tools under the usual gates

#### Scenario: Workspace MCP calls do not retry automatically

- **WHEN** a Workspace MCP tool call fails with a transient transport error
- **THEN** the call settles as one failed call without an automatic replay
- **AND** any server recovery follows the existing transport-specific MCP retry behavior

## MODIFIED Requirements

### Requirement: MCP tool ids are stable, provider-safe, and collision-free

Every admitted MCP tool SHALL have an id produced by the provider-independent `mcp-tool-id-v1` algorithm; provider selection SHALL NOT affect the mapping. The configured ASCII server id SHALL be preserved byte-for-byte. The discovered tool name SHALL be Unicode-NFKC-normalized, each maximal run outside ASCII `[A-Za-z0-9_-]` SHALL be replaced with `_`, leading and trailing `_` SHALL be removed, and ASCII letter case SHALL be preserved. The final id SHALL be `mcp__<server>__<tool>` and at most 64 ASCII characters; 64 SHALL be the fixed provider-independent executable limit for this capability. Empty or overlength results SHALL be refused rather than truncated or suffixed. Collisions SHALL be detected under ASCII case-folding across the composed catalog, and every member of a colliding set SHALL be refused before advertisement. `mcp-tool-id-v1` SHALL govern runtime identities and the exact ids in minimal committed-turn availability records. A future mapping change requires an explicit identity/migration contract without rewriting historical call identities.

Startup allowlist parsing SHALL enforce that exact entries use the same grammar, length, and canonical tool-segment rules, but SHALL NOT require the server id to match a currently configured server. It SHALL recognize only `mcp__<server>__*` as a namespace wildcard, where `<server>` is any canonical server id valid under the `mcp-tool-id-v1` server-id grammar and `*` is the complete permission-only tool segment. A valid server id SHALL be accepted whether or not a server with that id is currently configured or discovered. Wildcards SHALL NOT change `mcp-tool-id-v1` or become executable tool ids. A future provider adapter with a stricter limit SHALL add an explicit provider capability/validation path and SHALL NOT silently change `mcp-tool-id-v1`.

#### Scenario: Tool receives a namespaced id

- **WHEN** server `web` declares tool `search`
- **THEN** the admitted llame tool id is `mcp__web__search`

#### Scenario: Normalization collision is refused

- **WHEN** two discovered source names would normalize to the same llame tool id
- **THEN** neither ambiguous declaration is advertised or executable
- **AND** valid non-colliding siblings remain eligible

#### Scenario: Provider-incompatible id is refused

- **WHEN** a generated id violates an executable provider's tool-name constraints
- **THEN** that tool is refused before worker attempt advertisement or a successful availability-state record

#### Scenario: Public normalization mapping is deterministic

- **WHEN** server `web` declares tool `Find／Docs` using the full-width slash code point
- **THEN** `mcp-tool-id-v1` maps it to `mcp__web__Find_Docs`
- **AND** every provider and startup allowlist parser observes that same id

#### Scenario: Case-folded collision is refused

- **WHEN** admitted source names would produce ids differing only by ASCII letter case
- **THEN** every member of that colliding set is refused without a suffix

#### Scenario: Allowlist does not require a configured server

- **WHEN** an exact MCP id or namespace wildcard uses a grammar-valid server id with no currently configured server
- **THEN** startup allowlist validation succeeds
- **AND** the rule creates no tool identity or unavailable declaration by itself

### Requirement: MCP namespace filtering remains exact and lifecycle-safe

A namespace wildcard SHALL match safely admitted canonical exact tool ids by removing the terminal `*` from the boot-validated `mcp__<server>__*` rule, whose server id SHALL satisfy the MCP server-id grammar, and comparing the remaining literal, case-sensitive prefix against only `tool.id`. The complete trailing separator SHALL prevent crossing into a similarly prefixed server id, and the globally reserved `mcp__` prefix SHALL prevent selecting code-owned tools. Matching SHALL NOT reparse ids or inspect source metadata at turn time. Exact and namespace allowlist entries SHALL act only as boolean eligibility predicates over source inventory. Matching SHALL retain or reject each existing candidate once; it SHALL NOT create identities, bypass declaration admission, expand rules into candidates, or deduplicate distinct inventory candidates before existing collision checks. `tools.permissions` SHALL remain the independent authorization check for each call.

For disconnect and reconnect disclosure, a process SHALL retain the exact identities from the server's last completely published admitted catalog as unavailable source inventory, but MUST immediately withdraw every executor and declaration. Only retained identities matching current `tools.allowed` entries SHALL produce unavailable exact-id manifest entries. A successful complete rediscovery SHALL atomically replace the retained identity set with the newly admitted exact ids, so omitted or refused identities become absent; an initial process lifetime with no successful discovery SHALL retain no identities. Refused declarations SHALL never enter the replacement set.

#### Scenario: Similar server prefix is excluded

- **WHEN** `mcp__web__*` is allowlisted and servers `web` and `webExtra` both publish admitted tools
- **THEN** only exact ids parsed into the `web` namespace match the wildcard

#### Scenario: Overlapping permissions do not duplicate a tool

- **WHEN** one admitted inventory candidate matches both an exact `tools.allowed` entry and its server namespace wildcard
- **THEN** the filter retains that candidate once because matching is a boolean eligibility predicate

#### Scenario: Distinct collision candidates are not deduplicated

- **WHEN** two distinct admitted candidates both match an allowlist entry and collide under the existing catalog rules
- **THEN** allowlist filtering preserves both for collision refusal rather than selecting one

#### Scenario: Refused declaration remains invisible

- **WHEN** a declaration from an allowlisted namespace fails schema, collision, secret, or other admission checks
- **THEN** its id and declaration enter neither the executable catalog nor the current runtime availability state used for successful-turn comparison

#### Scenario: Exact permission does not manufacture identity

- **WHEN** an exact MCP `tools.allowed` entry names an id absent from both the fresh process's admitted or remembered source inventory and the previous successful turn's comparison record
- **THEN** that id enters neither the executable catalog nor the current runtime availability comparison input

#### Scenario: Disconnect retains identity but not authority to call

- **WHEN** a previously admitted wildcard-selected tool's server disconnects
- **THEN** the next worker attempt may record that exact id as unavailable and disclose the corresponding transition
- **AND** no stale executor or declaration is advertised or callable

#### Scenario: Reconnect replaces the remembered exact set

- **WHEN** fresh complete rediscovery succeeds after a disconnect
- **THEN** the newly admitted exact ids replace the server's remembered set atomically
- **AND** later attempts compare their runtime state with the previous successful turn to disclose added, recovered, removed, or still-unavailable identities using the existing exact-id availability semantics

#### Scenario: Offline first start invents nothing

- **WHEN** a process starts with an exact or namespace `tools.allowed` entry but has never successfully discovered that server
- **THEN** no unavailable exact tool id is fabricated from either allowlist form

#### Scenario: Patterns never enter durable or model-facing state

- **WHEN** a wildcard-selected tool is advertised or invoked in memory, or its exact id/state or actual call is recorded
- **THEN** every such surface contains only its exact canonical tool id and exact admitted declaration where applicable
- **AND** the wildcard remains only in restart-applied instance configuration

This requirement SHALL not authorize persistence of tool definitions. MCP schemas and descriptions remain in worker memory; only the minimal successful-turn id/state record and ordinary call/result/reminder history may persist.

### Requirement: Operators can configure local stdio MCP servers

The instance configuration SHALL accept named local MCP servers that llame runs as child processes and communicates with over stdin and stdout. Each such server SHALL be launched from an executable and an ordered argument list, never from a shell-interpreted command string. A configured stdio server SHALL have the same independent lifecycle guarantee as a remote one: a server that fails to launch, fails to initialize, or exits MUST NOT prevent startup, native-tool use, answer-only Runs, or another MCP server from operating.

Every process that resolves MCP tools SHALL run its own child process per configured stdio server, because the executing worker resolves each attempt from its own live catalog.

Discovery, declaration admission, tool-id composition, allowlist filtering, and in-memory within-attempt drift refusal SHALL behave identically for stdio and remote servers. Neither transport SHALL persist schemas or descriptions as an execution catalog. Both transports SHALL use the same allowlist eligibility and `tools.permissions` authorization rules; transport type or remote-authored claims SHALL NOT grant authority or safety classification.

A stdio server SHALL be subject to the same negotiated-revision limits as a remote one, and a server negotiating a revision outside the supported set SHALL become unavailable with the closed protocol-unsupported reason rather than being used.

#### Scenario: Configured local server connects

- **WHEN** an operator configures a stdio entry whose executable starts and speaks a supported MCP revision
- **THEN** llame launches the child process, initializes an independent MCP client over its stdio streams, and discovers its tools

#### Scenario: Failing executable does not block the instance

- **WHEN** a configured stdio entry names an executable that does not exist
- **THEN** the instance still starts and serves answer-only and unrelated native-tool Runs
- **AND** tools from that server remain unavailable

#### Scenario: Command is not shell-interpreted

- **WHEN** a stdio entry's executable name or an argument contains shell metacharacters
- **THEN** they are passed to the child process as literal argument text and no shell evaluates them

#### Scenario: Unsupported revision over stdio stays unavailable

- **WHEN** a stdio server negotiates a revision outside `2025-03-26`, `2025-06-18`, and `2025-11-25`
- **THEN** its tools remain unavailable with the protocol-unsupported reason
- **AND** llame stops the child process rather than using the connection
