## MODIFIED Requirements

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
- **AND** every provider and startup exact-entry parser observes that same id

#### Scenario: Namespace wildcard is not a tool id

- **WHEN** `tools.allowed` contains `mcp__web__*`
- **THEN** startup treats it as permission for canonical ids in server `web`, not as an `mcp-tool-id-v1` output
- **AND** no provider-facing or persisted tool id contains `*`

#### Scenario: Case-folded collision is refused

- **WHEN** admitted source names would produce ids differing only by ASCII letter case
- **THEN** every member of that colliding set is refused without a suffix

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

## ADDED Requirements

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
