## MODIFIED Requirements

### Requirement: Nested org-unit tree with materialized id-paths

The system SHALL model organizational units as an arbitrarily nested tree (`organization`, `group`, `team`, `department` node types), where each unit carries a materialized path composed of ancestor **ids** (`rootId/…/selfId`). A root unit's path SHALL be its own id. Renames SHALL never change any path; only moves SHALL.

`project` is NOT an org-unit type: projects are their own entity (see the `projects` capability) and the former `'project'` enum value is removed from the type vocabulary at the datastore level.

#### Scenario: Root creation

- **WHEN** an authenticated user creates a root org unit
- **THEN** the unit is persisted with `parent_id = NULL` and `path` equal to its own id, and the creator is recorded in `created_by`

#### Scenario: Child creation materializes the ancestor path

- **WHEN** a child is created under a parent with path `P`
- **THEN** the child's path is exactly `P/<child-id>`

#### Scenario: Rename does not touch paths

- **WHEN** a unit anywhere in a tree is renamed
- **THEN** no `path` value in the tree changes

#### Scenario: The project type value is gone

- **WHEN** a unit is created or updated with type `'project'` (via the API or direct SQL)
- **THEN** the write is rejected — the enum no longer contains the value and the create DTO no longer accepts it

#### Scenario: Stray project-typed rows are converted, not lost

- **WHEN** the vocabulary migration runs against a database containing `project`-typed org units
- **THEN** those rows are converted to type `'group'` and all their other columns (path, parent, memberships) are untouched
