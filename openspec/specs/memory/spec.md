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

The API MUST expose owner-scoped retrieval and partial update of memory settings under the established `api/v1/me` namespace. Identity MUST come only from the authenticated session, never client-supplied scope. A caller MUST NOT access another owner's settings by supplying an identifier. Requests MUST use a declared schema. Responses MUST use an explicit type and egress allowlist. Endpoints MUST appear in generated OpenAPI.

The `shareRecentChats` contract MUST disclose Chat titles, `chat://` locators, activity dates, message counts, bounded opening and latest visible excerpts, and canonical Workspace affinity. Latest excerpts can include assistant text. Workspace affinity includes the Machine name and canonical root, or `unbound`. The destination MUST be the operator-configured model provider. In a multi-user installation, that destination can be a third party unrelated to the owner.

The API contract and product documentation MUST disclose all three consequences:

1. Enabling immediately includes existing eligible Chats, including their excerpts and Workspace affinity.
2. Disabling stops new baselines, refreshes, and notices. Already-bound baseline items continue to replay, including across disabled compaction.
3. Deleting a source Chat does not erase its disclosure from other Chats' persisted digest items or historical receipts.

A presenting interface MUST state the sent fields, the configured provider destination, its possible third-party status, and the off-by-default setting. It need not repeat the three consequences inline. The API contract and product documentation MUST retain them. No interface can state or imply that disabling retracts prior disclosure.

#### Scenario: A presenting surface states the destination and the default

- **WHEN** an interface renders the `shareRecentChats` control
- **THEN** it states the sent fields, possible third-party destination, and off-by-default setting
- **AND** it does not imply that disabling retracts prior disclosure

#### Scenario: Owner retrieves their memory settings

- **WHEN** an authenticated owner requests their memory settings
- **THEN** the response contains their stored values
- **AND** it contains no other owner's data, server-only values, or provider internals

#### Scenario: Caller supplies another user's identifier

- **WHEN** a request body or query attempts to target another owner
- **THEN** the supplied identifier is ignored or rejected
- **AND** the operation applies only to the authenticated owner

#### Scenario: Unauthenticated request

- **WHEN** an unauthenticated caller requests or updates memory settings
- **THEN** the request is rejected
- **AND** no setting value is disclosed

#### Scenario: Consent names expanded rail disclosure

- **WHEN** the API contract and product documentation describe digest sharing
- **THEN** they name Chat locators, both bounded excerpts, canonical Workspace affinity, activity dates, and message counts alongside titles
- **AND** they describe persisted rail items without implying that deletion erases prior disclosure
