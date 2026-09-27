## MODIFIED Requirements

### Requirement: Every execution attempt resolves its effective context in the worker

API acceptance SHALL persist the user message, selected public model/effort, and
Run identity without resolving or persisting an effective prompt/tool catalog.
Remove the old `modelContextSnapshotId` Run FK and required create input after
historical system receipts have been migrated; no placeholder snapshot SHALL be
created for acceptance. Source-context lookup SHALL follow the successful
Run's system-only receipt.
Each queue-authorized attempt SHALL resolve those fixed model choices through
its executing worker's configuration, reread the owner's safe variable
projection, and admit its worker-local current tool inventory. It SHALL render
the complete system prompt and admitted llame-owned descriptions together from
that one context. Existing digest and temporal lifecycles SHALL retain their
meaning. A missing selected model SHALL fail explicitly without fallback.

The system prompt and admitted declarations SHALL stay fixed in memory for
that attempt's target-model loop after transition preparation and final rendering. A trusted Workspace action admitted under `tool-calling` MAY extend the in-memory declarations without replacing existing declarations; each such addition SHALL take effect from the next model step, and Workspace exit, switch, or detach SHALL leave its declaration in the attempt-local catalog with an unavailable executor. The trusted executors and source declarations SHALL stay bound
together in that memory; current invocation permissions, tenant/resource
authority, and native recovery fences SHALL still apply. Source loss or drift
during an MCP attempt SHALL use the existing unavailable-call behavior without
substituting newer definitions.

Before target-model I/O, the worker SHALL persist its finalized system-only prompt receipt
under a still-current attempt identity. Source-model transition summarization
uses the successful source system receipt and separately identified operational
events; a preliminary target sizing render SHALL not become a receipt. Full tool catalogs, templates, schemas,
descriptions, and source/declaration hashes SHALL NOT be persisted as execution
context. Minimal successful-turn id/state comparison records SHALL follow
`tool-calling`. Any permitted retry SHALL resolve and render again rather than
using its predecessor's receipt, catalog, or model context.

#### Scenario: Settings change while queued

- **WHEN** the owner changes personalization after queue acceptance but before worker execution
- **THEN** the attempt uses the current owner projection in both prompt surfaces
- **AND** its receipt records its actual rendered system prompt

#### Scenario: Catalog changes before retry

- **WHEN** an infrastructure retry runs with a changed worker catalog
- **THEN** it admits and renders the new attempt's catalog
- **AND** it never loads a catalog or rendered description from the database

#### Scenario: Tool definitions change during an attempt

- **WHEN** an MCP source disconnects or changes its declaration after attempt preparation
- **THEN** the existing in-memory declaration is not replaced
- **AND** a requested incompatible call settles through the unavailable-tool path

#### Scenario: Selected model is no longer executable

- **WHEN** the worker cannot resolve the queued Run's selected model or effort
- **THEN** preparation fails before target-model I/O
- **AND** another model is not substituted

#### Scenario: Render fails after scheduling

- **WHEN** current attempt inputs produce an invalid or empty effective prompt
- **THEN** that attempt fails final preparation with a safe error and no target-model request
- **AND** the scheduled message/Run remains recorded without a new comparison baseline

#### Scenario: Superseded attempt tries to publish context

- **WHEN** an earlier worker tries to write a receipt, model context, or completion after a newer attempt owns the Run
- **THEN** the stale write is refused under trusted attempt fencing
- **AND** it cannot replace the winning attempt or advance availability state

#### Scenario: Trusted Workspace addition extends the attempt catalog

- **WHEN** a trusted Workspace action adds an admitted declaration during a Run
- **THEN** that declaration joins the attempt-local model-facing catalog from the next model step without replacing an existing declaration
- **AND** a later Workspace exit, switch, or detach leaves the declaration present with an unavailable executor, as specified by `tool-calling`

### Requirement: Owners can inspect the exact effective context without seeing host paths

The owner SHALL be able to inspect immutable system-prompt-only receipts for

Operator skill source/package/file paths intentionally published under `agent-skills` SHALL be permitted in the recorded model-visible skill contributions; this exception SHALL NOT expose prompt-file paths, Knowledge backing paths, credentials, or other private configuration. Non-owners SHALL receive a not-found response.
every execution attempt that completed prompt preparation. Each receipt SHALL
contain the Run/attempt identity, public model id and effort, prompt source
label, exact rendered system prompt including projected owner values, prompt
hash, and resolution timestamp. A new attempt SHALL append its own receipt and
SHALL NOT overwrite or execute from a previous attempt's receipt. Failed-attempt
receipts remain owner inspection data and SHALL NOT become model history.
Receipt identity SHALL be unique per owner/Run/attempt, with an owner-matching
Run relationship and zero or more receipts per Run. Identical text/hash SHALL
not reuse another attempt's receipt. Completion SHALL identify its successful
attempt. A receipt proves preparation, not dispatch; correlated request events
SHALL distinguish those states.

The receipt API SHALL distinguish an owned queued/preparing Run with no receipt
from an unknown or non-owned Run: the former SHALL report not-yet-resolved
status, the latter SHALL return not found. An attempt that fails before prompt
preparation SHALL not fabricate a receipt. The existing owner-only context-receipt endpoint SHALL return resolution state,
active/completed attempt identifiers, and an ordered list of system-only
receipts keyed by attempt id. An owned Run with no prepared receipt SHALL have
an empty list and its actual unresolved/not-produced state. The UI SHALL expose
each prepared attempt and fetch this response on demand.

Receipts SHALL contain no tool catalog, schemas, descriptions, availability
manifest, declaration hashes, or combined prompt/tool content hash. An owner receipt MAY list the exact tool ids added during that Run by trusted Workspace actions, but it SHALL contain no schemas, descriptions, declaration hashes, endpoints, or other declaration content for those tools. Private
prompt-file paths, MCP connection information, raw source errors, provider
credentials, and executor context SHALL remain undisclosed. Historical system
prompt receipts SHALL survive catalog-column removal; historical tool receipt
fields SHALL be removed rather than rebuilt from current configuration.

#### Scenario: Owner inspects a run carrying personalization

- **WHEN** the chat owner opens the receipt for a run whose prompt rendered their personalization
- **THEN** the rendered personalization is visible in the disclosed prompt contents
- **AND** the owner can determine exactly what personalization the model received for that run

#### Scenario: Owner inspects runtime tool availability

- **WHEN** the chat owner opens a receipt for a Run with unavailable eligible tools
- **THEN** the receipt shows only the attempt's recorded system prompt and receipt metadata, without a tool catalog or availability manifest
- **AND** it exposes no endpoint, header, session, or raw remote error data

#### Scenario: Owner inspects migrated historical availability

- **WHEN** the owner opens a migrated historical system-only receipt whose former snapshot had no observed availability
- **THEN** the migrated receipt retains its original system prompt without tool availability fields
- **AND** migration does not fabricate an observed comparison baseline from historical non-observation

#### Scenario: Owner inspects a model-specific prompt

- **WHEN** the chat owner opens the effective-context receipt for a run using a per-model override
- **THEN** the exact recorded system prompt is displayed for its identified attempt
- **AND** the source is labeled `Model-specific override`
- **AND** no private configuration host path is present; intentionally published operator skill paths remain visible

#### Scenario: Owner inspects a default prompt

- **WHEN** the chat owner opens the receipt for a run using the project prompt
- **THEN** the complete project prompt contents are displayed
- **AND** the source is labeled `Project default`

#### Scenario: Another user requests the receipt

- **WHEN** an authenticated user requests a run context receipt they do not own
- **THEN** the API responds as though the receipt does not exist
- **AND** no model, prompt, tool, availability, endpoint, or path metadata is disclosed

#### Scenario: Skill activation does not mutate the enqueue receipt

- **WHEN** a skill activation publishes its package directory and resolved file path after the Run is claimed
- **THEN** the immutable enqueue receipt stays unchanged and the separate executed-context record contains the final activation text
- **AND** the skill path exception does not expose Knowledge backing paths or private prompt configuration

#### Scenario: Queued receipt is pending

- **WHEN** an owner inspects a Run before any attempt has prepared its system prompt
- **THEN** the response identifies it as not yet resolved with no fabricated prompt or tool data
- **AND** a non-owner requesting the same Run receives not found

#### Scenario: Retry renders different personalization

- **WHEN** a retry renders a different system prompt from an earlier failed attempt
- **THEN** both prepared attempts have separate immutable system-only receipts
- **AND** only the winning attempt's staged context items may enter committed model history

#### Scenario: Owner inspects added Workspace tool ids

- **WHEN** the chat owner opens the receipt for a Run in which a trusted Workspace action added tool declarations
- **THEN** the receipt lists the exact ids added during that Run
- **AND** it contains no schemas, descriptions, declaration hashes, endpoints, or other declaration content
