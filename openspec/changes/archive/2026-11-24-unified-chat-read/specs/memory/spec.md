## MODIFIED Requirements

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
