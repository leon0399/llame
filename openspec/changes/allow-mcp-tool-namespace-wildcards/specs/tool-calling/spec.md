## MODIFIED Requirements

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5 set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`, `external_send`, `financial_or_sensitive`, `admin`). In this slice the loop SHALL execute **only `read_only`** tools: a tool with any other classification SHALL be neither advertised to the model nor executed, even if registered and allowlisted — approval machinery (§7.5) arrives with the first write-capable tool.

The `mcp__` tool-id prefix SHALL be reserved for ids produced by the MCP capability. A code-owned or other non-MCP registry entry beginning with that prefix SHALL fail registration, so ID-only namespace permission matching cannot grant authority across source kinds.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called
- **THEN** it executes

#### Scenario: Non-read-only tool is refused even when allowlisted

- **WHEN** a tool classified other than `read_only` is registered and allowlisted, and the model requests it
- **THEN** it is not advertised to the model, and a direct request for it is refused with a recorded, non-fatal tool error

#### Scenario: Unclassified tool cannot register

- **WHEN** a tool without a classification is registered
- **THEN** registration fails at startup (fail loud, not at call time)

#### Scenario: Duplicate tool id cannot register

- **WHEN** two tools register the same id
- **THEN** registration fails at startup naming the id

#### Scenario: Code-owned tool cannot occupy the MCP namespace

- **WHEN** a code-owned registry entry has an id beginning with `mcp__`
- **THEN** registration fails at startup naming the reserved prefix

### Requirement: Fail-closed operator availability gate

Tool eligibility SHALL be governed by the operator allowlist in `llame.config.json` (`tools.allowed`). The default SHALL be an empty allowlist — an instance with no tools configured runs exactly as before this change (no tools advertised, none executable). The system SHALL first construct its source-owned inventory from registered code-owned tools and the safely admitted current or remembered-unavailable MCP inventory, then apply `tools.allowed` strictly as a boolean permission predicate over each candidate's canonical `tool.id`. Code-owned ids SHALL require exact entries. A canonical MCP id SHALL match either the same exact entry or a validated namespace rule `mcp__<configured-server>__*` whose terminal `*` is removed for literal ID-prefix comparison. Matching SHALL be case-sensitive. The validated trailing separator SHALL prevent one server prefix from matching a longer server id, and the reserved `mcp__` namespace SHALL prevent matching code-owned tools. Permission rules SHALL NOT create, copy, expand, or deduplicate candidates. A tool that matches no rule SHALL be neither advertised to the model nor executed if requested.

Exact and namespace MCP entries SHALL grant eligibility only to exact identities learned from safely admitted declarations for that server. When a live process loses the server transport, the last completely admitted identity set SHALL remain source inventory in an unavailable state; when complete discovery succeeds, its newly admitted identity set SHALL replace the prior set authoritatively. Neither permission form SHALL fabricate identities before first successful discovery or expose refused declarations. An eligible dynamic tool SHALL become advertisable or executable only while the source supplies a currently admitted declaration for that exact id under the operator's read-only attestation.

The restart-applied allowlist decision SHALL be bound into the immutable Run snapshot as filtered exact ids and exact declarations when a turn is accepted; wildcard patterns SHALL NOT enter provider requests, manifests, receipts, persistence, or execution binding. Removing an exact entry or namespace wildcard from later instance configuration SHALL affect newly accepted Runs but SHALL NOT retroactively rebind an already accepted Run or its queue retries. Immediate live revocation is outside this capability and requires the future permission-policy system; this bound authorization is permitted here only because every admitted remote tool is operator-attested read-only. Write-capable tools remain prohibited even when they claim idempotence; durable side-effect checkpointing and permission policy are separate follow-ups.

#### Scenario: Default is no tools

- **WHEN** the operator config does not set `tools.allowed`
- **THEN** runs never advertise or execute any tool

#### Scenario: Unlisted tool is not advertised

- **WHEN** a registered code-owned tool or discovered dynamic tool matches neither an exact entry nor an MCP namespace wildcard
- **THEN** it does not appear in the toolset offered to the model

#### Scenario: Unlisted tool is refused

- **WHEN** the model requests a tool that matches neither an exact entry nor an MCP namespace wildcard bound into the Run
- **THEN** the call is refused with a recorded, non-fatal tool error and the run continues

#### Scenario: Unknown tool id in the allowlist fails boot

- **WHEN** `tools.allowed` names an entry that is neither registered in code, a canonical exact dynamic id for a configured source, nor the canonical wildcard for a configured MCP namespace
- **THEN** startup fails naming the offending config path and entry

#### Scenario: Eligible dynamic tool can remain unavailable

- **WHEN** a previously admitted MCP identity still matches an exact or namespace permission but its live process loses the server transport
- **THEN** unrelated Runs remain usable and the filtered identity is recorded as unavailable
- **AND** that tool is not advertised or executable for newly bound Runs

#### Scenario: Permission does not create a fresh-offline identity

- **WHEN** a fresh process has no admitted or remembered MCP inventory and `tools.allowed` names an exact id or namespace from that server
- **THEN** the permission produces no effective-context or availability-manifest entry

#### Scenario: Complete discovery removes omitted identities

- **WHEN** successful complete discovery omits or refuses a previously admitted exact identity
- **THEN** the new source inventory no longer contains that identity
- **AND** the next Run treats it as absent even when an exact or namespace permission would match it

#### Scenario: Namespace wildcard admits future exact ids

- **WHEN** a configured MCP server later supplies a safely admitted canonical tool id within its allowlisted namespace
- **THEN** the next Run may bind and advertise that exact id without an instance-config change
- **AND** no wildcard pattern appears in the Run snapshot or provider request

#### Scenario: Overlapping rules filter one inventory candidate once

- **WHEN** one exact MCP id is selected by both its exact entry and its server namespace wildcard
- **THEN** filtering retains the original inventory candidate once without creating another candidate

#### Scenario: Permission filtering does not hide source collisions

- **WHEN** distinct source candidates collide and both match one or more permission rules
- **THEN** both candidates reach the existing collision refusal unchanged rather than being deduplicated by permission matching

#### Scenario: Later allowlist removal does not rebind an accepted Run

- **WHEN** an exact entry or matching namespace wildcard is removed from restart-applied configuration after a Run accepted and snapshotted the filtered exact tool
- **THEN** that Run and its retries retain the bound authorization and declaration
- **AND** newly accepted Runs no longer advertise or execute the removed permission's unmatched tools

#### Scenario: Queue retry may repeat only a remote read

- **WHEN** a queue retry restarts a Run before a prior MCP call result was durably settled
- **THEN** the operator-attested read-only call may execute again
- **AND** no write-capable MCP operation is eligible under this capability

### Requirement: First tool is internal, read-only, own-data

The first code-owned tool SHALL remain conversation search over the requesting user's own chats, implemented against the **same server-side search service the web chat search uses**. Code-owned tools SHALL take authorization identity only from trusted Run context and SHALL remain tenant-scoped by datastore enforcement.

Remote MCP tools MAY perform outbound network reads only through the `mcp-tools` capability: the operator SHALL explicitly configure the remote source and allowlist each executable namespaced tool exactly or allowlist that configured server's namespace. An exact entry SHALL attest that operation as read-only; a namespace wildcard SHALL attest every current and future safely admitted operation from that server as read-only. Remote execution SHALL receive no llame tenant authorization context or credential other than the operator-configured headers for that MCP server. Operators MUST NOT allowlist write, send, delete, execute, financial, or administrative MCP operations under either form; llame does not infer or verify remote semantic effects from MCP metadata.

#### Scenario: Conversation search over own chats

- **WHEN** the model invokes the conversation-search tool with a query
- **THEN** it returns matches only from chats owned by the run's owner

#### Scenario: Tool and UI search share one implementation

- **WHEN** the conversation-search tool and the web chat search execute the same query for the same user
- **THEN** both are served by the same underlying search service

#### Scenario: No external network egress from tools

- **WHEN** the shipped code-owned toolset is enumerated
- **THEN** none performs outbound network requests
- **AND** the only external-tool exception is an explicitly configured MCP read selected by an exact entry or matching namespace wildcard under the operator's read-only attestation

#### Scenario: Explicit MCP read is the only external-tool exception

- **WHEN** the shipped toolset is enumerated
- **THEN** external network tools are limited to explicitly configured MCP ids carrying the operator's exact or namespace-wide read-only attestation
- **AND** no remote tool receives llame's trusted tenant datastore context

### Requirement: Tool availability is source-neutral and bound per Run

Every new Run SHALL bind one canonical availability manifest covering exact tool ids relevant to that turn regardless of source, including code-owned tools such as `search_conversations`, MCP tools, and later tool sources. The manifest SHALL distinguish the exact eligible ids retained after operator-policy filtering, the exact declarations advertised to the model, and eligible exact ids unavailable for a closed server-authored reason. Configuration patterns SHALL NOT appear in the manifest. A tool never eligible and never previously visible in that chat SHALL not be disclosed through the manifest or reminders.

Every snapshot authored after this capability is deployed SHALL use an observed v1 manifest containing an `entries` array, including when its eligible catalog is empty. Historical snapshots that predate availability observation SHALL use exactly the canonical v0 sentinel `{"version":0,"state":"unobserved"}` with no `entries` field. Comparing a current manifest with that sentinel SHALL use initial-baseline semantics rather than treating the sentinel as an observed empty catalog. A v0 manifest with `entries`, a v1 manifest without `entries`, or any hybrid shape SHALL be rejected as malformed.

#### Scenario: Code-owned and MCP tools share availability semantics

- **WHEN** `search_conversations` and an exact MCP tool selected by an exact entry or namespace wildcard are both eligible for a turn
- **THEN** one manifest describes which exact declarations are advertised and which exact eligible ids are unavailable

#### Scenario: Unallowlisted discovery remains invisible

- **WHEN** a dynamic source discovers a tool that matches neither an exact entry nor a namespace wildcard and was not previously visible in the chat
- **THEN** its id and declaration appear in neither the model toolset nor an availability reminder

#### Scenario: Admission-refused discovery remains invisible

- **WHEN** a discovered dynamic tool fails declaration admission regardless of whether an exact or namespace permission would match its prospective id
- **THEN** its id and declaration appear in neither the source inventory, model toolset, nor an availability reminder

#### Scenario: Wildcard pattern remains configuration-only

- **WHEN** a namespace wildcard selects one or more admitted MCP tools
- **THEN** the availability manifest contains only their exact canonical ids and states
- **AND** no wildcard pattern is persisted or rendered to the model

#### Scenario: Historical absence of observation differs from an empty catalog

- **WHEN** historical snapshots are migrated before availability was ever observed
- **THEN** they receive exact canonical JSON `{"version":0,"state":"unobserved"}` and its availability hash
- **AND** the sentinel has no `entries` field
- **AND** it is distinct from an observed v1 manifest whose `entries` array is empty
