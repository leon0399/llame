# Spec: external-identities — canonical external identity mapping

## ADDED Requirements

### Requirement: One person, one account across providers

The system SHALL maintain a canonical mapping from `(provider, external_subject)` to exactly one llame user (e.g. `telegram` chat user id, `discord` user id, `oidc:<issuer>` subject), with optional provider metadata. The pair `(provider, external_subject)` SHALL be unique instance-wide. This mapping is distinct from web-login OAuth plumbing (NextAuth `accounts`).

#### Scenario: Duplicate external subject is rejected

- **WHEN** an external identity is linked with a `(provider, external_subject)` pair that is already mapped to any user
- **THEN** the link is rejected with a uniqueness conflict

#### Scenario: Multiple providers per user

- **WHEN** one user links identities from different providers
- **THEN** all resolve to that same user

### Requirement: Own-rows isolation under FORCE RLS

External identity rows SHALL be visible and mutable only to the owning user (FORCE row-level security on `app.current_user_id`); absent identity context yields zero rows. Channel ingress (v0.9) SHALL resolve identities through a dedicated service context, not user sessions — that context is out of scope here.

#### Scenario: Cross-tenant invisibility

- **WHEN** a user queries external identities
- **THEN** only rows with their own `user_id` are returned, and other users' rows cannot be read, updated, or deleted

#### Scenario: Unlink own identity

- **WHEN** a user deletes one of their own external identity rows
- **THEN** it is removed; deleting by id alone never affects another user's row

### Requirement: Lifecycle bound to the user

External identities SHALL be removed when their user is deleted (cascade).

#### Scenario: User deletion cleans up identities

- **WHEN** a user account is deleted
- **THEN** all of that user's external identity rows are removed
