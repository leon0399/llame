# mcp-tools

## Purpose

Defines how operator-configured MCP servers — remote Streamable HTTP endpoints and local stdio child processes — contribute allowlisted tools authorized by operator permissions to llame without making unrelated chats depend on a server's health or exposing its credentials.

## Requirements

### Requirement: Operators can configure remote Streamable HTTP MCP servers

The instance configuration SHALL accept zero or more named remote MCP servers. Each server SHALL use one absolute `http` or `https` URL and MAY carry static request headers whose values use the instance configuration's existing interpolation rules. Streamable HTTP SHALL be the only supported remote MCP transport; local servers are covered by a separate requirement. Each configured server SHALL have an independent client lifecycle; failure of one server MUST NOT prevent startup, native-tool use, answer-only Runs, or another MCP server from operating.

This capability SHALL offer MCP protocol `2025-11-25` and MAY negotiate only the session-capable revisions `2025-03-26`, `2025-06-18`, and `2025-11-25` supported by the pinned client. This revision set SHALL apply to every supported transport. It SHALL NOT attempt the breaking sessionless `2026-07-28` wire shape and SHALL NOT fall back to the deprecated HTTP+SSE transport from `2024-11-05`. Support for modern-first protocol negotiation is a separate capability change.

#### Scenario: Configured server connects

- **WHEN** an operator configures a reachable Streamable HTTP MCP endpoint
- **THEN** the instance initializes an independent MCP client for that server and discovers its tools

#### Scenario: Offline server does not block the instance

- **WHEN** one configured MCP endpoint is offline during startup
- **THEN** the instance still starts and serves answer-only and unrelated native-tool Runs
- **AND** tools from the offline server remain unavailable

#### Scenario: Unsupported transport is rejected

- **WHEN** configuration attempts to declare legacy SSE or another transport that is neither Streamable HTTP nor stdio
- **THEN** startup fails schema validation naming the unsupported configuration path

#### Scenario: Session-capable Streamable HTTP revision negotiates

- **WHEN** a configured server negotiates `2025-03-26`, `2025-06-18`, or `2025-11-25`
- **THEN** llame uses the negotiated session-capable Streamable HTTP revision

#### Scenario: Modern sessionless revision is not silently approximated

- **WHEN** a server supports only MCP `2026-07-28`
- **THEN** its tools remain unavailable under this capability with a closed protocol-unsupported reason
- **AND** llame does not emulate the modern wire shape or fall back to deprecated HTTP+SSE

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

### Requirement: Discovery is complete, bounded, and isolated

Every MCP operation, on both transports, SHALL enforce a fixed v1 limit of 1 MiB consumed before JSON/JSON-RPC parsing: for a remote transport, per non-streaming response body or SSE event; for a local stdio transport, per unterminated line accumulated since the last successfully framed message. The adapter SHALL supply the pinned HTTP transport with a bounded `fetch` implementation that wraps every returned `Response` before the package consumes it, including non-2xx bodies the package later reads as text; `Content-Length` MAY reject early but SHALL NOT be the sole enforcement. For stdio, llame SHALL own the child process spawn and the stdout read path itself rather than delegate that piece to the pinned client library, because the library's own stdio reader accumulates a child's output without any pre-parse bound. An overrun on either transport SHALL classify as malformed transport/JSON-RPC input; for stdio, the overrun SHALL also terminate the child process, which is then treated as any other exited stdio server.

Only the aggregate discovery response-byte budget below remains stdio-exempt, because it is a distinct running total across an entire discovery operation that the per-message bound does not itself track; every other limit below SHALL apply to both transports.

Tool discovery SHALL follow pagination until completion under additional fixed v1 limits: a 30-second aggregate deadline; 8 MiB total response bytes for remote transports; 256 tools per page; 1,000 tools total; 256 KiB per serialized raw declaration; schema nesting depth 64; 4 MiB serialized declarations retained for the candidate catalog; a 1,000-page cap; and a repeated-cursor guard. An operation-level budget breach SHALL fail the affected server's entire discovery/refresh and publish no partial catalog. A declaration exceeding only its individual size/depth admission budget SHALL be refused while valid siblings remain eligible. Connection, discovery, or declaration failure SHALL otherwise remain isolated to the affected server or tool. A catalog SHALL become advertisable only after discovery completes and every admitted declaration has passed the generic tool-schema and safety gates; partial pages SHALL never replace the prior catalog.

#### Scenario: Paginated catalog is fully discovered

- **WHEN** a server returns multiple `tools/list` pages with distinct cursors
- **THEN** every page is read before the newly discovered catalog is published

#### Scenario: Repeated cursor terminates discovery

- **WHEN** a server repeats a pagination cursor
- **THEN** discovery stops within the page bound and the server's tools remain unavailable

#### Scenario: One malformed tool is isolated

- **WHEN** one discovered tool has an invalid input schema and a sibling has a valid schema
- **THEN** the invalid tool is refused and the valid sibling remains eligible

#### Scenario: Oversized inbound discovery fails before publication

- **WHEN** a response body, SSE event, page tool count, aggregate byte/tool/catalog budget, or aggregate deadline exceeds its fixed limit
- **THEN** the input is aborted or refused within that bound
- **AND** no partial replacement catalog is advertised

#### Scenario: Oversized stdio message is bounded before parsing

- **WHEN** a stdio server writes bytes without a terminating newline past the 1 MiB pre-parse bound
- **THEN** llame stops consuming before JSON/JSON-RPC parsing and terminates the child process
- **AND** the server is treated as an exited stdio server, following its unavailable and bounded-retry behavior

#### Scenario: Incomplete discovery is never published

- **WHEN** a later discovery page times out or fails
- **THEN** no partial replacement catalog is advertised
- **AND** the server follows the unavailable and reconnect behavior below

#### Scenario: Post-parse limits still bound a local server

- **WHEN** a stdio server's discovery exceeds the tool-count, per-declaration size, schema-depth, retained-catalog, page-count, or deadline limit
- **THEN** that server's discovery fails within the bound and no partial replacement catalog is advertised

### Requirement: External declarations are neutralized before model use

Descriptions and schema-description prose supplied by an MCP server SHALL be treated as untrusted authored text. After initialization establishes the current protected-value set, those prose values SHALL be secret-redacted and then neutralized at the declaration-building boundary before canonicalization, hashing, receipts, or provider requests, so every consumer observes the same safe declaration. Neutralization SHALL preserve legitimate self-contained markup while preventing externally supplied text from closing an enclosing boundary or forging a reserved structural name. A raw remote tool name containing a protected value SHALL be refused before public id generation. A declaration object key containing a protected value, or protected data outside redaction-safe description prose, SHALL refuse only that tool rather than advertise a rewritten executable contract.

#### Scenario: External description attempts to close a boundary

- **WHEN** a discovered tool description or schema description contains a closing tag it did not open
- **THEN** the unsafe closer is neutralized before the declaration is hashed or sent to a model

#### Scenario: Safe declaration prose remains stable

- **WHEN** the same safe remote declaration is discovered on successive turns
- **THEN** its neutralized canonical declaration and hash are identical

#### Scenario: Secret-bearing remote identity is refused

- **WHEN** a remote tool name or declaration object key contains a configured header value or active session id
- **THEN** that tool is refused before id generation, canonicalization, persistence, or advertisement
- **AND** safe sibling declarations remain eligible

#### Scenario: Secret-bearing declaration prose is redacted

- **WHEN** a tool or schema description contains a configured header value or active session id
- **THEN** the protected value is replaced before authored-text neutralization and canonicalization
- **AND** the raw prose reaches no receipt, provider request, durable state, diagnostic, or test output

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

### Requirement: MCP calls use bounded non-retrying execution and portable results

Each MCP tool call SHALL use the existing per-call Run cancellation signal and effective tool-call timeout, on every transport. llame SHALL NOT automatically retry an MCP tool call on any transport. A successful MCP response SHALL map deterministically into the existing structured tool-result contract and flow through the existing truncation, persistence, live-stream, and later-turn replay paths. An MCP error, timeout, disconnect, or missing result SHALL become a structured non-fatal tool observation; raw remote exception text SHALL NOT become the recorded result.

For a remote transport, a call's response body, non-2xx error body, or SSE event SHALL remain subject to the transport-wide 1 MiB pre-parse cap at the adapter-supplied `fetch` boundary; exceeding that cap SHALL abort consumption and classify as malformed transport/JSON-RPC input. For a local stdio transport, a call's response line SHALL remain subject to the same 1 MiB pre-parse cap per "Discovery is complete, bounded, and isolated"; exceeding it SHALL abort consumption, classify as malformed transport/JSON-RPC input, and terminate the child process. A malformed or unparseable stdio message that stays within the cap SHALL still classify as malformed transport/JSON-RPC input.

During a tool call over a remote transport, a network disconnect, HTTP `401` or `403`, HTTP `404` when an MCP session is established, or malformed transport/JSON-RPC response SHALL additionally atomically withdraw that process's catalog for the affected server and start its background reconnect path. HTTP `429`, any `5xx`, every other valid `4xx` including `410`, a valid tool-level MCP error, `CallToolResult.isError`, invalid tool output, per-call timeout, Run cancellation, or caller cancellation SHALL settle only the affected call and SHALL NOT change server availability.

Over a local stdio transport there is no HTTP status and no session, so that matrix SHALL apply as follows: child-process exit and malformed transport/JSON-RPC response SHALL atomically withdraw that process's catalog for the affected server and start its bounded retry path; a valid tool-level MCP error, `CallToolResult.isError`, invalid tool output, per-call timeout, Run cancellation, or caller cancellation SHALL settle only the affected call and SHALL NOT change server availability.

Any HTTP failure during initialization, discovery, or background refresh SHALL make the affected server unavailable and enter the reconnect path because no complete catalog may be published or retained from that control-plane operation. HTTP `410` SHALL NOT create a terminal or manually reset state; it follows the ordinary stage-specific rules. Lifecycle classification SHALL use trusted operation stage, transport status, session presence, and protocol structure rather than remote error prose.

#### Scenario: Successful remote search is replayable

- **WHEN** an allowlisted MCP search tool returns a successful result
- **THEN** the result is mapped into the normal structured tool result, shown live, persisted, and replayed on a later turn

#### Scenario: Call timeout is non-fatal

- **WHEN** an MCP call exceeds its effective timeout
- **THEN** it settles as a structured timeout observation and the Run continues
- **AND** the server remains ready

#### Scenario: Tool-level error remains call-local

- **WHEN** a valid MCP response reports a tool-level error, `isError`, or invalid tool output
- **THEN** the affected call settles as a structured error observation
- **AND** the server remains ready and sibling tools are not withdrawn

#### Scenario: Transport integrity failure withdraws the server

- **WHEN** a call encounters a network disconnect, invalid or expired session, or malformed transport/JSON-RPC response
- **THEN** the affected call settles as a structured non-fatal error observation
- **AND** that process atomically withdraws the server catalog and starts background reconnect

#### Scenario: Oversized tool-call response is bounded before parsing

- **WHEN** a tool-call response body or SSE event exceeds 1 MiB
- **THEN** llame aborts consumption before JSON/JSON-RPC parsing and records a structured non-fatal error observation
- **AND** that process withdraws the server catalog and starts background reconnect as for malformed transport input

#### Scenario: Call-level HTTP rejection follows the status matrix

- **WHEN** a tool call returns `429`, `5xx`, or another valid `4xx` other than `401`, `403`, or a session-bearing `404`
- **THEN** the affected call settles as a structured non-fatal remote rejection
- **AND** the server remains ready

#### Scenario: HTTP 410 is not terminal

- **WHEN** a tool call returns HTTP `410`
- **THEN** it follows the ordinary call-local `4xx` behavior
- **AND** no permanent-disabled state is created

#### Scenario: Control-plane HTTP failure withdraws the server

- **WHEN** initialization, discovery, or background refresh receives any HTTP failure
- **THEN** the affected server becomes unavailable and enters background reconnect
- **AND** response-body prose does not alter that classification

#### Scenario: Cancellation does not diagnose server health

- **WHEN** a Run or caller cancellation aborts an MCP call
- **THEN** the call settles under existing cancellation precedence
- **AND** the server's ready state is unchanged

#### Scenario: Call is not automatically retried

- **WHEN** an MCP call fails with a transient transport error
- **THEN** llame records one failed call and does not issue the same call again automatically

### Requirement: Disconnect withdraws tools and reconnect requires fresh discovery

When an MCP client disconnects, llame SHALL atomically withdraw every tool from that server before scheduling a reconnect. Reconnect attempts SHALL run in the background, remain single-flight, and SHALL reset the attempt counter only after initialization plus complete discovery and admission succeed.

For a remote transport, reconnect SHALL use AWS Full Jitter: for zero-based failure attempt `n`, sample uniformly from zero through `min(5 minutes, 1 second * 2^n)`, and attempts SHALL continue indefinitely while the server remains configured. For a local stdio transport, attempts SHALL instead be bounded as specified in "stdio launch failures retry a bounded number of times", because an unbounded loop there respawns a child process rather than reopening a socket, and the most common cause is a configuration error that no number of retries resolves. A worker attempt that observes the server already unavailable or reconnecting SHALL use that runtime state immediately rather than wait for or initiate a reconnect. Reconnection SHALL create a fresh client and session and SHALL publish no tool until complete fresh discovery and admission succeeds. A timer or cached declaration MUST NOT re-advertise a stale tool.

Every per-server asynchronous operation and callback SHALL be fenced by the current lifecycle generation and exact client identity. A callback from an older client or generation MUST NOT publish or withdraw the current catalog, close the current client, change current lifecycle state, or schedule reconnect/state work. It MAY release only resources captured from its own stale generation. Runtime shutdown SHALL be terminal: it SHALL invalidate every current generation and client identity before cancellation and close begin, and no callback after shutdown starts MAY publish or withdraw a catalog, change lifecycle state, or schedule reconnect/refresh work even if it captured the formerly current generation.

While ready, each instance-managed server SHALL undergo complete discovery periodically in the background using a one-hour base interval with independently sampled ±20% jitter per server, process, and cycle, producing a 48–72 minute delay. A stdio server that has settled as unavailable SHALL also be scheduled on that same periodic occasion, using the same interval and jitter, with its tick attempting recovery — a fresh child process and complete discovery — rather than a refresh of a catalog it no longer has. This interval SHALL NOT be operator-configurable in this capability. A new turn SHALL perform no MCP network I/O and SHALL immediately bind the latest atomically published catalog even if a refresh is in flight. Successful refresh SHALL publish only after complete pagination and admission; declaration additions, removals, and drift become visible to the next turn after that atomic publication. A discovery failure SHALL immediately withdraw the affected server rather than retain a known-failed catalog.

#### Scenario: Disconnect withdraws the server catalog

- **WHEN** a connected MCP transport closes
- **THEN** all tools from that server are immediately absent from newly prepared worker catalogs
- **AND** unrelated tools remain available

#### Scenario: Reconnect publishes only fresh declarations

- **WHEN** a reconnect initializes successfully
- **THEN** no tool becomes available again until fresh complete discovery and admission succeeds

#### Scenario: Stale lifecycle callbacks cannot clobber recovery

- **WHEN** an old client's refresh completion or transport-close callback arrives after a newer generation is ready
- **THEN** the callback releases only its captured old resources
- **AND** the newer client, catalog, timers, and ready state remain unchanged

#### Scenario: Reconnect backoff follows Full Jitter

- **WHEN** reconnect attempt `n` is scheduled after failure
- **THEN** its delay is sampled uniformly between zero and `min(5 minutes, 1 second * 2^n)`
- **AND** a successful initialization without successful complete discovery does not reset `n`

#### Scenario: Known outage does not delay a turn

- **WHEN** a new turn binds while a configured server is unavailable or reconnecting
- **THEN** the turn immediately records the affected eligible tools as unavailable
- **AND** it neither waits for nor starts a reconnect attempt

#### Scenario: Ready server refresh does not delay a turn

- **WHEN** a new turn binds while background discovery is in flight for a ready server
- **THEN** the turn immediately uses the last completely published catalog
- **AND** the refresh result applies atomically only to later turns

#### Scenario: Silent catalog change is observed in the background

- **WHEN** a ready server changes its tool catalog without disconnecting
- **THEN** the next successful periodic discovery after an independently jittered 48–72 minute delay atomically publishes the admitted change
- **AND** the first later turn compares and discloses the resulting availability transition

#### Scenario: Declaration drift withdraws only the tool

- **WHEN** an MCP tool's live declaration no longer canonically matches the source declaration retained in the currently executing attempt
- **THEN** that tool call settles as unavailable rather than executing a different contract
- **AND** the mismatch does not fail the entire Run or affect sibling tools

#### Scenario: Clean shutdown closes clients

- **WHEN** the API or dedicated worker shuts down
- **THEN** reconnect work is cancelled, catalogs are withdrawn, and every live MCP client is closed within a bounded shutdown path
- **AND** late callbacks release only captured resources and cannot publish, change state, or schedule work

Within an attempt, source-declaration equality and executor/lifecycle checks SHALL remain in memory. A new queue attempt SHALL resolve fresh rather than restore a declaration from the database. Failed attempts SHALL not create model-visible history or availability comparison baselines.

### Requirement: MCP credentials and secret-bearing payloads never escape

Instance administrators MAY authenticate an MCP server with static headers whose values use llame's existing `{env:…}` and `{path:…}` interpolation. Configured MCP headers and session identifiers SHALL remain transport-only and SHALL NOT be disclosed to end users or models. Each server's private protected-value set SHALL contain every non-empty resolved header value plus its active session id. Those values MUST NOT appear in public tool identities, declarations, logs, diagnostics, context receipts, run events, persisted errors, model-facing content, or test output.

Before any MCP declaration, call argument, result, or error object from either transport enters a logging, persistence, or model-context path, llame SHALL apply the protected-value boundary. String leaves SHALL replace direct occurrences; a non-string JSON scalar whose canonical JSON spelling exactly equals a protected value SHALL be replaced as a whole with the same JSON-string redaction marker. This replacement SHALL preserve object/array container topology and safe keys but MAY change the matching scalar leaf type; secrecy SHALL take precedence over fidelity to the server's output schema after redaction. Redaction SHALL occur before truncation or serialization so no alternate typed representation preserves a direct secret echo.

An object key containing a protected value SHALL NOT be rewritten. A declaration containing such a key SHALL be refused. A call argument containing such a key SHALL be rejected before execution on either transport. A result or error containing such a key SHALL settle the affected call as a generic `execution_failed` observation without persisting or displaying the raw payload; it SHALL NOT withdraw an otherwise healthy server. Safe sibling declarations and calls SHALL remain unaffected.

#### Scenario: Server echoes an authorization header

- **WHEN** an MCP error response echoes a configured authorization value
- **THEN** the value appears in no log, durable event, tool result, receipt, or model request

#### Scenario: Tool payload contains a configured secret

- **WHEN** tool arguments or results contain a configured secret value
- **THEN** every persisted and model-facing representation contains a redaction marker instead of the value

#### Scenario: Secret-bearing object key fails the containing unit

- **WHEN** a declaration, call argument, result, or error object has a key containing a configured header value or active session id
- **THEN** llame refuses that declaration, rejects that argument before execution, or settles that result/error as generic `execution_failed` according to its stage
- **AND** the raw key and containing payload reach no durable, diagnostic, model-facing, or test surface
- **AND** safe sibling tools and a healthy server remain available

#### Scenario: Typed scalar echo is redacted

- **WHEN** a configured header value such as `123`, `true`, or `null` is echoed as the corresponding JSON scalar inside a structured result
- **THEN** the matching leaf becomes the JSON-string redaction marker before serialization even though its scalar type changes
- **AND** the containing object/array topology and keys remain intact while the secret reaches no durable or model-facing surface

#### Scenario: Session id remains private

- **WHEN** a server assigns an MCP session id
- **THEN** the id joins that server's protected-value set for the life of the session
- **AND** it is used only by the transport and never appears in public identity, declarations, diagnostics, durable state, model context, or test output

### Requirement: MCP acceptance is proven locally and against a gated real service

The capability SHALL ship with a deterministic local Streamable HTTP fixture covering initialization, paginated discovery, successful call/result mapping, malformed declarations, disconnect, reconnect, withdrawal, and close. Browser acceptance SHALL prove that an ordinary chat can invoke a generic MCP search tool, use its result, and preserve the tool activity across refresh/history replay. A credential-gated real-service evaluation SHALL demonstrate current sourced web evidence without printing or persisting credentials.

#### Scenario: Deterministic fixture covers lifecycle

- **WHEN** the local MCP acceptance suite runs without external credentials
- **THEN** it deterministically verifies discovery, call, mapping, failure isolation, disconnect, reconnect, withdrawal, and close

#### Scenario: Browser chat survives refresh

- **WHEN** a browser chat invokes the fixture search tool and the page refreshes after completion
- **THEN** the answer and settled tool activity reconstruct from durable history

#### Scenario: Real search evaluation is explicitly gated

- **WHEN** real-search credentials are absent
- **THEN** the external evaluation does not run
- **AND** deterministic local acceptance remains runnable

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

### Requirement: A stdio server's environment is exactly what configuration declares

llame SHALL construct a stdio server's environment from the values that entry declares, merged over the MCP client library's base environment allowlist and nothing else.

That allowlist is a small, fixed set of variables the library copies from llame's own environment so a child can locate its executable and home directory — on POSIX exactly `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, and `USER`. Each of those six SHALL be inherited by the child when llame's own environment defines it with a value that is not shell-function-shaped, since the library skips an undefined or `()`-prefixed value rather than synthesizing one; llame SHALL NOT fabricate a value the parent does not have. A declared value SHALL override an inherited one. Every **other** variable in llame's environment SHALL be absent from the child unless the entry declares it: llame SHALL NOT pass its ambient process environment through, so a credential such as the datastore URL or a provider key SHALL NOT reach a child process merely because llame itself holds it.

This SHALL hold as a secrecy mechanism, not only as a convention: a value llame never resolved cannot be recognized in a child's output, so ambient inheritance would create diagnostic output llame is unable to redact.

#### Scenario: Ambient variable outside the base allowlist is not inherited

- **WHEN** llame's own process environment contains a variable outside the base allowlist that a stdio entry does not declare
- **THEN** that variable is absent from the child process's environment

#### Scenario: Base-allowlist variable is inherited

- **WHEN** llame's environment defines `PATH` and a stdio entry declares none
- **THEN** the child process still receives llame's `PATH`, so a bare executable name resolves

#### Scenario: Undefined allowlist variable is not fabricated

- **WHEN** llame's environment does not define `TERM` and a stdio entry declares none
- **THEN** `TERM` is simply absent from the child rather than synthesized

#### Scenario: Declared value overrides the inherited one

- **WHEN** a stdio entry declares a variable that is also in the base allowlist
- **THEN** the child receives the declared value rather than llame's

#### Scenario: Declared variable reaches the child

- **WHEN** a stdio entry declares an environment variable
- **THEN** that variable is present in the child process's environment with the resolved value

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

### Requirement: stdio diagnostic output is captured, bounded, and sanitized

llame SHALL capture a stdio server's diagnostic output stream rather than letting it reach llame's own diagnostic stream directly, and SHALL begin capturing before the child is initialized so that early startup output is not lost. Captured output SHALL be bounded, so that a server emitting output without limit cannot exhaust llame's memory.

Captured output SHALL pass through protected-value sanitization before it is recorded anywhere, and SHALL be attributed to its configured server name. Captured output SHALL NOT reach model input, user-visible receipts, run events, or persisted Run state; it is operator diagnostic material only.

#### Scenario: Startup failure output is available to the operator

- **WHEN** a stdio server writes an error to its diagnostic stream and exits before initializing
- **THEN** that output is recorded for the operator, attributed to the configured server name

#### Scenario: Echoed secret is redacted

- **WHEN** a stdio server writes a declared environment secret to its diagnostic stream
- **THEN** the recorded output does not contain that value

#### Scenario: Unbounded output does not exhaust memory

- **WHEN** a stdio server writes diagnostic output continuously
- **THEN** llame retains only a bounded amount of it

### Requirement: stdio launch failures retry a bounded number of times

A stdio server that fails to launch, fails to initialize, or exits after connecting SHALL be retried a bounded number of times with an increasing delay, and SHALL then settle as unavailable rather than being retried indefinitely. Settling as unavailable SHALL use the existing unavailability disclosure; this requirement introduces no new unavailability reason.

The attempt budget SHALL be restored only by a session that demonstrated stability, not by any successful discovery. A child that initializes, completes discovery, and then exits SHALL consume budget on each such cycle, so that a server crash-looping after a successful start settles like any other persistent failure. A session that held its connection beyond a defined stability threshold SHALL restore the budget when it ends, so an isolated disconnection after a long healthy run is still treated as the momentary blip it is. The threshold SHALL exceed the combined delay of the fast retries, so that a server cycling through the ladder cannot earn a fresh budget by reaching the end of it.

Because llame processes are long-running and expose no operator reinitialization surface, a settled stdio server SHALL remain scheduled on the periodic occasion defined by the reconnect requirement, and each such tick SHALL make one recovery attempt. A successful attempt SHALL restore the server through complete discovery, and its attempt budget SHALL be restored on the stability terms above rather than by the attempt itself; a failed attempt SHALL leave it settled until the next tick. Recovery latency is therefore bounded by that interval rather than being immediate, which is accepted: the bounded fast retry already covers a momentary blip, and this path exists for a condition that outlives it — a dependency that came up late, a registry or registry-mirror outage, a corrected host state. Attempts SHALL remain single-flight and SHALL be cancelled by shutdown like any other lifecycle work.

A settled or retrying stdio server SHALL withdraw its callable tools and declarations immediately, retaining its last completely admitted exact ids as process-local unavailable inventory, exactly as a disconnected remote server does. Recovery SHALL require a fresh child process and complete discovery; no stale executor or declaration SHALL be reused.

The reconnect behavior of remote Streamable HTTP servers SHALL be unchanged by this requirement.

#### Scenario: Repeated launch failure settles

- **WHEN** a stdio server fails to launch on every attempt
- **THEN** llame stops retrying after its bounded attempt budget and reports the server as unavailable

#### Scenario: Crash loop after a successful start still settles

- **WHEN** a stdio server initializes and completes discovery, then exits, repeatedly
- **THEN** each short session consumes attempt budget rather than restoring it
- **AND** the server settles as unavailable instead of being respawned indefinitely

#### Scenario: A long healthy session earns its budget back

- **WHEN** a stdio server holds its connection past the stability threshold and then disconnects once
- **THEN** it retries on the fast bounded ladder rather than being treated as a crash loop

#### Scenario: Settled server is still scheduled

- **WHEN** a stdio server settles as unavailable after exhausting its attempt budget
- **THEN** it remains scheduled on the periodic occasion rather than being dropped from scheduling

#### Scenario: Settled server recovers without a restart

- **WHEN** a settled stdio server's executable becomes launchable again
- **THEN** a subsequent catalog-refresh occasion retries it and, on complete discovery, restores its tools

#### Scenario: Exit withdraws tools immediately

- **WHEN** a connected stdio server's child process exits
- **THEN** its callable tools and declarations are withdrawn immediately
- **AND** its last completely admitted exact ids remain as unavailable inventory for disclosure

### Requirement: stdio child processes are stopped on shutdown

llame SHALL stop every stdio child process it launched when the instance shuts down, escalating from a graceful stop to a forced termination within a bounded deadline so that shutdown is not delayed indefinitely by an unresponsive server. llame SHALL NOT wait indefinitely for a child process to exit.

llame SHALL NOT guarantee termination of processes a configured executable itself spawned. This limitation SHALL be documented for operators rather than silently assumed.

#### Scenario: Unresponsive server does not block shutdown

- **WHEN** a stdio server ignores a graceful stop during shutdown
- **THEN** llame forcibly terminates it within a bounded deadline and completes shutdown

### Requirement: MCP eligibility and execution authorization are separate

MCP annotations, descriptions, and server claims SHALL NOT grant execution authority or safety classification. An MCP tool SHALL be eligible for advertisement only when its exact namespaced id is present in `tools.allowed` or matches a valid namespace wildcard for its server. This allowlist SHALL determine eligibility only; it SHALL NOT authorize a call or attest that an operation is read-only. Each call SHALL execute only when `tools.permissions` authorizes that exact tool id. A missing permission group or a rejecting permission SHALL prevent the call. A tool matching neither allowlist form SHALL be neither advertised nor disclosed to the model. These gates SHALL apply to every MCP transport and source, including Workspace servers. These per-call `tools.permissions` evaluations govern an attempt whose effective permission mode is `default`; an attempt whose effective mode is `bypass` admits the call without evaluating any `tools.permissions` group, as `tool-call-permissions` defines, while `tools.allowed` eligibility applies unchanged.

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

Every non-empty resolved interpolation value SHALL be added to that Workspace server's protected-value set, except a literal supplied solely as the `:-default` fallback in a stdio `command`, `args`, or `env` field. Every non-empty value supplied in a Workspace remote `headers` entry SHALL also be added to the protected-value set, whether literal or interpolated, including a non-empty `:-default` fallback. Literal stdio `command`, `args`, and `env` text SHALL NOT be added to the protected-value set solely because it is literal. Protected values SHALL be redacted before they can appear in that server's declarations, call arguments or results, diagnostics, entry result, receipts, persisted errors, or model-facing content. This protection guarantee is scoped to that server's traffic and server-derived output; another tool that independently reads the same source is outside this guarantee.

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

#### Scenario: Literal stdio configuration text is not protected

- **WHEN** a Workspace stdio `command`, `args`, or `env` field contains non-empty literal text
- **THEN** that text is not added to the protected-value set solely because it is literal
- **AND** traffic and results containing that text are neither refused nor redacted solely because of that literal

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

For a Chat, a started Workspace server SHALL shadow an operator-configured server only when their server ids are byte-equal. If the Workspace server starts while an operator server's tools are already declared in the running attempt, the Workspace server SHALL contribute no tools in that attempt, the operator tools SHALL retain their executors for the rest of that attempt, and the entry result SHALL report `shadows from the next Run`. From the next attempt that composes the live binding, including a retry attempt of the same Run, the started Workspace server SHALL provide its admitted tools under the applicable namespaced ids and exact-id permission groups. A Workspace server whose id differs from an operator server id only by ASCII letter case SHALL be reported unavailable with reason `case-only collision with an operator server` and SHALL contribute no tools; the operator tools SHALL remain unaffected. A Workspace server that has failed to start or is otherwise unavailable SHALL NOT shadow the operator server, whose tools remain available under the usual gates.

When an id is already present in the running attempt and is re-added after a Chat exits and re-enters or switches between roots defining the same server, the trusted in-Run tool-addition behavior in the `tool-calling` capability SHALL apply. The new executor SHALL be bound only when the newly admitted declaration is byte-for-byte identical to the retained in-memory declaration; otherwise that id SHALL contribute no executor in this attempt and the entry result SHALL report `available from the next Run`. Declarations SHALL never be replaced or removed within the attempt, and the declaration comparison SHALL remain in memory rather than being persisted.

#### Scenario: Mid-Run Workspace shadowing is deferred

- **WHEN** a Workspace server starts during an attempt, its id is byte-equal to an operator server id, and the operator server's tools are already declared
- **THEN** the Workspace server contributes no tools to that attempt
- **AND** the operator tools retain their executors for the rest of that attempt
- **AND** the entry result reports `shadows from the next Run`
- **AND** the next attempt, including a retry of the same Run, composes the started Workspace server from the live binding

#### Scenario: Case-only Workspace server collision is unavailable

- **WHEN** an operator server is named `web` and a started Workspace server is named `WEB`
- **THEN** the Workspace server is reported unavailable with reason `case-only collision with an operator server`
- **AND** it contributes no tools and leaves the operator server's tools unaffected

#### Scenario: Started Workspace server shadows operator server on the next attempt

- **WHEN** a Workspace MCP server is started before an attempt and has a byte-equal server id to an operator MCP server
- **THEN** that Chat's next attempt uses the Workspace server's admitted tools under the applicable namespaced ids
- **AND** the same exact-id permission groups apply

#### Scenario: Failed Workspace server does not shadow operator server

- **WHEN** a Workspace server has the same id as an operator server but the Workspace server failed to start
- **THEN** the Workspace server is reported unavailable and does not shadow
- **AND** the Chat may use the operator server's admitted tools under the usual gates

#### Scenario: Re-adding an identical declaration restores its executor

- **WHEN** a Chat exits and re-enters, or switches between Workspaces, during an attempt and the newly admitted declaration has an id already retained in the attempt with a byte-for-byte identical in-memory declaration
- **THEN** the new Workspace executor is bound to the retained declaration
- **AND** the declaration is not replaced or persisted for comparison

#### Scenario: Re-adding a changed declaration waits for the next attempt

- **WHEN** a Chat exits and re-enters, or switches between Workspaces, during an attempt and the newly admitted declaration has an id already retained in the attempt with a different in-memory declaration
- **THEN** that id contributes no executor in the current attempt
- **AND** the entry result reports `available from the next Run`
- **AND** the retained declaration remains unchanged

#### Scenario: Workspace MCP calls do not retry automatically

- **WHEN** a Workspace MCP tool call fails with a transient transport error
- **THEN** the call settles as one failed call without an automatic replay
- **AND** any server recovery follows the existing transport-specific MCP retry behavior
