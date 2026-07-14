# Spec: org-memberships — memberships, roles, and ownership lifecycle

## ADDED Requirements

### Requirement: Explicit memberships with read-time inheritance

The system SHALL store one explicit membership row per (user, org unit) with a role from the SPEC §7.3 set (`owner`, `admin`, `maintainer`, `member`, `viewer`, `guest`, `service_account`). Inherited memberships SHALL NOT be materialized: effective roles are resolved at read time along the unit's ancestor path, so subtree moves never rewrite membership rows.

#### Scenario: Duplicate grant is a conflict

- **WHEN** a membership is granted to a user who already holds one on that unit
- **THEN** the operation fails with a uniqueness conflict (HTTP 409) and never silently changes the existing role

### Requirement: Nearest-wins effective-role resolution (reporting)

Given a unit and a user's memberships along its ancestor path, the system SHALL report the role of the **nearest** (deepest) membership, with the supplying unit and an `inherited` flag. This resolution is reporting-only; datastore authorization gates are additive over the path (a deeper low-tier grant does not subtract an ancestor's admin power — deny semantics arrive with the policy engine, #45).

#### Scenario: Inherited role

- **WHEN** a user holds `admin` on an ancestor and nothing on the unit itself
- **THEN** resolution reports `admin`, `inherited = true`, via the ancestor unit

#### Scenario: Nearest membership wins for reporting

- **WHEN** a user holds `admin` on the root and `viewer` explicitly on a descendant unit
- **THEN** resolution for that descendant reports `viewer` (`inherited = false`)

#### Scenario: No membership on the path

- **WHEN** a user holds no membership anywhere on the unit's path
- **THEN** resolution returns null

### Requirement: Owner bootstrap

Creating a root org unit SHALL, in the same transaction, grant its creator an `owner` membership — an org can never exist ownerless at creation. This creator-self-grant of `owner` on a fresh root is the only owner-minting path available to non-owners.

#### Scenario: Atomic bootstrap

- **WHEN** a user creates a root org unit
- **THEN** the unit and the creator's `owner` membership commit together or not at all

### Requirement: Owner-tier grants; escalation blocked at the datastore

The datastore SHALL enforce: admin-tier (`owner`/`admin`) membership on the unit's path is required to grant, change, or revoke others' memberships; granting or setting a role **to `owner`** additionally requires the caller to hold `owner` on the path; and any operation **targeting an existing `owner` membership row** (demotion, revocation) SHALL likewise require owner-tier on the path — admins can neither mint nor manage owners. All of this holds including via direct SQL (defense-in-depth below the application layer).

#### Scenario: Admin grants a member

- **WHEN** a user with `admin` on an ancestor grants `member` on a descendant unit
- **THEN** the grant succeeds

#### Scenario: Admin cannot mint an owner

- **WHEN** a user whose best role on the path is `admin` attempts (via API or direct SQL) to grant or set `owner`
- **THEN** the datastore rejects the write

#### Scenario: Owner mints a co-owner

- **WHEN** a user holding `owner` on the unit's path grants `owner` to another user
- **THEN** the grant succeeds (co-ownership / transfer path)

#### Scenario: Admin cannot demote or revoke an owner

- **WHEN** a user whose best role on the path is `admin` attempts to change or delete an existing `owner` membership (even when other owners remain)
- **THEN** the datastore rejects the write

#### Scenario: Self-grant into a foreign org is denied

- **WHEN** a user with no role on a unit's path inserts a membership for themselves on it
- **THEN** the datastore rejects the write

### Requirement: Last-owner protection

The database SHALL refuse, independent of application code, any operation that would leave a **root** org unit without an `owner` membership — including demoting or revoking the last owner and cascade-deletion via user removal. Deleting the unit itself remains allowed.

#### Scenario: Last owner cannot leave

- **WHEN** the sole owner of a root org attempts to revoke their own membership or demote themselves
- **THEN** the operation is rejected with a conflict explaining ownership must be transferred first

#### Scenario: Deleting a last-owner user account is blocked

- **WHEN** a user who is the sole owner of any root org is deleted
- **THEN** the deletion is rejected until ownership is transferred or the org is deleted

#### Scenario: Co-owner may leave

- **WHEN** one of two owners of a root org revokes their own membership
- **THEN** the revocation succeeds

#### Scenario: Concurrent departures cannot orphan the org

- **WHEN** the only two owners of a root org attempt to leave in concurrent transactions
- **THEN** at most one departure commits; the other is rejected (serialized by the datastore, not application code)

### Requirement: Roster visibility for members

Any user with a membership on a unit's path SHALL be able to list that unit's membership rows (roster). Users with no role on the path SHALL see none of them. A user SHALL always see their own membership rows.

#### Scenario: Member sees the roster

- **WHEN** a `member` on a unit (or its ancestor) lists the unit's memberships
- **THEN** all membership rows attached to that unit are returned

#### Scenario: Cross-tenant roster is invisible

- **WHEN** a user lists memberships of a unit they have no path role on
- **THEN** zero rows are returned

### Requirement: Membership HTTP surface

The API SHALL expose under `/api/v1/org-units/:id/memberships`: roster (`GET`), grant (`POST` — all roles except `service_account`), role change (`PATCH …/:userId`), revoke (`DELETE …/:userId` — by an admin-tier caller or by the member themselves), and the caller's effective role (`GET …/me` returning role, via-unit, `inherited`). Datastore denials SHALL map to 403, missing user/unit to 404, duplicates and last-owner violations to 409.

#### Scenario: Member leaves a unit

- **WHEN** a non-owner member DELETEs their own membership on a unit
- **THEN** the membership is removed (204)

#### Scenario: Admin revokes another member

- **WHEN** an admin-tier caller DELETEs another user's membership on a unit they administer
- **THEN** the membership is removed

#### Scenario: Effective role endpoint

- **WHEN** a caller GETs `…/memberships/me` for a visible unit
- **THEN** the response reports their nearest-wins role, the supplying unit id, and whether it is inherited
