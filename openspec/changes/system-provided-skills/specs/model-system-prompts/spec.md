## MODIFIED Requirements

### Requirement: Owners can inspect the exact effective context without seeing host paths

The owner SHALL be able to retrieve an immutable context receipt for each new Run. The receipt SHALL contain the public model id, prompt source label, complete effective system prompt contents **including any rendered per-user context exactly as sent to the provider**, advertised tool ids/descriptions/input schemas, availability manifest version, content hash, availability hash, and snapshot timestamp. For observed v1 availability it SHALL also contain the safe eligible/unavailable entries and closed reason labels. For migrated v0 availability it SHALL instead contain only `state: "unobserved"` and SHALL NOT represent historical non-observation as an empty catalog. It MUST NOT contain the administrator's prompt-file path, MCP URL, configured header names or values, session id, raw remote error, server-only provider model id, provider credentials, executor implementation, or trusted authorization context. Operator skill source/package/file paths intentionally published under `agent-skills` SHALL be permitted in the recorded model-visible skill contributions; this exception SHALL NOT expose prompt-file paths, Knowledge backing paths, credentials, or other private configuration. Non-owners SHALL receive a not-found response.

#### Scenario: Owner inspects a run carrying personalization

- **WHEN** the chat owner opens the receipt for a run whose prompt rendered their personalization
- **THEN** the rendered personalization is visible in the disclosed prompt contents
- **AND** the owner can determine exactly what personalization the model received for that run

#### Scenario: Owner inspects runtime tool availability

- **WHEN** the chat owner opens a receipt for a Run with unavailable eligible tools
- **THEN** the receipt shows safe tool ids and closed availability labels matching the bound manifest
- **AND** it exposes no endpoint, header, session, or raw remote error data

#### Scenario: Owner inspects migrated historical availability

- **WHEN** the owner opens a receipt whose snapshot carries the canonical v0 availability sentinel
- **THEN** the receipt reports manifest version `0` and state `unobserved`
- **AND** it does not report an empty observed tool catalog

#### Scenario: Owner inspects a model-specific prompt

- **WHEN** the chat owner opens the effective-context receipt for a run using a per-model override
- **THEN** the complete prompt contents and exact advertised tool contract are displayed
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
