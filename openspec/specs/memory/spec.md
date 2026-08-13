# memory

## Purpose

The owner-scoped settings surface governing what the assistant may learn from the owner's own past chats, held deliberately apart from `personalization`. Personalization settings shape how the assistant behaves; these settings control access to the owner's conversation history, which is a different consent decision with a different default and a different blast radius. This capability ships one setting — `shareRecentChats` — and is the surface later history-access gates extend.

## Requirements

### Requirement: Owners control recent-chat sharing through a setting that defaults off

The system SHALL provide each user a `shareRecentChats` boolean setting, **defaulting to false**, governing whether the assistant is given an unrequested view of what that owner has recently been working on. A user who has never opened the setting SHALL behave identically to one who has explicitly disabled it, and the absence of a stored row SHALL NOT be a special case.

The default SHALL be false, and the reasoning SHALL be documented: unlike a personalization field, this setting moves conversation-derived content the owner never authored for that purpose, and it does so without any authoring action that would signal intent. The same asymmetry already governs account-identity sharing, where defaulting on would retroactively transmit data on every existing user's behalf. The cost of this default — that the capability is inert until an owner opts in — SHALL be accepted rather than traded away.

The setting SHALL be global to the user rather than per model or per chat. The system MUST NOT infer, derive, or auto-enable it from usage.

#### Scenario: Brand-new user carries the intended default

- **WHEN** a user who has never opened these settings starts a chat
- **THEN** `shareRecentChats` is false and no digest is resolved
- **AND** the chat executes normally

#### Scenario: Owner opts in

- **WHEN** an owner enables `shareRecentChats`
- **THEN** their whole existing corpus becomes eligible to be listed as source entries, including chats created long before the setting was turned on
- **AND** a chat receives its own baseline on its first run for which the setting is enabled, whether that chat is new or already ongoing

#### Scenario: Setting is never inferred

- **WHEN** an owner searches their history, pins chats, or otherwise uses history features
- **THEN** `shareRecentChats` is unchanged
- **AND** it changes only through an explicit owner-initiated update

### Requirement: Memory settings are a separate axis from personalization

Memory settings SHALL NOT be gated by `personalization.enabled`. That switch means "use my authored profile", and withdrawing history features because an owner cleared their profile would be a capability regression the owner did not request and cannot see. The two SHALL be independently settable, and disabling one SHALL have no effect on the other.

The capability SHALL be shaped so that a later master history-access setting composes above `shareRecentChats` as a plain conjunction, without redefining what `shareRecentChats` means. `shareRecentChats` SHALL therefore be specified as _"share my recent chats with the assistant"_ rather than as _"the assistant may use my chat history"_, so the broader statement remains available to the later setting.

#### Scenario: Personalization is disabled while memory is enabled

- **WHEN** an owner sets `personalization.enabled` to false and leaves `shareRecentChats` true
- **THEN** no authored personalization renders and no account identity is transmitted
- **AND** the recency digest still renders

#### Scenario: Memory is disabled while personalization is enabled

- **WHEN** an owner sets `shareRecentChats` to false and leaves personalization enabled
- **THEN** their authored personalization still renders
- **AND** no new baseline is produced, no re-bake occurs, and no append is emitted, while any chat that already carries a baseline keeps rendering it

### Requirement: Memory settings are tenant-isolated at the datastore

Memory settings SHALL live in tenant-owned storage carrying the owner's user id, with row-level security `ENABLE`d **and** `FORCE`d and an owner policy evaluated against the request's current-user setting. There SHALL be **no** public-read policy: these settings MUST NOT be readable through the public chat-sharing path or by the empty identity. Every read and write SHALL execute inside the owner's tenant scope, with application-level owner filters retained as defense-in-depth, and cross-tenant and public-identity negative tests SHALL run in the row-level-security suite alongside the other proofs.

#### Scenario: Force RLS holds against the table owner

- **WHEN** the row-level-security suite queries memory settings as the owning role with another user's identity set, and again with the empty identity
- **THEN** no other user's settings are readable
- **AND** no setting value is disclosed

#### Scenario: Cross-tenant update is attempted

- **WHEN** a user attempts to update memory settings belonging to another user id
- **THEN** the operation is denied
- **AND** the target user's stored values are unchanged

### Requirement: Owners read and update memory settings through an owner-scoped API

The API SHALL expose owner-scoped retrieval and partial update of the authenticated user's own memory settings under the `api/v1/me` namespace the personalization capability established. Identity SHALL come only from the authenticated session and never from client-supplied input, so a caller cannot read or write another user's settings by supplying an identifier. Requests SHALL be validated against a declared schema, responses SHALL use an explicit response type with an egress allowlist, and the endpoints SHALL appear in the generated OpenAPI document.

The `shareRecentChats` control SHALL be documented as sending titles and opening excerpts of the owner's other chats to the model provider the operator has configured — which in a multi-user instance may be a third party with no relationship to that user. Three consequences SHALL be disclosed together **in the API contract and in the product documentation**, and stating fewer there produces an incomplete consent contract:

1. **Enabling is retroactive over the existing corpus.** Chats created long before the setting was turned on become eligible immediately, including their opening excerpts.
2. **Disabling is not retroactive.** It stops new baselines, re-bakes, and appends; chats that already carry a baseline keep sending it.
3. **Deleting a chat is not erasure.** Its title and excerpt survive in other chats' already-bound prompts, in persisted appends, and in receipts already issued.

A **presenting UI surface** SHALL state what is sent, that the destination is the model provider the operator configured and may be a third party, and that the setting is off by default. It SHALL NOT be required to reproduce the three consequences inline. This is a deliberate correction to an earlier reading of this requirement: stacking the full contract beside the control produced roughly 570 characters of consent prose against a single toggle, which is not read, and a disclosure that is not read discloses nothing. The consequences are therefore carried where they can be read as prose, and the surface carries the facts needed to answer the control in front of the owner. A surface SHALL NOT state or imply that disabling undoes prior sharing.

#### Scenario: A presenting surface states the destination and the default

- **WHEN** a UI surface renders the `shareRecentChats` control
- **THEN** it states what is sent, that the destination may be a third party, and that the setting is off by default
- **AND** it does not claim or imply that turning the setting off retracts what was already shared

#### Scenario: Owner retrieves their memory settings

- **WHEN** an authenticated user requests their memory settings
- **THEN** the response contains their stored values
- **AND** it contains no other user's data and no server-only or provider internals

#### Scenario: Caller supplies another user's identifier

- **WHEN** a request body or query attempts to target a different user id
- **THEN** the supplied identifier is ignored or rejected
- **AND** the operation applies only to the authenticated user

#### Scenario: Unauthenticated request

- **WHEN** an unauthenticated caller requests or updates memory settings
- **THEN** the request is rejected
- **AND** no setting value is disclosed
