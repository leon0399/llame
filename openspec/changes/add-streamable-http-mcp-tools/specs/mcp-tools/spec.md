## Purpose

Defines how an operator-configured remote Streamable HTTP MCP server contributes explicitly enabled read-only tools to llame without making unrelated chats depend on that server's health or exposing its credentials.

## ADDED Requirements

### Requirement: Operators can configure remote Streamable HTTP MCP servers

The instance configuration SHALL accept zero or more named remote MCP servers. Each server SHALL use one absolute `http` or `https` URL and MAY carry static request headers whose values use the instance configuration's existing interpolation rules. Streamable HTTP SHALL be the only supported MCP transport. Each configured server SHALL have an independent client lifecycle; failure of one server MUST NOT prevent startup, native-tool use, answer-only Runs, or another MCP server from operating.

This capability SHALL offer MCP protocol `2025-11-25` and MAY negotiate only the session-capable Streamable HTTP revisions `2025-03-26`, `2025-06-18`, and `2025-11-25` supported by the pinned client. It SHALL NOT attempt the breaking sessionless `2026-07-28` wire shape and SHALL NOT fall back to the deprecated HTTP+SSE transport from `2024-11-05`. Support for modern-first protocol negotiation is a separate capability change.

#### Scenario: Configured server connects

- **WHEN** an operator configures a reachable Streamable HTTP MCP endpoint
- **THEN** the instance initializes an independent MCP client for that server and discovers its tools

#### Scenario: Offline server does not block the instance

- **WHEN** one configured MCP endpoint is offline during startup
- **THEN** the instance still starts and serves answer-only and unrelated native-tool Runs
- **AND** tools from the offline server remain unavailable

#### Scenario: Unsupported transport is rejected

- **WHEN** configuration attempts to declare stdio, legacy SSE, or another non-Streamable-HTTP transport
- **THEN** startup fails schema validation naming the unsupported configuration path

#### Scenario: Session-capable Streamable HTTP revision negotiates

- **WHEN** a configured server negotiates `2025-03-26`, `2025-06-18`, or `2025-11-25`
- **THEN** llame uses the negotiated session-capable Streamable HTTP revision

#### Scenario: Modern sessionless revision is not silently approximated

- **WHEN** a server supports only MCP `2026-07-28`
- **THEN** its tools remain unavailable under this capability with a closed protocol-unsupported reason
- **AND** llame does not emulate the modern wire shape or fall back to deprecated HTTP+SSE

### Requirement: MCP tool ids are stable, provider-safe, and collision-free

Every admitted MCP tool SHALL have an id produced by the provider-independent `mcp-tool-id-v1` algorithm; provider selection SHALL NOT affect the mapping. The configured ASCII server id SHALL be preserved byte-for-byte. The discovered tool name SHALL be Unicode-NFKC-normalized, each maximal run outside ASCII `[A-Za-z0-9_-]` SHALL be replaced with `_`, leading and trailing `_` SHALL be removed, and ASCII letter case SHALL be preserved. The final id SHALL be `mcp__<server>__<tool>` and at most 64 ASCII characters. Empty or overlength results SHALL be refused rather than truncated or suffixed. Collisions SHALL be detected under ASCII case-folding across the composed catalog, and every member of a colliding set SHALL be refused before advertisement. `mcp-tool-id-v1` SHALL be part of the observed v1 availability-manifest semantics, so a future mapping change requires a new manifest version and explicit migration. Startup allowlist parsing SHALL enforce the same grammar, length, configured-server lookup, and canonical tool-segment rules.

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

Every MCP operation SHALL enforce a fixed v1 limit of 1 MiB per non-streaming response body or SSE event while consuming bytes, before JSON/JSON-RPC parsing. The adapter SHALL supply the pinned HTTP transport with a bounded `fetch` implementation that wraps every returned `Response` before the package consumes it, including non-2xx bodies the package later reads as text. `Content-Length` MAY reject early but SHALL NOT be the sole enforcement. Tool discovery SHALL follow pagination until completion under additional fixed v1 limits: a 30-second aggregate deadline; 8 MiB total response bytes; 256 tools per page; 1,000 tools total; 256 KiB per serialized raw declaration; schema nesting depth 64; 4 MiB serialized declarations retained for the candidate catalog; a 1,000-page cap; and a repeated-cursor guard. An operation-level budget breach SHALL fail the affected server's entire discovery/refresh and publish no partial catalog. A declaration exceeding only its individual size/depth admission budget SHALL be refused while valid siblings remain eligible. Connection, discovery, or declaration failure SHALL otherwise remain isolated to the affected server or tool. A catalog SHALL become advertisable only after discovery completes and every admitted declaration has passed the generic tool-schema and safety gates; partial pages SHALL never replace the prior catalog.

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

#### Scenario: Incomplete discovery is never published

- **WHEN** a later discovery page times out or fails
- **THEN** no partial replacement catalog is advertised
- **AND** the server follows the unavailable and reconnect behavior below

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

MCP annotations, descriptions, and server claims SHALL NOT grant execution authority or safety classification. An MCP tool SHALL execute only when its exact namespaced id is present in `tools.allowed`; placing that id in the allowlist SHALL constitute the operator's explicit attestation that the remote operation is read-only. Unallowlisted discoveries SHALL be neither advertised nor disclosed to the model. llame SHALL document that it cannot independently verify a remote tool's semantic effects and MUST NOT present operator attestation as automated safety verification. Operators MUST NOT allowlist write, send, delete, execute, financial, or administrative MCP operations under this capability.

#### Scenario: MCP annotation does not grant authority

- **WHEN** a server annotation describes a tool as read-only but the operator has not allowlisted its namespaced id
- **THEN** the tool is neither advertised nor executable

#### Scenario: Explicitly enabled tool executes

- **WHEN** a valid discovered tool's exact namespaced id is allowlisted under the operator's read-only attestation
- **THEN** it is eligible for the bound Run toolset

#### Scenario: Remote write claim grants nothing

- **WHEN** an MCP server declares or implies write, send, delete, execute, financial, or administrative behavior but its id is not allowlisted
- **THEN** that remote claim does not make the tool executable in this capability

#### Scenario: Operator contract excludes write-capable ids

- **WHEN** an operator chooses ids for `tools.allowed`
- **THEN** the supported configuration contract requires every selected MCP operation to be read-only
- **AND** llame does not claim to infer or verify that property from remote-authored metadata

### Requirement: MCP calls use bounded non-retrying execution and portable results

Each MCP tool call SHALL use the existing per-call Run cancellation signal and effective tool-call timeout. llame SHALL NOT automatically retry a remote tool call. Its response body, non-2xx error body, or SSE event SHALL remain subject to the transport-wide 1 MiB pre-parse cap at the adapter-supplied `fetch` boundary; exceeding that cap SHALL abort consumption and classify as malformed transport/JSON-RPC input. A successful MCP response SHALL map deterministically into the existing structured tool-result contract and flow through the existing truncation, persistence, live-stream, and later-turn replay paths. An MCP error, timeout, disconnect, or missing result SHALL become a structured non-fatal tool observation; raw remote exception text SHALL NOT become the recorded result.

During a tool call, a network disconnect, HTTP `401` or `403`, HTTP `404` when an MCP session is established, or malformed transport/JSON-RPC response SHALL additionally atomically withdraw that process's catalog for the affected server and start its background reconnect path. HTTP `429`, any `5xx`, every other valid `4xx` including `410`, a valid tool-level MCP error, `CallToolResult.isError`, invalid tool output, per-call timeout, Run cancellation, or caller cancellation SHALL settle only the affected call and SHALL NOT change server availability.

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

When an MCP client disconnects, llame SHALL atomically withdraw every tool from that server before scheduling a reconnect. Reconnect attempts SHALL run in the background, remain single-flight, and use AWS Full Jitter: for zero-based failure attempt `n`, sample uniformly from zero through `min(5 minutes, 1 second * 2^n)`. Attempts SHALL continue indefinitely while the server remains configured and SHALL reset `n` only after initialization plus complete discovery and admission succeed. A new turn that observes the server already unavailable or reconnecting SHALL bind that unavailable state immediately rather than wait for or initiate a reconnect. Reconnection SHALL create a fresh client and session and SHALL publish no tool until complete fresh discovery and admission succeeds. A timer or cached declaration MUST NOT re-advertise a stale tool.

Every per-server asynchronous operation and callback SHALL be fenced by the current lifecycle generation and exact client identity. A callback from an older client or generation MUST NOT publish or withdraw the current catalog, close the current client, change current lifecycle state, or schedule reconnect/state work. It MAY release only resources captured from its own stale generation. Runtime shutdown SHALL be terminal: it SHALL invalidate every current generation and client identity before cancellation and close begin, and no callback after shutdown starts MAY publish or withdraw a catalog, change lifecycle state, or schedule reconnect/refresh work even if it captured the formerly current generation.

While ready, each instance-managed server SHALL undergo complete discovery periodically in the background using a one-hour base interval with independently sampled ±20% jitter per server, process, and cycle, producing a 48–72 minute delay. This interval SHALL NOT be operator-configurable in this capability. A new turn SHALL perform no MCP network I/O and SHALL immediately bind the latest atomically published catalog even if a refresh is in flight. Successful refresh SHALL publish only after complete pagination and admission; declaration additions, removals, and drift become visible to the next turn after that atomic publication. A discovery failure SHALL immediately withdraw the affected server rather than retain a known-failed catalog.

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

Before a remote declaration, call argument, result, or error object enters a logging, persistence, or model-context path, llame SHALL apply the protected-value boundary. String leaves SHALL replace direct occurrences; a non-string JSON scalar whose canonical JSON spelling exactly equals a protected value SHALL be replaced as a whole with the same JSON-string redaction marker. This replacement SHALL preserve object/array container topology and safe keys but MAY change the matching scalar leaf type; secrecy SHALL take precedence over fidelity to the remote output schema after redaction. Redaction SHALL occur before truncation or serialization so no alternate typed representation preserves a direct secret echo.

An object key containing a protected value SHALL NOT be rewritten. A declaration containing such a key SHALL be refused. A call argument containing such a key SHALL be rejected before remote execution. A result or error containing such a key SHALL settle the affected call as a generic `execution_failed` observation without persisting or displaying the raw payload; it SHALL NOT withdraw an otherwise healthy server. Safe sibling declarations and calls SHALL remain unaffected.

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
