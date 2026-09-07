## MODIFIED Requirements

### Requirement: Tool registry with mandatory safety classification

Every registered tool SHALL declare a safety classification from the SPEC §13.5
set (`read_only`, `write_low_risk`, `write_high_risk`, `execute_code`,
`external_send`, `financial_or_sensitive`, `admin`). The loop SHALL execute
allowlisted `read_only` tools and exact code-owned tools registered by an
approved alpha-native capability. The initial native set is `read` classified
`read_only`, plus `edit` and `write` classified `write_low_risk`; later native
capabilities such as Knowledge submit or bash must declare their own exact tools
and retry policy. Classification alone SHALL NOT admit any other write or
execution tool. Alpha-native tools carry explicit host authority for absolute paths and
owner-scoped Knowledge authority for `kb://` locators; they are not a general
permission engine or a remote MCP write grant. The candidate resolver SHALL admit
the three native tools when the process has accepted native host authority or
has a configured Knowledge root, and SHALL leave them unavailable when it has
neither.

The `mcp__` tool-id prefix SHALL be reserved for ids produced by the MCP
capability. A code-owned or other non-MCP registry entry beginning with that
prefix SHALL fail registration, so ID-only namespace permission matching cannot
grant authority across source kinds.

#### Scenario: Read-only tool executes

- **WHEN** an allowlisted tool classified `read_only` is called
- **THEN** it executes

#### Scenario: Alpha native file tool executes only in its host capability

- **WHEN** an exact code-owned native tool is allowlisted and its trusted alpha native capability is present
- **THEN** it executes with the native host authority declared by that capability
- **AND** it is not substituted with a hosted path or remote MCP operation

#### Scenario: Native tools are admitted by Knowledge root alone

- **WHEN** a process has a configured Knowledge root, no `tools.nativeExecutorId`, and allowlists `read`, `edit`, and `write`
- **THEN** the three tools are advertised and executable for `kb://` locators
- **AND** an absolute path fails closed with `executor_unavailable`

#### Scenario: Non-read-only tool is refused even when allowlisted

- **WHEN** a tool outside the exact alpha native file set is classified other than `read_only`, registered and allowlisted, and the model requests it
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

### Requirement: Code-owned Knowledge tools use the existing immutable read-only loop

The code-owned tool inventory SHALL include `knowledge_search` in addition to `search_conversations`; Knowledge file access is the `kb://` locator of the native file tools. `knowledge_search` SHALL declare `read_only`, require its own exact entry in `tools.allowed`, and participate in the same declaration admission, immutable Run tool snapshot, execution rebinding, timeout, abort, settlement, persistence, replay, compaction, result neutralization, truncation, and browser-rendering contracts as every other code-owned tool. The Run tool snapshot SHALL bind operation eligibility and declarations, not a Knowledge resource inventory.

The operator allowlist controls only whether these fixed operations are eligible. It SHALL NOT choose an owner, configured root, child directory, path root, or execution location. A permitted Knowledge tool MAY accept a stable Knowledge Space selector as defined by its code-owned schema, but current authority for that selector MUST come from the trusted Run owner at execution time. Model input SHALL NOT supply or expand ownership or local filesystem authority.

For each newly accepted Run, the code-owned candidate resolver SHALL use the static declaration, safety classification, exact allowlist entry, and configured Knowledge root to determine Knowledge tool availability. It SHALL NOT query or snapshot the owner's Knowledge Space inventory. With a configured root, an owner with zero current resources SHALL still receive the callable tool declarations; invocation SHALL return `knowledge_space_not_configured`. Without a configured root, each otherwise-eligible Knowledge tool SHALL retain the closed `knowledge_space_unavailable` manifest state. The API request path SHALL NOT probe the filesystem.

Worker execution SHALL receive the private filesystem resolver through trusted dependency injection or tool context and current owner identity through trusted Run context. It SHALL resolve current owner resources under RLS for every invocation and SHALL NOT serialize local binding data into declarations or accept it from model input.

Knowledge results SHALL retain the global execution envelope `status: "success" | "error"`; this change SHALL NOT add a generic `partial` status. A successful `knowledge_search` MAY additionally declare `complete: false` with bounded warnings. While its full payload is present, that structured result remains usable. Whenever a later model-replay projection clears that payload—including ordinary bounded next-turn projection and compaction into the observation ledger—the payload-cleared observation SHALL carry outcome `incomplete`, not `success`; later replay SHALL preserve that outcome. Other successful tool results SHALL continue to project and compact as `success`. General partial-result semantics outside Knowledge are not defined by this requirement.

New Knowledge results SHALL persist and render the current passage/range attribution defined by `knowledge-tools` without requiring a content hash. Historical persisted Knowledge results MAY retain their earlier hash-bearing shape. Execution, persistence, replay, compaction, and browser rendering SHALL preserve either bounded observation as authored and SHALL NOT normalize historical results into the new shape or synthesize removed fields. Existing persisted calls without new optional range or cursor arguments SHALL remain valid observations.

Changing the code-owned `knowledge_search` declaration SHALL be a coordinated API/worker revision boundary because an accepted Run binds the exact declaration and a code-owned executor refuses drift. Before replacing binaries for the passage-search declaration, the deployment SHALL quiesce new Run acceptance and drain every accepted Run bound to the prior declaration. It SHALL deploy matching API and worker binaries before resuming acceptance. Rollback SHALL quiesce and drain Runs bound to the newer declaration before restoring older API or worker binaries. No mixed-revision executor fallback or declaration normalization is introduced by this change.

The canonical closed Knowledge reason vocabulary and model-safe label mapping SHALL retain `knowledge_space_not_configured` and `knowledge_space_unavailable`. Because zero inventory no longer changes tool availability, `knowledge_space_not_configured` SHALL be emitted only as a tool-call result, not as an immutable manifest state. `knowledge_space_unavailable` and its existing recovery mapping SHALL continue to govern missing process configuration without admitting arbitrary reason text.

#### Scenario: Knowledge tool is not allowlisted

- **WHEN** a Knowledge tool is registered but its exact ID is absent from `tools.allowed`
- **THEN** it is neither advertised nor executable for a newly accepted Run

#### Scenario: Allowlisted Knowledge tool is snapshotted

- **WHEN** an exact Knowledge tool ID is allowlisted for a newly accepted Run with a configured Knowledge root
- **THEN** its exact declaration is included in that Run's immutable tool snapshot regardless of current owner inventory
- **AND** execution requires the matching code-owned read-only executor

#### Scenario: Eligible Knowledge tool starts unavailable

- **WHEN** a Knowledge tool is allowlisted but the authoring API has no configured Knowledge root
- **THEN** the Run manifest records `knowledge_space_unavailable`
- **AND** the tool is not advertised as callable for that Run

#### Scenario: Knowledge availability recovery uses the closed mapping

- **WHEN** a later accepted Run changes `knowledge_space_unavailable` to available within the disclosure epoch
- **THEN** its `Now available` transition uses `knowledge_space_restored`
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

#### Scenario: Removed reader fails closed for a bound Run

- **WHEN** a Run accepted before removal has `knowledge_read` in its immutable tool snapshot and the model requests it
- **THEN** the call receives a recorded non-fatal unavailable refusal
- **AND** no shim, alias, or redirect to `read` is applied

#### Scenario: Incomplete Knowledge search stays incomplete after payload clearing

- **WHEN** `knowledge_search` returns `status: "success"` with `complete: false` and its payload is later cleared by any model-replay projection
- **THEN** the payload-cleared observation and subsequent replay carry outcome `incomplete`
- **AND** the call is not upgraded to complete success

### Requirement: Conversation read uses the existing immutable read-only tool loop

The code-owned tool inventory SHALL include `conversation_read` in addition to `search_conversations` and `knowledge_search`. It SHALL declare `read_only`, require its own exact `tools.allowed` entry, and participate in the existing declaration admission, immutable Run snapshot, execution rebinding, timeout, cooperative cancellation, settlement, persistence, replay, compaction, neutralization, and generic browser-rendering lifecycle. Owner authority SHALL come only from trusted Run context, never from model arguments or a message locator.

The conversation reader SHALL enforce the `conversation-reads` bounds of 2,000 logical lines and 15,000 JavaScript UTF-16 code units before generic result truncation. A read whose first selected source line cannot fit SHALL return `conversation_limit_exceeded`. Bounded pages SHALL preserve exact `nextOffset` and cut-reason metadata, and generic truncation SHALL NOT clip numbered source content.

Structured Chat/message sequence attribution, role/timestamp, numbered content, neighboring eligible sequences, continuation metadata, and the closed untrusted-history notice SHALL persist and render as authored through the ordinary tool UI. Replay SHALL NOT rehydrate newer message content, synthesize hashes/UUIDs/versions/part identities, remove line prefixes/notices, or normalize historical result shapes. Adding or changing the code-owned declaration or Chat-local sequence semantics SHALL use a coordinated API/worker/data cutover: quiesce new Run acceptance, drain Runs bound to the prior declaration and sequence interpretation, migrate durable sequence boundaries, deploy matching executors/declarations, then resume; rollback SHALL restore the matching prior binaries and data snapshot rather than mix locator interpretations.

A persisted conversation-read observation SHALL follow the destination Chat's existing retention and deletion lifecycle. Product behavior SHALL NOT delete an individual source message. Deleting or later losing access to the source Chat SHALL make a fresh read return `conversation_source_not_found` but SHALL NOT redact or rewrite text already recorded in another owner-visible Chat. Deleting the destination Chat SHALL remove its messages, Runs, and Run events through the existing cascade lifecycle.

Because the global-to-Chat-local sequence rewrite is a pre-merge alpha hard cutover, deployment SHALL preflight persisted assistant parts, compaction replacement history, and Run events before changing sequence values. If it finds an experimental canonical `search_conversations` result or `conversation_read` input/result authored under the prior global interpretation, the cutover SHALL abort before mutation. It SHALL NOT rewrite the historical observation, accept its global value as an alias, or guess between colliding locator namespaces. The unsupported experimental Chat or database must be removed/reset as a whole before retrying the cutover.

#### Scenario: Conversation reader is not allowlisted

- **WHEN** `conversation_read` is registered but absent from `tools.allowed`
- **THEN** it is neither advertised nor executable for a newly accepted Run

#### Scenario: Allowlisted reader is bound immutably

- **WHEN** the exact reader ID is eligible for a newly accepted Run
- **THEN** that Run snapshots its exact declaration and requires the matching code-owned executor
- **AND** no Chat/sequence argument supplies owner authority

#### Scenario: Bounded continuation survives persistence

- **WHEN** a reader success returns numbered content with `nextOffset` and a cut reason
- **THEN** live events, assistant-message settlement, browser reload, and full-payload replay preserve the exact result
- **AND** the persisted observation is not replaced by a generic truncation preview

#### Scenario: Historical read is not rehydrated

- **WHEN** message content, sequence navigation, or line-rendering code changes after a read result was persisted
- **THEN** reload and replay preserve the bounded historical observation as authored
- **AND** they do not reread the source or rewrite its coordinates/content

#### Scenario: Experimental global locator blocks the alpha cutover

- **WHEN** migration preflight finds a persisted canonical search/read observation in live message parts, compaction replacement history, or Run events authored with the unmerged global sequence interpretation
- **THEN** the cutover fails before rewriting any message or compaction sequence
- **AND** it neither mutates that observation nor installs a global-sequence alias path

#### Scenario: Source deletion does not rewrite another Chat's observation

- **WHEN** a persisted conversation-read result in one owner-visible Chat quotes a source Chat later deleted or unavailable
- **THEN** the historical result remains recorded while a fresh call returns `conversation_source_not_found`
- **AND** deleting the destination Chat removes that observation under the existing Chat/Run cascade lifecycle

#### Scenario: Generic tool UI remains the rendering floor

- **WHEN** a live or historical `conversation_read` result reaches the browser
- **THEN** the existing structured tool renderer displays its input, lifecycle state, result, or closed error
- **AND** no specialized source card, outline, activity timeline, or conversation-only renderer is required

#### Scenario: Conversation-read declaration cutover drains prior Runs

- **WHEN** deployment changes code-owned conversation declarations or the interpretation of message sequence fields
- **THEN** it stops accepting new Runs and drains Runs and queue payloads bound to the prior interpretation before migrating sequence boundaries
- **AND** acceptance resumes only after every API and worker exposes the matching declaration, executor, and Chat-local sequence semantics
