## MODIFIED Requirements

### Requirement: Context layers have a stated precedence

The system MUST define and document one precedence order for instruction-bearing context, from highest to lowest:

1. The operator-configured system prompt and tool-permission or safety constraints. Owner content MUST NOT override them.
2. Explicit requests in the current Chat. These requests govern that Chat.
3. Explicit owner-authored guidance. Personalization and applicable Project instructions MUST both occupy this level.
4. Future inferred or accumulated memory. It MUST NOT silently outrank explicit owner-authored guidance.

Project instructions MUST add to personalization without replacement or a relative override hierarchy. The system MUST label their distinct scopes. Compatible guidance MUST remain available together. If guidance conflicts, the framing MUST direct the assistant to use the current request and ask only when the conflict materially affects the work.

The documentation MUST state what enforces each level. Tools and permissions MUST resolve without personalization or Project instruction input. Tests MUST assert this structural boundary. Lower levels MUST remain advisory through framing and model compliance. An operator replacement can remove personalization framing. Each Project item MUST retain its own bounded-authority statement under `context-injection`.

#### Scenario: In-conversation instruction overrides a standing preference

- **WHEN** `responsePreferences` request brief answers and the owner requests an exhaustive answer in a Chat
- **THEN** the current request governs that Chat
- **AND** the preference still applies to other Chats

#### Scenario: Future inferred memory cannot outrank an explicit preference

- **WHEN** a future inferred or accumulated memory conflicts with authored personalization
- **THEN** the authored personalization governs
- **AND** the inferred guidance occupies a lower authority level

#### Scenario: Project guidance adds to personalization

- **WHEN** personalization requests concise replies and Project instructions require metric units
- **THEN** the model receives both with distinct scope labels
- **AND** neither source replaces the other

#### Scenario: A current request resolves a guidance conflict

- **WHEN** personalization requests English, Project instructions request French, and the owner requests English for the current reply
- **THEN** the current request governs
- **AND** the system does not declare either standing source superior

#### Scenario: Authored guidance cannot change permissions

- **WHEN** personalization or Project instructions request a denied action
- **THEN** tool eligibility and permission evaluation ignore both sources
