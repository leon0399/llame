## MODIFIED Requirements

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5 set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`, `external_send`, `financial_or_sensitive`, `admin`, `unverified`). The loop SHALL execute allowlisted `read_only` tools and exact code-owned tools registered by an approved alpha-native capability only when the executing process's `tools.permissions` policy also allows the invocation. MCP tools SHALL declare `unverified`; their eligibility SHALL be determined by an admitted MCP declaration whose exact id matches either an exact `tools.allowed` entry or a validated namespace rule, not by a `read_only` classification. An MCP invocation SHALL execute only when its source is allowlisted and the executing process's `tools.permissions` policy allows that invocation. The initial native set is `read` and `grep` classified `read_only`, plus `edit` and `write` classified `write_low_risk`; later native capabilities such as Knowledge submit or bash must declare their own exact tools and retry policy. Classification alone SHALL NOT admit any other write or execution tool. Alpha-native tools carry explicit host authority for absolute paths and owner-scoped Knowledge authority for `kb://` locators, and `read` alone carries owner-scoped, read-only media authority for `media://` locators, which resolves only the Run owner's media; they are not a general permission engine, and their host authority SHALL NOT grant authority to MCP tools. The candidate resolver SHALL admit `edit` and `write` when the process has accepted native host authority or has a configured Knowledge root, and SHALL leave them unavailable when it has neither. It SHALL admit `read` whenever `tools.allowed` names it, because skill, web, and `media://` locators need no host authority; an absolute path on a process without accepted native authority still fails closed with `executor_unavailable`. It SHALL admit `grep` when the process has accepted native host authority, a configured Knowledge root, a configured operator skill source, or a configured Machine, and SHALL leave `grep` unavailable when it has none of these; the `grep-tool` capability owns that tool's scope and admission rules. A configured Knowledge root admits only `read`, `grep`, `edit`, and `write`; `bash`, `enter_workspace`, `exit_workspace`, and every other host-capability tool remain admitted solely by accepted native host authority. The exact host-capability set SHALL include `enter_workspace` and `exit_workspace`; `enter_workspace` SHALL be classified `execute_code`, `exit_workspace` SHALL be classified `write_low_risk`, neither SHALL record a `native.attempt` effect, both SHALL bind the Run to the executing native executor identity like other host tools, and both SHALL be idempotent over Chat state when retried after their state change commits. Every MCP source-inventory, advertisement, executable-binding, and unavailable-state gate SHALL use source admission, `tools.allowed`, and per-call `tools.permissions` as applicable; no MCP gate SHALL require or infer a `read_only` classification or attestation, and an unavailable MCP declaration SHALL retain at most its exact identity for availability disclosure without an executable binding.

The `mcp__` tool-id prefix SHALL be reserved for ids produced by the MCP capability. A code-owned or other non-MCP registry entry beginning with that prefix SHALL fail registration, so ID-only namespace permission matching cannot grant authority across source kinds.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called and its invocation passes the execution permission policy
- **THEN** it executes

#### Scenario: Alpha native file tool executes only in its host capability

- **WHEN** an exact code-owned native host tool, including `enter_workspace` or `exit_workspace`, is allowlisted, its trusted host capability is present, and the invocation passes execution permission checks
- **THEN** it executes with the host authority declared by that capability
- **AND** it is not substituted with a hosted path or remote MCP operation

#### Scenario: Native tools are admitted by Knowledge root alone

- **WHEN** a process has a configured Knowledge root, no `tools.nativeExecutorId`, and allowlists `read`, `edit`, and `write`
- **THEN** the three tools are advertised for `kb://` locators
- **AND** each call executes only when its `tools.permissions` policy allows it; without a matching allow the call receives `permission_denied`
- **AND** an absolute path fails closed with `executor_unavailable`

#### Scenario: Read is admitted by the allowlist alone

- **WHEN** a process has no `tools.nativeExecutorId` and no configured Knowledge root, and allowlists `read`, `edit`, and `write`
- **THEN** `read` is advertised and serves web locators under its permission policy
- **AND** `edit` and `write` are neither advertised nor executable, and an absolute-path `read` fails closed with `executor_unavailable`

#### Scenario: Knowledge root does not admit bash

- **WHEN** a process has a configured Knowledge root, no `tools.nativeExecutorId`, and allowlists `bash`
- **THEN** `bash` is neither advertised nor executable
- **AND** the Run manifest records it unavailable exactly as before this change

#### Scenario: Non-read-only tool is refused even when allowlisted

- **WHEN** a non-MCP tool outside the exact approved host-capability set is classified other than `read_only`, registered and allowlisted, and the model requests it
- **THEN** it is not advertised or executed
- **AND** a direct request receives a recorded non-fatal refusal

#### Scenario: Unclassified tool cannot register

- **WHEN** a tool without a classification is registered
- **THEN** registration fails at startup

#### Scenario: Duplicate tool id cannot register

- **WHEN** two tools register the same id
- **THEN** registration fails at startup naming the id

#### Scenario: Code-owned tool cannot occupy the MCP namespace

- **WHEN** a code-owned registry entry has an id beginning with `mcp__`
- **THEN** registration fails at startup naming the reserved prefix

#### Scenario: Write-capable MCP tool executes under both gates

- **WHEN** an MCP source supplies an admitted write-capable declaration whose exact id matches `tools.allowed`, and the invocation passes the executing process's `tools.permissions` policy
- **THEN** the tool executes despite its `unverified` classification

#### Scenario: Read serves media locators without host or Knowledge authority

- **WHEN** a process has no `tools.nativeExecutorId` and no configured Knowledge root, allowlists
  `read`, and the Run owner reads `media://<id>` of an image that owner holds
- **THEN** `read` returns the image result when its permission policy allows the call
- **AND** without a matching allow the call receives `permission_denied`

#### Scenario: Media authority does not cross owners

- **WHEN** user A's Run reads `media://<id>` of an image owned by user B, under a policy that allows
  the locator text
- **THEN** the call returns `not_found`, exactly as for an id that does not exist
- **AND** no bytes or descriptor fields of user B's image reach user A

#### Scenario: Media authority is read-only

- **WHEN** `edit` or `write` targets a `media://` locator
- **THEN** the call returns the existing unsupported-operation error
- **AND** no media object or stored variant changes

#### Scenario: Grep is admitted by any serving backend

- **WHEN** `tools.allowed` names `grep` and the process has a configured skill source but no native executor, Knowledge root, or Machine
- **THEN** `grep` is advertised
- **AND** a host scope returns `executor_unavailable` and a `kb://` scope returns `knowledge_space_unavailable`

### Requirement: Code-owned Knowledge tools use the attempt-local read-only loop

The code-owned tool inventory SHALL include `knowledge_search` in addition to `search_conversations`; Knowledge file access is the `kb://` locator of the native file tools. `knowledge_search` SHALL declare `read_only`, require its own exact entry in `tools.allowed`, and participate in the same declaration admission, attempt-local tool catalog, trusted executor binding, timeout, abort, settlement, persistence, replay, compaction, result neutralization, truncation, and browser-rendering contracts as every other code-owned tool. The runtime catalog SHALL describe operation eligibility and declarations, not a Knowledge resource inventory, and SHALL not be persisted.

The operator allowlist controls only whether these fixed operations are eligible. It SHALL NOT choose an owner, configured root, child directory, path root, or execution location. A permitted Knowledge tool MAY accept a stable Knowledge Space selector as defined by its code-owned schema, but current authority for that selector MUST come from the trusted Run owner at execution time. Model input SHALL NOT supply or expand ownership or local filesystem authority.

For each newly prepared execution attempt, the executing worker's candidate resolver SHALL use its source declaration, safety classification, exact allowlist entry, and configured Knowledge root to determine Knowledge tool availability. It SHALL NOT query or snapshot the owner's Knowledge Space inventory. With a configured root, an owner with zero current resources SHALL still receive the callable tool declarations; invocation SHALL return `knowledge_space_not_configured`. Without a configured root, each otherwise-eligible Knowledge tool SHALL retain the closed `knowledge_space_unavailable` manifest state. The API acceptance path SHALL neither resolve the catalog nor probe the filesystem.

Worker execution SHALL receive the private filesystem resolver through trusted dependency injection or tool context and current owner identity through trusted Run context. It SHALL resolve current owner resources under RLS for every invocation and SHALL NOT serialize local binding data into declarations or accept it from model input.

Knowledge results and `grep` results SHALL retain the global execution envelope `status: "success" | "error"`; this change SHALL NOT add a generic `partial` status. A successful `knowledge_search` or `grep` MAY additionally declare `complete: false` with bounded warnings. While its full payload is present, that structured result remains usable. Whenever a later model-replay projection clears that payload—including ordinary bounded next-turn projection and compaction into the observation ledger—the payload-cleared observation SHALL carry outcome `incomplete`, not `success`; later replay SHALL preserve that outcome. A `grep` result with `complete: true` SHALL continue to project and compact as `success`. Other successful tool results SHALL continue to project and compact as `success`. General partial-result semantics outside Knowledge and `grep` are not defined by this requirement.

New Knowledge results SHALL persist and render the current passage/range attribution defined by `knowledge-tools` without requiring a content hash. Historical persisted Knowledge results MAY retain their earlier hash-bearing shape. Execution, persistence, replay, compaction, and browser rendering SHALL preserve either bounded observation as authored and SHALL NOT normalize historical results into the new shape or synthesize removed fields. Existing persisted calls without new optional range or cursor arguments SHALL remain valid observations.

Changing execution semantics or stored Knowledge locator interpretation SHALL remain a coordinated API/worker/data boundary. Description-template edits SHALL be restart-applied and do not create a historical declaration-hash requirement for a scheduled Run. Before replacing binaries for the passage-search declaration, the deployment SHALL quiesce new Run acceptance and drain every accepted Run bound to the prior declaration. It SHALL deploy matching API and worker binaries before resuming acceptance. Rollback SHALL quiesce and drain Runs bound to the newer declaration before restoring older API or worker binaries. No mixed-revision executor fallback or declaration normalization is introduced by this change.

The canonical closed Knowledge reason vocabulary and model-safe label mapping SHALL retain `knowledge_space_not_configured` and `knowledge_space_unavailable`. Because zero inventory no longer changes tool availability, `knowledge_space_not_configured` SHALL be emitted only as a tool-call result, not as a runtime availability state. Current missing process configuration SHALL use the safe `knowledge_space_unavailable` label. Recovery notices SHALL identify the restored tool without asserting a prior cause, because the previous committed record stores only id/state.

#### Scenario: Knowledge tool is not allowlisted

- **WHEN** a Knowledge tool is registered but its exact ID is absent from `tools.allowed`
- **THEN** it is neither advertised nor executable for a newly prepared execution attempt

#### Scenario: Allowlisted Knowledge tool is admitted at runtime

- **WHEN** an exact Knowledge tool ID is allowlisted for a newly prepared execution attempt with a configured Knowledge root
- **THEN** its exact declaration is included in that Run's in-memory tool catalog regardless of current owner inventory
- **AND** execution requires the matching code-owned read-only executor

#### Scenario: Eligible Knowledge tool starts unavailable

- **WHEN** a Knowledge tool is allowlisted but the executing worker has no configured Knowledge root
- **THEN** the attempt's runtime availability records `knowledge_space_unavailable`
- **AND** the tool is not advertised as callable for that Run

#### Scenario: Knowledge availability recovery does not infer a prior cause

- **WHEN** an attempt admits a Knowledge tool recorded as unavailable in the most recent prior dispatched Run's record within the disclosure epoch
- **THEN** its `Now available` transition identifies that exact tool without inferring a stored failure reason
- **AND** no root, host path, or arbitrary reason text is rendered

#### Scenario: Knowledge observation persists through reload and replay

- **WHEN** an allowlisted Knowledge tool completes with passage/range attribution and no content hash
- **THEN** its call and structured result persist and render after browser reload
- **AND** later model replay receives the complete matched pair, a payload-cleared matched pair with honest `success`, `incomplete`, or error outcome, or a bounded omission marker according to the existing pair and turn/ledger budgets

#### Scenario: Historical Knowledge observation is not rewritten

- **WHEN** a persisted Knowledge observation uses the earlier hash-bearing result shape
- **THEN** reload and replay preserve the bounded observation as authored
- **AND** no migration or projection invents new range fields or removes its historical fields

#### Scenario: Knowledge declaration cutover drains prior Runs

- **WHEN** a deployment changes the code-owned `knowledge_search` declaration
- **THEN** it stops accepting new Runs and drains Runs bound to the prior declaration before replacing API or worker binaries
- **AND** acceptance resumes only after every executing process exposes the matching declaration and executor

#### Scenario: Tool permission cannot alter filesystem authority

- **WHEN** an operator allowlists `knowledge_search`
- **THEN** the permission makes only that fixed operation eligible
- **AND** any supplied space selector still resolves solely through current trusted owner authority

#### Scenario: Zero inventory remains model-visible

- **WHEN** a Run owner has no current Knowledge Spaces but `knowledge_search` is otherwise eligible
- **THEN** the tool is advertised as callable
- **AND** invocation returns the closed `knowledge_space_not_configured` result

#### Scenario: Removed reader is not recreated from history

- **WHEN** historical tool activity mentions the removed `knowledge_read` id
- **THEN** a fresh attempt does not reconstruct or execute it from that history
- **AND** no shim, alias, or redirect to `read` is applied

#### Scenario: Incomplete Knowledge search stays incomplete after payload clearing

- **WHEN** `knowledge_search` returns `status: "success"` with `complete: false` and its payload is later cleared by any model-replay projection
- **THEN** the payload-cleared observation and subsequent replay carry outcome `incomplete`
- **AND** the call is not upgraded to complete success

#### Scenario: Incomplete grep stays incomplete after payload clearing

- **WHEN** `grep` returns `status: "success"` with `complete: false` and its payload is later cleared by any model-replay projection
- **THEN** the payload-cleared observation and subsequent replay carry outcome `incomplete`
- **AND** the call is not upgraded to complete success
