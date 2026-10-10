## MODIFIED Requirements

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

Within an attempt, source-declaration equality and executor/lifecycle checks SHALL remain in memory. A new queue attempt SHALL resolve fresh rather than restore a declaration from the database. An attempt that fails before dispatching a model request SHALL not create an availability comparison baseline.

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
- **THEN** its id and declaration enter neither the executable catalog nor the current runtime availability state used for comparison against the most recent prior dispatched Run's id/state record

#### Scenario: Exact permission does not manufacture identity

- **WHEN** an exact MCP `tools.allowed` entry names an id absent from both the fresh process's admitted or remembered source inventory and the comparison record of the most recent prior Run that dispatched a model request
- **THEN** that id enters neither the executable catalog nor the current runtime availability comparison input

#### Scenario: Disconnect retains identity but not authority to call

- **WHEN** a previously admitted wildcard-selected tool's server disconnects
- **THEN** the next worker attempt may record that exact id as unavailable and disclose the corresponding transition
- **AND** no stale executor or declaration is advertised or callable

#### Scenario: Reconnect replaces the remembered exact set

- **WHEN** fresh complete rediscovery succeeds after a disconnect
- **THEN** the newly admitted exact ids replace the server's remembered set atomically
- **AND** later attempts compare their runtime state with the most recent prior dispatched Run's id/state record to disclose added, recovered, removed, or still-unavailable identities using the existing exact-id availability semantics

#### Scenario: Offline first start invents nothing

- **WHEN** a process starts with an exact or namespace `tools.allowed` entry but has never successfully discovered that server
- **THEN** no unavailable exact tool id is fabricated from either allowlist form

#### Scenario: Patterns never enter durable or model-facing state

- **WHEN** a wildcard-selected tool is advertised or invoked in memory, or its exact id/state or actual call is recorded
- **THEN** every such surface contains only its exact canonical tool id and exact admitted declaration where applicable
- **AND** the wildcard remains only in restart-applied instance configuration

This requirement SHALL not authorize persistence of tool definitions. MCP schemas and descriptions remain in worker memory; only the minimal id/state record written when a Run dispatches a model request and ordinary call/result/reminder history may persist.
