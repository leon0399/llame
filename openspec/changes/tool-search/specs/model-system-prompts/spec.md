## MODIFIED Requirements

### Requirement: Every new run binds an immutable effective-context snapshot

Before a new run is enqueued, the system SHALL bind it to an immutable owner-scoped snapshot containing the selected model's effective system prompt **with the requesting owner's per-user context already substituted**, prompt source kind, exact model-facing tool ids/descriptions/input schemas for every bound tool, the sorted list of bound ids that are discoverable rather than declared on the first step (empty when no tool is discoverable), and a canonical source-neutral tool-availability manifest for that turn. Substitution, tool admission, and tier resolution SHALL precede computation of the hashes. The existing content hash SHALL continue to cover the rendered prompt plus bound declarations, and SHALL additionally cover the discoverable-id list only when that list is non-empty, so every snapshot bound without discoverable tools keeps the hash it has today. The tool hash SHALL continue to cover only the exact bound declaration contract, including the `tool_search` declaration when one is bound, and a separate availability hash SHALL cover the canonical availability manifest. The snapshot's exact effective-context identity and reuse key SHALL include both content and availability hashes, so availability-only changes bind a distinct snapshot without retroactively changing the meaning of historical content hashes.

The user message, semantic runtime reminder metadata, Run, and snapshot binding SHALL commit atomically in the chat owner's tenant transaction. The per-user read and in-memory projection of the latest atomically published process-local catalog MAY occur before that transaction, but turn binding SHALL perform no MCP network I/O and SHALL not hold the transaction open across either operation; a personalization or remote-catalog change published after resolution MAY apply only to the next Run. Queued execution and retry SHALL use the bound snapshot and persisted reminder metadata rather than rereading prompt files, re-reading personalization, refreshing remote catalogs, rebinding newer tool availability, or recomputing tiers. Snapshots MAY be content-addressed and reused only within the same owner and only when prompt, bound declarations, discoverable-id list, source kind, and availability manifest are canonically identical.

#### Scenario: Personalization changes after enqueue

- **WHEN** an owner edits their personalization after a run is enqueued but before the worker executes it
- **THEN** that run executes with the personalization bound at enqueue
- **AND** the edited content applies only to subsequently enqueued runs

#### Scenario: Tool availability changes after enqueue

- **WHEN** a dynamic tool disconnects or reconnects after a Run is enqueued
- **THEN** that Run retains its bound declarations, availability manifest, and reminder metadata
- **AND** the changed availability is compared and disclosed on the next accepted turn

#### Scenario: Tier partition is bound at enqueue

- **WHEN** the model catalog, the per-model threshold, or the remote catalog changes after a Run is enqueued
- **THEN** that Run keeps the tiers and the `tool_search` declaration bound at enqueue
- **AND** a Run bound without discoverable tools carries no discoverable-id list and the same content hash as before this capability

#### Scenario: Two owners share one model

- **WHEN** two owners with different personalization run the same configured model
- **THEN** each run binds its own owner's rendered values
- **AND** neither owner's authored text appears in the other's prompt or snapshot

#### Scenario: Prompt file changes after enqueue

- **WHEN** an administrator changes a prompt file after a run is enqueued but before the worker executes it
- **THEN** that run uses the prompt content bound at enqueue
- **AND** a later run uses the newly resolved content only after the instance reloads it

#### Scenario: Run is retried

- **WHEN** execution of a run is retried
- **THEN** every attempt uses the same effective prompt, bound tool contract, tiers, availability manifest, and semantic reminders
- **AND** the context receipt remains unchanged

#### Scenario: Tool contract is incompatible at execution

- **WHEN** a snapshotted code-owned tool no longer has a compatible trusted executor at execution time
- **THEN** the Run fails before making a provider request
- **AND** the system does not silently advertise or execute a different tool contract
- **AND** a dynamic source failure instead retains the snapshotted declaration with an unavailable executor under the `tool-calling` capability

#### Scenario: Dynamic tool contract is unavailable at execution

- **WHEN** a snapshotted dynamic tool no longer has its matching trusted executor at execution time
- **THEN** its snapshotted declaration remains unchanged and its executor settles a requested call as unavailable
- **AND** unrelated tools and answer generation remain usable

#### Scenario: Cross-tenant snapshot reference is attempted

- **WHEN** one tenant attempts to read or bind another tenant's effective-context snapshot
- **THEN** datastore constraints and FORCE RLS deny the operation
- **AND** no prompt, tool, or availability content is disclosed

### Requirement: Owners can inspect the exact effective context without seeing host paths

The owner SHALL be able to retrieve an immutable context receipt for each new Run. The receipt SHALL contain the public model id, prompt source label, complete effective system prompt contents **including any rendered per-user context exactly as sent to the provider**, every bound tool id/description/input schema each marked as declared or discoverable, the `tool_search` declaration when one was bound, availability manifest version, content hash, availability hash, and snapshot timestamp. For observed v1 availability it SHALL also contain the safe eligible/unavailable entries and closed reason labels. For migrated v0 availability it SHALL instead contain only `state: "unobserved"` and SHALL NOT represent historical non-observation as an empty catalog. It MUST NOT contain the administrator's prompt-file path, MCP URL, configured header names or values, session id, raw remote error, server-only provider model id, provider credentials, executor implementation, or trusted authorization context. Non-owners SHALL receive a not-found response.

#### Scenario: Owner inspects a run carrying personalization

- **WHEN** the chat owner opens the receipt for a run whose prompt rendered their personalization
- **THEN** the rendered personalization is visible in the disclosed prompt contents
- **AND** the owner can determine exactly what personalization the model received for that run

#### Scenario: Owner inspects runtime tool availability

- **WHEN** the chat owner opens a receipt for a Run with unavailable eligible tools
- **THEN** the receipt shows safe tool ids and closed availability labels matching the bound manifest
- **AND** it exposes no endpoint, header, session, or raw remote error data

#### Scenario: Owner inspects a Run with discoverable tools

- **WHEN** the chat owner opens the receipt for a Run whose catalog exceeded the declaration budget
- **THEN** every bound declaration is shown with its tier
- **AND** the `tool_search` declaration and its enumerated discoverable ids are shown exactly as bound
- **AND** a Run whose catalog fit the budget shows every declaration as declared and no `tool_search`

#### Scenario: Owner inspects migrated historical availability

- **WHEN** the owner opens a receipt whose snapshot carries the canonical v0 availability sentinel
- **THEN** the receipt reports manifest version `0` and state `unobserved`
- **AND** it does not report an empty observed tool catalog

#### Scenario: Owner inspects a model-specific prompt

- **WHEN** the chat owner opens the effective-context receipt for a run using a per-model override
- **THEN** the complete prompt contents and exact bound tool contract are displayed
- **AND** the source is labeled `Model-specific override`
- **AND** no host path is present

#### Scenario: Owner inspects a default prompt

- **WHEN** the chat owner opens the receipt for a run using the project prompt
- **THEN** the complete project prompt contents are displayed
- **AND** the source is labeled `Project default`

#### Scenario: Another user requests the receipt

- **WHEN** an authenticated user requests a run context receipt they do not own
- **THEN** the API responds as though the receipt does not exist
- **AND** no model, prompt, tool, availability, endpoint, or path metadata is disclosed
