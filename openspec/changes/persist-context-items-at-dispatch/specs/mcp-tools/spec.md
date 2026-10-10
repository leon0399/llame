## MODIFIED Requirements

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
- **THEN** its id and declaration enter neither the executable catalog nor the current runtime availability state used for dispatched-turn comparison

#### Scenario: Exact permission does not manufacture identity

- **WHEN** an exact MCP `tools.allowed` entry names an id absent from both the fresh process's admitted or remembered source inventory and the previous dispatched turn's comparison record
- **THEN** that id enters neither the executable catalog nor the current runtime availability comparison input

#### Scenario: Disconnect retains identity but not authority to call

- **WHEN** a previously admitted wildcard-selected tool's server disconnects
- **THEN** the next worker attempt may record that exact id as unavailable and disclose the corresponding transition
- **AND** no stale executor or declaration is advertised or callable

#### Scenario: Reconnect replaces the remembered exact set

- **WHEN** fresh complete rediscovery succeeds after a disconnect
- **THEN** the newly admitted exact ids replace the server's remembered set atomically
- **AND** later attempts compare their runtime state with the previous dispatched turn to disclose added, recovered, removed, or still-unavailable identities using the existing exact-id availability semantics

#### Scenario: Offline first start invents nothing

- **WHEN** a process starts with an exact or namespace `tools.allowed` entry but has never successfully discovered that server
- **THEN** no unavailable exact tool id is fabricated from either allowlist form

#### Scenario: Patterns never enter durable or model-facing state

- **WHEN** a wildcard-selected tool is advertised or invoked in memory, or its exact id/state or actual call is recorded
- **THEN** every such surface contains only its exact canonical tool id and exact admitted declaration where applicable
- **AND** the wildcard remains only in restart-applied instance configuration

#### Scenario: A failed Run's recorded MCP ids stay comparison input

- **WHEN** a Run that recorded a wildcard-selected MCP id in its dispatch transaction fails, and that server is configured, allowlisted, and not ready on the next turn's worker
- **THEN** the id enters the next turn's comparison input as unavailable
- **AND** it is not reported as removed

This requirement SHALL not authorize persistence of tool definitions. MCP schemas and descriptions remain in worker memory; only the minimal dispatched-turn id/state record and ordinary call/result/reminder history may persist.
