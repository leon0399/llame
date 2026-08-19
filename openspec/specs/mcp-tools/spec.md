# mcp-tools

## Purpose

Defines how operator-configured MCP servers — remote Streamable HTTP endpoints and local stdio child processes — contribute explicitly enabled read-only tools to llame without making unrelated chats depend on a server's health or exposing its credentials.

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

Every admitted MCP tool SHALL have an id produced by the provider-independent `mcp-tool-id-v1` algorithm; provider selection SHALL NOT affect the mapping. The configured ASCII server id SHALL be preserved byte-for-byte. The discovered tool name SHALL be Unicode-NFKC-normalized, each maximal run outside ASCII `[A-Za-z0-9_-]` SHALL be replaced with `_`, leading and trailing `_` SHALL be removed, and ASCII letter case SHALL be preserved. The final id SHALL be `mcp__<server>__<tool>` and at most 64 ASCII characters; 64 SHALL be the fixed provider-independent executable limit for this capability. Empty or overlength results SHALL be refused rather than truncated or suffixed. Collisions SHALL be detected under ASCII case-folding across the composed catalog, and every member of a colliding set SHALL be refused before advertisement. `mcp-tool-id-v1` SHALL be part of the observed v1 availability-manifest semantics, so a future mapping change requires a new manifest version and explicit migration.

Startup allowlist parsing SHALL enforce that exact entries use the same grammar, length, configured-server lookup, and canonical tool-segment rules. Separately, it SHALL recognize only `mcp__<server>__*` as a namespace wildcard, using the exact canonical id of a configured server and treating `*` as the complete permission-only tool segment. Wildcards SHALL NOT change `mcp-tool-id-v1` or become executable tool ids. A future provider adapter with a stricter limit SHALL add an explicit provider capability/validation path and SHALL NOT silently change `mcp-tool-id-v1`.

#### Scenario: Tool receives a namespaced id

- **WHEN** server `web` declares tool `search`
- **THEN** the admitted llame tool id is `mcp__web__search`

#### Scenario: Normalization collision is refused

- **WHEN** two discovered source names would normalize to the same llame tool id
- **THEN** neither ambiguous declaration is advertised or executable
- **AND** valid non-colliding siblings remain eligible

#### Scenario: Provider-incompatible id is refused

- **WHEN** a generated id violates an executable provider's tool-name constraints
- **THEN** that tool is refused before entering an effective-context snapshot

#### Scenario: Public normalization mapping is deterministic

- **WHEN** server `web` declares tool `Find／Docs` using the full-width slash code point
- **THEN** `mcp-tool-id-v1` maps it to `mcp__web__Find_Docs`
- **AND** every provider and startup allowlist parser observes that same id

#### Scenario: Case-folded collision is refused

- **WHEN** admitted source names would produce ids differing only by ASCII letter case
- **THEN** every member of that colliding set is refused without a suffix

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

### Requirement: MCP execution requires an operator read-only attestation

MCP annotations, descriptions, and server claims SHALL NOT grant execution authority or safety classification. An MCP tool SHALL execute only when its exact namespaced id is present in `tools.allowed` or matches the configured server's exact namespace wildcard. Placing an exact id in the allowlist SHALL constitute the operator's explicit attestation that the one remote operation is read-only. Placing a namespace wildcard in the allowlist SHALL constitute the operator's explicit attestation that every current and future safely admitted operation from that server is read-only, including tools introduced remotely without another llame configuration change. Discoveries matching neither permission SHALL be neither advertised nor disclosed to the model. llame SHALL document that it cannot independently verify a remote tool's semantic effects and MUST NOT present operator attestation as automated safety verification. Operators MUST NOT allowlist a namespace containing any write, send, delete, execute, financial, or administrative operation under this capability.

#### Scenario: MCP annotation does not grant authority

- **WHEN** a server annotation describes a tool as read-only but the operator has neither allowlisted its exact id nor its server namespace
- **THEN** the tool is neither advertised nor executable

#### Scenario: Explicitly enabled tool executes

- **WHEN** a valid discovered tool's exact namespaced id is allowlisted under the operator's read-only attestation
- **THEN** it is eligible for the bound Run toolset

#### Scenario: Namespace-enabled tool executes

- **WHEN** a valid discovered tool's canonical id belongs to a configured server whose namespace wildcard is allowlisted
- **THEN** that exact id is eligible for the bound Run toolset

#### Scenario: Future remote tool inherits namespace authority

- **WHEN** a server with an allowlisted namespace later introduces another safely admitted tool
- **THEN** that exact tool becomes eligible without a llame configuration change
- **AND** this authority comes from the operator wildcard, not MCP metadata

#### Scenario: Remote write claim grants nothing

- **WHEN** an MCP server declares or implies write, send, delete, execute, financial, or administrative behavior but the operation matches no allowlist permission
- **THEN** that remote claim does not make the tool executable in this capability

#### Scenario: Operator contract excludes write-capable ids

- **WHEN** an operator chooses exact ids or namespace wildcards for `tools.allowed`
- **THEN** the supported configuration contract requires every operation selected now or later to be read-only
- **AND** llame does not claim to infer or verify that property from remote-authored metadata

### Requirement: MCP namespace filtering remains exact and lifecycle-safe

A namespace wildcard SHALL match safely admitted canonical exact tool ids by removing the terminal `*` from the boot-validated `mcp__<configured-server>__*` rule and comparing the remaining literal, case-sensitive prefix against only `tool.id`. The complete trailing separator SHALL prevent crossing into a similarly prefixed server id, and the globally reserved `mcp__` prefix SHALL prevent selecting code-owned tools. Matching SHALL NOT reparse ids or inspect source metadata at turn time. Exact and namespace permissions SHALL both act only as boolean predicates over source inventory. Matching SHALL retain or reject each existing candidate once; it SHALL NOT create identities, bypass declaration admission, expand rules into candidates, or deduplicate distinct inventory candidates before existing collision checks.

For disconnect and reconnect disclosure, a process SHALL retain the exact identities from the server's last completely published admitted catalog as unavailable source inventory, but MUST immediately withdraw every executor and declaration. Only retained identities matching current permissions SHALL produce unavailable exact-id manifest entries. A successful complete rediscovery SHALL atomically replace the retained identity set with the newly admitted exact ids, so omitted or refused identities become absent; an initial process lifetime with no successful discovery SHALL retain no identities. Refused declarations SHALL never enter the replacement set.

#### Scenario: Similar server prefix is excluded

- **WHEN** `mcp__web__*` is allowlisted and servers `web` and `webExtra` both publish admitted tools
- **THEN** only exact ids parsed into the `web` namespace match the wildcard

#### Scenario: Overlapping permissions do not duplicate a tool

- **WHEN** one admitted inventory candidate matches both an exact permission and its server namespace permission
- **THEN** the filter retains that candidate once because matching is a boolean predicate

#### Scenario: Distinct collision candidates are not deduplicated

- **WHEN** two distinct admitted candidates both match permission and collide under the existing catalog rules
- **THEN** permission filtering preserves both for collision refusal rather than selecting one

#### Scenario: Refused declaration remains invisible

- **WHEN** a declaration from an allowlisted namespace fails schema, collision, secret, or other admission checks
- **THEN** its id and declaration enter neither the executable catalog nor an availability manifest

#### Scenario: Exact permission does not manufacture identity

- **WHEN** an exact MCP permission names an id absent from the fresh process's admitted or remembered source inventory
- **THEN** that id enters neither the effective context nor an availability manifest

#### Scenario: Disconnect retains identity but not authority to call

- **WHEN** a previously admitted wildcard-selected tool's server disconnects
- **THEN** the next Run may record that exact id as unavailable and disclose the corresponding transition
- **AND** no stale executor or declaration is advertised or callable

#### Scenario: Reconnect replaces the remembered exact set

- **WHEN** fresh complete rediscovery succeeds after a disconnect
- **THEN** the newly admitted exact ids replace the server's remembered set atomically
- **AND** later Run manifests expose added, recovered, removed, or still-unavailable identities using the existing exact-id availability semantics

#### Scenario: Offline first start invents nothing

- **WHEN** a process starts with an exact or namespace permission but has never successfully discovered that server
- **THEN** no unavailable exact tool id is fabricated from either permission form

#### Scenario: Patterns never enter durable or model-facing state

- **WHEN** a wildcard-selected tool is advertised, snapshotted, rebound, receipted, persisted, or disclosed
- **THEN** every such surface contains only its exact canonical tool id and exact admitted declaration where applicable
- **AND** the wildcard remains only in restart-applied instance configuration

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

For a remote transport, reconnect SHALL use AWS Full Jitter: for zero-based failure attempt `n`, sample uniformly from zero through `min(5 minutes, 1 second * 2^n)`, and attempts SHALL continue indefinitely while the server remains configured. For a local stdio transport, attempts SHALL instead be bounded as specified in "stdio launch failures retry a bounded number of times", because an unbounded loop there respawns a child process rather than reopening a socket, and the most common cause is a configuration error that no number of retries resolves. A new turn that observes the server already unavailable or reconnecting SHALL bind that unavailable state immediately rather than wait for or initiate a reconnect. Reconnection SHALL create a fresh client and session and SHALL publish no tool until complete fresh discovery and admission succeeds. A timer or cached declaration MUST NOT re-advertise a stale tool.

Every per-server asynchronous operation and callback SHALL be fenced by the current lifecycle generation and exact client identity. A callback from an older client or generation MUST NOT publish or withdraw the current catalog, close the current client, change current lifecycle state, or schedule reconnect/state work. It MAY release only resources captured from its own stale generation. Runtime shutdown SHALL be terminal: it SHALL invalidate every current generation and client identity before cancellation and close begin, and no callback after shutdown starts MAY publish or withdraw a catalog, change lifecycle state, or schedule reconnect/refresh work even if it captured the formerly current generation.

While ready, each instance-managed server SHALL undergo complete discovery periodically in the background using a one-hour base interval with independently sampled ±20% jitter per server, process, and cycle, producing a 48–72 minute delay. A stdio server that has settled as unavailable SHALL also be scheduled on that same periodic occasion, using the same interval and jitter, with its tick attempting recovery — a fresh child process and complete discovery — rather than a refresh of a catalog it no longer has. This interval SHALL NOT be operator-configurable in this capability. A new turn SHALL perform no MCP network I/O and SHALL immediately bind the latest atomically published catalog even if a refresh is in flight. Successful refresh SHALL publish only after complete pagination and admission; declaration additions, removals, and drift become visible to the next turn after that atomic publication. A discovery failure SHALL immediately withdraw the affected server rather than retain a known-failed catalog.

#### Scenario: Disconnect withdraws the server catalog

- **WHEN** a connected MCP transport closes
- **THEN** all tools from that server are immediately absent from new Run snapshots
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

- **WHEN** an MCP tool's live declaration no longer canonically matches the declaration bound to a queued Run
- **THEN** that tool call settles as unavailable rather than executing a different contract
- **AND** the mismatch does not fail the entire Run or affect sibling tools

#### Scenario: Clean shutdown closes clients

- **WHEN** the API or dedicated worker shuts down
- **THEN** reconnect work is cancelled, catalogs are withdrawn, and every live MCP client is closed within a bounded shutdown path
- **AND** late callbacks release only captured resources and cannot publish, change state, or schedule work

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

Every process that resolves MCP tools SHALL run its own child process per configured stdio server, because a process authors a Run's availability manifest from its own live catalog.

Discovery, declaration admission, tool-id composition, allowlist filtering, drift refusal, receipts, and snapshot binding SHALL behave identically for stdio and remote servers. Configuring a stdio server SHALL NOT alter the operator read-only attestation model: llame does not verify remote semantic effects for either transport.

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

A protected value SHALL NOT appear in model input, user-visible receipts, run events, persisted errors, or logs. Startup failures concerning these fields SHALL name only the configuration path.

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

- **WHEN** interpolation fails for a stdio entry's environment value or argument
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
