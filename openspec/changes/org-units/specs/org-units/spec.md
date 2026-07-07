# Spec: org-units — nested organizational units

## ADDED Requirements

### Requirement: Nested org-unit tree with materialized id-paths
The system SHALL model organizational units as an arbitrarily nested tree (`organization`, `group`, `team`, `department`, `project` node types), where each unit carries a materialized path composed of ancestor **ids** (`rootId/…/selfId`). A root unit's path SHALL be its own id. Renames SHALL never change any path; only moves SHALL.

#### Scenario: Root creation
- **WHEN** an authenticated user creates a root org unit
- **THEN** the unit is persisted with `parent_id = NULL` and `path` equal to its own id, and the creator is recorded in `created_by`

#### Scenario: Child creation materializes the ancestor path
- **WHEN** a child is created under a parent with path `P`
- **THEN** the child's path is exactly `P/<child-id>`

#### Scenario: Rename does not touch paths
- **WHEN** a unit anywhere in a tree is renamed
- **THEN** no `path` value in the tree changes

### Requirement: Per-node settings
Each org unit SHALL carry a `settings` JSON object (default `{}`) holding node-scoped configuration (SPEC §7.2). In this change the platform only stores and returns it; interpretation and inheritance are the config resolver's job (#46).

#### Scenario: Settings persist per node
- **WHEN** a unit is created with (or updated to hold) a settings object
- **THEN** subsequent reads of that unit return the same object, and other units' settings are unaffected

### Requirement: DB-enforced path/parent integrity
The database SHALL enforce, independent of application code, that at transaction commit every org unit satisfies: `parent_id IS NULL AND path = id`, or `path = (parent's current path) || '/' || id`. Violations SHALL abort the transaction.

#### Scenario: Direct SQL cannot corrupt the tree
- **WHEN** a write (any client, including direct SQL) commits an org unit whose path does not match its parent's current path
- **THEN** the transaction is rejected by the database

#### Scenario: Concurrent move and child-creation cannot produce a stale path
- **WHEN** a subtree move and a child creation under a unit in that subtree execute concurrently
- **THEN** the operations serialize (or one aborts with a retryable conflict) and the committed tree satisfies the path invariant

### Requirement: Subtree move
The system SHALL support moving a unit (with its whole subtree) under a new parent, or to root, rewriting every descendant path prefix consistently in one transaction. A move into the unit's own subtree SHALL be rejected.

#### Scenario: Move rewrites the whole subtree
- **WHEN** a unit with descendants is moved under a new parent
- **THEN** the unit's path becomes `<new parent path>/<unit-id>` and every descendant path is rebased onto the new prefix in the same transaction

#### Scenario: Move into own subtree is rejected
- **WHEN** a caller attempts to move a unit under itself or any of its descendants
- **THEN** the request fails with a validation error and no row changes

### Requirement: Deletion is explicit and leaf-first
Deleting an org unit SHALL be restricted to units without children (FK `RESTRICT` — no silent subtree cascade) and SHALL cascade-remove only that unit's memberships.

#### Scenario: Deleting a unit with children is refused
- **WHEN** a caller deletes a unit that has child units
- **THEN** the deletion is rejected

#### Scenario: Deleting a leaf removes its memberships
- **WHEN** a childless unit is deleted by an authorized caller
- **THEN** the unit and its membership rows are removed

### Requirement: Row-level-secured visibility and administration
All org-unit access SHALL be enforced by FORCE row-level security keyed on `app.current_user_id`: visibility requires a membership on the unit or any ancestor (or being the creator — bootstrap edge); creating children and updating requires an admin-tier (`owner`/`admin`) membership on the path; deleting requires `owner` on the path. Absent identity context SHALL yield zero rows (fail closed).

#### Scenario: Stranger sees nothing
- **WHEN** a user with no membership anywhere in a tree queries org units
- **THEN** no unit of that tree is returned, and creating a child under any of its units is denied by the datastore

#### Scenario: Unscoped context fails closed
- **WHEN** a query runs without `app.current_user_id` set
- **THEN** zero org-unit rows are visible and all writes are denied

### Requirement: Org-unit HTTP lifecycle surface
The API SHALL expose the full unit lifecycle RESTfully under `/api/v1/org-units`: list visible (path-ordered), create root, create child, fetch one, `PATCH` for rename and move (`parentId`, `null` promotes to root), and `DELETE` — each with class-validator DTOs, explicit response types, and OpenAPI annotations. Authorization failures SHALL surface as 403, invisibility as 404, integrity conflicts as 409.

#### Scenario: Move via PATCH
- **WHEN** an admin-tier caller PATCHes a unit with a new `parentId` they administer
- **THEN** the subtree is moved and the updated unit (new `path`) is returned

#### Scenario: Concurrent-reorganization conflict is honest
- **WHEN** a commit-time path-integrity violation is raised for an API write
- **THEN** the API responds 409 with retry guidance, not 500
