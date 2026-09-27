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

A bound Workspace SHALL load its MCP server entries from `<root>/.mcp.json`, with `<root>/.llame/mcp.json` taking precedence by server name: an entry in the latter SHALL replace an entry with the same name in the former. Workspace entries SHALL use the portable named-server shape: an entry with `command` and no `type` SHALL be interpreted as stdio; `type: "http"` or `type: "streamable-http"` SHALL select the remote Streamable HTTP transport. A stdio entry MAY supply ordered `args`, `env`, and `cwd`; a remote entry SHALL supply its URL and MAY supply headers. A stdio entry with no `cwd` SHALL use the Workspace root, and a relative `cwd` SHALL resolve from that root. A Workspace stdio child's environment SHALL be built as for an operator stdio server: the entry's declared `env` values, after interpolation, merged over the fixed MCP base environment allowlist, and nothing else from llame's ambient environment inherited wholesale.

Workspace server string values SHALL support `${VAR}`, `${VAR:-default}`, `{env:…}`, and `{path:…}` interpolation. These tokens SHALL resolve from the executing process's environment and filesystem, including llame's own process environment. A relative `{path:LOCATION}` SHALL resolve from the Workspace root; an absolute location SHALL resolve as written. `${VAR:-default}` SHALL use the literal default when `VAR` is unset or empty. Interpolation SHALL be single-pass and non-recursive: a resolved value SHALL NOT be scanned again for tokens. An unset variable without a default or an unreadable file SHALL make the affected server unavailable, with a diagnostic naming the variable or file location but never the resolved value. Command and argument fields SHALL be passed as literal text and SHALL NOT be shell-interpreted. Reading llame's ambient environment through these tokens, and passing a selected value to a Workspace server, is an accepted risk of permitting entry into an audited Workspace.

Every non-empty resolved interpolation value SHALL be added to that Workspace server's protected-value set, except a literal supplied solely as the `:-default` fallback in a stdio `command`, `args`, or `env` field. Every non-empty value supplied in a Workspace remote `headers` entry SHALL also be added to the protected-value set, whether literal or interpolated, including a non-empty `:-default` fallback. A literal value supplied directly in a stdio `env` entry SHALL NOT be added to the protected-value set solely because it is literal. Protected values SHALL be redacted before they can appear in that server's declarations, call arguments or results, diagnostics, entry result, receipts, persisted errors, or model-facing content. This protection guarantee is scoped to that server's traffic and server-derived output; another tool that independently reads the same source is outside this guarantee.

A malformed Workspace MCP file, invalid server name or entry, unsupported transport, or unresolvable interpolation SHALL NOT fail Workspace entry. Each affected Workspace MCP server SHALL instead be reported as unavailable and SHALL contribute no callable tools.

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

- **WHEN** a Workspace MCP field contains `${LLAME_ONLY}` or `{env:LLAME_ONLY}` and the executing llame process defines that variable
- **THEN** its value is used for that field

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

#### Scenario: Literal stdio environment values are not protected

- **WHEN** a Workspace stdio `env` entry contains a non-empty literal value
- **THEN** that value is not added to the protected-value set solely because it is literal
- **AND** traffic and results containing that value are neither refused nor redacted solely because of that literal

#### Scenario: Literal Workspace Authorization header is redacted

- **WHEN** a Workspace remote server has a non-empty literal `Authorization` header and echoes that header value in a result
- **THEN** the header value is protected for that Workspace server
- **AND** the echoed value is redacted before it reaches diagnostics, receipts, persisted errors, or model-facing content

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

- **WHEN** a Chat is already bound to canonical root `/workspace` and enters `/workspace` again
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

### Requirement: Workspace MCP servers share MCP bounds and defer mid-Run shadowing

Workspace MCP servers SHALL use the same supported protocol revisions, tool-id composition, declaration admission and neutralization, discovery and per-operation bounds, protected-value handling, result handling, per-call timeout, transport-specific availability and retry behavior as operator MCP servers, except that Workspace entries follow the Workspace interpolation protection and unresolvable-token behavior specified by `Workspace MCP configuration is portable and protects interpolated values` and `Secret interpolation marks a stdio value as protected`. MCP tool calls SHALL NOT be automatically retried on any transport. Workspace tools SHALL pass the same `tools.allowed` eligibility and `tools.permissions` authorization gates as operator tools; Workspace configuration, transport type, annotations, descriptions, and server claims SHALL grant no additional execution authority.

For a Chat, a started Workspace server SHALL shadow an operator-configured server only when their server ids are byte-equal. If the Workspace server starts while an operator server's tools are already declared in the running attempt, the Workspace server SHALL contribute no tools in that Run, the operator tools SHALL retain their executors for the rest of that Run, and the entry result SHALL report `shadows from the next Run`. From the next Run, the started Workspace server SHALL provide its admitted tools under the applicable namespaced ids and exact-id permission groups. A Workspace server whose id differs from an operator server id only by ASCII letter case SHALL be reported unavailable with reason `case-only collision with an operator server` and SHALL contribute no tools; the operator tools SHALL remain unaffected. A Workspace server that has failed to start or is otherwise unavailable SHALL NOT shadow the operator server, whose tools remain available under the usual gates.

When an id is already present in the running attempt and is re-added after a Chat exits and re-enters or switches between roots defining the same server, the trusted in-Run tool-addition behavior in the `tool-calling` capability SHALL apply. The new executor SHALL be bound only when the newly admitted declaration is byte-for-byte identical to the retained in-memory declaration; otherwise that id SHALL contribute no executor in this Run and the entry result SHALL report `available from the next Run`. Declarations SHALL never be replaced or removed within the attempt, and the declaration comparison SHALL remain in memory rather than being persisted.

#### Scenario: Mid-Run Workspace shadowing is deferred

- **WHEN** a Workspace server starts during a Run, its id is byte-equal to an operator server id, and the operator server's tools are already declared
- **THEN** the Workspace server contributes no tools to that Run
- **AND** the operator tools retain their executors for the rest of the Run
- **AND** the entry result reports `shadows from the next Run`

#### Scenario: Case-only Workspace server collision is unavailable

- **WHEN** an operator server is named `web` and a started Workspace server is named `WEB`
- **THEN** the Workspace server is reported unavailable with reason `case-only collision with an operator server`
- **AND** it contributes no tools and leaves the operator server's tools unaffected

#### Scenario: Started Workspace server shadows operator server on the next Run

- **WHEN** a Workspace MCP server is started before a Run and has a byte-equal server id to an operator MCP server
- **THEN** that Chat's next Run uses the Workspace server's admitted tools under the applicable namespaced ids
- **AND** the same exact-id permission groups apply

#### Scenario: Failed Workspace server does not shadow operator server

- **WHEN** a Workspace server has the same id as an operator server but the Workspace server failed to start
- **THEN** the Workspace server is reported unavailable and does not shadow
- **AND** the Chat may use the operator server's admitted tools under the usual gates

#### Scenario: Re-adding an identical declaration restores its executor

- **WHEN** a Chat exits and re-enters, or switches between Workspaces, during a Run and the newly admitted declaration has an id already retained in the attempt with a byte-for-byte identical in-memory declaration
- **THEN** the new Workspace executor is bound to the retained declaration
- **AND** the declaration is not replaced or persisted for comparison

#### Scenario: Re-adding a changed declaration waits for the next Run

- **WHEN** a Chat exits and re-enters, or switches between Workspaces, during a Run and the newly admitted declaration has an id already retained in the attempt with a different in-memory declaration
- **THEN** that id contributes no executor in the current Run
- **AND** the entry result reports `available from the next Run`
- **AND** the retained declaration remains unchanged

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

### Requirement: Secret interpolation marks a stdio value as protected

The resolved value of every `{env:…}` / `{path:…}` secret-interpolation token appearing in a stdio entry's `command`, `args`, or `env` SHALL join the protected-value set that already covers remote request headers. Literal configuration text SHALL NOT be protected, in any of those fields. Interpolation is therefore the operator's declaration that a value is sensitive, and writing a value literally is the operator's declaration that it is not.

Where a token is only part of a field's text, the protected value SHALL be the resolved token's own value rather than the surrounding text, so that a server echoing the bare secret is still recognized.

A protected value SHALL NOT appear in model input, user-visible receipts, run events, persisted errors, or logs. For an operator-configured stdio entry, startup failures concerning these fields SHALL name only the configuration path. Workspace entries SHALL follow `Workspace MCP configuration is portable and protects interpolated values`: an unresolvable token makes that server unavailable with a diagnostic naming the variable or file location but never the resolved value.

This rule deliberately differs from the remote-header rule, under which every configured header value is protected regardless of origin. Arguments and environment values legitimately carry non-secret text — flags, paths, and ports — and protected values are matched as substrings across tool traffic, so protecting a low-entropy literal would refuse legitimate tool calls and corrupt legitimate results. `args` interpolation SHALL therefore remain permitted rather than restricted to `env`: a mechanical restriction cannot distinguish a legitimately interpolated non-secret argument from a credential, and llame's own protected-value redaction still applies equally to a secret resolved into either field. Three consequences SHALL be documented for operators rather than left to be discovered:

- Interpolating a low-entropy value, such as a per-deployment directory, makes that string protected everywhere, which can refuse tool calls naming it and redact it from results. Writing such a value literally is the remedy.
- A secret written literally instead of interpolated is not protected, and would therefore not be redacted from that server's diagnostic output. Secrets are always to be interpolated, never inlined.
- A resolved `args` value becomes that child process's argv, which on a POSIX host is world-readable via `/proc/<pid>/cmdline` (mode 444) to any process on the host, unlike `env` (`/proc/<pid>/environ`, mode 400, readable only by the owning user or root). llame's protected-value redaction covers what llame itself logs, persists, and sends to a model; it does not and cannot prevent another process on the same host from observing a live child's command line. A credential SHALL therefore be interpolated into `env`, never `args`.

#### Scenario: Interpolated secret is protected

- **WHEN** a stdio entry interpolates a secret into an environment value or an argument
- **THEN** the resolved value is present in that child process's environment or argument list
- **AND** it is treated as a protected value by every downstream surface

#### Scenario: Literal argument text is not protected

- **WHEN** a stdio entry declares a literal argument such as a root directory
- **THEN** that text is not added to the protected-value set
- **AND** tool calls and results naming it are neither refused nor redacted

#### Scenario: Only the interpolated segment is protected

- **WHEN** an argument combines literal text with an interpolated secret
- **THEN** the protected value is the resolved token's own value, not the whole argument

#### Scenario: Secret-bearing configuration error stays opaque

- **WHEN** an operator-configured stdio entry's interpolation fails for its environment value or argument
- **THEN** startup fails naming the configuration path without printing the resolved or partially resolved value

#### Scenario: A credential interpolated into args is redacted from llame but visible in argv

- **WHEN** an operator interpolates a secret into a stdio entry's `args` rather than its `env`
- **THEN** the resolved value is still protected by every llame-owned surface — logs, diagnostics, receipts, model input
- **AND** it is nonetheless present in the child process's argv, observable by another process on the same host through `/proc/<pid>/cmdline`, which no application-level redaction can prevent
